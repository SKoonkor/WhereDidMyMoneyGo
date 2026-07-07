"""Money-flow forecasting (config/forecast.json).

Models daily **income** and **expense** separately as harmonic regressions —
[intercept, linear trend, weekly + monthly Fourier terms] — fitted by
exponentially time-decayed weighted least squares (statsmodels WLS) so recent
behaviour dominates. Forecasts the future cumulative balance from the current net
worth, with uncertainty bands that grow with the horizon (driven by both income
and expense volatility).

Only the fit (`train_model`) needs statsmodels; prediction works from the stored
coefficients/covariance with numpy, so the model persists as plain JSON.
"""

import json
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_PATH = Path("config/forecast.json")

# Signed contribution of each transaction type to net worth (mirrors money_flow).
_SIGN = {"Income": 1, "Transfer-In": 1, "Income Balance": 1,
         "Expense": -1, "Transfer-Out": -1, "Expense Balance": -1}

_WEEKLY, _MONTHLY, _ANNUAL = 7.0, 30.44, 365.25

DEFAULT_CFG = {
    "half_life_days": 120,
    "harmonics": {"weekly": 2, "monthly": 2, "annual": 0},
}

_Z = {"50": 0.6745, "90": 1.6449}  # normal quantiles for the two bands


# ── Design matrix ─────────────────────────────────────────────────────────────

def _design_matrix(t: np.ndarray, cfg: dict) -> np.ndarray:
    """Columns [1, trend, weekly/monthly/annual Fourier] for day indices ``t``
    (days since the fit start). Column order is fixed by ``cfg`` so train and
    predict agree."""
    t = np.asarray(t, dtype=float)
    cols = [np.ones_like(t), t / 365.0]
    h = cfg.get("harmonics", DEFAULT_CFG["harmonics"])
    for period, key in ((_WEEKLY, "weekly"), (_MONTHLY, "monthly"), (_ANNUAL, "annual")):
        for k in range(1, int(h.get(key, 0)) + 1):
            ang = 2.0 * np.pi * k * t / period
            cols.append(np.sin(ang))
            cols.append(np.cos(ang))
    return np.column_stack(cols)


# ── Data helpers ──────────────────────────────────────────────────────────────

def _daily_series(df: pd.DataFrame, kind: str, start, end) -> np.ndarray:
    """Daily-summed amounts for ``kind`` ("Income"/"Expense"), 0-filled over the
    inclusive day range [start, end]."""
    idx = pd.date_range(start, end, freq="D")
    sub = df[df["Income/Expense"] == kind]
    if sub.empty:
        return np.zeros(len(idx))
    daily = sub.groupby(sub["Period"].dt.normalize())["Amount"].sum()
    return daily.reindex(idx, fill_value=0.0).to_numpy(dtype=float)


def _net_worth(df: pd.DataFrame) -> float:
    s = df["Income/Expense"].map(_SIGN).fillna(0.0) * df["Amount"]
    return float(s.sum())


def _fit_one(X: np.ndarray, y: np.ndarray, w: np.ndarray) -> dict:
    """Weighted least squares for one series → coef / cov / residual variance."""
    import statsmodels.api as sm
    res = sm.WLS(y, X, weights=w).fit()
    return {"coef": res.params.tolist(),
            "cov": np.asarray(res.cov_params()).tolist(),
            "sigma2": float(res.scale)}


# ── Train / persist ───────────────────────────────────────────────────────────

def train_model(df: pd.DataFrame, cfg: dict | None = None,
                path: str | Path = MODEL_PATH) -> dict:
    """Fit income & expense models with exponential recency weights and persist."""
    cfg = {**DEFAULT_CFG, **(cfg or {})}
    days = df["Period"].dt.normalize()
    start, end = days.min(), days.max()
    t = np.arange((end - start).days + 1, dtype=float)
    X = _design_matrix(t, cfg)

    # Most-recent day has weight 1; older days decay by the half-life.
    age = t[-1] - t
    w = 0.5 ** (age / float(cfg["half_life_days"]))

    inc = _fit_one(X, _daily_series(df, "Income", start, end), w)
    exp = _fit_one(X, _daily_series(df, "Expense", start, end), w)

    model = {
        "trained_at": datetime.now().isoformat(timespec="seconds"),
        "fit_start": start.date().isoformat(),
        "cfg": cfg,
        "income": inc,
        "expense": exp,
    }
    save_model(model, path)
    return model


def save_model(model: dict, path: str | Path = MODEL_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2, ensure_ascii=False)


def load_model(path: str | Path = MODEL_PATH) -> dict | None:
    path = Path(path)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ── Forecast ──────────────────────────────────────────────────────────────────

def forecast(df: pd.DataFrame, model: dict, horizon_days: int) -> dict:
    """Future cumulative-balance fan, anchored at the current net worth.

    Returns ``{dates, median, lo50, hi50, lo90, hi90, anchor_date, anchor_value}``
    with the anchor included as day 0 so the fan starts at today's balance.
    """
    cfg = model.get("cfg", DEFAULT_CFG)
    fit_start = pd.Timestamp(model["fit_start"])
    anchor_date = df["Period"].dt.normalize().max()
    anchor_value = _net_worth(df)

    inc, exp = model["income"], model["expense"]
    b_inc, b_exp = np.array(inc["coef"]), np.array(exp["coef"])
    cov_inc, cov_exp = np.array(inc["cov"]), np.array(exp["cov"])
    s2_inc, s2_exp = float(inc["sigma2"]), float(exp["sigma2"])

    anchor_idx = (anchor_date - fit_start).days
    future_t = np.arange(anchor_idx + 1, anchor_idx + int(horizon_days) + 1, dtype=float)
    Xf = _design_matrix(future_t, cfg)

    # Daily means (income & expense are non-negative → clamp), net = inc − exp.
    mu_inc = np.maximum(Xf @ b_inc, 0.0)
    mu_exp = np.maximum(Xf @ b_exp, 0.0)
    net = mu_inc - mu_exp

    dates = [anchor_date]
    median = [anchor_value]
    lo50, hi50, lo90, hi90 = [anchor_value], [anchor_value], [anchor_value], [anchor_value]

    cum = anchor_value
    resid_var = 0.0
    Sx = np.zeros(Xf.shape[1])
    for i in range(len(future_t)):
        cum += net[i]
        resid_var += s2_inc + s2_exp
        Sx += Xf[i]
        param_var = float(Sx @ cov_inc @ Sx + Sx @ cov_exp @ Sx)
        sd = float(np.sqrt(max(0.0, resid_var + param_var)))
        dates.append(anchor_date + pd.Timedelta(days=i + 1))
        median.append(cum)
        lo50.append(cum - _Z["50"] * sd)
        hi50.append(cum + _Z["50"] * sd)
        lo90.append(cum - _Z["90"] * sd)
        hi90.append(cum + _Z["90"] * sd)

    return {
        "dates": dates, "median": median,
        "lo50": lo50, "hi50": hi50, "lo90": lo90, "hi90": hi90,
        "anchor_date": anchor_date, "anchor_value": anchor_value,
        "trained_at": model.get("trained_at"),
    }

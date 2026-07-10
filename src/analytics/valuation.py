"""Intrinsic-value models (see docs/intrinsic_value_formulas.md).

Pure numpy/Python. Every model returns a per-share fair value (or None when its
required inputs are missing / a guardrail fails). ``run_all`` bundles them for the
page, and ``suitability`` explains when each model fits a given company.
"""

from __future__ import annotations

import numpy as np

# Method registry: key → display name (order shown on the page).
METHODS = [
    ("dcf", "Two-stage DCF (A)"),
    ("ddm", "Dividend Discount (D)"),
    ("ri", "Residual Income (E)"),
    ("pe", "Justified P/E (F)"),
    ("graham", "Graham (G)"),
    ("epv", "Earnings Power Value (G)"),
]


# ── Rates ─────────────────────────────────────────────────────────────────────

def cost_of_equity(rf: float, beta: float, erp: float) -> float:
    """CAPM: r_e = r_f + beta·ERP (beta defaults to 1 when unknown)."""
    return rf + (beta if beta is not None else 1.0) * erp


def wacc(re, rf, price, shares, debt, tax_rate=None, spread=0.015) -> float | None:
    """WACC = (E/V)·r_e + (D/V)·r_d·(1−τ) at market values (formula sheet §1.2).

    E = price·shares; r_d approximated as r_f + a credit spread (default 1.5%);
    τ defaults to the US statutory 21% when the effective rate is unknown. Falls
    back to r_e when the capital structure is unavailable (all-equity assumption)."""
    if re is None:
        return None
    if not price or not shares or shares <= 0:
        return re
    e = price * shares
    d = debt or 0.0
    if e + d <= 0:
        return re
    rd = (rf or 0.04) + spread
    tau = tax_rate if tax_rate is not None else 0.21
    tau = min(max(tau, 0.0), 0.5)                # clamp junk effective rates
    return (e * re + d * rd * (1 - tau)) / (e + d)


# ── Model A — two-stage FCF DCF ───────────────────────────────────────────────

def two_stage_dcf(fcf0, g1, g2, gT, r, cash, debt, shares, n1=5, n2=10) -> dict | None:
    """Fair value + the discounted-FCF path (for the breakdown chart).

    EV = Σ FCF_t/(1+r)^t + TV/(1+r)^n2 ; fair = (EV + cash − debt)/shares.
    n/a for non-positive base FCF — compounding a negative FCF just extrapolates
    losses forever and yields a meaningless (deeply negative) value (banks etc.;
    the formula sheet routes those to DDM / Residual Income instead)."""
    if not fcf0 or fcf0 <= 0 or not shares or shares <= 0 or r is None or gT is None:
        return None
    if r <= gT:  # HARD guardrail: terminal growth must be below the discount rate
        return None
    pv_by_year, fcf = [], float(fcf0)
    for t in range(1, n2 + 1):
        fcf *= (1 + (g1 if t <= n1 else g2))
        pv_by_year.append(fcf / (1 + r) ** t)
    tv = fcf * (1 + gT) / (r - gT)
    tv_pv = tv / (1 + r) ** n2
    ev = sum(pv_by_year) + tv_pv
    fair = (ev + (cash or 0) - (debt or 0)) / shares
    return {"fair": fair, "pv_by_year": pv_by_year, "tv_pv": tv_pv, "ev": ev}


# ── Model D — dividend discount (H-model) ─────────────────────────────────────

def ddm(d0, gS, gL, re, h=5.0) -> float | None:
    """H-model: dividend growth fades linearly from gS to gL over 2H years.

    P0 = [D0·(1+gL) + D0·H·(gS−gL)] / (re − gL). Collapses to Gordon when gS==gL.
    (The old version compounded dividends at the stage-1 *earnings* growth for 10
    straight years, which inflated payers with high analyst growth far above every
    other model — dividends cannot track EPS growth for a decade.)"""
    if not d0 or re is None or re <= gL:
        return None
    d0 = float(d0)
    return (d0 * (1 + gL) + d0 * h * (gS - gL)) / (re - gL)


# ── Model E — residual income ─────────────────────────────────────────────────

def residual_income(book0, roe, re, payout=None, n=10) -> float | None:
    """V = B0 + Σ (ROE_t − r_e)·B_{t−1}/(1+r_e)^t with two standard disciplines:

    * clean surplus — book compounds by what is actually retained,
      B_t = B_{t−1}·(1 + ROE_t·retention);
    * fade — ROE declines linearly to r_e by year ``n`` (competition erodes excess
      returns), so post-fade residual income is zero and no terminal term is
      needed. If ROE == r_e throughout, V == B0 exactly.
    """
    if not book0 or roe is None or re is None or re <= 0:
        return None
    retention = 1.0 - payout if payout is not None else 1.0
    retention = min(max(retention, 0.0), 1.0)
    v, b = float(book0), float(book0)
    for t in range(1, n + 1):
        roe_t = roe + (re - roe) * t / n         # linear fade: roe → re at t = n
        v += (roe_t - re) * b / (1 + re) ** t
        b *= (1 + roe_t * retention)             # clean-surplus book growth
    return v


# ── Model F — justified P/E ───────────────────────────────────────────────────

def justified_pe(eps, payout, roe, re) -> float | None:
    """Fair = EPS·payout·(1+g)/(r_e − g), with the *sustainable* growth the payout
    actually funds: g = ROE·(1−payout) (CFA convention). Internally consistent —
    the old version paired the real payout with terminal growth, which priced
    low-payout compounders at absurdly low multiples.

    n/a when the firm pays (almost) nothing out, when ROE is unknown, or when
    sustainable growth ≥ r_e (the Gordon algebra breaks for such firms)."""
    if not eps or eps <= 0 or re is None or roe is None:
        return None
    if payout is None or payout < 0.01 or payout > 1.0:
        return None                              # zero/near-zero payout → n/a, not 0
    g = roe * (1 - payout)                       # sustainable growth
    if g >= re:
        return None
    return eps * payout * (1 + g) / (re - g)


# ── Model G — Graham & Earnings Power Value ───────────────────────────────────

def graham(eps, g, y) -> float | None:
    """Graham revised (1974): V = EPS·(8.5 + 2g)·4.4/Y (g, Y whole-number percents).

    g is capped at 15 — Graham meant a conservative 7–10-year growth estimate, and
    an uncapped analyst rate (up to 25) turns the multiplier into 58.5×."""
    if not eps or eps <= 0 or y is None or y <= 0:
        return None
    g = min(g, 15.0)
    return eps * (8.5 + 2 * g) * 4.4 / y


def epv(ebit, tau, wacc, cash, debt, shares) -> float | None:
    """Earnings Power Value (zero-growth): NOPAT/WACC bridged to equity."""
    if not ebit or not shares or shares <= 0 or not wacc:
        return None
    nopat = ebit * (1 - (tau if tau is not None else 0.21))
    return (nopat / wacc + (cash or 0) - (debt or 0)) / shares


# ── Model H — reverse DCF (implied stage-1 growth) ────────────────────────────

def reverse_dcf(price, fcf0, gT, r, cash, debt, shares, n1=5, n2=10) -> float | None:
    """Implied g1 (with g2=g1/2) that makes the DCF fair value equal the price."""
    if not price or not fcf0 or not shares:
        return None

    def fv(g1):
        res = two_stage_dcf(fcf0, g1, g1 / 2, gT, r, cash, debt, shares, n1, n2)
        return res["fair"] if res else None

    lo, hi = -0.5, 0.6
    flo = fv(lo)
    if flo is None:
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        val = fv(mid)
        if val is None:
            return None
        if val < price:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ── Margin of safety / scenarios / sensitivity ────────────────────────────────

def margin_of_safety(fair, price) -> float | None:
    if fair is None or not price:
        return None
    return fair / price - 1.0  # >0 undervalued


def _disc(a) -> float:
    """DCF/EPV discount rate: WACC per the pairing rule (r_e fallback)."""
    return a.get("wacc") if a.get("wacc") else a["r"]


def _dcf_kwargs(inp, a):
    return dict(fcf0=inp.get("fcf0"), gT=a["gT"], r=_disc(a),
               cash=inp.get("cash"), debt=inp.get("debt"), shares=inp.get("shares"))


def scenarios(inp, a) -> dict:
    """Bear/Base/Bull DCF fair values by shifting growth & discount rate."""
    out = {}
    for name, dg, dr in (("Bear", -0.03, +0.01), ("Base", 0.0, 0.0),
                         ("Bull", +0.03, -0.01)):
        res = two_stage_dcf(inp.get("fcf0"), a["g1"] + dg, a["g2"] + dg, a["gT"],
                            _disc(a) + dr, inp.get("cash"), inp.get("debt"),
                            inp.get("shares"))
        out[name] = res["fair"] if res else None
    return out


def sensitivity_grid(inp, a, r_vals, gT_vals) -> np.ndarray:
    """2-D fair-value matrix over discount rate (rows) × terminal growth (cols)."""
    grid = np.full((len(r_vals), len(gT_vals)), np.nan)
    for i, r in enumerate(r_vals):
        for j, gT in enumerate(gT_vals):
            res = two_stage_dcf(inp.get("fcf0"), a["g1"], a["g2"], gT, r,
                               inp.get("cash"), inp.get("debt"), inp.get("shares"))
            if res:
                grid[i, j] = res["fair"]
    return grid


# ── Suitability notes (formula sheet §6 + per-model caveats) ───────────────────

_FINANCIAL = {"Financial Services", "Financials"}


def suitability(key: str, inp: dict) -> str:
    sector = inp.get("sector") or "Unknown"
    is_fin = sector in _FINANCIAL
    has_div = bool(inp.get("dividend"))
    fcf = inp.get("fcf0")
    roe = inp.get("roe")
    if key == "dcf":
        if is_fin:
            return "Caution: FCF is ill-defined for financials — prefer DDM / Residual Income."
        if not fcf or fcf <= 0:
            return "Caution: negative/uneven FCF makes the DCF unreliable."
        return "Best for predictable cash generators. Discounted at WACC."
    if key == "ddm":
        if not has_div:
            return "n/a — company pays no dividend."
        note = ("Strong fit: banks/insurers are best valued on dividends."
                if is_fin else
                f"Fits mature payers (yield {inp['dividend'] / inp['price'] * 100:.1f}%).")
        return note + " H-model: growth fades g1 → g_T over ~10y."
    if key == "ri":
        if is_fin:
            return "Strong fit: book value is meaningful for financials; robust vs DCF."
        if roe is not None and roe > 0.40:
            return ("Caution: ROE inflated by buybacks/small book equity — "
                    "book-based value unreliable here.")
        return "Good where book value is meaningful; ROE fades to r_e over 10y (no terminal)."
    if key == "pe":
        if inp.get("payout") is None or (inp.get("payout") or 0) < 0.01:
            return "n/a — needs a real payout ratio (Gordon algebra)."
        if roe is not None and roe * (1 - (inp.get("payout") or 0)) >= 0.06:
            return "Uses sustainable g = ROE·retention; n/a when that ≥ r_e."
        return "Market-anchored multiple from payout & sustainable growth — cross-check only."
    if key == "graham":
        return ("Toy-tier heuristic (Graham 1974; growth capped at 15, AAA yield "
                "≈ r_f + 1%) — sanity check only, not for cyclicals.")
    if key == "epv":
        return ("Zero-growth earnings power (Greenwald) at WACC — a conservative "
                "floor. Assumes current EBIT is normal (mid-cycle).")
    return ""


# ── Bundle all methods for the page ───────────────────────────────────────────

def run_all(inp: dict, a: dict) -> tuple[list[dict], dict | None, dict]:
    """Every method's fair value + MoS + note, honouring the pairing rule:
    FCF-based models (DCF, EPV) discount at WACC; dividend/book-based models
    (DDM, RI, justified P/E) at the cost of equity r_e.

    Returns (per-method results, dcf detail, extras) where extras carries the
    terminal-value share of the DCF and the reverse-DCF market-implied growth."""
    re = a["r"]                                  # cost of equity (CAPM)
    price = inp.get("price")
    dcf = two_stage_dcf(**_dcf_kwargs(inp, a), g1=a["g1"], g2=a["g2"])
    values = {
        "dcf": dcf["fair"] if dcf else None,
        "ddm": ddm(inp.get("dividend"), a["g1"], a["gT"], re),
        "ri": residual_income(inp.get("book_value"), inp.get("roe"), re,
                              inp.get("payout")),
        "pe": justified_pe(inp.get("eps"), inp.get("payout"), inp.get("roe"), re),
        "graham": graham(inp.get("eps"), a["g1"] * 100, (a["rf"] + 0.01) * 100),
        "epv": epv(inp.get("ebit"), inp.get("tax_rate"), _disc(a),
                   inp.get("cash"), inp.get("debt"), inp.get("shares")),
    }
    out = []
    for key, name in METHODS:
        fair = values[key]
        out.append({"key": key, "name": name, "fair": fair,
                    "mos": margin_of_safety(fair, price),
                    "note": suitability(key, inp)})
    extras = {
        "tv_share": (dcf["tv_pv"] / dcf["ev"]) if dcf and dcf["ev"] else None,
        "implied_g1": reverse_dcf(price, inp.get("fcf0"), a["gT"], _disc(a),
                                  inp.get("cash"), inp.get("debt"),
                                  inp.get("shares")),
    }
    return out, dcf, extras

"""Monte Carlo retirement projection (pure — no Dash).

The deterministic :func:`src.analytics.retirement.compute_retirement` applies one
fixed return, one fixed inflation and one fixed raise every year. Real markets vary
year to year, and the *order* of good and bad years matters (a crash just after you
retire is far worse than one late in life). This module expresses that uncertainty by
simulating the balance **path** many times: at each step a fresh random investment
return is drawn (and, per year, a random inflation and salary-raise), the balance is
rolled forward, and the spread across ``n_mc`` paths is summarised as month-by-month
percentiles — a stable median line with nested uncertainty bands.

Fixed (never randomised): current age, retirement age, life expectancy, principal and
the *initial* monthly deposit. Randomised (each with its own volatility): the annual
investment return, inflation, and the yearly deposit-increase rate.

**Return model.** Monthly log-returns are Normal. With annual mean ``μ`` and annual
volatility ``σ_r``, the monthly volatility is ``s = σ_r/√12`` and the monthly log-mean
is ``m = ln(1+μ)/12 − s²/2``; the monthly gross factor ``exp(Normal(m, s))`` then has
expectation ``(1+μ)**(1/12)`` — exactly the deterministic monthly factor, so at
``σ_r = 0`` every path collapses onto ``compute_retirement``.

**Inflation / deposit-growth models.** One draw per year (held across its 12 months),
Normal around the entered rate with its own volatility, floored just above ``-100%``.
Inflation compounds into a per-path price index (expense growth + today's-money
deflator); deposit growth compounds the raise.

The simulation is vectorised over paths: a length-``n_mc`` balance vector is rolled
through the ~660 months once, so ``n_mc=1000`` runs in well under a second.
"""

from __future__ import annotations

import numpy as np

from src.analytics.retirement import _monthly_rate


def _pct(arr: np.ndarray) -> dict:
    """Month-by-month 16/50/84th percentiles across paths (``arr`` is ``(months, n_mc)``).
    16–84% is the central ±1σ range — the single band the chart draws."""
    p = np.percentile(arr, [16, 50, 84], axis=1)
    return {"p16": p[0], "p50": p[1], "p84": p[2]}


def _event_pcts(months: np.ndarray, current_age: float) -> dict | None:
    """Turn a per-path event month (``-1`` where the event never happened) into the
    16/50/84th-percentile *ages* over the paths where it did occur, plus ``prob`` (the
    fraction that occurred). Returns ``None`` if the event never happened on any path."""
    occurred = months[months >= 0]
    if occurred.size == 0:
        return None
    p = np.percentile(current_age + occurred / 12.0, [16, 50, 84])
    return {"p16": float(p[0]), "p50": float(p[1]), "p84": float(p[2]),
            "prob": float(occurred.size / months.size)}


def simulate_retirement_mc(current_age: float, retirement_age: float,
                           life_expectancy: float, principal: float,
                           monthly_deposit: float, increasement: float,
                           annual_rate: float, inflation: float,
                           retirement_bonus: float = 0.0, pension: float = 0.0,
                           expense: float = 0.0, goals=None,
                           vol_return: float = 0.0, vol_inflation: float = 0.0,
                           vol_deposit: float = 0.0, n_mc: int = 1000,
                           seed: int = 12345) -> dict:
    """Monte Carlo version of ``compute_retirement``.

    ``vol_return``/``vol_inflation``/``vol_deposit`` are the annual volatilities
    (decimals) of the investment return, inflation and deposit-increase rate. ``goals``
    is an optional ``[(name, amount, factor)]`` list in rank order. Returns a dict of
    per-month percentile arrays for each plotted series plus summary stats.
    """
    current_age = float(current_age or 0)
    retirement_age = max(current_age, float(retirement_age or 0))
    life_expectancy = max(retirement_age, float(life_expectancy or 0))

    g = float(increasement or 0.0)
    infl = float(inflation or 0.0)
    D0 = float(monthly_deposit or 0.0)
    pension = float(pension or 0.0)
    expense0 = float(expense or 0.0)
    bonus = float(retirement_bonus or 0.0)
    P = float(principal or 0.0)

    n_mc = max(int(n_mc or 1), 1)
    total_months = int(round((life_expectancy - current_age) * 12))
    retire_month = int(round((retirement_age - current_age) * 12))
    total_months = max(total_months, retire_month, 1)
    n_years = total_months // 12 + 2

    ages = current_age + np.arange(total_months + 1) / 12.0
    rng = np.random.default_rng(seed)

    # ── Random draws (shared across the baseline/×factor/plain trajectories) ──────
    # Monthly gross investment return: lognormal, mean-matched to (1+annual_rate)^(1/12).
    s = float(vol_return or 0.0) / np.sqrt(12.0)
    m = np.log(max(1.0 + float(annual_rate or 0.0), 1e-9)) / 12.0 - 0.5 * s * s
    ret_gross = np.exp(rng.normal(m, s, size=(total_months + 1, n_mc)))   # R[0] unused

    # Per-year inflation and deposit-growth draws (held across each year's 12 months).
    phi_year = np.clip(rng.normal(infl, float(vol_inflation or 0.0),
                                  size=(n_years, n_mc)), -0.999, None)
    g_year = np.clip(rng.normal(g, float(vol_deposit or 0.0),
                                size=(n_years, n_mc)), -0.999, None)

    # Deposit multiplier for year y = product of (1+raise) over the prior years
    # (year 0 → 1.0, matching the deterministic (1+g)^year).
    cprod = np.cumprod(1.0 + g_year, axis=0)
    deposit_factor = np.vstack([np.ones((1, n_mc)), cprod[:-1]])

    # Monthly price index (per path): month t uses year (t-1)//12's inflation draw.
    mult = np.ones((total_months + 1, n_mc))
    if total_months >= 1:
        yr_idx = (np.arange(1, total_months + 1) - 1) // 12
        mult[1:] = (1.0 + phi_year[yr_idx]) ** (1.0 / 12.0)
    price_index = np.cumprod(mult, axis=0)
    expense_nominal = expense0 * price_index                      # shape (T+1, n_mc)

    def _run(targets: np.ndarray, amounts: np.ndarray):
        """Roll every path forward, buying goals (FIFO by rank) as reached. Returns
        ``(nominal, dep_month, depleted, hit_month)`` — ``nominal`` is ``(T+1, n_mc)`` and
        ``hit_month`` is ``(n_goals, n_mc)`` (the month each goal was bought, ``-1`` if
        never)."""
        ng = len(targets)
        nominal = np.empty((total_months + 1, n_mc))
        bal = np.full(n_mc, P, dtype=float)
        gp = np.zeros(n_mc, dtype=int)               # next unbought goal per path
        depleted = np.zeros(n_mc, dtype=bool)
        dep_month = np.full(n_mc, -1, dtype=int)
        hit_month = np.full((max(ng, 1), n_mc), -1, dtype=int)

        def _buy(t):
            if ng == 0:
                return
            while True:
                has = gp < ng
                if not has.any():
                    break
                cur = np.minimum(gp, ng - 1)         # clamp OOB pointers
                can = has & (bal >= targets[cur])
                if not can.any():
                    break
                idx = np.nonzero(can)[0]
                hit_month[cur[can], idx] = t         # record which goal each path bought
                bal[can] -= amounts[cur][can]
                gp[can] += 1

        _buy(0)
        nominal[0] = bal
        for t in range(1, total_months + 1):
            if t <= retire_month:
                bal = (bal + D0 * deposit_factor[(t - 1) // 12]) * ret_gross[t]
                if t == retire_month:
                    bal = bal + bonus
            else:
                bal = (bal + pension - expense_nominal[t]) * ret_gross[t]
            _buy(t)
            hit = (~depleted) & (bal <= 0.0)
            dep_month[hit] = t
            depleted |= bal <= 0.0
            bal = np.maximum(bal, 0.0)
            nominal[t] = bal
        return nominal, dep_month, depleted, hit_month

    def _freedom_months(targets: np.ndarray, amounts: np.ndarray) -> np.ndarray:
        """Per-path financial-freedom month: the first month at which — on a pure
        accumulation path (deposits keep going, no draw-down/bonus) with every goal
        already bought — the pot's expected monthly return covers the month's expense net
        of pension. Uses this run's stochastic returns/inflation/deposit growth; the
        coverage test uses the mean monthly rate ``i_mean``. ``-1`` if never reached."""
        i_mean = max(1.0 + float(annual_rate or 0.0), 1e-9) ** (1.0 / 12.0) - 1.0
        ng = len(targets)
        bal = np.full(n_mc, P, dtype=float)
        gp = np.zeros(n_mc, dtype=int)
        freed = np.full(n_mc, -1, dtype=int)

        def _buy():
            if ng == 0:
                return
            while True:
                has = gp < ng
                if not has.any():
                    break
                cur = np.minimum(gp, ng - 1)
                can = has & (bal >= targets[cur])
                if not can.any():
                    break
                bal[can] -= amounts[cur][can]
                gp[can] += 1

        def _check(t):
            net = expense0 * price_index[t] - pension        # per path
            ok = (gp >= ng) & (bal * i_mean >= net) & (freed < 0)
            freed[ok] = t

        _buy()
        _check(0)
        for t in range(1, total_months + 1):
            bal = (bal + D0 * deposit_factor[(t - 1) // 12]) * ret_gross[t]
            _buy()
            _check(t)
        return freed

    has_goals = bool(goals)
    result = {"ages": ages, "n_mc": n_mc, "has_goals": has_goals}

    empty = np.empty(0)
    base_nom, base_dep, base_depleted, _bh = _run(empty, empty)
    result["nominal"] = _pct(base_nom)
    result["real"] = _pct(base_nom / price_index)

    if has_goals:
        amounts = np.array([float(a) for _n, a, _f in goals])
        f_targets = np.array([float(a) * float(f) for _n, a, f in goals])
        p_targets = amounts.copy()
        f_nom, f_dep, f_depleted, f_hits = _run(f_targets, amounts)
        p_nom, _pd, _pdep, _ph = _run(p_targets, amounts)
        result["factor_nominal"] = _pct(f_nom)
        result["factor_real"] = _pct(f_nom / price_index)
        result["plain_nominal"] = _pct(p_nom)
        dep_month, depleted = f_dep, f_depleted          # ×factor is the primary plan
        # Per-goal achievement age spread (×factor plan), aligned to the goal order.
        result["goal_events"] = [
            {"name": nm, **(_event_pcts(f_hits[k], current_age)
                            or {"prob": 0.0})}
            for k, (nm, _a, _f) in enumerate(goals)]
        freedom_targets, freedom_amounts = f_targets, amounts
    else:
        dep_month, depleted = base_dep, base_depleted
        freedom_targets, freedom_amounts = empty, empty

    # Probability the money lasts to life expectancy, and the age spreads of the
    # freedom / depletion events (16–84th percentile over the paths where they occur).
    result["success_prob"] = float(np.mean(~depleted))
    result["depletion"] = _event_pcts(dep_month, current_age)
    result["freedom"] = _event_pcts(
        _freedom_months(freedom_targets, freedom_amounts), current_age)
    return result

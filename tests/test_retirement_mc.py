"""Monte Carlo retirement projection: path simulation, 16–84% bands, event spreads.

``simulate_retirement_mc`` is pure numpy (no Dash/I/O). At zero volatility every path is
identical, so it must reproduce the deterministic ``compute_retirement`` — the anchor
these tests lean on. Series and event spreads are reported as 16/50/84th percentiles.
"""

import numpy as np

from src.analytics.retirement import compute_retirement
from src.analytics.retirement_mc import simulate_retirement_mc


def _plan(**over):
    base = dict(current_age=30, retirement_age=60, life_expectancy=85, principal=0,
                monthly_deposit=10_000, increasement=0.03, annual_rate=0.06,
                inflation=0.03, retirement_bonus=0.0, pension=0.0, expense=30_000)
    base.update(over)
    return base


# ── Zero-volatility equivalence (the correctness anchor) ─────────────────────────

def test_zero_vol_median_matches_deterministic():
    plan = _plan()
    det = compute_retirement(**plan)
    mc = simulate_retirement_mc(**plan, vol_return=0, vol_inflation=0, vol_deposit=0,
                                n_mc=64)
    assert np.allclose(mc["nominal"]["p50"], det["balance_nominal"], rtol=1e-6, atol=1e-3)
    assert np.allclose(mc["real"]["p50"], det["balance_real"], rtol=1e-6, atol=1e-3)


def test_zero_vol_bands_collapse():
    mc = simulate_retirement_mc(**_plan(), vol_return=0, vol_inflation=0, vol_deposit=0,
                                n_mc=64)
    n = mc["nominal"]
    assert np.max(n["p84"] - n["p16"]) == 0.0        # every path identical


def test_zero_vol_goal_trajectories_match():
    plan = _plan(monthly_deposit=20_000, expense=15_000, goals=[("Car", 500_000, 2)])
    det = compute_retirement(**plan)
    mc = simulate_retirement_mc(**plan, vol_return=0, vol_inflation=0, vol_deposit=0,
                                n_mc=64)
    assert np.allclose(mc["factor_nominal"]["p50"], det["balance_factor_nominal"],
                       rtol=1e-6, atol=1e-3)
    assert np.allclose(mc["plain_nominal"]["p50"], det["balance_plain_nominal"],
                       rtol=1e-6, atol=1e-3)


def test_zero_vol_freedom_matches_deterministic():
    plan = _plan(monthly_deposit=20_000, expense=15_000)
    det = compute_retirement(**plan)
    mc = simulate_retirement_mc(**plan, vol_return=0, vol_inflation=0, vol_deposit=0,
                                n_mc=32)
    assert det["financial_freedom_age"] is not None
    assert mc["freedom"] is not None
    assert abs(mc["freedom"]["p50"] - det["financial_freedom_age"]) < 1e-6
    assert mc["freedom"]["p16"] == mc["freedom"]["p84"] == mc["freedom"]["p50"]


def test_zero_vol_goal_events_match_deterministic_ages():
    plan = _plan(monthly_deposit=20_000, expense=15_000,
                 goals=[("Car", 500_000, 2), ("House", 3_000_000, 1)])
    det = compute_retirement(**plan)
    mc = simulate_retirement_mc(**plan, vol_return=0, vol_inflation=0, vol_deposit=0,
                                n_mc=32)
    det_age = {h["name"]: h["age"] for h in det["goal_hits_factor"]}
    for ev in mc["goal_events"]:
        assert ev["name"] in det_age
        assert abs(ev["p50"] - det_age[ev["name"]]) < 1e-6
        assert ev["p16"] == ev["p84"] == ev["p50"]


# ── Percentile / event structure ─────────────────────────────────────────────────

def test_series_percentiles_ordered_everywhere():
    mc = simulate_retirement_mc(**_plan(), vol_return=0.15, vol_inflation=0.01,
                                vol_deposit=0.02, n_mc=500)
    p = mc["nominal"]
    assert np.all(p["p16"] <= p["p50"]) and np.all(p["p50"] <= p["p84"])


def test_events_ordered_and_prob_in_unit_interval():
    plan = _plan(monthly_deposit=20_000, expense=15_000,
                 goals=[("Car", 500_000, 2), ("House", 3_000_000, 1)])
    mc = simulate_retirement_mc(**plan, vol_return=0.15, vol_inflation=0.01,
                                vol_deposit=0.02, n_mc=800)
    for ev in [mc["freedom"], mc["depletion"], mc["depletion_plain"],
               *mc["goal_events"]]:
        if ev is None or ev.get("prob", 0) == 0:
            continue
        # Depletion percentiles may be censored (None = past life expectancy);
        # the non-censored ones must be ordered and Nones only appear at the top.
        vals = [ev["p16"], ev["p50"], ev["p84"]]
        known = [v for v in vals if v is not None]
        assert known == sorted(known)
        assert all(v is None for v in vals[len(known):])
        assert 0.0 <= ev["prob"] <= 1.0


def test_higher_return_volatility_widens_band():
    lo = simulate_retirement_mc(**_plan(), vol_return=0.05, n_mc=500)
    hi = simulate_retirement_mc(**_plan(), vol_return=0.25, n_mc=500)
    m = len(lo["ages"]) // 2
    lo_w = lo["nominal"]["p84"][m] - lo["nominal"]["p16"][m]
    hi_w = hi["nominal"]["p84"][m] - hi["nominal"]["p16"][m]
    assert hi_w > lo_w


def test_higher_volatility_widens_freedom_range():
    # A well-funded plan reaches freedom in ~every run, so the band exists at both vols.
    plan = _plan(monthly_deposit=20_000, expense=15_000)
    lo = simulate_retirement_mc(**plan, vol_return=0.05, n_mc=1500)
    hi = simulate_retirement_mc(**plan, vol_return=0.25, n_mc=1500)
    assert lo["freedom"] is not None and hi["freedom"] is not None
    assert (hi["freedom"]["p84"] - hi["freedom"]["p16"]) > \
           (lo["freedom"]["p84"] - lo["freedom"]["p16"])


def test_higher_volatility_widens_depletion_range():
    # A deeply underfunded plan runs out in (almost) every run at both vols, so
    # the 16th and 84th percentiles stay within the horizon (not censored).
    plan = _plan(monthly_deposit=5_000, expense=40_000)
    lo = simulate_retirement_mc(**plan, vol_return=0.05, n_mc=1500)
    hi = simulate_retirement_mc(**plan, vol_return=0.25, n_mc=1500)
    assert lo["depletion"] is not None and hi["depletion"] is not None
    assert lo["depletion"]["p84"] is not None and hi["depletion"]["p84"] is not None
    assert (hi["depletion"]["p84"] - hi["depletion"]["p16"]) > \
           (lo["depletion"]["p84"] - lo["depletion"]["p16"])


# ── Fixed vs random parameters ───────────────────────────────────────────────────

def test_fixed_params_identical_across_paths():
    mc = simulate_retirement_mc(**_plan(principal=250_000), vol_return=0.2,
                                vol_inflation=0.05, n_mc=400)
    n = mc["nominal"]
    assert n["p16"][0] == n["p84"][0] == 250_000


# ── Success probability & depletion event ────────────────────────────────────────

def test_success_prob_in_unit_interval():
    mc = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=500)
    assert 0.0 <= mc["success_prob"] <= 1.0


def test_higher_expense_lowers_success():
    easy = simulate_retirement_mc(**_plan(monthly_deposit=25_000, expense=12_000),
                                  vol_return=0.15, n_mc=800)
    hard = simulate_retirement_mc(**_plan(monthly_deposit=25_000, expense=45_000),
                                  vol_return=0.15, n_mc=800)
    assert hard["success_prob"] < easy["success_prob"]


def test_big_goal_lowers_success():
    base = simulate_retirement_mc(**_plan(monthly_deposit=20_000, expense=15_000),
                                  vol_return=0.15, n_mc=800)
    withg = simulate_retirement_mc(
        **_plan(monthly_deposit=20_000, expense=15_000, goals=[("House", 4_000_000, 1)]),
        vol_return=0.15, n_mc=800)
    assert withg["success_prob"] <= base["success_prob"]


def test_depletion_event_within_horizon_or_none():
    mc = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=500)
    dep = mc["depletion"]
    if dep is not None:
        known = [v for v in (dep["p16"], dep["p50"], dep["p84"]) if v is not None]
        assert known == sorted(known)
        assert all(60 <= v <= 85 for v in known)


def test_depletion_percentiles_match_band_zero_crossings():
    """The whole point of the all-runs statistic: the table's 16%/50% funds-out ages
    must equal (within a month) where the chart band's p16/p50 curves reach zero."""
    plan = _plan()                       # underfunded defaults: most runs deplete
    mc = simulate_retirement_mc(**plan, vol_return=0.15, vol_inflation=0.01,
                                vol_deposit=0.02, n_mc=1000)
    ages = mc["ages"]
    ret_idx = int((plan["retirement_age"] - plan["current_age"]) * 12)
    for key in ("p16", "p50"):
        assert mc["depletion"][key] is not None
        curve = mc["nominal"][key][ret_idx:]
        assert (curve <= 0).any()
        zero_age = ages[ret_idx + int(np.argmax(curve <= 0))]
        assert abs(zero_age - mc["depletion"][key]) <= 1.0 / 12 + 1e-9


def test_depletion_censored_past_life_expectancy():
    # A well-funded plan: more than 16% of runs never deplete, so the 84th
    # percentile is censored (None → shown as "85+"), while prob stays the
    # depleted fraction.
    mc = simulate_retirement_mc(**_plan(monthly_deposit=25_000, expense=12_000),
                                vol_return=0.15, n_mc=800)
    assert mc["success_prob"] > 0.16
    dep = mc["depletion"]
    if dep is not None:                  # some run must fail for the event to exist
        assert dep["p84"] is None
        assert 0.0 < dep["prob"] < 1.0


# ── Reproducibility ──────────────────────────────────────────────────────────────

def test_same_seed_reproducible():
    a = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=300, seed=7)
    b = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=300, seed=7)
    assert np.array_equal(a["nominal"]["p50"], b["nominal"]["p50"])
    assert a["success_prob"] == b["success_prob"]


def test_different_seed_differs():
    a = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=300, seed=1)
    b = simulate_retirement_mc(**_plan(), vol_return=0.15, n_mc=300, seed=2)
    assert not np.array_equal(a["nominal"]["p50"], b["nominal"]["p50"])

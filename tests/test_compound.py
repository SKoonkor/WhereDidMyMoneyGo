"""Compound-growth schedule: totals, goal buying order, and invariants.

``compute_schedule`` lives under src/app/figures/ but imports cleanly without
Dash (only numpy/plotly/theme), so it is a pure-calc target.
"""

from pytest import approx

from src.app.figures.compound import compute_schedule


def _sched(goals=None):
    return compute_schedule(0, 5_000, 120, 0.10, "Annually", goals=goals)


def test_totals_and_apy():
    s = _sched()
    assert s["total_principal"] == 5_000 * 120       # P=0, cumulative deposits
    assert s["maturity_value"] > s["total_principal"]  # growth beats contributions
    assert s["apy"] == approx(0.10)                    # annual compounding


def test_goals_do_not_change_pure_maturity():
    plain = _sched()
    withg = _sched(goals=[("Trip", 150_000, 3), ("iPad", 25_000, 5)])
    assert withg["maturity_value"] == plain["maturity_value"]
    assert withg["total_principal"] == plain["total_principal"]


def test_rank_order_buys_top_goal_first():
    # Trip is ranked first though iPad is cheaper — strict rank order must buy
    # Trip before iPad on BOTH bought lines.
    s = _sched(goals=[("Trip", 150_000, 3), ("iPad", 25_000, 5)])
    factor_names = [h["name"] for h in s["goal_hits"]]
    plain_names = [h["name"] for h in s["goal_hits_plain"]]
    assert factor_names and factor_names[0] == "Trip"
    assert plain_names and plain_names[0] == "Trip"
    # If both are bought, iPad follows Trip.
    if "iPad" in factor_names:
        assert factor_names.index("Trip") < factor_names.index("iPad")


def test_factor_target_is_amount_times_factor():
    s = _sched(goals=[("Trip", 150_000, 3)])
    trip_factor = next(h for h in s["goal_hits"] if h["name"] == "Trip")
    trip_plain = next(h for h in s["goal_hits_plain"] if h["name"] == "Trip")
    assert trip_factor["target"] == 450_000          # 150k x 3
    assert trip_plain["target"] == 150_000           # no factor
    # The plain line buys no later than the factor line (lower target).
    assert trip_plain["month"] <= trip_factor["month"]


def test_achievement_month_ordering():
    s = _sched(goals=[("Trip", 150_000, 3), ("iPad", 25_000, 5)])
    for g in s["achievement"]:
        months = [g["month_nobuy"], g["month_plain"], g["month_factor"]]
        if all(m is not None for m in months):
            # never buying reaches it first; ×factor last.
            assert g["month_nobuy"] <= g["month_plain"] <= g["month_factor"]

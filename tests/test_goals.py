"""Financial-goals pool math and persistence."""

from src.analytics.goals import (
    pool_target, goal_factor, load_goals, add_goal, remove_goal, reorder_goals,
    EMERGENCY_FUND)


def test_pool_target_uses_max_not_sum():
    goals = {EMERGENCY_FUND: 60_000, "iPad": 25_000, "Trip": 150_000}
    # Highest selected goal only, added on top of the EF target (no factors).
    assert pool_target(60_000, goals, ["iPad", "Trip"], factors={}) == 210_000
    assert pool_target(60_000, goals, ["iPad"], factors={}) == 85_000
    assert pool_target(60_000, goals, [], factors={}) == 60_000


def test_pool_target_applies_factor():
    goals = {"iPad": 25_000, "Trip": 150_000}
    # iPad x5 = 125,000 beats Trip x1 = 150,000? No -> Trip still highest (150k).
    assert pool_target(0, goals, ["iPad", "Trip"],
                       factors={"iPad": 5}) == 150_000
    # iPad x7 = 175,000 now beats Trip.
    assert pool_target(0, goals, ["iPad", "Trip"],
                       factors={"iPad": 7}) == 175_000


def test_goal_factor_floor_of_one():
    assert goal_factor("x", {"x": 0}) == 1.0
    assert goal_factor("x", {"x": 3}) == 3.0
    assert goal_factor("missing", {}) == 1.0


def test_add_remove_reorder_roundtrip(ledger_env):
    # ledger_env chdirs to a tmp dir so goals.json / goals_factors.json are isolated.
    goals = add_goal("Trip", 150_000, factor=3)
    assert goals["Trip"] == 150_000
    assert goal_factor("Trip") == 3.0            # factor persisted

    add_goal("iPad", 25_000)
    order = reorder_goals(["iPad", "Trip"])
    # Emergency Fund stays first; the given order follows.
    assert list(order.keys()) == [EMERGENCY_FUND, "iPad", "Trip"]

    remove_goal("Trip")
    assert "Trip" not in load_goals()
    assert goal_factor("Trip") == 1.0            # factor cleared with the goal


def test_emergency_fund_cannot_be_removed(ledger_env):
    add_goal("Car", 500_000)
    goals = remove_goal(EMERGENCY_FUND)
    assert EMERGENCY_FUND in goals

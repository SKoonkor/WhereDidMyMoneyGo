"""Retirement projection: accumulation, draw-down, depletion, and real vs nominal.

``compute_retirement`` is pure (numpy only), so these tests pass inputs directly
with no I/O or Dash.
"""

from src.analytics.retirement import compute_retirement


def _plan(**over):
    base = dict(current_age=30, retirement_age=60, life_expectancy=85, principal=0,
                monthly_deposit=10_000, increasement=0.0, annual_rate=0.06,
                inflation=0.03, retirement_bonus=0.0, pension=0.0, expense=30_000)
    base.update(over)
    return compute_retirement(**base)


def test_pot_at_retirement_exceeds_contributions():
    # 30 years of 10k/mo at 6% must beat the raw sum of deposits (growth).
    r = _plan()
    assert r["balance_at_retirement"] > r["total_contributions"] > 0
    # With expenses drawing it down after retirement, the pot peaks at retirement.
    assert r["balance_at_retirement"] == max(r["balance_nominal"])


def test_increasement_grows_the_pot():
    flat = _plan(increasement=0.0, expense=0.0)
    rising = _plan(increasement=0.05, expense=0.0)
    assert rising["balance_at_retirement"] > flat["balance_at_retirement"]
    assert rising["total_contributions"] > flat["total_contributions"]


def test_high_expense_depletes_before_life_expectancy():
    r = _plan(monthly_deposit=2_000, expense=60_000)
    assert r["covered"] is False
    assert r["depletion_age"] is not None
    assert r["retirement_age"] < r["depletion_age"] < r["life_expectancy"]
    assert r["ending_nominal"] == 0.0


def test_modest_expense_lasts_and_leaves_estate():
    r = _plan(monthly_deposit=20_000, expense=15_000)
    assert r["covered"] is True
    assert r["depletion_age"] is None
    assert r["ending_nominal"] > 0.0


def test_real_below_nominal_at_end_when_inflation_positive():
    r = _plan(monthly_deposit=20_000, expense=15_000, inflation=0.03)
    assert r["ending_real"] < r["ending_nominal"]
    # At age today (month 0) they coincide.
    assert r["balance_real"][0] == r["balance_nominal"][0]


def test_pension_pushes_depletion_later():
    no_pension = _plan(monthly_deposit=2_000, expense=60_000, pension=0)
    with_pension = _plan(monthly_deposit=2_000, expense=60_000, pension=40_000)
    # A pension covers part of the expense, so savings last longer (or forever).
    if with_pension["depletion_age"] is None:
        assert no_pension["depletion_age"] is not None
    else:
        assert with_pension["depletion_age"] > no_pension["depletion_age"]


def test_retirement_before_current_age_is_handled():
    # Degenerate input: no accumulation phase, immediate draw-down.
    r = _plan(current_age=65, retirement_age=60, life_expectancy=85)
    assert r["retire_month"] == 0
    assert r["balance_at_retirement"] == r["balance_nominal"][0]
    assert len(r["ages"]) == len(r["balance_nominal"])


# ── Goal buying ──────────────────────────────────────────────────────────────

def test_no_goals_keeps_original_shape():
    r = _plan()
    assert r["has_goals"] is False
    for k in ("balance_nominal", "balance_real", "balance_at_retirement",
              "depletion_age", "covered", "ending_nominal"):
        assert k in r
    # No goal-specific keys leak into the no-goals result.
    assert "summary_factor" not in r and "goal_hits_factor" not in r


def test_goals_reduce_pot_and_ending():
    # A well-funded plan that leaves an estate, so the ending drop is visible.
    base = _plan(monthly_deposit=20_000, expense=15_000)
    g = _plan(monthly_deposit=20_000, expense=15_000, goals=[("Car", 500_000, 2)])
    assert g["has_goals"] is True
    assert base["covered"] and g["summary_factor"]["covered"]
    assert g["summary_factor"]["pot_at_retirement"] < base["balance_at_retirement"]
    assert g["summary_factor"]["ending_nominal"] < base["ending_nominal"]
    assert g["summary_factor"]["total_spent"] == 500_000        # bought once


def test_goal_purchase_causes_a_dip():
    g = _plan(goals=[("Car", 500_000, 2)])
    hits = g["goal_hits_factor"]
    assert hits, "goal should be bought within the horizon"
    series = g["balance_factor_nominal"]
    m = hits[0]["month"]
    # The month the goal is bought, the balance steps down vs the prior month...
    assert series[m] < series[m - 1]
    # ...and stays below the no-goals baseline afterwards.
    assert series[m] < g["balance_nominal"][m]


def test_plain_buys_no_later_than_factor():
    g = _plan(goals=[("Car", 500_000, 2)])
    f_month = g["goal_hits_factor"][0]["month"]
    p_month = g["goal_hits_plain"][0]["month"]
    assert p_month <= f_month            # plain target (amount) < factor target


def test_big_goal_hastens_depletion():
    base = _plan(monthly_deposit=12_000, expense=20_000)
    g = _plan(monthly_deposit=12_000, expense=20_000,
              goals=[("House", 3_000_000, 1)])
    assert g["summary_factor"]["total_spent"] > 0
    if base["covered"]:
        # A big purchase leaves less at the end, or exhausts the fund entirely.
        assert (not g["summary_factor"]["covered"]
                or g["summary_factor"]["ending_nominal"] < base["ending_nominal"])
    else:
        assert g["summary_factor"]["depletion_age"] <= base["depletion_age"]


def test_hits_carry_age_and_target():
    g = _plan(goals=[("Car", 500_000, 2)])
    for h in g["goal_hits_factor"]:
        assert 30 <= h["age"] <= 85
        assert h["target"] == 500_000 * 2


def test_goal_names_in_rank_order():
    g = _plan(goals=[("Car", 500_000, 2), ("House", 3_000_000, 1)])
    assert g["goal_names"] == ["Car", "House"]


def test_financial_freedom_within_horizon():
    # The default plan eventually reaches the FIRE point within life expectancy.
    r = _plan()
    ff = r["financial_freedom_age"]
    assert ff is not None
    assert r["current_age"] < ff <= r["life_expectancy"]


def test_pension_covering_expenses_means_immediate_freedom():
    # Pension already exceeds today's expense → passive income covers from day one.
    r = _plan(pension=40_000, expense=30_000)
    assert r["financial_freedom_age"] == r["current_age"]


def test_more_savings_reaches_freedom_earlier():
    low = _plan(monthly_deposit=10_000)["financial_freedom_age"]
    high = _plan(monthly_deposit=50_000)["financial_freedom_age"]
    assert low is not None and high is not None
    assert high < low


def test_freedom_unreachable_returns_none():
    # Tiny deposits, huge inflating expense, low return → never covered.
    r = _plan(monthly_deposit=100, expense=100_000, annual_rate=0.02, inflation=0.05)
    assert r["financial_freedom_age"] is None


def test_goals_delay_financial_freedom():
    base = _plan(monthly_deposit=30_000, expense=15_000)["financial_freedom_age"]
    withg = _plan(monthly_deposit=30_000, expense=15_000,
                  goals=[("House", 3_000_000, 1)])["financial_freedom_age"]
    assert base is not None and withg is not None
    assert withg > base                       # buying a goal drains the pot, delaying it


def test_late_depletion_after_life_expectancy():
    # Savings last through life expectancy (85) but eventually run dry after it.
    r = _plan(monthly_deposit=10_000, expense=15_000)
    assert r["depletion_age"] is None and r["covered"] is True
    assert r["late_depletion_age"] is not None
    assert r["late_depletion_age"] > r["life_expectancy"]


def test_grows_forever_has_no_late_depletion():
    r = _plan(monthly_deposit=20_000, expense=15_000)
    assert r["depletion_age"] is None
    assert r["late_depletion_age"] is None     # lasts beyond the ~100 cap


def test_within_life_depletion_has_no_late_age():
    r = _plan()                                # depletes before life expectancy
    assert r["depletion_age"] is not None
    assert r["late_depletion_age"] is None


def test_goal_reached_plain_but_not_factor():
    # Plain target 5M is reached (pot peaks ~9.8M); ×factor target 15M never is.
    g = _plan(goals=[("Yacht", 5_000_000, 3)])
    factor_names = {h["name"] for h in g["goal_hits_factor"]}
    plain_names = {h["name"] for h in g["goal_hits_plain"]}
    assert "Yacht" in plain_names and "Yacht" not in factor_names
    assert g["summary_factor"]["total_spent"] == 0            # never bought
    assert g["summary_plain"]["total_spent"] == 5_000_000

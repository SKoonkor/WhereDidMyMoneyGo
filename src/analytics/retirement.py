"""Retirement planning projection (pure — no Dash).

Models the full life-cycle of a retirement plan as a month-by-month simulation
and returns nominal and real (today's-money) balance series plus a small summary.
It is the second tool on the Compound Interest page; kept Dash-free so it is
unit-testable like ``compute_schedule``.

Three phases:

* **Accumulation** (current age → retirement age): escalating monthly deposits are
  added at the start of each month (annuity due) and the balance grows at a
  monthly-equivalent rate derived from the annual interest rate. The deposit rises
  once a year by the *increasement* rate (a salary-style raise).
* **Retirement bonus**: a lump sum is added the month retirement begins (the pot's
  peak).
* **Decumulation** (retirement age → life expectancy): no more deposits. Living
  expenses — given in today's money — inflate every month; a fixed nominal monthly
  pension offsets them; the remaining balance funds the gap and keeps earning
  interest. If it hits zero the *depletion age* is recorded.

**Financial goals** may optionally be bought along the way: as savings reach a
goal's target (in Financial-Goals rank order, FIFO) the goal's amount is spent,
dipping the trajectory. Two strategies are simulated — buying at ``amount*factor``
(the safer ×factor target) and at the plain ``amount``.

The annual interest rate is treated as an effective annual yield, so the monthly
rate is ``(1+rate)**(1/12) - 1`` — consistent with the simple calculator's
"Annually" compounding.
"""

from __future__ import annotations

import numpy as np


def _monthly_rate(annual_rate: float) -> float:
    """Monthly-equivalent rate for an effective annual yield."""
    return (1.0 + float(annual_rate)) ** (1.0 / 12.0) - 1.0


def _financial_freedom_age(P, D0, g, i, infl, pension, expense0,
                           total_months, current_age, goals=None):
    """The FIRE 'financial freedom' age: the earliest age at which the pot's
    investment return alone covers expenses (net of a fixed pension), so savings
    never need to shrink. Uses a pure accumulation path (deposits keep going, no
    draw-down, no retirement bonus). Selected ``goals`` are bought as the pot reaches
    their ×factor target (FIFO rank order), draining it. Freedom is only declared
    once **every** selected goal has been bought *and* the remaining pot's return
    covers expenses — so a goal you can only afford later pushes freedom later (and a
    goal never reachable within the horizon means freedom is never declared).
    Returns an age (float) or ``None`` if not reached within the horizon.
    """
    queue = [{"amount": float(a), "target": float(a) * float(f)}
             for _nm, a, f in (goals or [])]
    bal = float(P)

    def _buy():
        nonlocal bal
        while queue and bal >= queue[0]["target"]:
            bal -= queue.pop(0)["amount"]

    _buy()
    for t in range(0, total_months + 1):
        if t > 0:
            year = (t - 1) // 12
            bal = (bal + D0 * (1.0 + g) ** year) * (1.0 + i)
            _buy()
        net_monthly_expense = expense0 * (1.0 + infl) ** (t / 12.0) - pension
        # All goals bought, and monthly interest earned covers what's left of the
        # monthly expense after the pension.
        if not queue and bal * i >= net_monthly_expense:
            return current_age + t / 12.0
    return None


def _late_depletion_age(bal_at_life, i, infl, pension, expense0,
                        total_months, current_age, cap_age=100):
    """When savings survive to life expectancy, keep drawing down *past* it to find
    when they would eventually hit zero. Returns that age (> life expectancy), or
    ``None`` if they last beyond ``cap_age`` (the caller shows '100+'). Returns
    ``None`` immediately if the balance was already depleted within the horizon.
    """
    if bal_at_life <= 0:
        return None
    bal = float(bal_at_life)
    cap_month = int(round((cap_age - current_age) * 12))
    for t in range(total_months + 1, cap_month + 1):
        expense_nominal = expense0 * (1.0 + infl) ** (t / 12.0)
        bal = (bal + pension - expense_nominal) * (1.0 + i)
        if bal <= 0:
            return current_age + t / 12.0
    return None


def _simulate(P, D0, g, i, infl, pension, expense0, bonus,
              total_months, retire_month, current_age, goals, use_factor):
    """Run the month-by-month projection, optionally buying goals as reached.

    ``goals`` is ``[(name, amount, factor)]`` in rank order (empty for the base
    trajectory). Returns ``(nominal, hits, contributions, depletion_month,
    total_spent)`` where ``nominal`` is length ``total_months + 1`` and each hit is
    ``{name, month, age, target}``.
    """
    queue = [{"name": nm, "amount": float(a),
              "target": float(a) * (float(f) if use_factor else 1.0)}
             for nm, a, f in (goals or [])]              # rank order preserved
    nominal = np.empty(total_months + 1)
    bal = float(P)
    contributions = float(P)
    total_spent = 0.0
    depletion_month = None
    hits = []

    def _buy(month):
        nonlocal bal, total_spent
        while queue and bal >= queue[0]["target"]:
            gg = queue.pop(0)
            hits.append({"name": gg["name"], "month": int(month),
                         "age": float(current_age + month / 12.0),
                         "target": gg["target"]})
            bal -= gg["amount"]
            total_spent += gg["amount"]

    _buy(0)
    nominal[0] = bal
    for t in range(1, total_months + 1):
        if t <= retire_month:
            year = (t - 1) // 12
            deposit = D0 * (1.0 + g) ** year
            bal = (bal + deposit) * (1.0 + i)
            contributions += deposit
            if t == retire_month:
                bal += float(bonus)                      # lump sum at retirement
        else:
            expense_nominal = expense0 * (1.0 + infl) ** (t / 12.0)
            bal = (bal + pension - expense_nominal) * (1.0 + i)
        _buy(t)                                          # buy goals as reached
        if bal <= 0.0:
            bal = 0.0
            if depletion_month is None:
                depletion_month = t
        nominal[t] = bal

    return nominal, hits, contributions, depletion_month, total_spent


def compute_retirement(current_age: float, retirement_age: float,
                       life_expectancy: float, principal: float,
                       monthly_deposit: float, increasement: float,
                       annual_rate: float, inflation: float,
                       retirement_bonus: float = 0.0, pension: float = 0.0,
                       expense: float = 0.0, goals=None) -> dict:
    """Project a retirement plan month by month.

    Rates (``increasement``, ``annual_rate``, ``inflation``) are decimals
    (0.03 = 3%). ``expense`` and ``pension`` are monthly amounts; ``expense`` is in
    *today's* money and inflates over time. ``goals`` is an optional
    ``[(name, amount, factor)]`` list in rank order; when given, two extra
    goal-buying trajectories (×factor and plain) and their summaries are added.
    Returns a dict of series and summary figures.
    """
    current_age = float(current_age or 0)
    retirement_age = max(current_age, float(retirement_age or 0))
    life_expectancy = max(retirement_age, float(life_expectancy or 0))

    i = _monthly_rate(annual_rate)
    g = float(increasement or 0.0)
    infl = float(inflation or 0.0)
    D0 = float(monthly_deposit or 0.0)
    pension = float(pension or 0.0)
    expense0 = float(expense or 0.0)
    bonus = float(retirement_bonus or 0.0)
    P = float(principal or 0.0)

    total_months = int(round((life_expectancy - current_age) * 12))
    retire_month = int(round((retirement_age - current_age) * 12))
    total_months = max(total_months, retire_month, 1)

    ages = current_age + np.arange(total_months + 1) / 12.0
    deflator = (1.0 + infl) ** (ages - current_age)   # nominal → today's money

    def _run(gs, use_factor):
        return _simulate(P, D0, g, i, infl, pension, expense0, bonus,
                         total_months, retire_month, current_age, gs, use_factor)

    # Base (no goals) — the trajectory shown as the chart's faint baseline and the
    # source of the top-level keys (kept stable for callers that pass no goals).
    nominal, _h, contributions, depletion_month, _s = _run(None, True)
    real = nominal / deflator

    expense_at_retirement = (expense0 * (1.0 + infl) ** (retire_month / 12.0)
                             if expense0 else 0.0)
    depletion_age = (current_age + depletion_month / 12.0
                     if depletion_month is not None else None)

    result = {
        "ages": ages,
        "months": np.arange(total_months + 1),
        "balance_nominal": nominal,
        "balance_real": real,
        "current_age": current_age,
        "retirement_age": retirement_age,
        "life_expectancy": life_expectancy,
        "retire_month": retire_month,
        "balance_at_retirement": float(nominal[retire_month]),
        "expense_at_retirement": float(expense_at_retirement),
        "pension": pension,
        "years_in_retirement": float(life_expectancy - retirement_age),
        "depletion_age": depletion_age,
        "covered": depletion_age is None,
        "ending_nominal": float(nominal[-1]),
        "ending_real": float(real[-1]),
        "total_contributions": float(contributions),
        "annual_rate": float(annual_rate or 0.0),
        "inflation": infl,
        "has_goals": bool(goals),
        "financial_freedom_age": _financial_freedom_age(
            P, D0, g, i, infl, pension, expense0, total_months, current_age,
            goals=goals),
        # Where the base plan would eventually run dry past life expectancy (None if
        # it lasts beyond ~age 100, or if it already depleted within the horizon).
        "late_depletion_age": _late_depletion_age(
            float(nominal[-1]), i, infl, pension, expense0, total_months,
            current_age),
    }

    if goals:
        def _strategy(use_factor):
            nom, hits, _c, dep_m, spent = _run(goals, use_factor)
            rl = nom / deflator
            dep_age = (current_age + dep_m / 12.0) if dep_m is not None else None
            summary = {
                "pot_at_retirement": float(nom[retire_month]),
                "depletion_age": dep_age,
                "covered": dep_age is None,
                "ending_nominal": float(nom[-1]),
                "ending_real": float(rl[-1]),
                "total_spent": float(spent),
                "late_depletion_age": _late_depletion_age(
                    float(nom[-1]), i, infl, pension, expense0, total_months,
                    current_age),
            }
            return nom, rl, hits, summary

        f_nom, f_real, f_hits, f_sum = _strategy(True)
        p_nom, p_real, p_hits, p_sum = _strategy(False)
        result.update({
            "balance_factor_nominal": f_nom, "balance_factor_real": f_real,
            "balance_plain_nominal": p_nom, "balance_plain_real": p_real,
            "goal_hits_factor": f_hits, "goal_hits_plain": p_hits,
            "summary_factor": f_sum, "summary_plain": p_sum,
            # Selected goals in rank order — lets the results table list every goal,
            # including ones never reached (which have no hit).
            "goal_names": [nm for nm, _a, _f in goals],
        })

    return result

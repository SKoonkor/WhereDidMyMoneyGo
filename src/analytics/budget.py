"""Budgeting model and persistence (config/budget.json).

Implements a 50/30/20-style budget. Expense categories are assigned to two
spending buckets — **Needs** and **Wants** — while **Savings/Debt** is the
leftover (income − Needs spent − Wants spent), so it needs no category mapping.

Budget targets are a percentage of a monthly income base that is either a fixed
amount the user sets, or the rolling average of recent months' income. The
current budget period runs from a configurable reset day each month.
"""

import calendar
import json
from datetime import date
from pathlib import Path

import pandas as pd

BUDGET_PATH = Path("config/budget.json")

NEEDS, WANTS, SAVINGS = "Needs", "Wants", "Savings"
DEFAULT_PERCENTAGES = {NEEDS: 50, WANTS: 30, SAVINGS: 20}

# Sensible starting map for the user's existing categories; everything else
# (and any future category) falls back to Wants.
DEFAULT_ASSIGN = {
    "Bills": NEEDS, "Food": NEEDS, "Household": NEEDS, "Health": NEEDS,
    "Transport": NEEDS, "Car": NEEDS, "Family": NEEDS, "Education": NEEDS,
    "Social Life": WANTS, "Travel": WANTS, "Beauty": WANTS, "Apparel": WANTS,
    "Gift": WANTS, "Subscription": WANTS, "Other": WANTS,
}

DEFAULT_BUDGET = {
    "mode": "fixed",            # "fixed" | "rolling"
    "fixed_income": 37500,
    "rolling_months": 6,
    "percentages": dict(DEFAULT_PERCENTAGES),
    "assignments": dict(DEFAULT_ASSIGN),
    "reset_day": 1,
}


# ── Persistence ──────────────────────────────────────────────────────────────

def load_budget(path: str | Path = BUDGET_PATH) -> dict:
    """Load the budget config, seeding defaults for any missing keys."""
    path = Path(path)
    if not path.exists():
        save_budget(DEFAULT_BUDGET, path)
        return json.loads(json.dumps(DEFAULT_BUDGET))
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    # Backfill any missing top-level keys so older files keep working.
    for key, default in DEFAULT_BUDGET.items():
        cfg.setdefault(key, json.loads(json.dumps(default)))
    return cfg


def save_budget(cfg: dict, path: str | Path = BUDGET_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


def bucket_for(category: str, assignments: dict) -> str:
    """Bucket a category belongs to; unknown categories default to Wants."""
    return assignments.get(category, WANTS)


# ── Income base ──────────────────────────────────────────────────────────────

def budget_income(df: pd.DataFrame, cfg: dict, today: date | None = None) -> float:
    """Monthly income base the percentages apply to.

    "fixed"   → the user-set amount.
    "rolling" → mean of the last `rolling_months` *completed* months' income
                (real Income rows only; reconciliation/transfer rows excluded).
    """
    if cfg.get("mode") != "rolling":
        return float(cfg.get("fixed_income", 0) or 0)

    today = today or date.today()
    inc = df[df["Income/Expense"] == "Income"]
    if inc.empty:
        return 0.0
    monthly = inc.groupby(inc["Period"].dt.to_period("M"))["Amount"].sum()
    completed = monthly[monthly.index < pd.Period(today, freq="M")]
    recent = completed.tail(int(cfg.get("rolling_months", 6)))
    return float(recent.mean()) if len(recent) else 0.0


# ── Period from the reset day ────────────────────────────────────────────────

def _reset_on(year: int, month: int, reset_day: int) -> date:
    """Reset date for a given month, clamping the day to the month's length."""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(int(reset_day), last))


def budget_period(today: date, reset_day: int = 1) -> tuple[date, date]:
    """Current budget period [start, end): the most recent reset day on/before
    `today` to the next reset day."""
    this = _reset_on(today.year, today.month, reset_day)
    if today >= this:
        start = this
        ny, nm = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        end = _reset_on(ny, nm, reset_day)
    else:
        py, pm = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
        start = _reset_on(py, pm, reset_day)
        end = this
    return start, end


# ── Spending & summary ───────────────────────────────────────────────────────

def spending_by_bucket(df: pd.DataFrame, start: date, end: date,
                       assignments: dict) -> dict:
    """Sum expense amounts in [start, end) per Needs/Wants bucket."""
    mask = ((df["Income/Expense"] == "Expense")
            & (df["Period"] >= pd.Timestamp(start))
            & (df["Period"] < pd.Timestamp(end)))
    spent = {NEEDS: 0.0, WANTS: 0.0}
    sub = df[mask]
    if sub.empty:
        return spent
    by_cat = sub.groupby("Category")["Amount"].sum()
    for cat, amt in by_cat.items():
        spent[bucket_for(cat, assignments)] = spent.get(
            bucket_for(cat, assignments), 0.0) + float(amt)
    return {NEEDS: spent.get(NEEDS, 0.0), WANTS: spent.get(WANTS, 0.0)}


def spending_by_category(df: pd.DataFrame, start: date, end: date) -> dict:
    """Sum expense amounts in [start, end) per Category."""
    mask = ((df["Income/Expense"] == "Expense")
            & (df["Period"] >= pd.Timestamp(start))
            & (df["Period"] < pd.Timestamp(end)))
    sub = df[mask]
    if sub.empty:
        return {}
    return {str(c): float(v) for c, v in sub.groupby("Category")["Amount"].sum().items()}


def hidden_cost_in(df: pd.DataFrame, start: date, end: date) -> float:
    """Net reconciliation 'hidden cost' in [start, end): Σ Expense Balance −
    Σ Income Balance, clamped to ≥0 (only untracked *spending* counts)."""
    sub = df[(df["Period"] >= pd.Timestamp(start)) & (df["Period"] < pd.Timestamp(end))]
    eb = sub.loc[sub["Income/Expense"] == "Expense Balance", "Amount"].sum()
    ib = sub.loc[sub["Income/Expense"] == "Income Balance", "Amount"].sum()
    return max(0.0, float(eb - ib))


HIDDEN_LABEL = "Hidden cost"


def month_pie_data(df: pd.DataFrame, month, budget: float,
                   assignments: dict | None = None) -> dict:
    """Spending breakdown for a calendar month, as a share of the monthly budget.

    Returns ``{budget, total, over, pie, remaining, list}`` where ``pie`` and
    ``list`` are ``[(label, amount, bucket)]`` (bucket ∈ "Needs"/"Wants"; Hidden
    cost is tagged "Wants"). The pie fills **Needs categories first** (largest →
    smallest), then Wants, so when a month is over budget the overflow ``list`` is
    the Wants — the natural cut candidates. Hidden cost always goes to the list
    when over budget. Under budget, the pie holds everything plus a "Remaining
    budget" filler (``remaining``).
    """
    assignments = assignments or {}
    month = pd.Period(month, freq="M")
    start, end = month.start_time.date(), (month + 1).start_time.date()
    sub = df[(df["Period"].dt.to_period("M") == month)
             & (df["Income/Expense"] == "Expense")]
    by_cat = sub.groupby("Category")["Amount"].sum()
    needs, wants = [], []
    for c, v in by_cat.items():
        (needs if bucket_for(str(c), assignments) == NEEDS else wants).append(
            (str(c), float(v)))
    needs.sort(key=lambda kv: kv[1], reverse=True)
    wants.sort(key=lambda kv: kv[1], reverse=True)
    ordered = [(c, v, NEEDS) for c, v in needs] + [(c, v, WANTS) for c, v in wants]

    hidden = hidden_cost_in(df, start, end)
    total = sum(v for _, v, _ in ordered) + hidden

    if total <= budget:
        pie = list(ordered)
        if hidden > 0:
            pie.append((HIDDEN_LABEL, hidden, WANTS))
        return {"budget": budget, "total": total, "over": False,
                "pie": pie, "remaining": max(0.0, budget - total), "list": []}

    pie, overflow, cum = [], [], 0.0
    for label, amt, bucket in ordered:
        if cum >= budget:
            overflow.append((label, amt, bucket))
        else:
            pie.append((label, amt, bucket))
            cum += amt
    if hidden > 0:
        overflow.append((HIDDEN_LABEL, hidden, WANTS))
    return {"budget": budget, "total": total, "over": True,
            "pie": pie, "remaining": 0.0, "list": overflow}


def budget_summary(df: pd.DataFrame, cfg: dict | None = None,
                   today: date | None = None) -> dict:
    """Per-bucket targets / spent / remaining for the current period.

    Needs & Wants: remaining = target − spent (positive = under budget).
    Savings:       spent = income − Needs − Wants (actual saved);
                   remaining = actual − target  (positive = ahead of plan).
    """
    cfg = cfg or load_budget()
    today = today or date.today()
    income = budget_income(df, cfg, today)
    pct = cfg.get("percentages", DEFAULT_PERCENTAGES)
    reset_day = int(cfg.get("reset_day", 1))
    start, end = budget_period(today, reset_day)

    spent = spending_by_bucket(df, start, end, cfg.get("assignments", {}))
    needs_t = income * pct.get(NEEDS, 0) / 100
    wants_t = income * pct.get(WANTS, 0) / 100
    sav_t = income * pct.get(SAVINGS, 0) / 100
    sav_actual = income - spent[NEEDS] - spent[WANTS]

    return {
        "income": income,
        "mode": cfg.get("mode", "fixed"),
        "reset_day": reset_day,
        "start": start,
        "end": end,
        "buckets": {
            NEEDS: {"target": needs_t, "spent": spent[NEEDS],
                    "remaining": needs_t - spent[NEEDS]},
            WANTS: {"target": wants_t, "spent": spent[WANTS],
                    "remaining": wants_t - spent[WANTS]},
            SAVINGS: {"target": sav_t, "spent": sav_actual,
                      "remaining": sav_actual - sav_t},
        },
    }


def bucket_tone(name: str, spent: float, target: float) -> str:
    """Traffic-light tone ("good"/"warn"/"bad") for a bucket's spend vs target.

    Needs & Wants: less is better (green <50%, orange 50–85%, red >85%).
    Savings:       more is better (green ≥90%, orange 65–90%, red <65% of goal).
    """
    raw = (spent / target * 100) if target else 0
    if name == SAVINGS:
        return "good" if raw >= 90 else "warn" if raw >= 65 else "bad"
    return "good" if raw < 50 else "warn" if raw <= 85 else "bad"


# ── Sub-category breakdowns ──────────────────────────────────────────────────

def subcategory_breakdown(df: pd.DataFrame, start: date, end: date,
                          txn_type: str) -> list:
    """Nested breakdown for ``txn_type`` rows in ``[start, end)``.

    Returns ``[(category, cat_total, [(subcategory, amount), ...]), ...]`` with
    categories sorted by total desc and sub-categories desc. Empty sub-category
    labels are normalised to "—".
    """
    mask = ((df["Income/Expense"] == txn_type)
            & (df["Period"] >= pd.Timestamp(start))
            & (df["Period"] < pd.Timestamp(end)))
    sub = df[mask]
    if sub.empty:
        return []
    sub = sub.copy()
    sub["Subcategory"] = sub["Subcategory"].fillna("").replace("", "—")
    out = []
    cat_totals = sub.groupby("Category")["Amount"].sum().sort_values(ascending=False)
    for cat, tot in cat_totals.items():
        subs = (sub[sub["Category"] == cat].groupby("Subcategory")["Amount"].sum()
                .sort_values(ascending=False))
        out.append((str(cat), float(tot),
                    [(str(s), float(a)) for s, a in subs.items()]))
    return out


def _expense_cat_sub(df: pd.DataFrame, month) -> dict:
    """Expense totals for a calendar month keyed by ``(Category, Subcategory)``."""
    month = pd.Period(month, freq="M")
    sub = df[(df["Period"].dt.to_period("M") == month)
             & (df["Income/Expense"] == "Expense")]
    if sub.empty:
        return {}
    sub = sub.copy()
    sub["Subcategory"] = sub["Subcategory"].fillna("").replace("", "—")
    g = sub.groupby(["Category", "Subcategory"])["Amount"].sum()
    return {(str(c), str(s)): float(v) for (c, s), v in g.items()}


def subcategory_month_changes(df: pd.DataFrame, current_month, prev_month) -> list:
    """Expense sub-category change between two months, grouped by parent category.

    Returns ``[{category, cur, prev, delta, rows:[{sub, cur, prev, delta, pct}]}]``.
    ``pct`` is None when the previous amount is 0 (a new sub-category). Ordering is
    left to the caller (the page sorts by spend or by change).
    """
    cur = _expense_cat_sub(df, current_month)
    prev = _expense_cat_sub(df, prev_month)
    cats: dict = {}
    for key in set(cur) | set(prev):
        c, s = key
        cur_a, prev_a = cur.get(key, 0.0), prev.get(key, 0.0)
        delta = cur_a - prev_a
        pct = (delta / prev_a * 100) if prev_a else None
        cats.setdefault(c, []).append(
            {"sub": s, "cur": cur_a, "prev": prev_a, "delta": delta, "pct": pct})
    out = []
    for c, rows in cats.items():
        cat_cur = sum(r["cur"] for r in rows)
        cat_prev = sum(r["prev"] for r in rows)
        out.append({"category": c, "cur": cat_cur, "prev": cat_prev,
                    "delta": cat_cur - cat_prev, "rows": rows})
    return out

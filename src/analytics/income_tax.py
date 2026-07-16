"""Personal income-tax estimator + persistence (config/tax.json).

Estimates the income tax owed for a tax year. The model is **country-keyed**
(``COUNTRIES``) so more countries can be added later; only **Thailand**
(``TH_SPEC``) ships today. A country spec carries its progressive brackets, the
automatic employment-expense deduction, and an ordered list of allowance
definitions the page renders generically.

Thai tax year = calendar year (Jan 1 – Dec 31). Figures follow the standard
personal income-tax (PIT) schedule and the common personal allowances; caps are
applied per item, then the shared retirement cap, then the donation cap (which is
a percentage of income *after* every other deduction).
"""

from __future__ import annotations

import datetime
import json
from pathlib import Path

import pandas as pd

TAX_PATH = Path("config/tax.json")


# ── Thailand spec ────────────────────────────────────────────────────────────

# Progressive PIT bands as (lower, upper_or_None, rate) on *net taxable* income.
TH_BRACKETS = [
    (0, 150_000, 0.00),
    (150_000, 300_000, 0.05),
    (300_000, 500_000, 0.10),
    (500_000, 750_000, 0.15),
    (750_000, 1_000_000, 0.20),
    (1_000_000, 2_000_000, 0.25),
    (2_000_000, 5_000_000, 0.30),
    (5_000_000, None, 0.35),
]

# Allowance definitions, rendered generically by the page. ``type``:
#   fixed  → always granted (``amount``), no input;
#   flag   → a checkbox worth ``amount`` when ticked;
#   count  → an integer × ``per`` (optional ``max_units``);
#   amount → a THB figure, capped by ``cap`` and/or ``cap_pct`` (of gross income);
#            ``cap_pct_of_net`` caps against income after all other deductions.
TH_ALLOWANCES = [
    {"key": "personal", "label": "Personal allowance", "type": "fixed",
     "amount": 60_000, "hint": "Automatic 60,000 for every taxpayer."},
    {"key": "spouse", "label": "Spouse (no income)", "type": "flag",
     "amount": 60_000, "hint": "60,000 if your spouse has no assessable income."},
    {"key": "children", "label": "Children", "type": "count", "per": 30_000,
     "unit": "children", "hint": "30,000 per child."},
    {"key": "parents", "label": "Parental care", "type": "count", "per": 30_000,
     "max_units": 4, "unit": "people",
     "hint": "30,000 per dependent parent aged 60+, up to 4."},
    {"key": "insurance", "label": "Life & health insurance", "type": "amount",
     "cap": 100_000, "hint": "Premiums, capped at 100,000."},
    {"key": "social_security", "label": "Social security", "type": "amount",
     "cap": 9_000, "hint": "Contributions, capped at 9,000."},
    {"key": "provident", "label": "Provident fund / GPF", "type": "amount",
     "cap_pct": 0.15, "cap": 500_000,
     "hint": "Up to 15% of income and 500,000 (shared retirement cap)."},
    {"key": "ssf", "label": "SSF", "type": "amount",
     "cap_pct": 0.30, "cap": 200_000,
     "hint": "Up to 30% of income and 200,000 (shared retirement cap)."},
    {"key": "rmf", "label": "RMF", "type": "amount",
     "cap_pct": 0.30, "cap": 500_000,
     "hint": "Up to 30% of income and 500,000 (shared retirement cap)."},
    {"key": "mortgage", "label": "Mortgage interest", "type": "amount",
     "cap": 100_000, "hint": "Home-loan interest, capped at 100,000."},
    {"key": "donations", "label": "Donations", "type": "amount",
     "cap_pct_of_net": 0.10,
     "hint": "Capped at 10% of income after other deductions."},
]

TH_SPEC = {
    "country": "Thailand",
    "currency": "THB",
    "brackets": TH_BRACKETS,
    "expense_deduction": {"rate": 0.50, "cap": 100_000},
    "allowances": TH_ALLOWANCES,
    # SSF + RMF + provident/GPF together cannot exceed this.
    "retirement_group": {"keys": ["provident", "ssf", "rmf"], "cap": 500_000},
}

COUNTRIES = {"Thailand": TH_SPEC}


def spec_for(country: str | None = None) -> dict:
    """The tax spec for ``country`` (defaults to Thailand)."""
    return COUNTRIES.get(country or "Thailand", TH_SPEC)


def allowance_defs(spec: dict | None = None) -> list[dict]:
    return (spec or TH_SPEC)["allowances"]


# ── Calculation (pure) ───────────────────────────────────────────────────────

def expense_deduction(gross: float, spec: dict) -> float:
    """Automatic employment-expense deduction (50% of income, capped)."""
    ed = spec["expense_deduction"]
    return min(float(ed["rate"]) * float(gross or 0), float(ed["cap"]))


def _raw_value(a: dict, val) -> float:
    """The requested allowance amount from a raw input, before caps."""
    typ = a["type"]
    if typ == "fixed":
        return float(a["amount"])
    if typ == "flag":
        return float(a["amount"]) if val else 0.0
    if typ == "count":
        units = int(val or 0)
        units = max(0, min(units, a.get("max_units", units)))
        return units * float(a["per"])
    # amount
    return max(0.0, float(val or 0))


def _cap_amount(a: dict, raw: float, gross: float) -> float:
    """Apply an ``amount`` allowance's per-item caps (percentage-of-gross and/or
    absolute). ``cap_pct_of_net`` is handled separately (needs the net figure)."""
    capped = raw
    if a.get("cap_pct") is not None:
        capped = min(capped, float(a["cap_pct"]) * float(gross or 0))
    if a.get("cap") is not None:
        capped = min(capped, float(a["cap"]))
    return max(0.0, capped)


def apply_allowances(gross: float, values: dict, spec: dict) -> tuple[float, list]:
    """Total allowed deductions and a per-item breakdown.

    Non-donation allowances are capped individually, with the shared retirement
    cap applied across provident/SSF/RMF in list order. Donations cap last,
    against income remaining after the expense deduction and every other
    allowance (Thai 10%-of-net rule).
    """
    gross = float(gross or 0)
    values = values or {}
    retire = spec.get("retirement_group", {})
    retire_keys = set(retire.get("keys", []))
    retire_cap = retire.get("cap")
    retire_used = 0.0

    total = 0.0
    breakdown = []
    donation_defs = []
    for a in spec["allowances"]:
        if a.get("cap_pct_of_net") is not None:
            donation_defs.append(a)          # deferred to the net-based pass
            continue
        capped = _cap_amount(a, _raw_value(a, values.get(a["key"])), gross)
        if a["key"] in retire_keys and retire_cap is not None:
            capped = min(capped, max(0.0, float(retire_cap) - retire_used))
            retire_used += capped
        total += capped
        breakdown.append({"key": a["key"], "label": a["label"], "amount": capped})

    net_before_donation = max(0.0, gross - expense_deduction(gross, spec) - total)
    for a in donation_defs:
        raw = _raw_value(a, values.get(a["key"]))
        capped = max(0.0, min(raw, float(a["cap_pct_of_net"]) * net_before_donation))
        total += capped
        breakdown.append({"key": a["key"], "label": a["label"], "amount": capped})

    return total, breakdown


def progressive_tax(taxable: float, brackets: list) -> tuple[float, list, float]:
    """Tax on ``taxable`` income. Returns (tax_due, rows, marginal_rate) where
    each row is a band that has income in it: {lower, upper, rate, income_in_band,
    tax}."""
    taxable = max(0.0, float(taxable or 0))
    tax = 0.0
    marginal = 0.0
    rows = []
    for lo, hi, rate in brackets:
        if taxable <= lo:
            break
        upper = taxable if hi is None else min(taxable, hi)
        band_income = upper - lo
        if band_income <= 0:
            continue
        band_tax = band_income * rate
        tax += band_tax
        marginal = rate
        rows.append({"lower": lo, "upper": hi, "rate": rate,
                     "income_in_band": band_income, "tax": band_tax})
    return tax, rows, marginal


def income_tax_status(gross: float, values: dict, spec: dict,
                      tax_paid: float = 0.0) -> dict:
    """Full estimate for a tax year: deductions, net taxable income, tax due,
    effective/marginal rate, and the outstanding balance vs. tax already paid."""
    gross = float(gross or 0)
    exp_ded = expense_deduction(gross, spec)
    allow_total, allow_breakdown = apply_allowances(gross, values, spec)
    net_taxable = max(0.0, gross - exp_ded - allow_total)
    tax_due, bracket_rows, marginal = progressive_tax(net_taxable, spec["brackets"])
    tax_paid = float(tax_paid or 0)
    return {
        "gross": gross,
        "expense_deduction": exp_ded,
        "allowance_total": allow_total,
        "allowance_breakdown": allow_breakdown,
        "net_taxable": net_taxable,
        "tax_due": tax_due,
        "bracket_rows": bracket_rows,
        "effective_rate": (tax_due / gross) if gross else 0.0,
        "marginal_rate": marginal,
        "tax_paid": tax_paid,
        "remaining": tax_due - tax_paid,
    }


# ── Ledger helpers ───────────────────────────────────────────────────────────

def gross_income_for_year(df: pd.DataFrame, year: int) -> float:
    """Sum of tracked Income transactions in the given calendar year."""
    if df is None or df.empty:
        return 0.0
    mask = ((df["Income/Expense"] == "Income")
            & (df["Period"].dt.year == int(year)))
    return float(df.loc[mask, "Amount"].sum())


def tax_paid_for_year(df: pd.DataFrame, subcategory: str | None, year: int) -> float:
    """Sum of Expense transactions tagged with ``subcategory`` in the year — the
    tax the user has already paid (withholding / prepayments)."""
    if df is None or df.empty or not subcategory:
        return 0.0
    mask = ((df["Income/Expense"] == "Expense")
            & (df["Subcategory"] == subcategory)
            & (df["Period"].dt.year == int(year)))
    return float(df.loc[mask, "Amount"].sum())


def tax_payments_for_year(df: pd.DataFrame, subcategory: str | None,
                          year: int) -> list[dict]:
    """The individual tax-payment transactions for the year (the rows summed by
    :func:`tax_paid_for_year`), oldest first. Each item is
    ``{"date": "DD-MMM-YYYY", "amount": float}`` — JSON-safe for a dcc.Store."""
    if df is None or df.empty or not subcategory:
        return []
    mask = ((df["Income/Expense"] == "Expense")
            & (df["Subcategory"] == subcategory)
            & (df["Period"].dt.year == int(year)))
    sub = df.loc[mask, ["Period", "Amount"]].sort_values("Period")
    return [{"date": pd.Timestamp(p).strftime("%d-%b-%Y"), "amount": float(a)}
            for p, a in zip(sub["Period"], sub["Amount"])]


def ledger_years(df: pd.DataFrame, current: int | None = None) -> list[int]:
    """Years present in the ledger plus the current year, newest first."""
    cur = int(current or datetime.date.today().year)
    years = {cur}
    if df is not None and not df.empty:
        yrs = df["Period"].dt.year.dropna()
        years.update(int(y) for y in yrs.unique())
    return sorted(years, reverse=True)


# ── Persistence (config/tax.json) ────────────────────────────────────────────

def _default_allowances() -> dict:
    """Zero/false defaults for every user-entered allowance (fixed ones excluded)."""
    return {a["key"]: (False if a["type"] == "flag" else 0)
            for a in TH_ALLOWANCES if a["type"] != "fixed"}


DEFAULT_TAX = {"country": "Thailand", "allowances": _default_allowances()}


def load_tax(path: str | Path = TAX_PATH) -> dict:
    """Load saved tax inputs (last-entered allowances), seeding defaults."""
    path = Path(path)
    if not path.exists():
        save_tax(DEFAULT_TAX, path)
        return json.loads(json.dumps(DEFAULT_TAX))
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    cfg.setdefault("country", DEFAULT_TAX["country"])
    allow = cfg.setdefault("allowances", {})
    for k, v in _default_allowances().items():
        allow.setdefault(k, v)
    return cfg


def save_tax(cfg: dict, path: str | Path = TAX_PATH) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)

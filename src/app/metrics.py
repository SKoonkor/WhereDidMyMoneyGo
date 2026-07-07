"""Shared fundamental-multiples display spec (Investing Simulator + Paper Trading).

Lives outside the pages package on purpose: importing a page module from another
page loads it under a second module name, which makes ``dash.register_page`` run
twice and trips Dash's duplicate-path check.
"""


def pe(v) -> str:
    return f"{v:.1f}" if v else "–"


def mpct(v) -> str:
    return f"{v:+.1f}%" if v is not None else "–"


def mnum(v) -> str:
    return f"{v:.2f}" if v is not None else "–"


# Indicator rows: (label, metric key, formatter over the ratios dict).
METRICS = [
    ("Operating margin", "op_margin",
     lambda m: f"{m['op_margin']:.1f}%" if m["op_margin"] is not None else "–"),
    ("Revenue growth (YoY)", "rev_growth", lambda m: mpct(m["rev_growth"])),
    ("P/S", "ps", lambda m: mnum(m["ps"])),
    ("Trailing P/E", "trailing_pe", lambda m: pe(m["trailing_pe"])),
    ("P/E (current)", "current_pe", lambda m: pe(m["current_pe"])),
    ("Forward P/E", "forward_pe", lambda m: pe(m["forward_pe"])),
    ("D/E", "de", lambda m: mnum(m["de"])),
]

# Hover descriptions for the metric labels above.
METRIC_TIPS = {
    "P/S": "Price-to-Sales — market cap ÷ trailing 12-month revenue",
    "D/E": "Debt-to-Equity — total debt ÷ shareholders' equity",
    "Operating margin": "Operating income ÷ revenue",
    "Revenue growth (YoY)": "Year-over-year revenue change",
    "Trailing P/E": "Price ÷ trailing 12-month EPS (last 4 quarters)",
    "P/E (current)": "Price ÷ latest annual (fiscal-year) EPS",
    "Forward P/E": "Price ÷ (latest quarterly EPS × 4), annualized",
}

"""Human-readable Income Tax report as a self-contained HTML document.

Pure string building (no Dash, no I/O) so it is unit-testable and can be handed to
``dcc.send_string`` for download. The result opens in any browser and prints to
PDF. ``payload`` is what the Income Tax page stores after a Calculate:

    {"status": <income_tax_status dict>, "year": 2026, "country": "Thailand",
     "currency": "THB", "subcat": "Tax", "generated": "2026-07-12"}
"""

from __future__ import annotations

from html import escape


def _band_label(lo, hi) -> str:
    """Compact bracket band label, e.g. "150k–300k" or "5M+"."""
    def k(v):
        if v == 0:
            return "0"
        return f"{v / 1_000_000:g}M" if v >= 1_000_000 else f"{v / 1000:g}k"
    return f"{k(lo)}+" if hi is None else f"{k(lo)}–{k(hi)}"


_CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: Helvetica, Arial, sans-serif; color: #1f2430;
       background: #fff; margin: 0; padding: 32px; }
.wrap { max-width: 720px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 2px; }
.sub { color: #6b7280; font-size: 13px; margin: 0 0 20px; }
h2 { font-size: 15px; margin: 24px 0 8px; color: #1f2430; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; text-align: left; }
th { color: #6b7280; font-weight: 600; font-size: 12px; }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 2px solid #d1d5db; }
.due td { font-weight: 700; font-size: 16px; }
.due td.num { text-decoration: underline; text-underline-offset: 3px; }
.pay { color: #c0392b; font-weight: 700; }
.refund { color: #1e8e4e; font-weight: 700; }
.foot { color: #9aa3ad; font-size: 12px; margin-top: 28px;
        border-top: 1px solid #e5e7eb; padding-top: 10px; }
@media print { body { padding: 0; } }
"""


def _money(v, cur: str) -> str:
    return f"{float(v or 0):,.0f} {cur}"


def build_report_html(payload: dict) -> str:
    status = payload.get("status") or {}
    cur = escape(str(payload.get("currency") or ""))
    year = escape(str(payload.get("year") or ""))
    country = escape(str(payload.get("country") or "Thailand"))
    subcat = payload.get("subcat")
    generated = escape(str(payload.get("generated") or ""))

    def money(v):
        return _money(v, cur)

    # ── summary rows ─────────────────────────────────────────────────────────
    rows = [
        ("Gross income", money(status.get("gross")), ""),
        ("− Employment expense", money(status.get("expense_deduction")), ""),
        ("− Allowances", money(status.get("allowance_total")), ""),
        ("Net taxable income", money(status.get("net_taxable")), ""),
        ("Tax due", money(status.get("tax_due")), "due"),
        ("Effective rate", f"{status.get('effective_rate', 0) * 100:.2f}%", ""),
        ("Marginal rate", f"{status.get('marginal_rate', 0) * 100:.0f}%", ""),
    ]
    # Raw here — the row renderer escapes every label once (avoid double-escaping).
    paid_label = "Tax already paid" + (f" · {subcat}" if subcat else "")
    rows.append((paid_label, money(status.get("tax_paid")), ""))

    rem = float(status.get("remaining", 0) or 0)
    if rem > 0:
        rem_label, rem_cls = "Still to pay", "pay"
    elif rem < 0:
        rem_label, rem_cls = "Refund", "refund"
    else:
        rem_label, rem_cls = "Settled", ""
    summary_html = "".join(
        f'<tr class="{cls}"><td>{escape(label)}</td>'
        f'<td class="num">{val}</td></tr>'
        for label, val, cls in rows)
    summary_html += (f'<tr><td class="{rem_cls}">{rem_label}</td>'
                     f'<td class="num {rem_cls}">{money(abs(rem))}</td></tr>')

    # ── deductions applied ───────────────────────────────────────────────────
    used = [b for b in (status.get("allowance_breakdown") or []) if b.get("amount")]
    if used:
        ded_rows = "".join(
            f'<tr><td>{escape(str(b["label"]))}</td>'
            f'<td class="num">{money(b["amount"])}</td></tr>' for b in used)
        ded_rows += (f'<tr class="total"><td>Total allowances</td>'
                     f'<td class="num">{money(status.get("allowance_total"))}</td></tr>')
        deductions = (f'<h2>Deductions applied</h2><table>{ded_rows}</table>')
    else:
        deductions = '<h2>Deductions applied</h2><p class="sub">None applied.</p>'

    # ── tax by bracket ───────────────────────────────────────────────────────
    brows = status.get("bracket_rows") or []
    if brows:
        body = "".join(
            f'<tr><td>{escape(_band_label(r["lower"], r["upper"]))}</td>'
            f'<td class="num">{money(r["income_in_band"])}</td>'
            f'<td class="num">{r["rate"] * 100:.0f}%</td>'
            f'<td class="num">{money(r["tax"])}</td></tr>' for r in brows)
        brackets = (
            '<h2>Tax by bracket</h2><table>'
            '<tr><th>Band</th><th class="num">Income in band</th>'
            '<th class="num">Rate</th><th class="num">Tax</th></tr>'
            f'{body}</table>')
    else:
        brackets = ('<h2>Tax by bracket</h2>'
                    '<p class="sub">No taxable income — no tax due.</p>')

    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        f"<title>Income Tax Estimate {year}</title><style>{_CSS}</style></head>"
        "<body><div class=\"wrap\">"
        f"<h1>Income Tax Estimate — {year} ({country})</h1>"
        f'<p class="sub">Generated {generated}</p>'
        f"<h2>Summary</h2><table>{summary_html}</table>"
        f"{deductions}"
        f"{brackets}"
        '<p class="foot">Estimate only — not tax advice. Figures are based on the '
        "inputs you entered and the standard allowances/brackets.</p>"
        "</div></body></html>"
    )

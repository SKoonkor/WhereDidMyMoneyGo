"""Income Tax HTML report builder (pure, no Dash)."""

from src.analytics.income_tax import income_tax_status, TH_SPEC
from src.io.tax_report import build_report_html


def _payload(subcat="Tax", tax_paid=8_000):
    status = income_tax_status(840_000, {"ssf": 300_000}, TH_SPEC,
                               tax_paid=tax_paid)
    return {"status": status, "year": 2026, "country": "Thailand",
            "currency": "THB", "subcat": subcat, "generated": "2026-07-12"}


def test_report_is_standalone_html():
    html = build_report_html(_payload())
    assert html.lstrip().lower().startswith("<!doctype html>")
    assert "<style>" in html                       # inline CSS, self-contained
    assert "http://" not in html and "https://" not in html  # no external assets


def test_report_contains_headline_figures():
    payload = _payload()
    s = payload["status"]
    html = build_report_html(payload)
    assert "Income Tax Estimate — 2026 (Thailand)" in html
    assert "Generated 2026-07-12" in html
    assert f"{s['tax_due']:,.0f} THB" in html       # 25,500 THB
    assert "Tax by bracket" in html
    assert "Deductions applied" in html


def test_report_shows_capped_allowance_and_paid():
    html = build_report_html(_payload())
    # SSF 300k is capped to 200k for gross 840k; the capped figure appears.
    assert "200,000 THB" in html
    assert "Tax already paid · Tax" in html


def test_report_refund_vs_owed_wording():
    assert "Still to pay" in build_report_html(_payload(tax_paid=0))
    assert "Refund" in build_report_html(_payload(tax_paid=100_000))


def test_report_escapes_subcategory():
    html = build_report_html(_payload(subcat="Tax & <b>WHT</b>"))
    assert "Tax &amp; &lt;b&gt;WHT&lt;/b&gt;" in html
    assert "<b>WHT</b>" not in html                 # raw markup not injected


def test_report_handles_zero_tax():
    payload = {"status": income_tax_status(100_000, {}, TH_SPEC),
               "year": 2025, "country": "Thailand", "currency": "THB",
               "subcat": None, "generated": "2026-01-01"}
    html = build_report_html(payload)
    assert "No taxable income" in html              # below the 0% band ceiling

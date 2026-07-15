"""Reusable UI components shared across pages."""

from __future__ import annotations

from dash import dcc, html

from src.app import theme
from src.app.i18n import t
from src.analytics.reconciliation import is_reminder_due


def reminder_banner():
    """A dismissible banner prompting balance reconciliation when overdue.

    Returns an empty placeholder (keeping the close-button id absent) when no
    reminder is due. Dismissal for the session is handled by a clientside
    callback registered in home.py.
    """
    if not is_reminder_due():
        return html.Div(id="recon-reminder", style={"display": "none"})
    return html.Div(
        [
            html.Span(t("⏰ Time to reconcile your accounts — register your real "
                        "balances to capture untracked spending."),
                      style={"flex": "1"}),
            dcc.Link(t("Reconcile now"), href="/reconcile", className="reminder-cta"),
            html.Button("✕", id="recon-reminder-close", n_clicks=0,
                        className="reminder-close", title=t("Dismiss")),
        ],
        id="recon-reminder", className="reminder-banner",
    )


def home_link():
    """A 'home' link styled as a button (placed at the top-right of a header)."""
    return dcc.Link(
        t("⌂ Home"),
        href="/",
        style={"textDecoration": "none", "whiteSpace": "nowrap", **theme.BUTTON_STYLE},
    )


def theme_toggle():
    """Light/dark mode toggle — a sliding pill switch (clientside in app.py).

    The knob slides and the icon/colours swap purely in CSS off ``data-theme``;
    the button just relays the click to the theme callback."""
    return html.Button(html.Span(className="tt-knob"),
                       id="theme-toggle", n_clicks=0,
                       className="theme-switch", title=t("Toggle light/dark mode"))


def censor_toggle():
    """Privacy toggle — a minimalist eye / eye-off icon (clientside in app.py).

    The glyph is a CSS mask so it takes the theme ink colour and flips to the
    slashed eye under ``data-censor="on"``."""
    return html.Button(html.Span(className="ct-eye"),
                       id="censor-toggle", n_clicks=0,
                       className="censor-toggle", title=t("Hide/show amounts"))


def lang_toggle():
    """Language toggle — a compact ``EN / TH`` pill (clientside in app.py).

    Both codes are always rendered; CSS highlights the active one off
    ``data-lang`` (the same trick as ``money_span`` off ``data-censor``), so the
    callback only has to flip the stored value. Page text is not translated yet —
    this just persists the choice for the upcoming per-page translation work."""
    return html.Button(
        [html.Span("EN", className="lang-en"),
         html.Span("/", className="lang-sep"),
         html.Span("TH", className="lang-th")],
        id="lang-toggle", n_clicks=0,
        className="lang-switch", title=t("Switch language (EN / TH)"))


def money_span(text, className: str = ""):
    """A money amount that CSS masks to '*****' when privacy mode is on. The real
    value and the mask are both rendered; ``data-censor`` toggles which shows."""
    return html.Span(
        [html.Span(text, className="money-real"),
         html.Span("*****", className="money-mask")],
        className=("money " + className).strip(),
    )


# Dropdown destinations, grouped: personal finance, investing, then balances —
# each group separated by a horizontal rule. An entry is (label, href) or
# (label, sub, href); the sub renders fainter — inline when it's parenthesised,
# on its own line otherwise (long names would overflow the dropdown).
_MENU_GROUPS = [
    [
        ("Money Flow", "/flow"),
        ("Income / Expense", "/pie"),
        ("Transactions", "/transactions"),
        ("Budget", "/budget"),
        ("Financial Goals", "/goals"),
        ("Income Tax", "/income-tax"),
    ],
    [
        ("Compound Interest", "/compound"),
        ("Investing Simulator", "Historical Data", "/invest"),
        ("Paper Trading", "Live Market Data", "/paper"),
        ("Stock Intrinsic Valuation", "/valuation"),
    ],
    [
        ("Account Settings", "/settings"),
    ],
]


def _menu_link(entry):
    if len(entry) == 2:
        label, href = entry
        return dcc.Link(t(label), href=href)
    label, sub, href = entry
    sub_cls = "menu-sub" if sub.startswith("(") else "menu-sub menu-sub-line"
    return dcc.Link([html.Span(t(label)), html.Span(f" {t(sub)}", className=sub_cls)],
                    href=href)


def menu_widget():
    """A collapsible "☰ Menu" dropdown for the header (toggled clientside below)."""
    items = []
    for i, group in enumerate(_MENU_GROUPS):
        if i:
            items.append(html.Hr(className="menu-divider"))
        items.extend(_menu_link(entry) for entry in group)
    return html.Div(
        [
            html.Button(t("☰  Menu"), id="menu-toggle", n_clicks=0,
                        className="menu-btn", title=t("Menu")),
            html.Div(items, id="menu-dropdown", className="menu-dropdown",
                     style={"display": "none"}),
        ],
        style={"position": "relative"},
    )


# The "☰ Menu" dropdown is opened/closed and dismissed on outside click entirely
# in assets/popup_dismiss.js (so it behaves like the calendar popup). Navigating via
# a dcc.Link re-renders the header, so the dropdown resets to hidden afterwards.


def page_header(title: str, subtitle: str | None = None, show_home: bool = True,
                back: tuple[str, str] | None = None):
    """Page header with title/subtitle on the left, theme toggle + Home top-right.

    ``back`` is an optional (label, href) pair rendered as a "‹ label" button
    above the title — like the mobile-style back navigation in the design.

    Placing the controls in the header keeps them clear of the Plotly modebar
    and the Dash dev-tools widget (both of which sit over the chart area).
    """
    left = []
    if back:
        back_label, back_href = back
        left.append(dcc.Link(
            f"‹ {t(back_label)}", href=back_href, className="back-link",
            style={"display": "inline-block", "textDecoration": "none",
                   "whiteSpace": "nowrap", "marginBottom": "10px",
                   **theme.BUTTON_STYLE},
        ))
        left.append(html.Br())
    left.append(html.H1(t(title), style=theme.H1_STYLE))
    if subtitle:
        left.append(html.P(t(subtitle), style={"color": theme.MUTED, "marginTop": 0}))
    right = [theme_toggle(), censor_toggle(), lang_toggle(), menu_widget()]
    if show_home:
        right.append(home_link())
    return html.Div(
        [
            html.Div(left),
            html.Div(right, style={"display": "flex", "gap": "10px",
                                   "alignItems": "center"}),
        ],
        style={"display": "flex", "justifyContent": "space-between",
               "alignItems": "flex-start", "marginBottom": "16px", "gap": "16px"},
    )


def card(children, style: dict | None = None):
    return html.Div(children, style={**theme.CARD_STYLE, **(style or {})})

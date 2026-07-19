"""Reusable UI components shared across pages."""

from __future__ import annotations

from dash import dcc, html

from src.app import theme
from src.app.i18n import t, second_lang_native
from src.app.data import language_config
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
        # Same class as the ☰ Menu button so the two match in height across languages.
        className="menu-btn",
    )


def theme_toggle(id_suffix: str = ""):
    """Light/dark mode toggle — a sliding pill switch (clientside in app.py).

    The knob slides and the icon/colours swap purely in CSS off ``data-theme``;
    the button just relays the click to the theme callback. ``id_suffix`` lets a
    second instance (e.g. the mobile menu copy, ``-m``) coexist without duplicate
    ids; both feed the same callback."""
    return html.Button(html.Span(className="tt-knob"),
                       id="theme-toggle" + id_suffix, n_clicks=0,
                       className="theme-switch", title=t("Toggle light/dark mode"))


def censor_toggle(id_suffix: str = ""):
    """Privacy toggle — a minimalist eye / eye-off icon (clientside in app.py).

    The glyph is a CSS mask so it takes the theme ink colour and flips to the
    slashed eye under ``data-censor="on"``. See ``theme_toggle`` for ``id_suffix``."""
    return html.Button(html.Span(className="ct-eye"),
                       id="censor-toggle" + id_suffix, n_clicks=0,
                       className="censor-toggle", title=t("Hide/show amounts"))


def lang_toggle(id_suffix: str = ""):
    """Language toggle — a compact ``EN / <native>`` pill (clientside in app.py).

    Both codes are always rendered; CSS highlights the active one off ``data-lang``
    (the same trick as ``money_span`` off ``data-censor``), so the callback only
    flips the stored value. The second code shows the chosen language's native
    script (e.g. ``ไทย``). ``data-locked`` mirrors the Settings "disable toggling"
    option; when locked, a click reveals the sibling ``lang-lock-msg`` instead of
    switching (see the clientside callback in ``app.py``). ``id_suffix`` lets a
    second instance (the mobile menu copy, ``-m``) coexist without duplicate ids."""
    lc = language_config()
    button = html.Button(
        [html.Span("EN", className="lang-en"),
         html.Span("/", className="lang-sep"),
         html.Span(second_lang_native(lc["second_language"]), className="lang-th")],
        id="lang-toggle" + id_suffix, n_clicks=0, className="lang-switch",
        title=t("Switch language"),
        **{"data-locked": "1" if lc["toggle_disabled"] else "0"})
    return html.Div(
        [button,
         html.Span(t("No language toggle allowed, enable in Settings"),
                   id="lang-lock-msg" + id_suffix, className="lang-lock-msg")],
        className="lang-switch-wrap")


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
        ("Retirement Planning", "/compound"),
    ],
    [
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
    """A collapsible "☰ Menu" dropdown of navigation links for the header
    (toggled clientside below). The theme/privacy/language toggles live in the
    header bar itself (``.header-tools-desktop`` in ``page_header``) at every
    screen size, so the menu holds navigation only."""
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
    """Page header: the controls row (Menu + Home, plus the theme/privacy/language
    toggles on large screens) sits at the very top, with the title/subtitle below —
    so the page reads like an app, nav first.

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
    # The inline theme/privacy/language toggles show at every screen size.
    right = [
        html.Div([theme_toggle(), censor_toggle(), lang_toggle()],
                 className="header-tools-desktop",
                 style={"display": "flex", "gap": "10px", "alignItems": "center"}),
        menu_widget(),
    ]
    if show_home:
        right.append(home_link())
    return html.Div(
        [
            # Controls first (top-right cluster on its own row), title below.
            html.Div(right, className="header-controls",
                     style={"display": "flex", "gap": "10px", "alignItems": "center",
                            "flexWrap": "wrap", "justifyContent": "flex-end"}),
            html.Div(left),
        ],
        className="page-header",
        style={"marginBottom": "16px"},
    )


def card(children, style: dict | None = None, className: str | None = None):
    return html.Div(children, style={**theme.CARD_STYLE, **(style or {})},
                    className=className)


# ── Landscape / fullscreen chart helper ───────────────────────────────────────
# Generic clientside body for the chart-expand toggle: finds the enclosing .ls-box
# from the clicked button and opens it full-screen as a plain viewport FILL
# (.fullscreen) — no CSS rotation. Rotating the chart 90° (the old phone path) broke
# Plotly's pan/zoom, which reads raw screen coordinates and can't account for the
# transform (worst on rotation-locked phones, where the device never turns to match).
# So every device now just fills the screen upright; a phone gets a true wide view by
# physically turning (auto-rotate). The device-based CSS label swap still shows
# "Landscape" on phones vs "Full screen" on computers. The JS ignores its args (reads
# callback_context.triggered), so any number of enter/exit button inputs share it.
LANDSCAPE_JS = """
function () {
    var trig = (window.dash_clientside.callback_context.triggered[0] || {});
    var id = (trig.prop_id || '').split('.')[0];
    var btn = id && document.getElementById(id);
    if (btn) {
        var box = btn.closest('.ls-box');
        if (box) {
            var on = id.indexOf('ls-enter') >= 0;
            if (on) {
                box.classList.add('fullscreen');
            } else {
                box.classList.remove('fullscreen');
            }
            document.body.style.overflow = on ? 'hidden' : '';
            setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 150);
        }
    }
    return window.dash_clientside.no_update;
}
"""


def ls_enter_children():
    """Enter-button label: "⤢ Landscape" on phones, "⛶ Full screen" on computers
    (CSS swaps them by the same media query the JS uses)."""
    return [html.Span("⤢ " + t("Landscape"), className="ls-lbl-ls"),
            html.Span("⛶ " + t("Full screen"), className="ls-lbl-fs")]


def ls_exit_children():
    """Exit-button label: "✕ Close landscape" on phones, "✕ Exit full screen" on
    computers."""
    return [html.Span("✕ " + t("Close landscape"), className="ls-lbl-ls"),
            html.Span("✕ " + t("Exit full screen"), className="ls-lbl-fs")]


def landscape_chart(graph, prefix: str, head_left: list | None = None):
    """Wrap a ``dcc.Graph`` in the reusable expand box (``.ls-box``): the button
    (CSS-shown only ≤900px) opens a locked full-screen view — rotated on phones,
    filled on computers. ``prefix`` names the buttons (``{prefix}-ls-enter`` /
    ``{prefix}-ls-exit``) and the box (``{prefix}-ls-box``). ``head_left`` is optional
    content placed left of the button in the head row (e.g. a Log-y toggle). The
    passed ``graph`` should carry ``className="ls-graph"`` so it fills the box. Pair
    with a page-level ``clientside_callback(LANDSCAPE_JS, …)`` listing the buttons."""
    head = list(head_left or [])
    head.append(html.Button(ls_enter_children(), id=f"{prefix}-ls-enter",
                            n_clicks=0, className="ls-enter"))
    return html.Div(
        [
            html.Div(head, className="ls-head",
                     style={"display": "flex", "justifyContent": "flex-end",
                            "alignItems": "center", "gap": "10px"}),
            html.Div(
                [html.Button(ls_exit_children(), id=f"{prefix}-ls-exit",
                             n_clicks=0, className="ls-exit"),
                 graph],
                className="ls-inner",
            ),
        ],
        id=f"{prefix}-ls-box", className="ls-box",
    )

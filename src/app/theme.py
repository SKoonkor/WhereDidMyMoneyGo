"""Shared visual theme.

Page chrome uses CSS variables (defined in assets/style.css) so the light/dark
toggle restyles all HTML instantly without re-rendering layouts. Plotly cannot
read CSS variables, so figure builders take a ``dark`` flag and pull concrete
hex values from :func:`fig_theme`.
"""

from dataclasses import dataclass

# ── CSS-variable colors for HTML components (theme-reactive) ─────────────────
INK = "var(--ink)"
MUTED = "var(--muted)"
ACCENT = "var(--accent)"

# Semantic colors shared by figures and HTML (legible on both themes).
INCOME_COLOR = "#2ecc71"
EXPENSE_COLOR = "#e74c3c"
SAVING_COLOR = "#3498db"

# Color per account (used by the money-flow plot legend).
ACCOUNT_COLORS = {
    "Bank Accounts": "#3498db",
    "Credit Card":   "#e74c3c",
    "Savings":       "#2ecc71",
    "Cash":          "#f39c12",
    "Wallet":        "#9b59b6",
    "Card":          "#1abc9c",
    "Brokerage":     "#e67e22",
}
# Fallback palette for any account not listed above.
FALLBACK_PALETTE = ["#34495e", "#7f8c8d", "#d35400", "#8e44ad", "#16a085"]

# Latin faces first, then widely-available system Thai faces (macOS Thonburi/
# Sukhumvit, Windows Leelawadee UI, Linux Noto Sans Thai/Sarabun) so Thai text
# renders cleanly wherever the app runs.
FONT_FAMILY = ('Helvetica Neue, Helvetica, Arial, "Sarabun", "Leelawadee UI", '
               '"Sukhumvit Set", Thonburi, "Noto Sans Thai", sans-serif')


def account_color(account: str, index: int = 0) -> str:
    """Return a stable color for an account name."""
    if account in ACCOUNT_COLORS:
        return ACCOUNT_COLORS[account]
    return FALLBACK_PALETTE[index % len(FALLBACK_PALETTE)]


# ── Plotly figure theming (concrete hex per mode) ─────────────────────────────

@dataclass(frozen=True)
class FigTheme:
    template: str      # base Plotly template
    ink: str           # primary text / annotations
    muted: str         # secondary text, dotted connectors
    grid: str          # grid lines / annotation borders
    band: str          # alternating month-band fill (money flow)
    anno_bg: str       # balances-box background
    bar_outline: str   # income bar outline (money flow)


DARK_FIG = FigTheme(
    template="plotly_dark",
    ink="#e8eaed",
    muted="#9aa3ad",
    grid="#3a4250",
    band="#ffffff",
    anno_bg="rgba(30,36,46,0.88)",
    bar_outline="#ffffff",
)

LIGHT_FIG = FigTheme(
    template="plotly_white",
    ink="#2c3e50",
    muted="#7f8c8d",
    grid="#d0d7de",
    band="#000000",
    anno_bg="rgba(255,255,255,0.85)",
    bar_outline="#000000",
)


def fig_theme(dark: bool) -> FigTheme:
    return DARK_FIG if dark else LIGHT_FIG


def is_dark(theme_value) -> bool:
    """Map the theme-store value to a bool. Unset (None) means dark."""
    return theme_value != "light"


def is_censored(censor_value) -> bool:
    """Whether privacy mode is on (money amounts hidden). Unset means off."""
    return bool(censor_value)


def gauge_bands(dark: bool) -> list[str]:
    """Background bands for the goal gauge (low → high)."""
    if dark:
        return ["#54393b", "#54482e", "#2e4a3a"]
    return ["#fadbd8", "#fdebd0", "#d5f5e3"]


# ── Reusable CSS-in-Python style dicts ────────────────────────────────────────

PAGE_STYLE = {
    "fontFamily": FONT_FAMILY,
    # Horizontal padding is fluid (clamp is valid in inline styles), so every page
    # tightens toward the edges on phones without a per-page media query.
    "padding": "20px clamp(14px, 4vw, 32px)",
    "maxWidth": "1280px",
    "margin": "0 auto",
    "color": INK,
}

CARD_STYLE = {
    "background": "var(--surface)",
    "borderRadius": "14px",
    "boxShadow": "var(--shadow)",
    "padding": "16px",
}

H1_STYLE = {"fontWeight": 600, "color": INK, "marginBottom": "4px"}

BUTTON_STYLE = {
    "background": "var(--btn-bg)",
    "color": "var(--btn-fg)",
    "border": "none",
    "borderRadius": "8px",
    "padding": "10px 18px",
    "fontSize": "15px",
    "cursor": "pointer",
}

PERIOD_BUTTON_STYLE = {
    "background": "var(--surface)",
    "color": INK,
    "border": "1px solid var(--border)",
    "borderRadius": "8px",
    "padding": "8px 14px",
    "fontSize": "14px",
    "cursor": "pointer",
}

PERIOD_BUTTON_ACTIVE_STYLE = {
    **PERIOD_BUTTON_STYLE,
    "background": "var(--btn-bg)",
    "color": "var(--btn-fg)",
    "border": "1px solid var(--btn-bg)",
}

# Shared input style — box-sizing keeps padding inside the declared width so
# text and placeholders never overflow their boxes.
INPUT_STYLE = {
    "width": "100%",
    "padding": "8px 10px",
    "marginBottom": "12px",
    "boxSizing": "border-box",
    "background": "var(--surface-2)",
    "color": INK,
    "border": "1px solid var(--border)",
    "borderRadius": "6px",
    "fontSize": "14px",
}

# A label/value row that never overlaps (flex instead of float).
RESULT_ROW_STYLE = {
    "display": "flex",
    "justifyContent": "space-between",
    "alignItems": "baseline",
    "gap": "12px",
    "padding": "6px 0",
    "borderBottom": "1px solid var(--border-soft)",
}

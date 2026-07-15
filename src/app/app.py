"""Dash application factory and shell layout."""

from pathlib import Path

import dash
from dash import Dash, Input, Output, State, clientside_callback, dcc, html, page_container

from src.app import theme
from src.app.data import get_config
from src.utils.paths import is_frozen, resource_path

# In a frozen build the source tree lives under PyInstaller's extraction dir, so
# Dash can't infer the pages/assets folders from ``__file__``; point it at the
# bundled copies instead. From source both resolve to this package's folders.
if is_frozen():
    # Bundled to non-`src/` names so the on-disk copies Dash scans don't shadow
    # the frozen ``src`` package (see packaging/moneytracker.spec).
    _PAGES_DIR = str(resource_path("mt_pages"))
    _ASSETS_DIR = str(resource_path("mt_assets"))
else:
    _PAGES_DIR = str(Path(__file__).parent / "pages")
    _ASSETS_DIR = str(Path(__file__).parent / "assets")

# Applies the saved theme before first paint so dark/light loads without a
# flash of the wrong background. dcc.Store(storage_type="local") persists
# JSON under localStorage key = component id.
_INDEX_STRING = """<!DOCTYPE html>
<html>
    <head>
        {%metas%}
        <title>{%title%}</title>
        {%favicon%}
        <script>
        (function () {
            var t = "dark";
            try {
                if (JSON.parse(window.localStorage.getItem("theme-store")) === "light") {
                    t = "light";
                }
            } catch (e) {}
            document.documentElement.setAttribute("data-theme", t);
            // Apply saved privacy mode before first paint (mask amounts instantly).
            var c = "off";
            try {
                if (JSON.parse(window.localStorage.getItem("censor-store")) === true) {
                    c = "on";
                }
            } catch (e) {}
            document.documentElement.setAttribute("data-censor", c);
        })();
        </script>
        {%css%}
    </head>
    <body>
        {%app_entry%}
        <footer>
            {%config%}
            {%scripts%}
            {%renderer%}
        </footer>
    </body>
</html>"""


def create_app() -> Dash:
    app = Dash(
        __name__,
        use_pages=True,
        pages_folder=_PAGES_DIR,
        assets_folder=_ASSETS_DIR,
        suppress_callback_exceptions=True,
        title=get_config().get("settings", {}).get("general", {}).get("app_name", "Money Tracker"),
    )
    app.index_string = _INDEX_STRING

    app.layout = html.Div(
        [
            dcc.Store(id="theme-store", storage_type="local"),
            dcc.Store(id="censor-store", storage_type="local"),
            page_container,
        ],
        style={"minHeight": "100vh", "fontFamily": theme.FONT_FAMILY},
    )

    # The toggle button remounts with n_clicks=0 on every page change; only a
    # real click (truthy n_clicks) flips the theme, otherwise we just re-sync.
    clientside_callback(
        """
        function (n_clicks, current) {
            var dark = current !== "light";
            if (n_clicks) { dark = !dark; }
            var next = dark ? "dark" : "light";
            document.documentElement.setAttribute("data-theme", next);
            return next;
        }
        """,
        Output("theme-store", "data"),
        Input("theme-toggle", "n_clicks"),
        State("theme-store", "data"),
    )

    # Privacy toggle: flip the persisted censor flag and set the DOM attribute
    # (CSS masks amounts instantly); figure callbacks also read the store value.
    clientside_callback(
        """
        function (n_clicks, current) {
            var on = current === true;
            if (n_clicks) { on = !on; }
            document.documentElement.setAttribute("data-censor", on ? "on" : "off");
            return on;
        }
        """,
        Output("censor-store", "data"),
        Input("censor-toggle", "n_clicks"),
        State("censor-store", "data"),
    )
    return app


# Module-level app + server for `gunicorn`/`flask` style deployment.
app = create_app()
server = app.server

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
            // Highlight the active language from the `lang` cookie — the same
            // source the server uses to render text, so the pill always matches
            // the page. Falls back to the persisted store, then English.
            var l = "en";
            try {
                var m = document.cookie.match(/(?:^|; )lang=(en|th)/);
                if (m) { l = m[1]; }
                else if (JSON.parse(window.localStorage.getItem("lang-store")) === "th") { l = "th"; }
            } catch (e) {}
            document.documentElement.setAttribute("data-lang", l);
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
            dcc.Store(id="lang-store", storage_type="local"),
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

    # Language toggle: flip the persisted language (en⇄th), set the DOM attribute
    # (CSS highlights the active code off data-lang), and on a real click write the
    # `lang` cookie and reload so the server re-renders every string in the new
    # language (page layouts/callbacks read the cookie via src/app/i18n.get_lang).
    clientside_callback(
        """
        function (n_clicks, current) {
            // The `lang` cookie is the single source of truth (the server reads
            // it too); read the current value from it, not from the store, so a
            // reload racing the store write can't desync the toggle.
            var m = document.cookie.match(/(?:^|; )lang=(en|th)/);
            var lang = m ? m[1] : "en";
            if (n_clicks) {
                lang = (lang === "en") ? "th" : "en";
                document.cookie = "lang=" + lang + ";path=/;max-age=31536000;samesite=lax";
                document.documentElement.setAttribute("data-lang", lang);
                window.location.reload();
                return lang;
            }
            document.documentElement.setAttribute("data-lang", lang);
            return lang;
        }
        """,
        Output("lang-store", "data"),
        Input("lang-toggle", "n_clicks"),
        State("lang-store", "data"),
    )
    return app


# Module-level app + server for `gunicorn`/`flask` style deployment.
app = create_app()
server = app.server

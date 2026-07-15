"""i18n core: the t() translator and cookie-based get_lang().

Pure helpers — no Dash app needed. get_lang() is exercised with a real Flask
request context (a throwaway Flask app) so the cookie path is covered.
"""

import flask

from src.app.i18n import DEFAULT_LANG, get_lang, t
from src.app.translations_th import TRANSLATIONS_TH


# ── t() ─────────────────────────────────────────────────────────────────────────

def test_english_is_identity():
    assert t("Budget", "en") == "Budget"
    assert t("Money Flow", "en") == "Money Flow"


def test_thai_translates_known_key():
    assert t("Budget", "th") == TRANSLATIONS_TH["Budget"]
    assert t("Budget", "th") != "Budget"


def test_missing_key_falls_back_to_english():
    assert t("No such string here", "th") == "No such string here"


def test_non_string_passthrough():
    # page_header titles are sometimes a list of Dash children — must not raise.
    children = ["Investing Simulator ", {"props": {}}]
    assert t(children, "th") is children


# ── get_lang() ──────────────────────────────────────────────────────────────────

def test_get_lang_defaults_english_without_request():
    # Called outside any request context.
    assert get_lang() == DEFAULT_LANG == "en"


def test_get_lang_reads_cookie():
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"Cookie": "lang=th"}):
        assert get_lang() == "th"
    with app.test_request_context("/", headers={"Cookie": "lang=en"}):
        assert get_lang() == "en"


def test_get_lang_ignores_unsupported_cookie():
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"Cookie": "lang=fr"}):
        assert get_lang() == "en"
    with app.test_request_context("/"):  # no cookie
        assert get_lang() == "en"


def test_t_uses_current_request_language():
    app = flask.Flask(__name__)
    with app.test_request_context("/", headers={"Cookie": "lang=th"}):
        assert t("Budget") == TRANSLATIONS_TH["Budget"]   # lang inferred from cookie
    with app.test_request_context("/", headers={"Cookie": "lang=en"}):
        assert t("Budget") == "Budget"

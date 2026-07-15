"""i18n core: the t() translator and cookie-based get_lang().

Pure helpers — no Dash app needed. get_lang() is exercised with a real Flask
request context (a throwaway Flask app) so the cookie path is covered.
"""

import flask

from src.app.i18n import DEFAULT_LANG, get_lang, make_t, t
from src.app.translations_th import TRANSLATIONS_TH, TRANSLATIONS_TH_BY_PAGE


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


# ── per-page overrides / make_t() ────────────────────────────────────────────────

# "Budget" exists in the shared base; we override it only for the "budget" page
# so the same English string yields different Thai depending on context.
_SENTINEL = "งบ-เฉพาะหน้านี้"


def _seed_budget_override(monkeypatch):
    monkeypatch.setitem(TRANSLATIONS_TH_BY_PAGE["budget"], "Budget", _SENTINEL)


def test_make_t_override_wins_for_its_namespace(monkeypatch):
    _seed_budget_override(monkeypatch)
    tb = make_t("budget")
    assert tb("Budget", "th") == _SENTINEL


def test_make_t_falls_back_to_shared_when_no_override(monkeypatch):
    _seed_budget_override(monkeypatch)
    tb = make_t("budget")
    # not overridden for budget → shared Thai wins
    assert tb("Money Flow", "th") == TRANSLATIONS_TH["Money Flow"]


def test_make_t_falls_back_to_english_when_unknown():
    tb = make_t("budget")
    assert tb("No such string here", "th") == "No such string here"


def test_make_t_english_is_identity(monkeypatch):
    _seed_budget_override(monkeypatch)  # override present but must not apply to EN
    assert make_t("budget")("Budget", "en") == "Budget"


def test_global_t_unaffected_by_overrides(monkeypatch):
    _seed_budget_override(monkeypatch)
    # namespace=None → shared base only, never a page override
    assert t("Budget", "th") == TRANSLATIONS_TH["Budget"] != _SENTINEL


def test_other_namespace_ignores_another_pages_override(monkeypatch):
    _seed_budget_override(monkeypatch)
    assert make_t("pie")("Budget", "th") == TRANSLATIONS_TH["Budget"]


def test_by_page_values_are_dicts():
    assert TRANSLATIONS_TH_BY_PAGE  # non-empty registry of namespaces
    for ns, overrides in TRANSLATIONS_TH_BY_PAGE.items():
        assert isinstance(ns, str)
        assert isinstance(overrides, dict), ns

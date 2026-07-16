"""Lightweight i18n for the Dash UI (English ⇄ Thai).

The language is carried in a ``lang`` cookie (set by the header EN/TH toggle,
see ``app.py``). Because every page ``layout`` and every text-producing callback
runs inside a Flask request, :func:`get_lang` can read that cookie at render
time — so translating a string is just wrapping it in :func:`t`, with no page
restructuring.

English source text doubles as the lookup key: :func:`t` returns the Thai
translation when the language is Thai *and* an entry exists, otherwise the
original English. That makes the rollout incremental and safe — any string not
yet in ``translations_th.py`` simply stays English.
"""

from __future__ import annotations

from src.app.translations_th import TRANSLATIONS_TH, TRANSLATIONS_TH_BY_PAGE

SUPPORTED = ("en", "th")
DEFAULT_LANG = "en"
COOKIE_NAME = "lang"

# Second-language registry. English is always the first language; a goal's second
# language is chosen from here (see data.language_config). Each entry carries the
# language's own native script (shown on the EN/xx toggle pill) and its English
# name (shown in the Settings dropdown). Adding a language is a data-only change
# here; wiring the actual translations/`SUPPORTED` for a new code is separate.
LANGUAGES: dict[str, dict[str, str]] = {
    "th": {"native": "ไทย", "english": "Thai"},
}
DEFAULT_SECOND_LANG = "th"


def second_lang_native(code: str | None) -> str:
    """Native-script symbol for the toggle pill (e.g. ``th`` → ``ไทย``)."""
    entry = LANGUAGES.get(code or DEFAULT_SECOND_LANG) or LANGUAGES[DEFAULT_SECOND_LANG]
    return entry["native"]


def get_lang() -> str:
    """Current UI language from the request cookie; ``"en"`` by default.

    Safe to call outside a request context (returns the default) so importable
    helpers and tests don't need a live Flask request.
    """
    try:
        from flask import request  # local import: no request context at import time
        lang = request.cookies.get(COOKIE_NAME)
    except Exception:
        lang = None
    return lang if lang in SUPPORTED else DEFAULT_LANG


def t(text: str, lang: str | None = None, namespace: str | None = None) -> str:
    """Translate ``text`` for the given (or current) language.

    Returns the Thai string when the effective language is ``"th"`` and a
    translation exists; otherwise returns ``text`` unchanged (English-as-key
    fallback).

    ``namespace`` selects a per-page override layer: when given, a matching entry
    in ``TRANSLATIONS_TH_BY_PAGE[namespace]`` wins, letting the same English
    string carry page-specific wording. Anything not overridden falls through to
    the shared ``TRANSLATIONS_TH`` base, then to English. With ``namespace=None``
    the behavior is exactly the shared-base lookup.
    """
    if not isinstance(text, str):
        return text  # e.g. a list of Dash children passed as a title — leave as-is
    if lang is None:
        lang = get_lang()
    if lang == "th":
        if namespace:
            page = TRANSLATIONS_TH_BY_PAGE.get(namespace)
            if page is not None and text in page:
                return page[text]
        return TRANSLATIONS_TH.get(text, text)
    return text


def make_t(namespace: str):
    """Return a translator bound to a page ``namespace``.

    Page and figure modules do ``t = make_t("budget")`` right after their imports;
    every ``t(...)`` call site then resolves against that page's override layer
    first (see :func:`t`). Binding at import time — rather than sniffing the
    request path — is what makes per-page context work inside Dash callbacks,
    whose request path is the shared ``/_dash-update-component`` endpoint.
    """
    def _t(text: str, lang: str | None = None) -> str:
        return t(text, lang=lang, namespace=namespace)

    return _t

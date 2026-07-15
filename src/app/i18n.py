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

from src.app.translations_th import TRANSLATIONS_TH

SUPPORTED = ("en", "th")
DEFAULT_LANG = "en"
COOKIE_NAME = "lang"


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


def t(text: str, lang: str | None = None) -> str:
    """Translate ``text`` for the given (or current) language.

    Returns the Thai string when the effective language is ``"th"`` and a
    translation exists; otherwise returns ``text`` unchanged (English-as-key
    fallback).
    """
    if not isinstance(text, str):
        return text  # e.g. a list of Dash children passed as a title — leave as-is
    if lang is None:
        lang = get_lang()
    if lang == "th":
        return TRANSLATIONS_TH.get(text, text)
    return text

"""Language settings: config accessor, the [language] save round-trip, and the
native-symbol rendering on the header toggle."""

from src.app.data import language_config, refresh_config
from src.app.i18n import second_lang_native, LANGUAGES
from src.utils.config import save_settings


def test_language_config_defaults(ledger_env):
    # A settings.toml with no [language] section → toggling allowed, Thai second.
    refresh_config()
    lc = language_config()
    assert lc == {"toggle_disabled": False, "second_language": "th"}


def test_language_config_save_roundtrip(ledger_env):
    save_settings({"language": {"toggle_disabled": True, "second_language": "th"}})
    refresh_config()
    lc = language_config()
    assert lc["toggle_disabled"] is True
    assert lc["second_language"] == "th"
    # The section is created in the file (save_settings appends missing sections).
    assert "[language]" in (ledger_env / "config" / "settings.toml").read_text()


def test_second_lang_native_symbol_and_fallback():
    assert second_lang_native("th") == "ไทย" == LANGUAGES["th"]["native"]
    assert second_lang_native(None) == "ไทย"      # default
    assert second_lang_native("zz") == "ไทย"      # unknown code → default


def test_lang_toggle_renders_native_symbol_and_lock(ledger_env):
    refresh_config()
    from src.app.components import lang_toggle
    wrap = lang_toggle()
    button = wrap.children[0]
    props = button.to_plotly_json()["props"]
    spans = props["children"]
    assert spans[0].children == "EN"
    assert spans[2].children == "ไทย"                       # native, not "TH"
    assert props["data-locked"] == "0"                      # default: not disabled
    # The hidden inline notice rides alongside the button.
    assert wrap.children[1].id == "lang-lock-msg"

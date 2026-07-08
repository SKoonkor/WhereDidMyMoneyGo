"""Configuration loader (tomllib) and a minimal in-place settings writer."""

import re
import tomllib
from pathlib import Path


def load_config(config_dir: str | Path = "config") -> dict:
    """Load all TOML config files from the config directory."""
    config_dir = Path(config_dir)
    config = {}
    for toml_file in config_dir.glob("*.toml"):
        with open(toml_file, "rb") as f:
            config[toml_file.stem] = tomllib.load(f)
    return config


def _toml_scalar(v) -> str:
    """Serialise a scalar to TOML. Python type decides the literal form."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        s = repr(v)
        return s if any(c in s for c in ".eE") else s + ".0"
    s = str(v).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{s}"'


def save_settings(updates: dict[str, dict], config_dir: str | Path = "config") -> None:
    """Update scalar keys in ``settings.toml`` in place, preserving comments.

    ``updates`` maps a section name to a ``{key: value}`` dict, e.g.
    ``{"general": {"app_name": "..."}, "emergency_fund": {"target_months": 3}}``.
    Existing keys are edited in their existing lines; a missing key is appended
    under its section (a missing section is appended at the end). The result is
    validated with ``tomllib`` before it is written.
    """
    path = Path(config_dir) / "settings.toml"
    lines = path.read_text(encoding="utf-8").splitlines()
    pending = {sec: dict(kv) for sec, kv in updates.items()}
    header_re = re.compile(r"^\s*\[([^\]]+)\]\s*$")

    def flush(section: str | None, out: list[str]) -> None:
        for key, val in (pending.get(section) or {}).items():
            out.append(f"{key} = {_toml_scalar(val)}")
        if section in pending:
            pending[section] = {}

    out: list[str] = []
    current: str | None = None
    for line in lines:
        m = header_re.match(line)
        if m:
            flush(current, out)              # emit any leftover keys for prev section
            current = m.group(1).strip()
            out.append(line)
            continue
        replaced = False
        for key in list((pending.get(current) or {}).keys()):
            km = re.match(r"^(\s*" + re.escape(key) + r"\s*=\s*).*$", line)
            if km:
                out.append(f"{km.group(1)}{_toml_scalar(pending[current][key])}")
                del pending[current][key]
                replaced = True
                break
        if not replaced:
            out.append(line)
    flush(current, out)                       # last section
    for section, kv in pending.items():        # sections not present at all
        if kv:
            out.append(f"[{section}]")
            for key, val in kv.items():
                out.append(f"{key} = {_toml_scalar(val)}")

    text = "\n".join(out) + "\n"
    tomllib.loads(text)                        # validate; raises on malformed
    path.write_text(text, encoding="utf-8")

"""Configuration loader using tomllib."""

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

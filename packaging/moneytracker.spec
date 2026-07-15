# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller build recipe for the Money Tracker desktop app.

One spec, three platforms:
  * macOS   → ``Money Tracker.app`` (onedir bundle, menu-bar/tray agent)
  * Windows → onefile ``MoneyTracker.exe``
  * Linux   → onefile ``MoneyTracker`` binary

Build:  ``pyinstaller packaging/moneytracker.spec``

Dash/plotly/statsmodels/yfinance load templates and submodules dynamically, so
we pull their data files + submodules explicitly. If a first launch dies with a
missing module or data file, add it to ``hiddenimports`` / ``datas`` below —
that iteration is expected.
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent  # packaging/ → project root
# PyInstaller runs this spec without the project root on sys.path, so make the
# local ``src`` package importable here — otherwise collect_submodules("src")
# returns nothing and only graph-reachable modules get frozen (Dash imports the
# page modules by path, so their `from src.app… import` lines would break).
sys.path.insert(0, str(ROOT))

datas = []
binaries = []
hiddenimports = ["werkzeug.serving"]

# Packages that need their full data + submodule set bundled.
for pkg in ("dash", "plotly"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

for pkg in ("statsmodels", "yfinance", "openpyxl", "pystray", "PIL"):
    datas += collect_data_files(pkg)
    hiddenimports += collect_submodules(pkg)

# Our own source: every submodule must be frozen (Dash imports page modules by
# name at runtime via use_pages).
hiddenimports += collect_submodules("src")

# App resources shipped as data. Dash scans the pages/assets folders from disk,
# so they must be real directories in the bundle — but NOT under ``src/`` or the
# on-disk copy would shadow the frozen ``src`` package (making e.g.
# ``src.app.txn_form`` unimportable). Ship them under neutral names and point
# Dash at them via resource_path("mt_pages") / ("mt_assets") in src/app/app.py.
datas += [
    (str(ROOT / "src" / "app" / "assets"), "mt_assets"),
    (str(ROOT / "src" / "app" / "pages"), "mt_pages"),
    (str(ROOT / "config.example"), "config.example"),
    (str(ROOT / "packaging" / "icon.png"), "packaging"),
]

# Trim heavy, unused test/plotting extras to keep the bundle smaller.
excludes = ["tkinter", "pytest", "playwright", "IPython", "notebook"]

a = Analysis(
    [str(ROOT / "desktop.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

if sys.platform == "darwin":
    icon = str(ROOT / "packaging" / "icon.icns")
elif os.name == "nt":
    icon = str(ROOT / "packaging" / "icon.ico")
else:
    icon = str(ROOT / "packaging" / "icon.png")

if sys.platform == "darwin":
    # onedir inside a .app bundle (the macOS-idiomatic form).
    exe = EXE(
        pyz, a.scripts, [], exclude_binaries=True,
        name="MoneyTracker", console=False, icon=icon,
    )
    coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="MoneyTracker")
    app = BUNDLE(
        coll,
        name="Money Tracker.app",
        icon=icon,
        bundle_identifier="com.skoonkor.moneytracker",
        info_plist={
            "CFBundleName": "Money Tracker",
            "CFBundleDisplayName": "Money Tracker",
            "NSHighResolutionCapable": True,
            # Menu-bar/tray agent: no Dock icon, lives in the status bar.
            "LSUIElement": True,
        },
    )
else:
    # onefile for Windows/Linux: one downloadable artifact.
    exe = EXE(
        pyz, a.scripts, a.binaries, a.datas, [],
        name="MoneyTracker", console=False, icon=icon,
        strip=False, upx=False,
    )

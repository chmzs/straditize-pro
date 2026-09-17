# -*- mode: python ; coding: utf-8 -*-
"""Universal cross-platform distribution bundle for Straditize Pro v2.0 (Windows, Linux, macOS)."""

import os
import sys

# SPECPATH is support/ -> repo_root is one level up
repo_root = os.path.abspath(os.path.join(SPECPATH, ".."))
source_root = os.path.join(repo_root, "straditize_core")
frontend_dist = os.path.join(repo_root, "frontend", "dist")

datas = []
if os.path.isdir(frontend_dist):
    datas.append((frontend_dist, os.path.join("frontend", "dist")))

models_dir = os.path.join(source_root, "ocr", "models")
if os.path.isdir(models_dir):
    datas.append((models_dir, os.path.join("straditize_core", "ocr", "models")))

excludes = [
    # Legacy PyQt5 & WebEngine
    "PyQt5",
    "PyQt5.QtCore",
    "PyQt5.QtWidgets",
    "PyQt5.QtGui",
    "PyQt5.QtNetwork",
    "PyQt5.QtWebEngineWidgets",
    "PyQtWebEngine",
    "PyQt5-sip",
    # Legacy plotting engine & GUI wrappers
    "psyplot",
    "psyplot_gui",
    "psy_strat",
    "matplotlib",
    "netCDF4",
    "xarray",
    # Dev & test tools
    "pytest",
    "pytest_asyncio",
    "pytest_cov",
    "ruff",
    "pip",
    "setuptools",
    "pkg_resources",
    "wheel",
    "IPython",
    "ipykernel",
    "jupyter",
    "qtconsole",
    "sphinx",
    "sphinx_rtd_theme",
]

analysis = Analysis(
    [os.path.join(repo_root, "app.py")],
    pathex=[repo_root],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "straditize_core",
        "straditize_core.rpc_server",
        "straditize_core.cli",
        "straditize_core.session",
        "straditize_core.digitize",
        "straditize_core.curve",
        "straditize_core.columns",
        "straditize_core.image",
        "straditize_core.calibration",
        "straditize_core.protocol",
        "straditize_core.age_depth",
        "skimage",
        "skimage.morphology",
        "skimage.color",
        "skimage.filters",
        "PIL",
        "PIL.Image",
        "pandas",
        "scipy",
        "scipy.interpolate",
        "scipy.signal",
        "scipy.ndimage",
        "numpy",
        "openpyxl",
        "pypdf",
        "onnxruntime",
        "straditize_core.ocr",
        "straditize_core.ocr.engine",
        "straditize_core.ocr.dictionary",
        "straditize_core.ocr.affine",
        "straditize_core.metadata",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(analysis.pure)
exe = EXE(
    pyz,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="straditize",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    analysis.binaries,
    analysis.datas,
    analysis.zipfiles,
    strip=False,
    upx=False,
    name="straditize",
)

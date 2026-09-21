"""
Tessera Presets Catalog
Defines validated, canonical configuration presets for the Control Center.
Presets only contain supported canonical keys.
"""

from typing import Any, Dict

PRESETS: Dict[str, Dict[str, Any]] = {
    "Balanced": {
        "description": "Clean, modern square-like tiling where all windows share space equitably.",
        "values": {
            "defaultLayout": "balanced-grid",
            "gapInner": 8,
            "gapOuter": 10,
            "primaryRegionRatio": 0.50,
            "primaryRegionCount": 1,
            "perDesktopLayout": True,
            "tileNewWindows": True,
            "ignoreMinimized": True,
            "showOsd": True,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
    "Primary + Stack": {
        "description": "Focus-oriented workflow with a prominent primary work area and stacked auxiliary windows.",
        "values": {
            "defaultLayout": "primary-stack",
            "gapInner": 8,
            "gapOuter": 10,
            "primaryRegionRatio": 0.55,
            "primaryRegionCount": 1,
            "perDesktopLayout": True,
            "tileNewWindows": True,
            "ignoreMinimized": True,
            "showOsd": True,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
    "Columns": {
        "description": "Vertical side-by-side columns ideal for wide or ultrawide displays.",
        "values": {
            "defaultLayout": "columns",
            "gapInner": 6,
            "gapOuter": 8,
            "primaryRegionRatio": 0.50,
            "primaryRegionCount": 1,
            "perDesktopLayout": True,
            "tileNewWindows": True,
            "ignoreMinimized": True,
            "showOsd": True,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
    "Rows": {
        "description": "Horizontal stacked rows ideal for tall or vertical monitor orientations.",
        "values": {
            "defaultLayout": "rows",
            "gapInner": 6,
            "gapOuter": 8,
            "primaryRegionRatio": 0.50,
            "primaryRegionCount": 1,
            "perDesktopLayout": True,
            "tileNewWindows": True,
            "ignoreMinimized": True,
            "showOsd": True,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
    "Focus": {
        "description": "Maximized focus layout where one window occupies the entire work area with zero distractions.",
        "values": {
            "defaultLayout": "monocle",
            "gapInner": 0,
            "gapOuter": 0,
            "primaryRegionRatio": 0.50,
            "primaryRegionCount": 1,
            "perDesktopLayout": True,
            "tileNewWindows": True,
            "ignoreMinimized": True,
            "showOsd": True,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
    "Floating": {
        "description": "Traditional floating window manager behavior with automated tiling disabled.",
        "values": {
            "defaultLayout": "floating",
            "enableTiling": False,
            "gapInner": 0,
            "gapOuter": 0,
            "primaryRegionRatio": 0.50,
            "primaryRegionCount": 1,
            "perDesktopLayout": False,
            "tileNewWindows": False,
            "ignoreMinimized": True,
            "showOsd": False,
            "reconcileDebounceMs": 60,
            "gameWindowPolicy": "floating",
        },
    },
}

def get_preset_names() -> list[str]:
    return list(PRESETS.keys())

def get_preset(name: str) -> Dict[str, Any]:
    if name not in PRESETS:
        raise KeyError(f"Unknown preset: {name}")
    return PRESETS[name]["values"].copy()

"""
Tessera Canonical Configuration Contract
Provides single-source-of-truth schema definitions, types, defaults, ranges, and migration rules.
"""

import json
import os
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONTRACT_JSON_PATH = os.path.join(REPO_ROOT, "config/canonical-config.json")

# Fallback definition if JSON file is relocated
CANONICAL_PROPERTIES = {
    "configSchemaVersion": {
        "type": "integer",
        "default": 2,
        "min": 1,
        "max": 10,
    },
    "enableTiling": {
        "type": "boolean",
        "default": True,
    },
    "defaultLayout": {
        "type": "string",
        "default": "balanced-grid",
        "enum": ["balanced-grid", "primary-stack", "binary-split", "columns", "rows", "monocle", "floating"],
        "legacyAliases": ["master-stack"],
    },
    "gapInner": {
        "type": "integer",
        "default": 8,
        "min": 0,
        "max": 100,
    },
    "gapOuter": {
        "type": "integer",
        "default": 10,
        "min": 0,
        "max": 100,
    },
    "primaryRegionRatio": {
        "type": "number",
        "default": 0.50,
        "min": 0.10,
        "max": 0.90,
        "legacyAliases": ["masterRatio"],
    },
    "primaryRegionCount": {
        "type": "integer",
        "default": 1,
        "min": 0,
        "max": 10,
        "legacyAliases": ["masterCount"],
    },
    "perDesktopLayout": {
        "type": "boolean",
        "default": True,
    },
    "tileNewWindows": {
        "type": "boolean",
        "default": True,
    },
    "showOsd": {
        "type": "boolean",
        "default": True,
    },
    "reconcileDebounceMs": {
        "type": "integer",
        "default": 60,
        "min": 0,
        "max": 1000,
        "legacyAliases": ["nvidiaDebounceMs"],
    },
    "ignoreMinimized": {
        "type": "boolean",
        "default": True,
    },
    "gameWindowPolicy": {
        "type": "string",
        "default": "floating",
        "enum": ["floating", "tiled", "monocle"],
    },
    "floatFilter": {
        "type": "string",
        "default": "krunner,kcalc,systemsettings,pavucontrol,plasma-desktop,spectacle,kdialog,ksplashqml,org.kde.polkit-kde-authentication-agent-1,Steam,steam_app,steamwebhelper",
    },
    "customRulesJson": {
        "type": "string",
        "default": "[]",
    },
    "workspaceLayoutsJson": {
        "type": "string",
        "default": "{}",
        "legacyAliases": ["desktopLayoutsJson"],
    },
}

LEGACY_KEY_MAP = {
    "masterRatio": "primaryRegionRatio",
    "masterCount": "primaryRegionCount",
    "nvidiaDebounceMs": "reconcileDebounceMs",
    "desktopLayoutsJson": "workspaceLayoutsJson",
    "desktopLayouts": "workspaceLayoutsJson",
    "customRules": "customRulesJson",
}

LEGACY_LAYOUT_MAP = {
    "master-stack": "primary-stack",
}

def load_canonical_defaults() -> Dict[str, Any]:
    defaults = {}
    for key, spec in CANONICAL_PROPERTIES.items():
        defaults[key] = spec["default"]
    return defaults

def normalize_and_validate_value(key: str, value: Any) -> Tuple[bool, Any, Optional[str]]:
    """
    Validates and casts a configuration value according to the canonical contract.
    Returns (is_valid, normalized_value, error_message).
    """
    if key not in CANONICAL_PROPERTIES:
        return False, value, f"Unknown configuration key '{key}'"

    spec = CANONICAL_PROPERTIES[key]
    val_type = spec["type"]

    try:
        if val_type == "boolean":
            if isinstance(value, bool):
                norm = value
            elif isinstance(value, str):
                s = value.strip().lower()
                if s in ("true", "1", "yes"):
                    norm = True
                elif s in ("false", "0", "no"):
                    norm = False
                else:
                    return False, value, f"Cannot parse boolean for '{key}': {value}"
            elif isinstance(value, (int, float)):
                norm = bool(value)
            else:
                return False, value, f"Invalid type for boolean key '{key}': {type(value)}"
            return True, norm, None

        elif val_type == "integer":
            if isinstance(value, bool):
                return False, value, f"Boolean not accepted for integer key '{key}'"
            norm = int(value)
            if "min" in spec and norm < spec["min"]:
                return False, norm, f"Value {norm} below minimum {spec['min']} for '{key}'"
            if "max" in spec and norm > spec["max"]:
                return False, norm, f"Value {norm} above maximum {spec['max']} for '{key}'"
            return True, norm, None

        elif val_type == "number":
            if isinstance(value, bool):
                return False, value, f"Boolean not accepted for numeric key '{key}'"
            norm = float(value)
            if "min" in spec and norm < spec["min"]:
                return False, norm, f"Value {norm} below minimum {spec['min']} for '{key}'"
            if "max" in spec and norm > spec["max"]:
                return False, norm, f"Value {norm} above maximum {spec['max']} for '{key}'"
            return True, norm, None

        elif val_type == "string":
            norm = str(value)
            # Map legacy layout names if applicable
            if key == "defaultLayout" and norm in LEGACY_LAYOUT_MAP:
                norm = LEGACY_LAYOUT_MAP[norm]
            if "enum" in spec and norm not in spec["enum"]:
                return False, norm, f"Value '{norm}' not in allowed enum {spec['enum']} for '{key}'"
            if key.endswith("Json"):
                # Validate JSON parseability
                try:
                    json.loads(norm)
                except Exception as e:
                    return False, norm, f"Invalid JSON for key '{key}': {e}"
            return True, norm, None

    except (ValueError, TypeError) as e:
        return False, value, f"Validation error for '{key}': {e}"

    return True, value, None

"""
Tessera Canonical Configuration Contract
Provides single-source-of-truth schema definitions, types, defaults, ranges, and migration rules.
"""

import json
import math
import os
import re
from urllib.parse import quote, unquote_to_bytes
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
        "legacyValueAliases": ["master-stack"],
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
    "overlayPollingMs": {
        "type": "integer",
        "default": 16,
        "min": 8,
        "max": 60,
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
        "default": "{\"version\":1,\"scopes\":{}}",
        "legacyAliases": ["desktopLayoutsJson"],
    },
}

# The checked-in JSON contract is authoritative. The inline dictionary above is
# retained only so an installed standalone Control Center still has safe
# defaults if the contract file is unavailable.
try:
    with open(CONTRACT_JSON_PATH, "r", encoding="utf-8") as contract_file:
        _contract_document = json.load(contract_file)
    _loaded_properties = {}
    for _key, _spec in _contract_document["properties"].items():
        _normalized_spec = dict(_spec)
        if "minimum" in _normalized_spec:
            _normalized_spec["min"] = _normalized_spec.pop("minimum")
        if "maximum" in _normalized_spec:
            _normalized_spec["max"] = _normalized_spec.pop("maximum")
        _loaded_properties[_key] = _normalized_spec
    CANONICAL_PROPERTIES = _loaded_properties
except (OSError, KeyError, TypeError, json.JSONDecodeError):
    pass

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

WORKSPACE_LAYOUT_VERSION = 1
WORKSPACE_LAYOUT_MAX_ENTRIES = 50
WORKSPACE_LAYOUT_MAX_BYTES = 65536
UNSAFE_SCOPE_PARTS = {"__proto__", "prototype", "constructor"}
JS_URI_COMPONENT_SAFE = "-_.!~*'()"

class DuplicateJsonKeyError(ValueError):
    pass

def _unique_object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJsonKeyError(f"Duplicate JSON key '{key}'")
        result[key] = value
    return result


def _reject_json_constant(constant: str):
    raise ValueError(f"Invalid numeric constant {constant}")

def _decode_scope_component(component: str) -> str:
    if re.search(r"%(?![0-9A-Fa-f]{2})", component):
        raise ValueError("invalid percent escape")
    return unquote_to_bytes(component).decode("utf-8", errors="strict")

def _encode_scope_component(component: str) -> str:
    return quote(component, safe=JS_URI_COMPONENT_SAFE)

def canonical_workspace_scope_key(output_id: str, desktop_id: str) -> str:
    return f"{_encode_scope_component(output_id)}//{_encode_scope_component(desktop_id)}"

def normalize_workspace_layouts_json(value: str) -> str:
    if len(value.encode("utf-8")) > WORKSPACE_LAYOUT_MAX_BYTES:
        raise ValueError("workspaceLayoutsJson exceeds 64KB size limit")
    parsed = json.loads(
        value,
        object_pairs_hook=_unique_object_pairs,
        parse_constant=_reject_json_constant,
    )
    if not isinstance(parsed, dict):
        raise ValueError("workspaceLayoutsJson must be a JSON object")

    if "version" in parsed or "scopes" in parsed:
        if set(parsed) != {"version", "scopes"}:
            raise ValueError("workspaceLayoutsJson root contains unknown fields")
        if parsed.get("version") != WORKSPACE_LAYOUT_VERSION:
            raise ValueError(f"Unsupported workspaceLayoutsJson version: {parsed.get('version')}")
        scopes = parsed.get("scopes")
        if not isinstance(scopes, dict):
            raise ValueError("workspaceLayoutsJson scopes must be a JSON object")
        is_versioned = True
    else:
        # Phase 5D first-pass compatibility: an unversioned root map is treated
        # as schema version 1 and rewritten canonically on the next save.
        scopes = parsed
        is_versioned = False

    if len(scopes) > WORKSPACE_LAYOUT_MAX_ENTRIES:
        raise ValueError("workspaceLayoutsJson exceeds maximum of 50 scope entries")

    valid_layouts = set(CANONICAL_PROPERTIES["defaultLayout"]["enum"])
    canonical_scopes = {}
    for scope_key, scope_data in scopes.items():
        if not isinstance(scope_key, str) or not scope_key:
            raise ValueError(f"Invalid scope key in workspaceLayoutsJson: {scope_key}")
        parts = scope_key.split("//")
        if len(parts) != 2 or not all(parts):
            raise ValueError(f"Invalid scope key in workspaceLayoutsJson: {scope_key}")
        output_id = _decode_scope_component(parts[0])
        desktop_id = _decode_scope_component(parts[1])
        if output_id in UNSAFE_SCOPE_PARTS or desktop_id in UNSAFE_SCOPE_PARTS:
            raise ValueError(f"Unsafe scope key in workspaceLayoutsJson: {scope_key}")
        canonical_scope = canonical_workspace_scope_key(output_id, desktop_id)
        if canonical_scope != scope_key:
            raise ValueError(f"Non-canonical scope key in workspaceLayoutsJson: {scope_key}")
        if canonical_scope in canonical_scopes:
            raise ValueError(f"Duplicate canonical scope in workspaceLayoutsJson: {scope_key}")
        if not isinstance(scope_data, dict):
            raise ValueError(f"Scope data for '{scope_key}' must be a dictionary")
        unknown_fields = set(scope_data) - {"layout", "ratio", "primaryCount"}
        if unknown_fields:
            raise ValueError(f"Unknown fields in scope '{scope_key}': {sorted(unknown_fields)}")

        canonical_data = {}
        if "layout" in scope_data:
            layout = LEGACY_LAYOUT_MAP.get(scope_data["layout"], scope_data["layout"])
            if not isinstance(layout, str) or layout not in valid_layouts:
                raise ValueError(f"Invalid layout '{layout}' in scope '{scope_key}'")
            canonical_data["layout"] = layout
        if "ratio" in scope_data:
            ratio = scope_data["ratio"]
            if isinstance(ratio, bool) or not isinstance(ratio, (int, float)) or not math.isfinite(ratio):
                raise ValueError(f"Invalid ratio in scope '{scope_key}'")
            ratio = float(ratio)
            if ratio < 0.10 or ratio > 0.90:
                raise ValueError(f"Ratio {ratio} out of bounds [0.10, 0.90] in scope '{scope_key}'")
            canonical_data["ratio"] = ratio
        if "primaryCount" in scope_data:
            count = scope_data["primaryCount"]
            if isinstance(count, bool) or not isinstance(count, int):
                raise ValueError(f"Invalid primaryCount in scope '{scope_key}'")
            if count < 0 or count > 10:
                raise ValueError(f"Primary count {count} out of bounds [0, 10] in scope '{scope_key}'")
            canonical_data["primaryCount"] = count
        canonical_scopes[canonical_scope] = canonical_data

    ordered_scopes = {key: canonical_scopes[key] for key in sorted(canonical_scopes)}
    canonical_json = json.dumps(
        {"version": WORKSPACE_LAYOUT_VERSION, "scopes": ordered_scopes},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    if is_versioned and canonical_json != value:
        raise ValueError("workspaceLayoutsJson is not canonically serialized")
    return canonical_json

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
                if value not in (0, 1):
                    return False, value, f"Numeric boolean for '{key}' must be 0 or 1"
                norm = bool(value)
            else:
                return False, value, f"Invalid type for boolean key '{key}': {type(value)}"
            return True, norm, None

        elif val_type == "integer":
            if isinstance(value, bool):
                return False, value, f"Boolean not accepted for integer key '{key}'"
            if isinstance(value, int):
                norm = value
            elif isinstance(value, float):
                if not math.isfinite(value) or not value.is_integer():
                    return False, value, f"Non-integral value is not allowed for '{key}'"
                norm = int(value)
            elif isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip()):
                norm = int(value.strip())
            else:
                return False, value, f"Invalid type for integer key '{key}': {type(value)}"
            if "min" in spec and norm < spec["min"]:
                return False, norm, f"Value {norm} below minimum {spec['min']} for '{key}'"
            if "max" in spec and norm > spec["max"]:
                return False, norm, f"Value {norm} above maximum {spec['max']} for '{key}'"
            return True, norm, None

        elif val_type == "number":
            if isinstance(value, bool):
                return False, value, f"Boolean not accepted for numeric key '{key}'"
            norm = float(value)
            if not math.isfinite(norm):
                return False, norm, f"Non-finite value is not allowed for '{key}'"
            if "min" in spec and norm < spec["min"]:
                return False, norm, f"Value {norm} below minimum {spec['min']} for '{key}'"
            if "max" in spec and norm > spec["max"]:
                return False, norm, f"Value {norm} above maximum {spec['max']} for '{key}'"
            return True, norm, None

        elif val_type == "string":
            if not isinstance(value, str):
                return False, value, f"Invalid type for string key '{key}': {type(value)}"
            norm = value
            # Map legacy layout names if applicable
            if key == "defaultLayout" and norm in LEGACY_LAYOUT_MAP:
                norm = LEGACY_LAYOUT_MAP[norm]
            if "enum" in spec and norm not in spec["enum"]:
                return False, norm, f"Value '{norm}' not in allowed enum {spec['enum']} for '{key}'"
            if key.endswith("Json"):
                if key == "workspaceLayoutsJson":
                    try:
                        norm = normalize_workspace_layouts_json(norm)
                    except (DuplicateJsonKeyError, json.JSONDecodeError, UnicodeDecodeError, ValueError) as e:
                        return False, norm, f"Invalid JSON for key '{key}': {e}"
                else:
                    try:
                        json.loads(norm, object_pairs_hook=_unique_object_pairs, parse_constant=_reject_json_constant)
                    except (DuplicateJsonKeyError, json.JSONDecodeError, ValueError) as e:
                        return False, norm, f"Invalid JSON for key '{key}': {e}"
            return True, norm, None

    except (ValueError, TypeError) as e:
        return False, value, f"Validation error for '{key}': {e}"

    return True, value, None

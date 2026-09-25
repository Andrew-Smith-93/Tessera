#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
TARGET_DIR="$DATA_HOME/kwin/scripts/tessera"
CONTROL_DIR="$DATA_HOME/tessera"
DESKTOP_TARGET="$DATA_HOME/applications/org.kde.tessera.desktop"
ICON_TARGET="$DATA_HOME/icons/hicolor/scalable/apps/tessera.svg"
LAUNCHER_TARGET="$BIN_HOME/tessera-settings"
SHORTCUT_CATALOG="$SCRIPT_DIR/config/shortcuts.json"

PURGE=false
case "${1:-}" in
    "") ;;
    --purge) PURGE=true ;;
    *) echo "Usage: $0 [--purge]" >&2; exit 2 ;;
esac

remove_install_tree() {
    local target="${1%/}"
    case "$target" in
        "$TARGET_DIR"|"$CONTROL_DIR")
            if [ -L "$target" ]; then
                rm -f -- "$target"
            else
                rm -rf -- "$target"
            fi
            ;;
        *)
            echo "Refusing to remove unexpected install path: $1" >&2
            return 1
            ;;
    esac
}

remove_file_target() {
    local target="${1%/}"
    case "$target" in
        "$DESKTOP_TARGET"|"$ICON_TARGET"|"$LAUNCHER_TARGET")
            rm -f -- "$target"
            ;;
        *)
            echo "Refusing to remove unexpected install file: $1" >&2
            return 1
            ;;
    esac
}

echo "Uninstalling Tessera..."

CONFIG_CLEANUP_SUCCESS=true

if command -v kwriteconfig6 >/dev/null 2>&1; then
    if ! kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled false; then
        echo "Warning: failed to disable Tessera plugin in kwinrc." >&2
        CONFIG_CLEANUP_SUCCESS=false
    fi
else
    echo "Warning: kwriteconfig6 not found; cannot disable Tessera plugin in kwinrc." >&2
    CONFIG_CLEANUP_SUCCESS=false
fi

declare -a SHORTCUT_NAMES=(
    "Tessera: Toggle Zone Overlay"
    "Tessera: Toggle Tiling"
    "Tessera: Toggle Window Floating"
    "Tessera: Move Window to Left Region"
    "Tessera: Move Window to Right Region"
    "Tessera: Move Window to Up Region"
    "Tessera: Move Window to Down Region"
    "Tessera: Expand Window Width"
    "Tessera: Shrink Window Width"
    "Tessera: Expand Window Height"
    "Tessera: Shrink Window Height"
    "Tessera: Move Window to Screen Left"
    "Tessera: Move Window to Screen Right"
    "Tessera: Move Window to Screen Above"
    "Tessera: Move Window to Screen Below"
    "Tessera: Focus Left Window"
    "Tessera: Focus Right Window"
    "Tessera: Focus Up Window"
    "Tessera: Focus Down Window"
    "Tessera: Swap Left Window"
    "Tessera: Swap Right Window"
    "Tessera: Retile Current Workspace"
    "Tessera: Next Layout"
    "Tessera: Previous Layout"
    "Tessera: Increase Primary Count"
    "Tessera: Decrease Primary Count"
    "Tessera: Move Window to Next Screen"
    "Tessera: Cycle Layout on Other Screen"
    "Tessera: Swap Screen Layouts"
    "Tessera: Focus Next Window"
    "Tessera: Focus Previous Window"
    "Tessera: Swap Window Forward"
    "Tessera: Swap Window Backward"
    "Tessera: Increase Master Ratio"
    "Tessera: Decrease Master Ratio"
    "Tessera: Increase Master Count"
    "Tessera: Decrease Master Count"
    "Tessera: Show Master HUD"
    "Tessera: Increase Primary Ratio"
    "Tessera: Decrease Primary Ratio"
)

MISSING_VALUE="__TESSERA_MISSING_VALUE__"

get_active_default_sequence() {
    local action="$1"
    case "$action" in
        "Tessera: Toggle Zone Overlay") echo "Meta+Shift+C" ;;
        "Tessera: Toggle Tiling") echo "Meta+Shift+T" ;;
        "Tessera: Toggle Window Floating") echo "Meta+Shift+F" ;;
        "Tessera: Move Window to Left Region") echo "Meta+Left" ;;
        "Tessera: Move Window to Right Region") echo "Meta+Right" ;;
        "Tessera: Move Window to Up Region") echo "Meta+Up" ;;
        "Tessera: Move Window to Down Region") echo "Meta+Down" ;;
        "Tessera: Expand Window Width") echo "Meta+Shift+Right" ;;
        "Tessera: Shrink Window Width") echo "Meta+Shift+Left" ;;
        "Tessera: Expand Window Height") echo "Meta+Shift+Down" ;;
        "Tessera: Shrink Window Height") echo "Meta+Shift+Up" ;;
        "Tessera: Move Window to Screen Left") echo "Meta+Ctrl+Left" ;;
        "Tessera: Move Window to Screen Right") echo "Meta+Ctrl+Right" ;;
        "Tessera: Move Window to Screen Above") echo "Meta+Ctrl+Up" ;;
        "Tessera: Move Window to Screen Below") echo "Meta+Ctrl+Down" ;;
        "Tessera: Focus Left Window") echo "Meta+Alt+A" ;;
        "Tessera: Focus Right Window") echo "Meta+Alt+D" ;;
        "Tessera: Focus Up Window") echo "Meta+Alt+W" ;;
        "Tessera: Focus Down Window") echo "Meta+Alt+S" ;;
        "Tessera: Swap Left Window") echo "Meta+Alt+Q" ;;
        "Tessera: Swap Right Window") echo "Meta+Alt+E" ;;
        "Tessera: Retile Current Workspace") echo "Meta+Shift+R" ;;
        *) echo "" ;;
    esac
}

get_active_default_label() {
    local action="$1"
    case "$action" in
        "Tessera: Toggle Zone Overlay") echo "Toggle Zone Overlay" ;;
        "Tessera: Toggle Tiling") echo "Toggle Tiling Globally" ;;
        "Tessera: Toggle Window Floating") echo "Toggle Active Window Floating" ;;
        "Tessera: Move Window to Left Region") echo "Move Window to Left Snap Region" ;;
        "Tessera: Move Window to Right Region") echo "Move Window to Right Snap Region" ;;
        "Tessera: Move Window to Up Region") echo "Move Window to Upper Snap Region" ;;
        "Tessera: Move Window to Down Region") echo "Move Window to Lower Snap Region" ;;
        "Tessera: Expand Window Width") echo "Expand Window Width" ;;
        "Tessera: Shrink Window Width") echo "Shrink Window Width" ;;
        "Tessera: Expand Window Height") echo "Expand Window Height" ;;
        "Tessera: Shrink Window Height") echo "Shrink Window Height" ;;
        "Tessera: Move Window to Screen Left") echo "Move Window to Screen Left" ;;
        "Tessera: Move Window to Screen Right") echo "Move Window to Screen Right" ;;
        "Tessera: Move Window to Screen Above") echo "Move Window to Screen Above" ;;
        "Tessera: Move Window to Screen Below") echo "Move Window to Screen Below" ;;
        "Tessera: Focus Left Window") echo "Focus Left Window (WASD)" ;;
        "Tessera: Focus Right Window") echo "Focus Right Window (WASD)" ;;
        "Tessera: Focus Up Window") echo "Focus Up Window (WASD)" ;;
        "Tessera: Focus Down Window") echo "Focus Down Window (WASD)" ;;
        "Tessera: Swap Left Window") echo "Swap Window Left (Counter-Clockwise)" ;;
        "Tessera: Swap Right Window") echo "Swap Window Right (Clockwise)" ;;
        "Tessera: Retile Current Workspace") echo "Force Retile Workspace" ;;
        *) echo "" ;;
    esac
}

is_recognized_default_label() {
    local action="$1"
    local lbl="$2"

    [ -z "$lbl" ] && return 0
    [ "$lbl" = "$action" ] && return 0

    local act_lbl
    act_lbl="$(get_active_default_label "$action")"
    if [ -n "$act_lbl" ] && [ "$lbl" = "$act_lbl" ]; then
        return 0
    fi

    case "$action" in
        "Tessera: Toggle Zone Overlay")
            [ "$lbl" = "Toggle Zone Overlay (KZones-Style)" ] ;;
        "Tessera: Next Layout")
            [ "$lbl" = "Cycle to Next Layout" ] ;;
        "Tessera: Previous Layout")
            [ "$lbl" = "Cycle to Previous Layout" ] ;;
        "Tessera: Toggle Tiling")
            [ "$lbl" = "Toggle Tiling" ] ;;
        "Tessera: Toggle Window Floating")
            [ "$lbl" = "Toggle Window Floating" ] ;;
        "Tessera: Retile Current Workspace")
            [ "$lbl" = "Retile Current Workspace" ] ;;
        "Tessera: Increase Primary Ratio")
            [ "$lbl" = "Expand Primary Region Ratio" ] ;;
        "Tessera: Decrease Primary Ratio")
            [ "$lbl" = "Shrink Primary Region Ratio" ] ;;
        *)
            false ;;
    esac
}

is_recognized_old_default() {
    local action="$1"
    local seq="$2"
    case "$action" in
        "Tessera: Toggle Zone Overlay")
            [ "$seq" = "Ctrl+Shift+C" ] ;;
        "Tessera: Next Layout")
            [ "$seq" = "Ctrl+Space" ] || [ "$seq" = "Meta+Space" ] ;;
        "Tessera: Previous Layout")
            [ "$seq" = "Ctrl+Shift+Space" ] || [ "$seq" = "Meta+Shift+Space" ] ;;
        "Tessera: Toggle Tiling")
            [ "$seq" = "Ctrl+Shift+T" ] ;;
        "Tessera: Toggle Window Floating")
            [ "$seq" = "Ctrl+Shift+F" ] || [ "$seq" = "Meta+Shift+F" ] ;;
        "Tessera: Focus Left Window")
            [ "$seq" = "Ctrl+Shift+A" ] || [ "$seq" = "Meta+Shift+H" ] ;;
        "Tessera: Focus Right Window")
            [ "$seq" = "Ctrl+Shift+D" ] || [ "$seq" = "Meta+Shift+L" ] ;;
        "Tessera: Focus Up Window")
            [ "$seq" = "Ctrl+Shift+W" ] || [ "$seq" = "Meta+Shift+K" ] ;;
        "Tessera: Focus Down Window")
            [ "$seq" = "Ctrl+Shift+S" ] || [ "$seq" = "Meta+Shift+J" ] ;;
        "Tessera: Swap Left Window")
            [ "$seq" = "Ctrl+Shift+Q" ] || [ "$seq" = "Meta+Shift+H" ] ;;
        "Tessera: Swap Right Window")
            [ "$seq" = "Ctrl+Shift+E" ] || [ "$seq" = "Meta+Shift+L" ] ;;
        *"Increase"*"Ratio")
            [ "$seq" = "Ctrl+Shift+L" ] || [ "$seq" = "Meta+Shift+I" ] || [ "$seq" = "Meta+L" ] || [ "$seq" = "Meta+Alt+L" ] ;;
        *"Decrease"*"Ratio")
            [ "$seq" = "Ctrl+Shift+H" ] || [ "$seq" = "Meta+Shift+D" ] || [ "$seq" = "Meta+H" ] || [ "$seq" = "Meta+Alt+H" ] ;;
        "Tessera: Retile Current Workspace")
            [ "$seq" = "Ctrl+Shift+R" ] ;;
        "Tessera: Focus Next Window")
            [ "$seq" = "Ctrl+Shift+J" ] || [ "$seq" = "Meta+J" ] ;;
        "Tessera: Focus Previous Window")
            [ "$seq" = "Ctrl+Shift+K" ] || [ "$seq" = "Meta+K" ] ;;
        "Tessera: Swap Window Forward")
            [ "$seq" = "Ctrl+Alt+J" ] || [ "$seq" = "Ctrl+Shift+J" ] ;;
        "Tessera: Swap Window Backward")
            [ "$seq" = "Ctrl+Alt+K" ] || [ "$seq" = "Ctrl+Shift+K" ] ;;
        *"Increase"*"Count")
            [ "$seq" = "Ctrl+Shift+I" ] || [ "$seq" = "Meta+Shift+M" ] ;;
        *"Decrease"*"Count")
            [ "$seq" = "Ctrl+Shift+O" ] || [ "$seq" = "Meta+Shift+N" ] ;;
        "Tessera: Move Window to Next Screen")
            [ "$seq" = "Ctrl+Shift+Z" ] || [ "$seq" = "Meta+Shift+S" ] ;;
        "Tessera: Cycle Layout on Other Screen")
            [ "$seq" = "Ctrl+Shift+X" ] ;;
        "Tessera: Swap Screen Layouts")
            [ "$seq" = "Ctrl+Alt+X" ] ;;
        *"HUD"*)
            [ "$seq" = "Ctrl+Shift+M" ] ;;
        *)
            false ;;
    esac
}

is_removable_tessera_default() {
    local action="$1"
    local existing="$2"
    [ -z "$existing" ] && return 1

    local cur_binding=""
    local def_binding=""
    local label=""
    IFS=',' read -r cur_binding def_binding label <<< "$existing"

    # Both current and stored default fields must exist and not be "none"
    [ -z "$cur_binding" ] && return 1
    [ -z "$def_binding" ] && return 1
    [ "$cur_binding" = "none" ] && return 1
    [ "$def_binding" = "none" ] && return 1

    # Both fields must be equal
    [ "$cur_binding" != "$def_binding" ] && return 1

    # The label must be an uncustomized default label; a custom label indicates user customization
    if ! is_recognized_default_label "$action" "$label"; then
        return 1
    fi

    # The sequence must be a recognized active or historical default for this action
    local cur_def
    cur_def="$(get_active_default_sequence "$action")"
    if [ -n "$cur_def" ] && [ "$cur_binding" = "$cur_def" ]; then
        return 0
    fi

    if is_recognized_old_default "$action" "$cur_binding"; then
        return 0
    fi

    return 1
}


if command -v python3 >/dev/null 2>&1 && [ -r "$SHORTCUT_CATALOG" ]; then
    declare -a _CATALOG_SHORTCUTS=()
    mapfile -t _CATALOG_SHORTCUTS < <(python3 - "$SHORTCUT_CATALOG" "${SHORTCUT_NAMES[@]}" 2>/dev/null <<'PY' || true
import json
import sys

catalog_path = sys.argv[1]
required_names = sys.argv[2:]
required_set = set(required_names)

names = []
seen = set()
valid = False

try:
    with open(catalog_path, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    if isinstance(document, dict):
        shortcuts = document.get("shortcuts")
        legacy = document.get("legacyNames")
        if isinstance(shortcuts, list) and isinstance(legacy, list):
            all_ok = True
            for item in shortcuts:
                if not isinstance(item, dict):
                    all_ok = False
                    break
                name = item.get("name")
                if not isinstance(name, str) or not name.strip() or not name.startswith("Tessera: "):
                    all_ok = False
                    break
                if name in seen:
                    all_ok = False
                    break
                seen.add(name)
                names.append(name)
            if all_ok:
                for item in legacy:
                    if not isinstance(item, str) or not item.strip() or not item.startswith("Tessera: "):
                        all_ok = False
                        break
                    if item in seen:
                        all_ok = False
                        break
                    seen.add(item)
                    names.append(item)
            if all_ok and required_set.issubset(seen):
                valid = True
except Exception:
    valid = False

if valid:
    for n in names:
        sys.stdout.write(n + "\n")
else:
    sys.exit(1)
PY
)
    if [ "${#_CATALOG_SHORTCUTS[@]}" -gt 0 ]; then
        SHORTCUT_NAMES=("${_CATALOG_SHORTCUTS[@]}")
    fi
fi

if command -v kwriteconfig6 >/dev/null 2>&1; then
    for name in "${SHORTCUT_NAMES[@]}"; do
        if [ "$PURGE" = true ]; then
            if ! kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --delete; then
                echo "Warning: failed to delete shortcut '$name'." >&2
                CONFIG_CLEANUP_SUCCESS=false
            fi
        else
            if command -v kreadconfig6 >/dev/null 2>&1; then
                existing="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --default "$MISSING_VALUE")"
                if [ "$existing" != "$MISSING_VALUE" ]; then
                    if is_removable_tessera_default "$name" "$existing"; then
                        if ! kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --delete; then
                            echo "Warning: failed to delete shortcut '$name'." >&2
                            CONFIG_CLEANUP_SUCCESS=false
                        fi
                    fi
                fi
            else
                echo "Warning: kreadconfig6 not found; cannot verify shortcut bindings." >&2
                CONFIG_CLEANUP_SUCCESS=false
            fi
        fi
    done
else
    echo "Warning: kwriteconfig6 not found; cannot delete shortcuts from kglobalshortcutsrc." >&2
    CONFIG_CLEANUP_SUCCESS=false
fi

remove_install_tree "$TARGET_DIR"
remove_install_tree "$CONTROL_DIR"
remove_file_target "$DESKTOP_TARGET"
remove_file_target "$ICON_TARGET"
remove_file_target "$LAUNCHER_TARGET"

if [ "$PURGE" = true ]; then
    if command -v kwriteconfig6 >/dev/null 2>&1; then
        declare -a CONFIG_KEYS=(
            configSchemaVersion enableTiling defaultLayout gapInner gapOuter
            primaryRegionRatio primaryRegionCount perDesktopLayout tileNewWindows
            showOsd reconcileDebounceMs overlayPollingMs enableAnimations animationDurationMs ignoreMinimized
            gameWindowPolicy floatFilter customRulesJson workspaceLayoutsJson
            masterRatio masterCount nvidiaDebounceMs desktopLayoutsJson
            desktopLayouts customRules
        )
        for key in "${CONFIG_KEYS[@]}"; do
            if ! kwriteconfig6 --file kwinrc --group Script-tessera --key "$key" --delete; then
                CONFIG_CLEANUP_SUCCESS=false
            fi
        done
    else
        echo "Warning: kwriteconfig6 not found; cannot remove kwinrc Script-tessera configuration." >&2
        CONFIG_CLEANUP_SUCCESS=false
    fi
    rm -f -- "$CONFIG_HOME/tesserarc" "$CONFIG_HOME/tessera_migration_backup.json"
fi

command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true
if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure >/dev/null 2>&1 || true
fi

if [ "$PURGE" = true ]; then
    if [ "$CONFIG_CLEANUP_SUCCESS" = true ]; then
        echo "Tessera and its saved configuration have been removed."
    else
        echo "Tessera has been removed; some saved configuration could not be deleted."
    fi
else
    if [ "$CONFIG_CLEANUP_SUCCESS" = true ]; then
        echo "Tessera has been removed; saved layout settings were preserved."
    else
        echo "Tessera has been removed; some configuration could not be disabled or deleted."
    fi
fi

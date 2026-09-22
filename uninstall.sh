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
    "Tessera: Next Layout"
    "Tessera: Previous Layout"
    "Tessera: Toggle Tiling"
    "Tessera: Toggle Window Floating"
    "Tessera: Focus Left Window"
    "Tessera: Focus Right Window"
    "Tessera: Focus Up Window"
    "Tessera: Focus Down Window"
    "Tessera: Swap Left Window"
    "Tessera: Swap Right Window"
    "Tessera: Focus Next Window"
    "Tessera: Focus Previous Window"
    "Tessera: Swap Window Forward"
    "Tessera: Swap Window Backward"
    "Tessera: Increase Primary Ratio"
    "Tessera: Decrease Primary Ratio"
    "Tessera: Increase Primary Count"
    "Tessera: Decrease Primary Count"
    "Tessera: Retile Current Workspace"
    "Tessera: Move Window to Next Screen"
    "Tessera: Cycle Layout on Other Screen"
    "Tessera: Swap Screen Layouts"
    "Tessera: Increase Master Ratio"
    "Tessera: Decrease Master Ratio"
    "Tessera: Increase Master Count"
    "Tessera: Decrease Master Count"
    "Tessera: Show Master HUD"
)

if command -v python3 >/dev/null 2>&1 && [ -f "$SHORTCUT_CATALOG" ]; then
    mapfile -t SHORTCUT_NAMES < <(python3 - "$SHORTCUT_CATALOG" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    document = json.load(handle)
for item in document.get("shortcuts", []):
    print(item["name"])
for name in document.get("legacyNames", []):
    print(name)
PY
)
fi

if command -v kwriteconfig6 >/dev/null 2>&1; then
    for name in "${SHORTCUT_NAMES[@]}"; do
        if ! kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --delete; then
            echo "Warning: failed to delete shortcut '$name'." >&2
            CONFIG_CLEANUP_SUCCESS=false
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
            showOsd reconcileDebounceMs overlayPollingMs ignoreMinimized
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

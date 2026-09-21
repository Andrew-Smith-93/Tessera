#!/usr/bin/env bash
set -e

TARGET_DIR="$HOME/.local/share/kwin/scripts/tessera"
CONTROL_INSTALL_DIR="$HOME/.local/share/tessera"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
BIN_DIR="$HOME/.local/bin"

PURGE=false
if [ "$1" == "--purge" ]; then
    PURGE=true
fi

echo "Uninstalling Tessera..."

# Disable in kwinrc
if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled false
    if [ "$PURGE" = true ]; then
        echo "-> Purging Tessera configuration group..."
        kwriteconfig6 --file kwinrc --group Script-tessera --key configSchemaVersion --delete 2>/dev/null || true
    fi
fi

rm -rf "$TARGET_DIR"
rm -rf "$CONTROL_INSTALL_DIR"
rm -f "$APPS_DIR/org.kde.tessera.desktop"
rm -f "$ICONS_DIR/tessera.svg"
rm -f "$BIN_DIR/tessera-settings"

if [ "$PURGE" = true ]; then
    rm -f "$HOME/.config/tessera_migration_backup.json"
fi

if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure 2>/dev/null || true
    qdbus6 org.kde.plasmashell /org/kde/osdService org.kde.osdService.showText "preferences-desktop-virtual" "Tessera Uninstalled" 2>/dev/null || true
fi

echo "✓ Tessera has been removed."

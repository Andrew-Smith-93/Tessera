#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KWIN_SCRIPTS_DIR="$HOME/.local/share/kwin/scripts"
TARGET_DIR="$KWIN_SCRIPTS_DIR/tessera"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
BIN_DIR="$HOME/.local/bin"

echo "========================================================="
echo "   Installing Tessera Tiling Window Manager for KDE 6   "
echo "========================================================="

# 1. Ensure target directories exist
mkdir -p "$KWIN_SCRIPTS_DIR"
mkdir -p "$APPS_DIR"
mkdir -p "$ICONS_DIR"
mkdir -p "$BIN_DIR"

# 2. Deploy KWin 6 Script Package
echo "-> Deploying KWin 6 script package..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

cp -r "$SCRIPT_DIR/metadata.json" "$TARGET_DIR/"
cp -r "$SCRIPT_DIR/contents" "$TARGET_DIR/"

# 3. Enable in kwinrc
echo "-> Enabling Tessera plugin in KWin..."
if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled true
fi

# 4. Install Desktop Entry & Icon
echo "-> Installing Control Center desktop entry & icon..."
cp "$SCRIPT_DIR/desktop/tessera.svg" "$ICONS_DIR/tessera.svg"
cp "$SCRIPT_DIR/desktop/org.kde.tessera.desktop" "$APPS_DIR/"
sed -i "s|Exec=.*|Exec=$BIN_DIR/tessera-settings|g" "$APPS_DIR/org.kde.tessera.desktop"
kbuildsycoca6 2>/dev/null || true

# 5. Install CLI command
echo "-> Installing CLI launcher into $BIN_DIR/tessera-settings..."
ln -sf "$SCRIPT_DIR/bin/tessera-settings" "$BIN_DIR/tessera-settings"

# 6. Register Global Shortcuts in kglobalshortcutsrc
echo "-> Registering global shortcuts..."
if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Toggle Tiling" "Meta+Shift+T,Meta+Shift+T,Tessera: Toggle Tiling"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Next Layout" "Ctrl+Space,Ctrl+Space,Tessera: Next Layout"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Previous Layout" "Ctrl+Shift+Space,Ctrl+Shift+Space,Tessera: Previous Layout"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Toggle Window Floating" "Meta+Shift+F,Meta+Shift+F,Tessera: Toggle Window Floating"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Focus Next Window" "Meta+J,Meta+J,Tessera: Focus Next Window"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Focus Previous Window" "Meta+K,Meta+K,Tessera: Focus Previous Window"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Swap Window Forward" "Meta+Shift+J,Meta+Shift+J,Tessera: Swap Window Forward"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Swap Window Backward" "Meta+Shift+K,Meta+Shift+K,Tessera: Swap Window Backward"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Increase Master Ratio" "Meta+L,Meta+L,Tessera: Increase Master Ratio"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Decrease Master Ratio" "Meta+H,Meta+H,Tessera: Decrease Master Ratio"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Increase Master Count" "Meta+I,Meta+I,Tessera: Increase Master Count"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Decrease Master Count" "Meta+D,Meta+D,Tessera: Decrease Master Count"
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Retile Current Workspace" "Meta+Shift+R,Meta+Shift+R,Tessera: Retile Current Workspace"
    systemctl --user restart plasma-kglobalaccel.service 2>/dev/null || true
fi

# 7. Initialize default config
python3 -c "import sys; sys.path.append('$SCRIPT_DIR/tessera-control'); from config_manager import ConfigManager; ConfigManager().save()" 2>/dev/null || true

# 8. Reload KWin
echo "-> Reloading KWin configuration..."
if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure 2>/dev/null || true
    qdbus6 org.kde.plasmashell /org/kde/osdService org.kde.osdService.showText "preferences-desktop-virtual" "Tessera Tiling Activated!" 2>/dev/null || true
fi

echo ""
echo "========================================================="
echo "  ✓ Installation Complete!                              "
echo "  Launch the settings GUI with: tessera-settings        "
echo "  Or search for 'Tessera Control Center' in KDE launcher"
echo "  Toggle tiling with: Meta + Shift + T                  "
echo "  Switch layouts with: Meta + Space                     "
echo "========================================================="

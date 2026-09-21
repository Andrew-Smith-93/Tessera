#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KWIN_SCRIPTS_DIR="$HOME/.local/share/kwin/scripts"
TARGET_DIR="$KWIN_SCRIPTS_DIR/tessera"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
BIN_DIR="$HOME/.local/bin"
CONTROL_INSTALL_DIR="$HOME/.local/share/tessera/control"

echo "========================================================="
echo "   Installing Tessera Tiling Window Manager for KDE 6   "
echo "========================================================="

# 0. Preflight checks
echo "-> Performing pre-flight checks..."
if ! command -v python3 >/dev/null 2>&1; then
    echo "Error: python3 is required to run Tessera Control Center." >&2
    exit 1
fi

if ! python3 -c "import PyQt5" 2>/dev/null; then
    echo "Warning: PyQt5 is not installed. Tessera Control GUI will require python3-pyqt5." >&2
fi

# 1. Ensure target directories exist
mkdir -p "$KWIN_SCRIPTS_DIR"
mkdir -p "$APPS_DIR"
mkdir -p "$ICONS_DIR"
mkdir -p "$BIN_DIR"
mkdir -p "$CONTROL_INSTALL_DIR"

# 2. Deploy KWin 6 Script Package atomically via temporary staging
echo "-> Deploying KWin 6 script package..."
STAGE_TMP=$(mktemp -d)
trap 'rm -rf "$STAGE_TMP"' EXIT

cp "$SCRIPT_DIR/metadata.json" "$STAGE_TMP/"
cp -r "$SCRIPT_DIR/contents" "$STAGE_TMP/"

rm -rf "$TARGET_DIR"
mkdir -p "$(dirname "$TARGET_DIR")"
cp -r "$STAGE_TMP" "$TARGET_DIR"
rm -rf "$STAGE_TMP"
trap - EXIT

# 3. Deploy Control Center files to stable directory
echo "-> Deploying Control Center files to $CONTROL_INSTALL_DIR..."
cp -r "$SCRIPT_DIR/tessera-control/"* "$CONTROL_INSTALL_DIR/"

# 4. Enable in kwinrc
echo "-> Enabling Tessera plugin in KWin..."
if command -v kwriteconfig6 >/dev/null 2>&1; then
    kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled true
fi

# 5. Install Desktop Entry & Icon
echo "-> Installing Control Center desktop entry & icon..."
cp "$SCRIPT_DIR/desktop/tessera.svg" "$ICONS_DIR/tessera.svg"
cp "$SCRIPT_DIR/desktop/org.kde.tessera.desktop" "$APPS_DIR/"
sed -i "s|Exec=.*|Exec=$BIN_DIR/tessera-settings|g" "$APPS_DIR/org.kde.tessera.desktop"
kbuildsycoca6 2>/dev/null || true

# 6. Install CLI launcher script pointing to stable control directory
echo "-> Installing CLI launcher into $BIN_DIR/tessera-settings..."
cat << 'EOF' > "$BIN_DIR/tessera-settings"
#!/usr/bin/env bash
CONTROL_DIR="$HOME/.local/share/tessera/control"
if [ ! -d "$CONTROL_DIR" ]; then
    # Fallback to dev repository if running from source tree
    SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
    if [ -d "$SCRIPT_DIR/tessera-control" ]; then
        CONTROL_DIR="$SCRIPT_DIR/tessera-control"
    fi
fi
PYTHONPATH="$CONTROL_DIR" exec python3 "$CONTROL_DIR/tessera_settings.py" "$@"
EOF
chmod +x "$BIN_DIR/tessera-settings"

# 7. Register Global Shortcuts preserving existing user bindings
echo "-> Registering global shortcuts (preserving existing bindings)..."
if command -v kwriteconfig6 >/dev/null 2>&1; then
    declare -A SHORTCUT_DEFAULTS=(
        ["Tessera: Toggle Zone Overlay"]="Ctrl+Shift+C,Ctrl+Shift+C,Tessera: Toggle Zone Overlay"
        ["Tessera: Toggle Tiling"]="Ctrl+Shift+T,Ctrl+Shift+T,Tessera: Toggle Tiling"
        ["Tessera: Next Layout"]="Ctrl+Space,Ctrl+Space,Tessera: Next Layout"
        ["Tessera: Previous Layout"]="Ctrl+Shift+Space,Ctrl+Shift+Space,Tessera: Previous Layout"
        ["Tessera: Toggle Window Floating"]="Ctrl+Shift+F,Ctrl+Shift+F,Tessera: Toggle Window Floating"
        ["Tessera: Focus Left Window"]="Ctrl+Shift+A,Ctrl+Shift+A,Tessera: Focus Left Window"
        ["Tessera: Focus Right Window"]="Ctrl+Shift+D,Ctrl+Shift+D,Tessera: Focus Right Window"
        ["Tessera: Focus Up Window"]="Ctrl+Shift+W,Ctrl+Shift+W,Tessera: Focus Up Window"
        ["Tessera: Focus Down Window"]="Ctrl+Shift+S,Ctrl+Shift+S,Tessera: Focus Down Window"
        ["Tessera: Swap Left Window"]="Ctrl+Shift+Q,Ctrl+Shift+Q,Tessera: Swap Left Window"
        ["Tessera: Swap Right Window"]="Ctrl+Shift+E,Ctrl+Shift+E,Tessera: Swap Right Window"
        ["Tessera: Focus Next Window"]="Ctrl+Shift+J,Ctrl+Shift+J,Tessera: Focus Next Window"
        ["Tessera: Focus Previous Window"]="Ctrl+Shift+K,Ctrl+Shift+K,Tessera: Focus Previous Window"
        ["Tessera: Swap Window Forward"]="Ctrl+Alt+J,Ctrl+Alt+J,Tessera: Swap Window Forward"
        ["Tessera: Swap Window Backward"]="Ctrl+Alt+K,Ctrl+Alt+K,Tessera: Swap Window Backward"
        ["Tessera: Increase Master Ratio"]="Ctrl+Shift+L,Ctrl+Shift+L,Tessera: Increase Master Ratio"
        ["Tessera: Decrease Master Ratio"]="Ctrl+Shift+H,Ctrl+Shift+H,Tessera: Decrease Master Ratio"
        ["Tessera: Increase Master Count"]="Ctrl+Shift+I,Ctrl+Shift+I,Tessera: Increase Master Count"
        ["Tessera: Decrease Master Count"]="Ctrl+Shift+O,Ctrl+Shift+O,Tessera: Decrease Master Count"
        ["Tessera: Retile Current Workspace"]="Ctrl+Shift+R,Ctrl+Shift+R,Tessera: Retile Current Workspace"
        ["Tessera: Move Window to Next Screen"]="Ctrl+Shift+Z,Ctrl+Shift+Z,Tessera: Move Window to Next Screen"
        ["Tessera: Cycle Layout on Other Screen"]="Ctrl+Shift+X,Ctrl+Shift+X,Tessera: Cycle Layout on Other Screen"
        ["Tessera: Swap Screen Layouts"]="Ctrl+Alt+X,Ctrl+Alt+X,Tessera: Swap Screen Layouts"
    )

    for sc_name in "${!SHORTCUT_DEFAULTS[@]}"; do
        existing=""
        if command -v kreadconfig6 >/dev/null 2>&1; then
            existing=$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$sc_name" 2>/dev/null || true)
        fi
        if [ -z "$existing" ]; then
            kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$sc_name" "${SHORTCUT_DEFAULTS[$sc_name]}"
        fi
    done

    # Remove obsolete Master HUD shortcut if present
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "Tessera: Show Master HUD" --delete 2>/dev/null || true

    systemctl --user restart plasma-kglobalaccel.service 2>/dev/null || true
fi

# 8. Initialize default config
python3 -c "import sys; sys.path.append('$CONTROL_INSTALL_DIR'); from config_manager import ConfigManager; ConfigManager().save()" 2>/dev/null || true

# 9. Reload KWin
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
echo "  Toggle tiling with: Ctrl + Shift + T                  "
echo "  Switch layouts with: Ctrl + Space                     "
echo "========================================================="

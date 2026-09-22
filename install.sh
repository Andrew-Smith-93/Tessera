#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_HOME="${XDG_BIN_HOME:-$HOME/.local/bin}"
KWIN_SCRIPTS_DIR="$DATA_HOME/kwin/scripts"
TARGET_DIR="$KWIN_SCRIPTS_DIR/tessera"
APPS_DIR="$DATA_HOME/applications"
ICONS_DIR="$DATA_HOME/icons/hicolor/scalable/apps"
CONTROL_INSTALL_DIR="$DATA_HOME/tessera/control"
DESKTOP_TARGET="$APPS_DIR/org.kde.tessera.desktop"
ICON_TARGET="$ICONS_DIR/tessera.svg"
LAUNCHER_TARGET="$BIN_HOME/tessera-settings"
SHORTCUT_CATALOG="$SCRIPT_DIR/config/shortcuts.json"
MISSING_VALUE="__TESSERA_INSTALL_VALUE_MISSING_8f2b70c1__"

echo "Installing Tessera for KDE Plasma 6..."

# Dependency preflight checks before any mutation
for required in python3 kreadconfig6 kwriteconfig6; do
    if ! command -v "$required" >/dev/null 2>&1; then
        echo "Error: required utility '$required' was not found in PATH." >&2
        exit 1
    fi
done

if ! python3 -c "import PyQt5" >/dev/null 2>&1; then
    echo "Error: PyQt5 is required for the installed Tessera Control Center (install python3-pyqt5)." >&2
    exit 1
fi

# Source inventory validation before any mutation
for req_file in \
    "$SCRIPT_DIR/metadata.json" \
    "$SCRIPT_DIR/contents/ui/main.qml" \
    "$SCRIPT_DIR/contents/ui/config.ui" \
    "$SCRIPT_DIR/contents/code/layouts.js" \
    "$SCRIPT_DIR/contents/code/rules.js" \
    "$SCRIPT_DIR/contents/code/reconciler.js" \
    "$SCRIPT_DIR/contents/config/main.xml" \
    "$SCRIPT_DIR/tessera-control/command_runner.py" \
    "$SCRIPT_DIR/tessera-control/config_contract.py" \
    "$SCRIPT_DIR/tessera-control/config_manager.py" \
    "$SCRIPT_DIR/tessera-control/presets.py" \
    "$SCRIPT_DIR/tessera-control/tessera_settings.py" \
    "$SCRIPT_DIR/tessera-control/ui_preview.py" \
    "$SCRIPT_DIR/tessera-control/window_picker.py" \
    "$SCRIPT_DIR/desktop/org.kde.tessera.desktop" \
    "$SCRIPT_DIR/desktop/tessera.svg" \
    "$SHORTCUT_CATALOG"; do
    if [ ! -f "$req_file" ]; then
        echo "Error: required source file '$req_file' was not found." >&2
        exit 1
    fi
done

python3 - "$SCRIPT_DIR/metadata.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        meta = json.load(f)
    if not isinstance(meta, dict):
        raise ValueError("metadata must be a JSON object")
    kplugin = meta.get("KPlugin")
    if not isinstance(kplugin, dict) or kplugin.get("Id") != "tessera":
        raise ValueError("KPlugin.Id must be 'tessera'")
    if meta.get("X-Plasma-MainScript") != "ui/main.qml":
        raise ValueError("X-Plasma-MainScript must be 'ui/main.qml'")
    if meta.get("KPackageStructure") != "KWin/Script":
        raise ValueError("KPackageStructure must be 'KWin/Script'")
except Exception as exc:
    print(f"Error: malformed metadata.json in {sys.argv[1]}: {exc}", file=sys.stderr)
    sys.exit(1)
PY

TRANSACTION_DIR=""
STAGE_DIR=""
BACKUP_DIR=""
COMMITTED=false

declare -a REPLACED_TARGETS=()
declare -a REPLACED_BACKUPS=()
declare -a ADDED_SHORTCUTS=()
declare -a SHORTCUT_NAMES=()
declare -a SHORTCUT_SEQUENCES=()
declare -a SHORTCUT_LABELS=()
declare -a LEGACY_SHORTCUT_NAMES=()
PLUGIN_WAS_WRITTEN=false
PLUGIN_WAS_PRESENT=false
PLUGIN_PREVIOUS_VALUE=""

remove_known_target() {
    local target="${1%/}"
    case "$target" in
        "$TARGET_DIR"|"$CONTROL_INSTALL_DIR"|"$DESKTOP_TARGET"|"$ICON_TARGET"|"$LAUNCHER_TARGET")
            if [ -L "$target" ]; then
                rm -f -- "$target"
            else
                rm -rf -- "$target"
            fi
            ;;
        *)
            echo "Refusing to remove unexpected install target: $1" >&2
            return 1
            ;;
    esac
}

rollback_install() {
    local exit_code=$?
    trap - EXIT INT TERM
    if [ "$COMMITTED" = true ] || [ "$exit_code" -eq 0 ]; then
        [ -n "${TRANSACTION_DIR:-}" ] && [ -d "$TRANSACTION_DIR" ] && rm -rf -- "$TRANSACTION_DIR"
        return "$exit_code"
    fi

    set +e
    set +u
    echo "Installation failed; restoring the previous Tessera installation." >&2
    if [ "$PLUGIN_WAS_WRITTEN" = true ]; then
        if [ "$PLUGIN_WAS_PRESENT" = true ]; then
            kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled "$PLUGIN_PREVIOUS_VALUE" >/dev/null 2>&1
        else
            kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled --delete >/dev/null 2>&1
        fi
    fi
    for shortcut_name in "${ADDED_SHORTCUTS[@]}"; do
        kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$shortcut_name" --delete >/dev/null 2>&1
    done
    for ((index=${#REPLACED_TARGETS[@]} - 1; index >= 0; index--)); do
        target="${REPLACED_TARGETS[$index]}"
        backup="${REPLACED_BACKUPS[$index]}"
        remove_known_target "$target" >/dev/null 2>&1
        if [ -n "$backup" ] && { [ -e "$backup" ] || [ -L "$backup" ]; }; then
            mkdir -p "$(dirname "$target")"
            mv "$backup" "$target"
        fi
    done
    [ -n "${TRANSACTION_DIR:-}" ] && [ -d "$TRANSACTION_DIR" ] && rm -rf -- "$TRANSACTION_DIR"
    exit "$exit_code"
}

handle_sigint() {
    trap - INT TERM
    exit 130
}

handle_sigterm() {
    trap - INT TERM
    exit 143
}

trap handle_sigint INT
trap handle_sigterm TERM
trap rollback_install EXIT

mkdir -p "$DATA_HOME" "$BIN_HOME" "$KWIN_SCRIPTS_DIR" "$APPS_DIR" "$ICONS_DIR" "$(dirname "$CONTROL_INSTALL_DIR")"
TRANSACTION_DIR="$(mktemp -d "$DATA_HOME/.tessera-install.XXXXXX")"
STAGE_DIR="$TRANSACTION_DIR/stage"
BACKUP_DIR="$TRANSACTION_DIR/backup"
mkdir -p "$STAGE_DIR" "$BACKUP_DIR"

replace_path() {
    local source=$1
    local target="${2%/}"
    local index=${#REPLACED_TARGETS[@]}
    local backup_path=""
    if [ -e "$target" ] || [ -L "$target" ]; then
        backup_path="$BACKUP_DIR/$index"
        mv "$target" "$backup_path"
    fi
    REPLACED_TARGETS+=("$target")
    REPLACED_BACKUPS+=("$backup_path")
    mkdir -p "$(dirname "$target")"
    mv "$source" "$target"
}

# Validate and materialize the shortcut catalog before touching installed state.
SHORTCUT_ROWS="$TRANSACTION_DIR/shortcuts.tsv"
python3 - "$SHORTCUT_CATALOG" "$SHORTCUT_ROWS" <<'PY'
import json
import sys

source, destination = sys.argv[1:]
try:
    with open(source, "r", encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise ValueError("catalog must be a json object")
    if set(document.keys()) != {"version", "shortcuts", "legacyNames"}:
        raise ValueError("catalog top-level keys must be exactly ('version', 'shortcuts', 'legacyNames')")
    if document.get("version") != 1 or not isinstance(document.get("shortcuts"), list) or not isinstance(document.get("legacyNames"), list):
        raise ValueError("invalid version or shortcut/legacy lists")

    seen_names = set()
    seen_seqs = set()
    rows = []
    for idx, item in enumerate(document["shortcuts"]):
        if not isinstance(item, dict) or set(item.keys()) != {"name", "label", "sequence"}:
            raise ValueError(f"entry {idx} must have exactly ('name', 'label', 'sequence')")
        name = item["name"]
        label = item["label"]
        seq = item["sequence"]
        for field, val in [("name", name), ("label", label), ("sequence", seq)]:
            if not isinstance(val, str) or not val.strip():
                raise ValueError(f"entry {idx} field {field} must be a non-empty string")
            if any(ord(c) < 32 or c in "\t\r\n" for c in val):
                raise ValueError(f"entry {idx} field {field} contains control characters")
        if "master" in name.lower() or "master" in label.lower():
            raise ValueError(f"active shortcut '{name}' must not contain Master terminology")
        if name in seen_names:
            raise ValueError(f"duplicate active shortcut name: {name}")
        if seq in seen_seqs:
            raise ValueError(f"duplicate active shortcut sequence: {seq}")
        seen_names.add(name)
        seen_seqs.add(seq)
        rows.append(("active", name, seq, label))

    seen_legacy = set()
    for lname in document["legacyNames"]:
        if not isinstance(lname, str) or not lname.strip():
            raise ValueError("legacy shortcut name must be non-empty string")
        if any(ord(c) < 32 or c in "\t\r\n" for c in lname):
            raise ValueError("legacy shortcut name contains control characters")
        if lname in seen_legacy:
            raise ValueError(f"duplicate legacy shortcut name: {lname}")
        seen_legacy.add(lname)
        rows.append(("legacy", lname, "", ""))

    if not seen_names.isdisjoint(seen_legacy):
        raise ValueError("legacy shortcut names must be disjoint from active shortcut names")

    with open(destination, "w", encoding="utf-8", newline="") as handle:
        for row in rows:
            handle.write("\t".join(row) + "\n")
except Exception as exc:
    print(f"Error: invalid shortcut catalog {source}: {exc}", file=sys.stderr)
    sys.exit(1)
PY

while IFS=$'\t' read -r kind name sequence label; do
    if [ "$kind" = "active" ]; then
        SHORTCUT_NAMES+=("$name")
        SHORTCUT_SEQUENCES+=("$sequence")
        SHORTCUT_LABELS+=("$label")
    else
        LEGACY_SHORTCUT_NAMES+=("$name")
    fi
done < "$SHORTCUT_ROWS"

# Build every new artifact inside the transaction directory with explicit allowlists.
mkdir -p \
    "$STAGE_DIR/script/contents/code" \
    "$STAGE_DIR/script/contents/config" \
    "$STAGE_DIR/script/contents/ui" \
    "$STAGE_DIR/control"

cp "$SCRIPT_DIR/metadata.json" "$STAGE_DIR/script/metadata.json"
cp "$SCRIPT_DIR/contents/code/layouts.js" "$STAGE_DIR/script/contents/code/layouts.js"
cp "$SCRIPT_DIR/contents/code/reconciler.js" "$STAGE_DIR/script/contents/code/reconciler.js"
cp "$SCRIPT_DIR/contents/code/rules.js" "$STAGE_DIR/script/contents/code/rules.js"
cp "$SCRIPT_DIR/contents/config/main.xml" "$STAGE_DIR/script/contents/config/main.xml"
cp "$SCRIPT_DIR/contents/ui/config.ui" "$STAGE_DIR/script/contents/ui/config.ui"
cp "$SCRIPT_DIR/contents/ui/main.qml" "$STAGE_DIR/script/contents/ui/main.qml"

for mod in command_runner.py config_contract.py config_manager.py presets.py tessera_settings.py ui_preview.py window_picker.py; do
    cp "$SCRIPT_DIR/tessera-control/$mod" "$STAGE_DIR/control/$mod"
done
cp "$SHORTCUT_CATALOG" "$STAGE_DIR/control/shortcuts.json"

cp "$SCRIPT_DIR/desktop/org.kde.tessera.desktop" "$STAGE_DIR/org.kde.tessera.desktop"
sed -i "s|^Exec=.*|Exec=$LAUNCHER_TARGET|" "$STAGE_DIR/org.kde.tessera.desktop"
cp "$SCRIPT_DIR/desktop/tessera.svg" "$STAGE_DIR/tessera.svg"

cat > "$STAGE_DIR/tessera-settings" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONTROL_DIR="$DATA_HOME/tessera/control"
PYTHONPATH="$CONTROL_DIR" exec python3 "$CONTROL_DIR/tessera_settings.py" "$@"
EOF
chmod +x "$STAGE_DIR/tessera-settings"

replace_path "$STAGE_DIR/script" "$TARGET_DIR"
replace_path "$STAGE_DIR/control" "$CONTROL_INSTALL_DIR"
replace_path "$STAGE_DIR/org.kde.tessera.desktop" "$DESKTOP_TARGET"
replace_path "$STAGE_DIR/tessera.svg" "$ICON_TARGET"
replace_path "$STAGE_DIR/tessera-settings" "$LAUNCHER_TARGET"

# Preserve every explicit user shortcut, including an explicit empty binding.
for ((index=0; index<${#SHORTCUT_NAMES[@]}; index++)); do
    name="${SHORTCUT_NAMES[$index]}"
    sequence="${SHORTCUT_SEQUENCES[$index]}"
    label="${SHORTCUT_LABELS[$index]}"
    existing="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --default "$MISSING_VALUE")"
    if [ "$existing" = "$MISSING_VALUE" ]; then
        # Record intent before write so fail-after-side-effect is recoverable
        ADDED_SHORTCUTS+=("$name")
        kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" "$sequence,$sequence,$label"
    fi
done

PLUGIN_PREVIOUS_VALUE="$(kreadconfig6 --file kwinrc --group Plugins --key tesseraEnabled --default "$MISSING_VALUE")"
if [ "$PLUGIN_PREVIOUS_VALUE" != "$MISSING_VALUE" ]; then
    PLUGIN_WAS_PRESENT=true
fi
# Record intent before write so fail-after-side-effect is recoverable
PLUGIN_WAS_WRITTEN=true
kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled true

COMMITTED=true
rm -rf -- "$TRANSACTION_DIR"
TRANSACTION_DIR=""
trap - EXIT INT TERM

# Obsolete action IDs no longer exist in the runtime, so remove only those
# legacy registrations after the recoverable file/config transaction commits.
for name in "${LEGACY_SHORTCUT_NAMES[@]}"; do
    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --delete >/dev/null 2>&1 || true
done

command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true
if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure >/dev/null 2>&1 || true
fi

echo "Installation complete. Launch the Control Center with: tessera-settings"

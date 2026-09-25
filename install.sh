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

OPT_IN_SPATIAL_REPLACEMENTS=false
for arg in "$@"; do
    case "$arg" in
        --migrate-legacy-spatial|--migrate-spatial-replacements|--migrate-spatial-shortcuts)
            OPT_IN_SPATIAL_REPLACEMENTS=true
            ;;
    esac
done
if [ "${TESSERA_MIGRATE_LEGACY_SPATIAL:-0}" = "1" ] || [ "${TESSERA_OPT_IN_SPATIAL_MIGRATION:-0}" = "1" ]; then
    OPT_IN_SPATIAL_REPLACEMENTS=true
fi

echo "Installing Tessera for KDE Plasma 6..."

# Dependency preflight checks before any mutation
for required in python3 kreadconfig6 kwriteconfig6; do
    if ! command -v "$required" >/dev/null 2>&1; then
        echo "Error: required utility '$required' was not found in PATH." >&2
        exit 1
    fi
done

# Source inventory validation before any mutation
for req_file in \
    "$SCRIPT_DIR/metadata.json" \
    "$SCRIPT_DIR/contents/ui/main.qml" \
    "$SCRIPT_DIR/contents/ui/config.ui" \
    "$SCRIPT_DIR/contents/code/layouts.js" \
    "$SCRIPT_DIR/contents/code/rules.js" \
    "$SCRIPT_DIR/contents/code/reconciler.js" \
    "$SCRIPT_DIR/contents/config/main.xml" \
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
declare -a SNAPSHOT_KEYS=()
declare -a SNAPSHOT_STATUS=()
declare -a SNAPSHOT_VALUES=()
declare -a TRANSFERRED_CUSTOM_ACTIONS=()
declare -a SHORTCUT_NAMES=()
declare -a SHORTCUT_SEQUENCES=()
declare -a SHORTCUT_LABELS=()
declare -a LEGACY_SHORTCUT_NAMES=()
PLUGIN_WAS_WRITTEN=false
PLUGIN_WAS_PRESENT=false
PLUGIN_PREVIOUS_VALUE=""

snapshot_shortcut_key() {
    local key="$1"
    for existing_key in "${SNAPSHOT_KEYS[@]}"; do
        if [ "$existing_key" = "$key" ]; then
            return 0
        fi
    done
    local cur_val
    cur_val="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$key" --default "$MISSING_VALUE")"
    SNAPSHOT_KEYS+=("$key")
    if [ "$cur_val" = "$MISSING_VALUE" ]; then
        SNAPSHOT_STATUS+=("absent")
        SNAPSHOT_VALUES+=("")
    else
        SNAPSHOT_STATUS+=("present")
        SNAPSHOT_VALUES+=("$cur_val")
    fi
}

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
    for ((index=${#SNAPSHOT_KEYS[@]} - 1; index >= 0; index--)); do
        key="${SNAPSHOT_KEYS[$index]}"
        status="${SNAPSHOT_STATUS[$index]}"
        old_val="${SNAPSHOT_VALUES[$index]}"
        if [ "$status" = "absent" ]; then
            kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$key" --delete >/dev/null 2>&1
        else
            kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$key" "$old_val" >/dev/null 2>&1
        fi
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

# Bridge staleness and syntax preflight for source checkouts.
# A source checkout contains apps/kwin-adapter/src.
# A source-less package contains only runtime files without TypeScript source trees.
if [ -d "$SCRIPT_DIR/apps/kwin-adapter/src" ]; then
    # 1. Staleness check: bridges must be at least as new as TypeScript sources
    python3 - "$SCRIPT_DIR" <<'PY'
import os
import sys

script_dir = sys.argv[1]
bridges = [
    os.path.join(script_dir, "contents", "code", "layouts.js"),
    os.path.join(script_dir, "contents", "code", "rules.js"),
    os.path.join(script_dir, "contents", "code", "reconciler.js"),
]

for b in bridges:
    if not os.path.isfile(b):
        sys.stderr.write(f"Error: missing required bridge file: {b}\n")
        sys.exit(1)

source_files = []
for root, dirs, files in os.walk(script_dir):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", "target", "dist", ".tessera-install")]
    for f in files:
        if f.endswith((".ts", ".json", ".mjs")) and not f.endswith(".d.ts"):
            rel = os.path.relpath(os.path.join(root, f), script_dir)
            if (rel.startswith("apps/kwin-adapter/src/") or
                rel == "apps/kwin-adapter/esbuild.config.mjs" or
                (rel.startswith("packages/") and "/src/" in rel) or
                rel in ("package.json", "tsconfig.json")):
                source_files.append(os.path.join(root, f))

if source_files:
    max_src_mtime = max(os.path.getmtime(sf) for sf in source_files)
    for b in bridges:
        b_mtime = os.path.getmtime(b)
        if b_mtime < max_src_mtime:
            rel_b = os.path.relpath(b, script_dir)
            sys.stderr.write(f"Error: generated bridge '{rel_b}' is stale compared to TypeScript sources. Run 'npm run build' before installing.\n")
            sys.exit(1)
PY

    # 2. Syntax/compatibility validation: verify generated bridges contain no unlowered class fields.
    # Uses Node.js + TypeScript AST parser.
    # In a source checkout, verification must run; if dependencies are missing, fail before mutation.
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js was not found in PATH to verify generated bridges in source checkout." >&2
        exit 1
    fi

    export NODE_PATH="${NODE_PATH:-}:${SCRIPT_DIR}/node_modules"
    node - "$SCRIPT_DIR" <<'NODE_JS'
const fs = require('fs');
const path = require('path');
const scriptDir = process.argv[2];

let ts;
try {
    ts = require('typescript');
} catch (err) {
    try {
        ts = require(path.join(scriptDir, 'node_modules', 'typescript'));
    } catch (err2) {
        process.stderr.write("Error: TypeScript parser dependency not found to verify generated bridges in source checkout. Run 'npm install' before installing.\n");
        process.exit(2);
    }
}

const bridges = [
    'contents/code/layouts.js',
    'contents/code/rules.js',
    'contents/code/reconciler.js'
];

let hasError = false;
for (const rel of bridges) {
    const fullPath = path.join(scriptDir, rel);
    if (!fs.existsSync(fullPath)) {
        process.stderr.write(`Error: missing required bridge file: ${rel}\n`);
        process.exit(1);
    }
    const code = fs.readFileSync(fullPath, 'utf8');
    const sf = ts.createSourceFile(fullPath, code, ts.ScriptTarget.Latest, true);

    function visit(node) {
        const isProp = ts.isPropertyDeclaration(node), isSpread = ts.isSpreadAssignment(node), isOpt = !!node.questionDotToken, isNull = ts.isBinaryExpression(node) && node.operatorToken && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
        if (isProp || isSpread || isOpt || isNull) {
            const tag = isProp ? `class field '${node.name ? node.name.getText(sf) : '<unknown>'}'` : (isSpread ? `object spread '...${node.expression ? node.expression.getText(sf) : ''}'` : (isOpt ? "optional chaining" : "nullish coalescing"));
            const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            process.stderr.write(`Error: generated bridge '${rel}' contains unlowered ${tag} at line ${pos.line + 1}, column ${pos.character + 1} incompatible with KWin QML host. Run 'npm run build' before installing.\n`); hasError = true;
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
}

if (hasError) {
    process.exit(1);
}
NODE_JS
fi

# Build every new artifact inside the transaction directory with explicit allowlists.
mkdir -p \
    "$STAGE_DIR/script/contents/code" \
    "$STAGE_DIR/script/contents/config" \
    "$STAGE_DIR/script/contents/ui"

cp "$SCRIPT_DIR/metadata.json" "$STAGE_DIR/script/metadata.json"
cp "$SCRIPT_DIR/contents/code/layouts.js" "$STAGE_DIR/script/contents/code/layouts.js"
cp "$SCRIPT_DIR/contents/code/reconciler.js" "$STAGE_DIR/script/contents/code/reconciler.js"
cp "$SCRIPT_DIR/contents/code/rules.js" "$STAGE_DIR/script/contents/code/rules.js"
cp "$SCRIPT_DIR/contents/config/main.xml" "$STAGE_DIR/script/contents/config/main.xml"
cp "$SCRIPT_DIR/contents/ui/config.ui" "$STAGE_DIR/script/contents/ui/config.ui"
cp "$SCRIPT_DIR/contents/ui/main.qml" "$STAGE_DIR/script/contents/ui/main.qml"

replace_path "$STAGE_DIR/script" "$TARGET_DIR"

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

is_recognized_default_label() {
    local action="$1"
    local lbl="$2"

    [ -z "$lbl" ] && return 0
    [ "$lbl" = "$action" ] && return 0

    local idx=0
    for ((idx=0; idx<${#SHORTCUT_NAMES[@]}; idx++)); do
        if [ "${SHORTCUT_NAMES[idx]}" = "$action" ]; then
            [ "$lbl" = "${SHORTCUT_LABELS[idx]}" ] && return 0
            break
        fi
    done

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

is_uncustomized_old_default() {
    local action="$1"
    local raw_val="$2"
    [ -z "$raw_val" ] && return 1

    local cur_binding=""
    local def_binding=""
    local label=""
    IFS=',' read -r cur_binding def_binding label <<< "$raw_val"

    # Both current and stored default fields must exist and not be "none"
    [ -z "$cur_binding" ] && return 1
    [ -z "$def_binding" ] && return 1
    [ "$cur_binding" = "none" ] && return 1
    [ "$def_binding" = "none" ] && return 1

    # Both fields must be equal
    [ "$cur_binding" != "$def_binding" ] && return 1

    # The sequence must be a recognized historical default for this action
    if ! is_recognized_old_default "$action" "$cur_binding"; then
        return 1
    fi

    # The label must be an uncustomized default label; a custom label indicates user customization
    is_recognized_default_label "$action" "$label"
}

get_compatible_replacement() {
    local legacy_name="$1"
    case "$legacy_name" in
        "Tessera: Focus Next Window")
            if [ "$OPT_IN_SPATIAL_REPLACEMENTS" = true ]; then
                echo "Tessera: Focus Right Window"
            fi
            ;;
        "Tessera: Focus Previous Window")
            if [ "$OPT_IN_SPATIAL_REPLACEMENTS" = true ]; then
                echo "Tessera: Focus Left Window"
            fi
            ;;
        "Tessera: Swap Window Forward")
            if [ "$OPT_IN_SPATIAL_REPLACEMENTS" = true ]; then
                echo "Tessera: Swap Right Window"
            fi
            ;;
        "Tessera: Swap Window Backward")
            if [ "$OPT_IN_SPATIAL_REPLACEMENTS" = true ]; then
                echo "Tessera: Swap Left Window"
            fi
            ;;
        "Tessera: Move Window to Next Screen")
            if [ "$OPT_IN_SPATIAL_REPLACEMENTS" = true ]; then
                echo "Tessera: Move Window to Screen Right"
            fi
            ;;
        *)
            echo "" ;;
    esac
}

detect_plasma_conflicts() {
    local -a conflicts=()
    local known_plasma_shortcuts=(
        "kwin:Window Quick Tile Left:Meta+Left:Quick Tile Left"
        "kwin:Window Quick Tile Right:Meta+Right:Quick Tile Right"
        "kwin:Window Quick Tile Top:Meta+Up:Quick Tile Top"
        "kwin:Window Quick Tile Bottom:Meta+Down:Quick Tile Bottom"
        "kwin:Window Maximize:Meta+Up:Maximize Window"
        "kwin:Window Minimize:Meta+Down:Minimize Window"
        "kwin:Window One Desktop to the Left:Meta+Ctrl+Left:Window to Previous Desktop"
        "kwin:Window One Desktop to the Right:Meta+Ctrl+Right:Window to Next Desktop"
        "kwin:Window One Desktop Up:Meta+Ctrl+Up:Window to Desktop Above"
        "kwin:Window One Desktop Down:Meta+Ctrl+Down:Window to Desktop Below"
        "org.kde.krunner.desktop:_launch:Meta+Space:KRunner"
    )

    # Read actual active bindings from kglobalshortcutsrc
    for ((i=0; i<${#SHORTCUT_NAMES[@]}; i++)); do
        local t_name="${SHORTCUT_NAMES[$i]}"
        local t_val
        t_val="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$t_name" --default "$MISSING_VALUE")"
        if [ "$t_val" != "$MISSING_VALUE" ]; then
            local t_seq
            t_seq="$(echo "$t_val" | cut -d',' -f1)"
            if [ -n "$t_seq" ] && [ "$t_seq" != "none" ]; then
                for entry in "${known_plasma_shortcuts[@]}"; do
                    local p_group="${entry%%:*}"
                    local remainder="${entry#*:}"
                    local p_key="${remainder%%:*}"
                    remainder="${remainder#*:}"
                    local p_default_seq="${remainder%%:*}"
                    local p_desc="${remainder#*:}"

                    local p_val
                    p_val="$(kreadconfig6 --file kglobalshortcutsrc --group "$p_group" --key "$p_key" --default "$MISSING_VALUE")"
                    local p_check_seq=""
                    if [ "$p_val" = "$MISSING_VALUE" ]; then
                        # Plasma key is missing from kglobalshortcutsrc: Plasma uses its built-in default
                        p_check_seq="$p_default_seq"
                    else
                        # Plasma key is explicitly configured in kglobalshortcutsrc
                        local p_active_seq
                        p_active_seq="$(echo "$p_val" | cut -d',' -f1)"
                        if [ -n "$p_active_seq" ] && [ "$p_active_seq" != "none" ]; then
                            p_check_seq="$p_active_seq"
                        else
                            # Explicitly empty or 'none': unbound by user, not a conflict
                            p_check_seq=""
                        fi
                    fi
                    if [ -n "$p_check_seq" ] && [ "$t_seq" = "$p_check_seq" ]; then
                        conflicts+=("Tessera '$t_name' (bound to '$t_seq') and Plasma '$p_key' ($p_desc) both use '$t_seq'")
                    fi
                done
            fi
        fi
    done

    if [ ${#conflicts[@]} -gt 0 ]; then
        echo "Notice: Detected potential shortcut conflicts with Plasma defaults:"
        for c in "${conflicts[@]}"; do
            echo "  - $c"
        done
        echo "Tessera shortcuts were registered without modifying unrelated shortcuts. You can customize them in KDE System Settings -> Shortcuts."
    fi
}

# Transactional legacy shortcut handling: migrate custom bindings to compatible replacements where uncustomized;
# delete uncustomized/default legacy registrations; preserve custom or intentionally unbound legacy bindings.
for legacy_name in "${LEGACY_SHORTCUT_NAMES[@]}"; do
    existing="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$legacy_name" --default "$MISSING_VALUE")"
    if [ "$existing" != "$MISSING_VALUE" ]; then
        legacy_binding="$(echo "$existing" | cut -d',' -f1)"
        if is_uncustomized_old_default "$legacy_name" "$existing"; then
            snapshot_shortcut_key "$legacy_name"
            kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$legacy_name" --delete
        else
            replacement="$(get_compatible_replacement "$legacy_name")"
            migrated_to_replacement=false
            if [ -n "$replacement" ] && [ -n "$legacy_binding" ] && [ "$legacy_binding" != "none" ]; then
                repl_existing="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$replacement" --default "$MISSING_VALUE")"
                repl_binding="$(echo "$repl_existing" | cut -d',' -f1)"
                repl_seq=""
                repl_label=""
                for ((idx=0; idx<${#SHORTCUT_NAMES[@]}; idx++)); do
                    if [ "${SHORTCUT_NAMES[$idx]}" = "$replacement" ]; then
                        repl_seq="${SHORTCUT_SEQUENCES[$idx]}"
                        repl_label="${SHORTCUT_LABELS[$idx]}"
                        break
                    fi
                done
                if [ "$repl_existing" = "$MISSING_VALUE" ] || [ "$repl_binding" = "$repl_seq" ] || is_uncustomized_old_default "$replacement" "$repl_existing"; then
                    snapshot_shortcut_key "$replacement"
                    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$replacement" "$legacy_binding,$repl_seq,$repl_label"
                    TRANSFERRED_CUSTOM_ACTIONS+=("$replacement")
                    snapshot_shortcut_key "$legacy_name"
                    kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$legacy_name" --delete
                    echo "Notice: migrated custom binding '$legacy_binding' from retired action '$legacy_name' to active directional replacement '$replacement'. Note: spatial navigation replaces previous cyclical ordering."
                    migrated_to_replacement=true
                fi
            fi
            if [ "$migrated_to_replacement" = false ]; then
                echo "Notice: preserving custom or intentionally unbound binding on legacy action '$legacy_name' ($legacy_binding) in kglobalshortcutsrc. Note: legacy actions lack active QML runtime handlers and remain dormant unless migrated to active directional shortcuts via --migrate-spatial-shortcuts or reconfigured in KDE System Settings -> Shortcuts."
            fi
        fi
    fi
done

# Configure active shortcuts: write missing defaults, migrate recognized old defaults to Super,
# and strictly preserve custom or intentionally unbound values.
for ((index=0; index<${#SHORTCUT_NAMES[@]}; index++)); do
    name="${SHORTCUT_NAMES[$index]}"
    sequence="${SHORTCUT_SEQUENCES[$index]}"
    label="${SHORTCUT_LABELS[$index]}"

    is_transferred_custom=false
    for t_action in "${TRANSFERRED_CUSTOM_ACTIONS[@]}"; do
        if [ "$t_action" = "$name" ]; then
            is_transferred_custom=true
            break
        fi
    done
    if [ "$is_transferred_custom" = true ]; then
        continue
    fi

    existing="$(kreadconfig6 --file kglobalshortcutsrc --group kwin --key "$name" --default "$MISSING_VALUE")"
    if [ "$existing" = "$MISSING_VALUE" ]; then
        snapshot_shortcut_key "$name"
        kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" "$sequence,$sequence,$label"
    else
        current_binding="$(echo "$existing" | cut -d',' -f1)"
        if [ -z "$current_binding" ] || [ "$current_binding" = "none" ]; then
            # Explicitly unbound by user: preserve empty/none binding
            :
        elif [ "$current_binding" = "$sequence" ]; then
            # Already matches new Super default
            :
        elif is_uncustomized_old_default "$name" "$existing"; then
            # Recognized old default: migrate to new Super default while preserving third-field label byte-for-byte
            snapshot_shortcut_key "$name"
            existing_label=""
            IFS=',' read -r _ _ existing_label <<< "$existing"
            migrated_label="${existing_label:-$label}"
            kwriteconfig6 --file kglobalshortcutsrc --group kwin --key "$name" "$sequence,$sequence,$migrated_label"
        else
            # User custom binding: preserve
            :
        fi
    fi
done

detect_plasma_conflicts

PLUGIN_PREVIOUS_VALUE="$(kreadconfig6 --file kwinrc --group Plugins --key tesseraEnabled --default "$MISSING_VALUE")"
if [ "$PLUGIN_PREVIOUS_VALUE" != "$MISSING_VALUE" ]; then
    PLUGIN_WAS_PRESENT=true
fi
PLUGIN_WAS_WRITTEN=true
kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled true

COMMITTED=true
rm -rf -- "$TRANSACTION_DIR"
TRANSACTION_DIR=""
trap - EXIT INT TERM

# Clean up any legacy Control Center files from prior versions
declare -a CONTROL_CLEANUP_FAILURES=()
for legacy_target in "$CONTROL_INSTALL_DIR" "$DESKTOP_TARGET" "$ICON_TARGET" "$LAUNCHER_TARGET"; do
    if [ -e "$legacy_target" ] || [ -L "$legacy_target" ]; then
        if ! remove_known_target "$legacy_target"; then
            CONTROL_CLEANUP_FAILURES+=("$legacy_target")
        fi
    fi
done

if [ ${#CONTROL_CLEANUP_FAILURES[@]} -gt 0 ]; then
    echo "Warning: failed to remove legacy Control Center files: ${CONTROL_CLEANUP_FAILURES[*]}. Legacy cleanup incomplete; please remove remaining files manually." >&2
fi

command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 >/dev/null 2>&1 || true
if command -v qdbus6 >/dev/null 2>&1; then
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure >/dev/null 2>&1 || true
fi

if [ ${#CONTROL_CLEANUP_FAILURES[@]} -eq 0 ]; then
    echo "Installation complete. Configure Tessera in KDE System Settings -> Window Management -> KWin Scripts."
else
    echo "Installation complete with warnings. Configure Tessera in KDE System Settings -> Window Management -> KWin Scripts."
fi

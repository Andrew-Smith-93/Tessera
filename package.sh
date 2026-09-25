#!/usr/bin/env bash
# ==============================================================================
# Tessera Build & Packaging Tool
# Builds a deterministic reproducible .kwinscript package for local verification and maintainer distribution
# ==============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${1:-${DIST_DIR:-$PROJECT_DIR/dist}}"

# Preflight 1: Validate metadata.json and SOURCE_DATE_EPOCH, and safely derive package identity.
# Must fail nonzero without an archive or staging if metadata is invalid or unsafe, or epoch is invalid.
PACKAGE_IDENTITY=$(PROJECT_DIR="$PROJECT_DIR" python3 - <<'PYEOF'
import datetime
import json
import os
import re
import sys

project_dir = os.environ["PROJECT_DIR"]
epoch_text = os.environ.get("SOURCE_DATE_EPOCH", "1767225600")

# Validate SOURCE_DATE_EPOCH
try:
    source_epoch = int(epoch_text)
except ValueError:
    sys.stderr.write(f"Error: SOURCE_DATE_EPOCH must be an integer, got {epoch_text!r}\n")
    sys.exit(1)

try:
    dt = datetime.datetime.fromtimestamp(source_epoch, datetime.timezone.utc)
    if dt.year < 1980 or dt.year > 2107:
        raise ValueError(f"Year {dt.year} outside ZIP range")
except (OverflowError, ValueError, OSError):
    sys.stderr.write("Error: SOURCE_DATE_EPOCH is outside the ZIP timestamp range (1980-2107)\n")
    sys.exit(1)

# Validate metadata.json
meta_path = os.path.join(project_dir, "metadata.json")
if not os.path.isfile(meta_path):
    sys.stderr.write(f"Error: Missing metadata file: {meta_path}\n")
    sys.exit(1)

try:
    with open(meta_path, "r", encoding="utf-8") as fp:
        meta = json.load(fp)
except Exception as err:
    sys.stderr.write(f"Error: Failed to parse metadata.json as JSON: {err}\n")
    sys.exit(1)

if not isinstance(meta, dict):
    sys.stderr.write("Error: metadata.json root must be a JSON object\n")
    sys.exit(1)

kplugin = meta.get("KPlugin")
if not isinstance(kplugin, dict):
    sys.stderr.write("Error: metadata.json KPlugin must be an object\n")
    sys.exit(1)

plugin_id = kplugin.get("Id")
plugin_version = kplugin.get("Version")

SAFE_IDENT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")

if not isinstance(plugin_id, str) or not SAFE_IDENT_RE.match(plugin_id) or ".." in plugin_id or "/" in plugin_id or "\\" in plugin_id:
    sys.stderr.write(f"Error: Invalid or unsafe KPlugin.Id: {plugin_id!r}\n")
    sys.exit(1)

if plugin_id != "tessera":
    sys.stderr.write(f"Error: KPlugin.Id must be 'tessera', got {plugin_id!r}\n")
    sys.exit(1)

if not isinstance(plugin_version, str) or not SAFE_IDENT_RE.match(plugin_version) or ".." in plugin_version or "/" in plugin_version or "\\" in plugin_version:
    sys.stderr.write(f"Error: Invalid or unsafe KPlugin.Version: {plugin_version!r}\n")
    sys.exit(1)

if meta.get("KPackageStructure") != "KWin/Script":
    sys.stderr.write(f"Error: KPackageStructure must be 'KWin/Script', got {meta.get('KPackageStructure')!r}\n")
    sys.exit(1)

if meta.get("X-Plasma-MainScript") != "ui/main.qml":
    sys.stderr.write(f"Error: X-Plasma-MainScript must be 'ui/main.qml', got {meta.get('X-Plasma-MainScript')!r}\n")
    sys.exit(1)

print(plugin_id)
print(plugin_version)
print(f"{plugin_id}-v{plugin_version}.kwinscript")
PYEOF
)

PLUGIN_ID=$(echo "$PACKAGE_IDENTITY" | sed -n '1p')
PLUGIN_VERSION=$(echo "$PACKAGE_IDENTITY" | sed -n '2p')
PACKAGE_NAME=$(echo "$PACKAGE_IDENTITY" | sed -n '3p')

echo "================================================="
echo " Building Tessera Distribution Package v${PLUGIN_VERSION}"
echo "================================================="

# Ensure TypeScript sources are built and up-to-date before packaging
if [ "${TESSERA_SKIP_BUILD:-0}" != "1" ] && [ -f "$PROJECT_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
    echo "-> Building latest TypeScript sources and layout bridges..."
    (cd "$PROJECT_DIR" && npm run build)
fi

# Preflight 2: Verify all required active runtime files exist
PROJECT_DIR="$PROJECT_DIR" python3 - <<'PYEOF'
import os
import sys

project_dir = os.environ["PROJECT_DIR"]
REQUIRED_FILES = [
    "metadata.json",
    "LICENSE",
    "contents/code/layouts.js",
    "contents/code/reconciler.js",
    "contents/code/rules.js",
    "contents/config/main.xml",
    "contents/ui/config.ui",
    "contents/ui/main.qml",
]

for rel_path in REQUIRED_FILES:
    full_path = os.path.join(project_dir, rel_path)
    if not os.path.isfile(full_path):
        sys.stderr.write(f"Error: Missing required file: {rel_path}\n")
        sys.exit(1)
PYEOF

# Validate KPackage structure with kpackagetool6 if available using isolated staged allowlist
if command -v kpackagetool6 >/dev/null 2>&1; then
    echo "-> Validating package structure with kpackagetool6..."
    BUILD_TMP=$(mktemp -d)
    trap 'rm -rf "$BUILD_TMP"' EXIT
    mkdir -p "$BUILD_TMP/contents/code" "$BUILD_TMP/contents/config" "$BUILD_TMP/contents/ui"
    cp "$PROJECT_DIR/metadata.json" "$BUILD_TMP/"
    cp "$PROJECT_DIR/LICENSE" "$BUILD_TMP/"
    cp "$PROJECT_DIR/contents/code/layouts.js" "$BUILD_TMP/contents/code/"
    cp "$PROJECT_DIR/contents/code/reconciler.js" "$BUILD_TMP/contents/code/"
    cp "$PROJECT_DIR/contents/code/rules.js" "$BUILD_TMP/contents/code/"
    cp "$PROJECT_DIR/contents/config/main.xml" "$BUILD_TMP/contents/config/"
    cp "$PROJECT_DIR/contents/ui/config.ui" "$BUILD_TMP/contents/ui/"
    cp "$PROJECT_DIR/contents/ui/main.qml" "$BUILD_TMP/contents/ui/"
    if ! kpackagetool6 --type KWin/Script --appstream-metainfo "$BUILD_TMP" >/dev/null 2>&1; then
        echo "Error: kpackagetool6 package validation failed!" >&2
        rm -rf "$BUILD_TMP"
        exit 1
    fi
    rm -rf "$BUILD_TMP"
    trap - EXIT
else
    echo "-> kpackagetool6 not found; skipping package metadata validation."
fi

# Prepare target directory
mkdir -p "$DIST_DIR"
DIST_DIR="$(cd "$DIST_DIR" && pwd)"

# Create standard zip-based .kwinscript bundle with deterministic ordering, modes, and timestamps
echo "-> Creating $PACKAGE_NAME (deterministic reproducible build)..."
PROJECT_DIR="$PROJECT_DIR" DIST_DIR="$DIST_DIR" PACKAGE_NAME="$PACKAGE_NAME" python3 - <<'PYEOF'
import datetime
import os
import sys
import zipfile

project_dir = os.environ["PROJECT_DIR"]
dist_dir = os.environ["DIST_DIR"]
package_name = os.environ["PACKAGE_NAME"]
epoch_text = os.environ.get("SOURCE_DATE_EPOCH", "1767225600")

source_epoch = int(epoch_text)
dt = datetime.datetime.fromtimestamp(source_epoch, datetime.timezone.utc)
second = dt.second - (dt.second % 2)
fixed_time = (dt.year, dt.month, dt.day, dt.hour, dt.minute, second)

# Exact allowlist of 12 entries: metadata.json and LICENSE first, then explicit directories and files
ALLOWLIST_ENTRIES = [
    ("metadata.json", False, "metadata.json"),
    ("LICENSE", False, "LICENSE"),
    ("contents/", True, None),
    ("contents/code/", True, None),
    ("contents/code/layouts.js", False, "contents/code/layouts.js"),
    ("contents/code/reconciler.js", False, "contents/code/reconciler.js"),
    ("contents/code/rules.js", False, "contents/code/rules.js"),
    ("contents/config/", True, None),
    ("contents/config/main.xml", False, "contents/config/main.xml"),
    ("contents/ui/", True, None),
    ("contents/ui/config.ui", False, "contents/ui/config.ui"),
    ("contents/ui/main.qml", False, "contents/ui/main.qml"),
]

out_zip = os.path.join(dist_dir, package_name)
tmp_zip = os.path.join(dist_dir, f".tmp-{os.getpid()}-{package_name}")

try:
    with zipfile.ZipFile(tmp_zip, "w") as z:
        z.comment = b""
        for arc_path, is_dir, src_rel in ALLOWLIST_ENTRIES:
            zinfo = zipfile.ZipInfo(filename=arc_path, date_time=fixed_time)
            zinfo.create_system = 3  # Unix
            zinfo.create_version = 20
            zinfo.extract_version = 20
            zinfo.flag_bits = 0
            zinfo.extra = b""
            zinfo.comment = b""
            if is_dir:
                zinfo.compress_type = zipfile.ZIP_STORED
                zinfo.external_attr = 0o40755 << 16
                z.writestr(zinfo, b"")
            else:
                zinfo.compress_type = zipfile.ZIP_DEFLATED
                zinfo.external_attr = 0o100644 << 16
                with open(os.path.join(project_dir, src_rel), "rb") as fp:
                    data = fp.read()
                z.writestr(zinfo, data, compresslevel=9)
    os.replace(tmp_zip, out_zip)
except Exception:
    if os.path.exists(tmp_zip):
        os.unlink(tmp_zip)
    raise
PYEOF

echo "================================================="
echo " ✓ Build Succeeded!"
echo " Output: $DIST_DIR/$PACKAGE_NAME"
echo " File size: $(du -h "$DIST_DIR/$PACKAGE_NAME" | cut -f1)"
echo " Local deterministic archive created. Publication/upload remains a separate maintainer decision."
echo "================================================="

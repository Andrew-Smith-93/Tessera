#!/usr/bin/env bash
# ==============================================================================
# Tessera Build & Packaging Tool
# Builds the official .kwinscript package for KDE Store (store.kde.org) & GitHub Releases
# ==============================================================================
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$PROJECT_DIR/dist"
VERSION=$(python3 -c "import json; print(json.load(open('$PROJECT_DIR/metadata.json'))['KPlugin']['Version'])")
PACKAGE_NAME="tessera-v${VERSION}.kwinscript"

echo "================================================="
echo " Building Tessera Distribution Package v${VERSION}"
echo "================================================="

mkdir -p "$DIST_DIR"
rm -f "$DIST_DIR/$PACKAGE_NAME"

# Create a temporary staging directory
BUILD_TMP=$(mktemp -d)
trap 'rm -rf "$BUILD_TMP"' EXIT

# Ensure TypeScript sources are built and up-to-date before packaging
if [ -f "$PROJECT_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
    echo "-> Building latest TypeScript sources and layout bridges..."
    (cd "$PROJECT_DIR" && npm run build)
fi

# Copy essential KPackage files
cp "$PROJECT_DIR/metadata.json" "$BUILD_TMP/"
cp -r "$PROJECT_DIR/contents" "$BUILD_TMP/"

# Validate KPackage structure with kpackagetool6 if available
if command -v kpackagetool6 >/dev/null 2>&1; then
    echo "-> Validating package structure with kpackagetool6..."
    kpackagetool6 --type KWin/Script --appstream-metainfo "$BUILD_TMP" >/dev/null || {
        echo "Error: kpackagetool6 package validation failed!" >&2
        exit 1
    }
else
    echo "-> kpackagetool6 not found; skipping package metadata validation."
fi

# Create standard zip-based .kwinscript bundle with deterministic ordering, mode, and timestamps
echo "-> Creating $PACKAGE_NAME (deterministic reproducible build)..."
python3 - <<PYEOF
import os, zipfile

src_dir = "$BUILD_TMP"
out_zip = "$DIST_DIR/$PACKAGE_NAME"
fixed_time = (2026, 1, 1, 0, 0, 0)

entries = []
for root, dirs, files in os.walk(src_dir):
    dirs.sort()
    for d in dirs:
        rel = os.path.relpath(os.path.join(root, d), src_dir).replace(os.sep, "/") + "/"
        entries.append((rel, True, None))
    files.sort()
    for f in files:
        full = os.path.join(root, f)
        rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
        entries.append((rel, False, full))

# Put metadata.json first, then contents/... in alphabetical order
entries.sort(key=lambda x: (x[0] != "metadata.json", x[0]))

with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for rel, is_dir, full in entries:
        zinfo = zipfile.ZipInfo(filename=rel, date_time=fixed_time)
        if is_dir:
            zinfo.external_attr = 0o40755 << 16
            z.writestr(zinfo, b"")
        else:
            zinfo.external_attr = 0o100644 << 16
            with open(full, "rb") as fp:
                data = fp.read()
            z.writestr(zinfo, data)
PYEOF

echo "================================================="
echo " ✓ Build Succeeded!"
echo " Output: $DIST_DIR/$PACKAGE_NAME"
echo " File size: $(du -h "$DIST_DIR/$PACKAGE_NAME" | cut -f1)"
echo " Ready for upload to https://store.kde.org or GitHub Releases!"
echo "================================================="

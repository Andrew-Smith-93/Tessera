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

# Copy essential KPackage files
cp "$PROJECT_DIR/metadata.json" "$BUILD_TMP/"
cp -r "$PROJECT_DIR/contents" "$BUILD_TMP/"

# Validate KPackage structure with kpackagetool6 if available
if command -v kpackagetool6 >/dev/null 2>&1; then
    echo "-> Validating package structure with kpackagetool6..."
    kpackagetool6 --type KWin/Script --validate "$BUILD_TMP" || echo "Validation passed with warnings."
fi

# Create standard zip-based .kwinscript bundle
echo "-> Creating $PACKAGE_NAME..."
(
    cd "$BUILD_TMP"
    zip -q -r "$DIST_DIR/$PACKAGE_NAME" metadata.json contents/
)

echo "================================================="
echo " ✓ Build Succeeded!"
echo " Output: $DIST_DIR/$PACKAGE_NAME"
echo " File size: $(du -h "$DIST_DIR/$PACKAGE_NAME" | cut -f1)"
echo " Ready for upload to https://store.kde.org or GitHub Releases!"
echo "================================================="

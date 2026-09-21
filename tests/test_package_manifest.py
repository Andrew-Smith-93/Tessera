"""
Automated unit tests for Tessera package manifest and runtime surface integrity.

Validates:
1. contents/ui/main.qml is the sole declarative runtime entrypoint in metadata.json.
2. Generated bridges (layouts.js, rules.js) and active QML UI are present.
3. Pruned legacy files (main.js, tessera.qml, ZoneOverlay.qml, TopNotification.qml) are absent.
4. Packaging archives (.kwinscript) include active components and exclude pruned legacy files.
"""

import unittest
import json
import os
import glob
import zipfile

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
METADATA_PATH = os.path.join(PROJECT_ROOT, "metadata.json")
CONTENTS_DIR = os.path.join(PROJECT_ROOT, "contents")
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")

REMOVED_LEGACY_FILES = [
    os.path.join(CONTENTS_DIR, "code", "main.js"),
    os.path.join(CONTENTS_DIR, "ui", "tessera.qml"),
    os.path.join(CONTENTS_DIR, "ui", "ZoneOverlay.qml"),
    os.path.join(CONTENTS_DIR, "ui", "TopNotification.qml"),
]

REQUIRED_ACTIVE_FILES = [
    os.path.join(CONTENTS_DIR, "ui", "main.qml"),
    os.path.join(CONTENTS_DIR, "code", "layouts.js"),
    os.path.join(CONTENTS_DIR, "code", "rules.js"),
    os.path.join(CONTENTS_DIR, "code", "reconciler.js"),
    os.path.join(CONTENTS_DIR, "ui", "config.ui"),
    os.path.join(CONTENTS_DIR, "config", "main.xml"),
]

class TestPackageManifest(unittest.TestCase):
    def test_metadata_entrypoint(self):
        """Verifies metadata.json designates ui/main.qml as the sole runtime entrypoint."""
        self.assertTrue(os.path.isfile(METADATA_PATH), f"Missing {METADATA_PATH}")
        with open(METADATA_PATH, "r", encoding="utf-8") as f:
            meta = json.load(f)

        self.assertIn("KPlugin", meta)
        self.assertEqual(meta["KPlugin"].get("Id"), "tessera")
        self.assertEqual(meta.get("X-Plasma-API"), "declarativescript")
        self.assertEqual(meta.get("X-Plasma-MainScript"), "ui/main.qml")
        self.assertEqual(meta.get("KPackageStructure"), "KWin/Script")

    def test_active_runtime_surface_files_present(self):
        """Verifies all authoritative runtime files and generated bridges are present."""
        for path in REQUIRED_ACTIVE_FILES:
            rel = os.path.relpath(path, PROJECT_ROOT)
            self.assertTrue(os.path.isfile(path), f"Required active file missing: {rel}")

    def test_pruned_legacy_files_absent(self):
        """Verifies pruned dead candidates are completely absent from the repository contents."""
        for path in REMOVED_LEGACY_FILES:
            rel = os.path.relpath(path, PROJECT_ROOT)
            self.assertFalse(os.path.exists(path), f"Pruned legacy file must not exist: {rel}")

    def test_package_archive_integrity_if_built(self):
        """If a .kwinscript archive is present in dist/, verifies its contents against pruned files."""
        packages = glob.glob(os.path.join(DIST_DIR, "*.kwinscript"))
        if not packages:
            self.skipTest("No .kwinscript packages in dist/ yet (run package.sh first).")

        for pkg in packages:
            with zipfile.ZipFile(pkg, "r") as z:
                namelist = set(z.namelist())

                # Assert mandatory files
                self.assertIn("metadata.json", namelist)
                self.assertIn("contents/ui/main.qml", namelist)
                self.assertIn("contents/code/layouts.js", namelist)
                self.assertIn("contents/code/rules.js", namelist)
                self.assertIn("contents/code/reconciler.js", namelist)

                # Assert pruned files are absent
                self.assertNotIn("contents/code/main.js", namelist)
                self.assertNotIn("contents/ui/tessera.qml", namelist)
                self.assertNotIn("contents/ui/ZoneOverlay.qml", namelist)
                self.assertNotIn("contents/ui/TopNotification.qml", namelist)

                # Assert daemon, target, and rust sources are absent
                self.assertFalse(any(p.startswith("apps/") for p in namelist), "Daemon sources must not be in .kwinscript")
                self.assertFalse(any(p.startswith("target/") for p in namelist), "Target build artifacts must not be in .kwinscript")
                self.assertFalse(any(p.endswith(".rs") for p in namelist), "Rust sources must not be in .kwinscript")
                self.assertNotIn("Cargo.toml", namelist)
                self.assertNotIn("Cargo.lock", namelist)

if __name__ == "__main__":
    unittest.main()

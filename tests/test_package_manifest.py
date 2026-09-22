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
import re
import shutil
import hashlib
import tempfile
import zipfile
import subprocess

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
METADATA_PATH = os.path.join(PROJECT_ROOT, "metadata.json")
CONTENTS_DIR = os.path.join(PROJECT_ROOT, "contents")
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")
PACKAGE_SCRIPT = os.path.join(PROJECT_ROOT, "package.sh")

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

EXPECTED_11_ALLOWLIST = [
    "metadata.json",
    "contents/",
    "contents/code/",
    "contents/code/layouts.js",
    "contents/code/reconciler.js",
    "contents/code/rules.js",
    "contents/config/",
    "contents/config/main.xml",
    "contents/ui/",
    "contents/ui/config.ui",
    "contents/ui/main.qml",
]

SAFE_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")


def _get_derived_package_name(meta_path=METADATA_PATH):
    with open(meta_path, "r", encoding="utf-8") as f:
        meta = json.load(f)
    plugin_id = meta["KPlugin"]["Id"]
    plugin_version = meta["KPlugin"]["Version"]
    return f"{plugin_id}-v{plugin_version}.kwinscript"


def _snapshot_directory(path):
    if not os.path.exists(path):
        return None
    snapshot = {}
    for root, dirs, files in os.walk(path):
        dirs.sort()
        files.sort()
        for d in dirs:
            rel = os.path.relpath(os.path.join(root, d), path).replace(os.sep, "/") + "/"
            snapshot[rel] = ("dir", None, None)
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, path).replace(os.sep, "/")
            if os.path.islink(full):
                snapshot[rel] = ("symlink", os.readlink(full), os.lstat(full).st_mode)
            else:
                with open(full, "rb") as fp:
                    digest = hashlib.sha256(fp.read()).hexdigest()
                snapshot[rel] = ("file", digest, os.stat(full).st_mode)
    return snapshot


def _snapshot_source_inputs():
    targets = [
        METADATA_PATH,
        os.path.join(CONTENTS_DIR, "code", "layouts.js"),
        os.path.join(CONTENTS_DIR, "code", "reconciler.js"),
        os.path.join(CONTENTS_DIR, "code", "rules.js"),
        os.path.join(CONTENTS_DIR, "config", "main.xml"),
        os.path.join(CONTENTS_DIR, "ui", "config.ui"),
        os.path.join(CONTENTS_DIR, "ui", "main.qml"),
    ]
    snapshot = {}
    for path in targets:
        with open(path, "rb") as fp:
            snapshot[path] = hashlib.sha256(fp.read()).hexdigest()
    return snapshot


def _extract_zip_manifest(zip_path):
    with zipfile.ZipFile(zip_path, "r") as z:
        manifest = []
        for info in z.infolist():
            manifest.append((
                info.filename,
                info.is_dir(),
                info.CRC,
                info.file_size,
                info.compress_size,
                info.date_time,
                info.compress_type,
                info.flag_bits,
                info.external_attr,
                info.create_system,
                info.extra,
                info.comment,
            ))
        return manifest


def _create_disposable_source_copy(dest_dir, symlink_node_modules=True):
    for item in os.listdir(PROJECT_ROOT):
        if item in [".git", "dist", "node_modules", "target", "__pycache__"]:
            continue
        src_path = os.path.join(PROJECT_ROOT, item)
        dst_path = os.path.join(dest_dir, item)
        if os.path.isdir(src_path):
            shutil.copytree(src_path, dst_path, symlinks=True)
        else:
            shutil.copy2(src_path, dst_path)
    if symlink_node_modules:
        nm_src = os.path.join(PROJECT_ROOT, "node_modules")
        if os.path.exists(nm_src):
            os.symlink(nm_src, os.path.join(dest_dir, "node_modules"))


class TestPackageManifest(unittest.TestCase):
    def test_metadata_entrypoint(self):
        """Verifies metadata.json designates ui/main.qml and enforces safe metadata identity."""
        self.assertTrue(os.path.isfile(METADATA_PATH), f"Missing {METADATA_PATH}")
        with open(METADATA_PATH, "r", encoding="utf-8") as f:
            meta = json.load(f)

        self.assertIsInstance(meta, dict)
        self.assertIn("KPlugin", meta)
        self.assertIsInstance(meta["KPlugin"], dict)
        plugin_id = meta["KPlugin"].get("Id")
        plugin_version = meta["KPlugin"].get("Version")

        self.assertIsInstance(plugin_id, str)
        self.assertTrue(bool(SAFE_IDENTIFIER_RE.match(plugin_id)))
        self.assertNotIn("..", plugin_id)
        self.assertNotIn("/", plugin_id)
        self.assertNotIn("\\", plugin_id)
        self.assertEqual(plugin_id, "tessera")

        self.assertIsInstance(plugin_version, str)
        self.assertTrue(bool(SAFE_IDENTIFIER_RE.match(plugin_version)))
        self.assertNotIn("..", plugin_version)
        self.assertNotIn("/", plugin_version)
        self.assertNotIn("\\", plugin_version)

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

    def test_package_reproducibility_and_independent_outputs(self):
        """
        Builds the package into two separately created TemporaryDirectory output roots using the same epoch.
        Asserts both metadata-derived paths exist, hashes match, full entry manifests match,
        exact 11-entry allowlist in exact order, modes/types exact, unzip -t passes, and unzip -Z1 matches.
        """
        package_name = _get_derived_package_name()
        epoch = "1704067200"  # 2024-01-01 00:00:00 UTC

        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            out_pkg1 = os.path.join(tmp1, package_name)
            out_pkg2 = os.path.join(tmp2, package_name)

            build_env = dict(os.environ, SOURCE_DATE_EPOCH=epoch)
            res1 = subprocess.run([PACKAGE_SCRIPT, tmp1], cwd=PROJECT_ROOT, capture_output=True, text=True, env=build_env)
            self.assertEqual(res1.returncode, 0, f"Build 1 failed:\n{res1.stderr}\n{res1.stdout}")
            self.assertTrue(os.path.isfile(out_pkg1), f"Expected package not found: {out_pkg1}")

            with open(out_pkg1, "rb") as f:
                hash1 = hashlib.sha256(f.read()).hexdigest()
            manifest1 = _extract_zip_manifest(out_pkg1)

            res2 = subprocess.run([PACKAGE_SCRIPT, tmp2], cwd=PROJECT_ROOT, capture_output=True, text=True, env=build_env)
            self.assertEqual(res2.returncode, 0, f"Build 2 failed:\n{res2.stderr}\n{res2.stdout}")
            self.assertTrue(os.path.isfile(out_pkg2), f"Expected package not found: {out_pkg2}")

            with open(out_pkg2, "rb") as f:
                hash2 = hashlib.sha256(f.read()).hexdigest()
            manifest2 = _extract_zip_manifest(out_pkg2)

            self.assertEqual(hash1, hash2, f"Archive hashes differed: {hash1} vs {hash2}")
            self.assertEqual(manifest1, manifest2, "Full ZipInfo manifests differed across independent builds")

            # Validate exact 11-entry allowlist and order
            entry_names1 = [m[0] for m in manifest1]
            self.assertEqual(entry_names1, EXPECTED_11_ALLOWLIST, f"Entries differed from allowlist: {entry_names1}")

            # Validate modes and attributes
            for filename, is_dir, crc, file_size, comp_size, date_time, comp_type, flags, ext_attr, create_sys, extra, comment in manifest1:
                self.assertEqual(create_sys, 3, f"Entry {filename} create_system must be Unix (3)")
                self.assertEqual(date_time, (2024, 1, 1, 0, 0, 0), f"Entry {filename} timestamp mismatch")
                self.assertEqual(extra, b"", f"Entry {filename} has extra fields")
                self.assertEqual(comment, b"", f"Entry {filename} has comment")
                if is_dir:
                    self.assertEqual(comp_type, zipfile.ZIP_STORED, f"Directory {filename} must be STORED")
                    self.assertEqual(ext_attr >> 16, 0o40755, f"Directory {filename} mode must be 040755")
                    self.assertEqual(file_size, 0)
                else:
                    self.assertEqual(comp_type, zipfile.ZIP_DEFLATED, f"File {filename} must be DEFLATED")
                    self.assertEqual(ext_attr >> 16, 0o100644, f"File {filename} mode must be 0100644")

            # Run unzip -t on both artifacts
            for pkg in (out_pkg1, out_pkg2):
                unzip_t = subprocess.run(["unzip", "-t", pkg], capture_output=True, text=True)
                self.assertEqual(unzip_t.returncode, 0, f"unzip -t failed on {pkg}:\n{unzip_t.stderr}\n{unzip_t.stdout}")
                self.assertIn("No errors detected in compressed data", unzip_t.stdout)

            # Run unzip -Z1 on both artifacts
            for pkg in (out_pkg1, out_pkg2):
                unzip_z1 = subprocess.run(["unzip", "-Z1", pkg], capture_output=True, text=True)
                self.assertEqual(unzip_z1.returncode, 0, f"unzip -Z1 failed on {pkg}:\n{unzip_z1.stderr}")
                lines = [line.strip() for line in unzip_z1.stdout.strip().splitlines() if line.strip()]
                self.assertEqual(lines, EXPECTED_11_ALLOWLIST, f"unzip -Z1 output mismatch for {pkg}")

    def test_repository_non_mutation(self):
        """
        Verifies that package.sh builds do not mutate repository dist/, source files,
        or leave .kwinscript / temporary staging directories in the repo.
        """
        dist_before = _snapshot_directory(DIST_DIR)
        sources_before = _snapshot_source_inputs()

        with tempfile.TemporaryDirectory() as tmp_out:
            env = dict(os.environ, SOURCE_DATE_EPOCH="1704067200")
            res = subprocess.run([PACKAGE_SCRIPT, tmp_out], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env)
            self.assertEqual(res.returncode, 0, f"Build failed: {res.stderr}\n{res.stdout}")

        dist_after = _snapshot_directory(DIST_DIR)
        sources_after = _snapshot_source_inputs()

        self.assertEqual(dist_before, dist_after, "Repository dist/ directory was mutated during temporary packaging!")
        self.assertEqual(sources_before, sources_after, "Packaged source files were modified during packaging!")

        # Check for any stray .kwinscript or .tmp-* files in repo
        for root, dirs, files in os.walk(PROJECT_ROOT):
            if any(part in [".git", "node_modules"] for part in root.split(os.sep)):
                continue
            for f in files:
                if f.endswith(".kwinscript") and not root.startswith(DIST_DIR):
                    self.fail(f"Stray .kwinscript found in repo: {os.path.join(root, f)}")
                if f.startswith(".tmp-") and f.endswith(".kwinscript"):
                    self.fail(f"Stray temporary file found in repo: {os.path.join(root, f)}")
            for d in dirs:
                if d.startswith(".tmp-"):
                    self.fail(f"Stray temporary directory found in repo: {os.path.join(root, d)}")

    def test_epoch_granularity_and_different_epochs(self):
        """
        Verifies 2-second timestamp flooring for odd epochs, reproducibility for identical even epochs,
        and differing bytes/hashes for different epochs.
        """
        package_name = _get_derived_package_name()

        with tempfile.TemporaryDirectory() as tmp:
            # 1. Even epoch 1704067200 (2024-01-01 00:00:00 UTC)
            out_even1 = os.path.join(tmp, "even1")
            env_even = dict(os.environ, SOURCE_DATE_EPOCH="1704067200", TESSERA_SKIP_BUILD="1")
            res = subprocess.run([PACKAGE_SCRIPT, out_even1], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_even)
            self.assertEqual(res.returncode, 0, res.stderr)

            # 2. Odd epoch 1704067201 (2024-01-01 00:00:01 UTC) - must floor second to 00
            out_odd = os.path.join(tmp, "odd")
            env_odd = dict(os.environ, SOURCE_DATE_EPOCH="1704067201", TESSERA_SKIP_BUILD="1")
            res_odd = subprocess.run([PACKAGE_SCRIPT, out_odd], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_odd)
            self.assertEqual(res_odd.returncode, 0, res_odd.stderr)

            # 3. Different valid epoch 1735689600 (2025-01-01 00:00:00 UTC)
            out_diff = os.path.join(tmp, "diff")
            env_diff = dict(os.environ, SOURCE_DATE_EPOCH="1735689600", TESSERA_SKIP_BUILD="1")
            res_diff = subprocess.run([PACKAGE_SCRIPT, out_diff], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_diff)
            self.assertEqual(res_diff.returncode, 0, res_diff.stderr)

            with open(os.path.join(out_even1, package_name), "rb") as f:
                bytes_even1 = f.read()
            with open(os.path.join(out_odd, package_name), "rb") as f:
                bytes_odd = f.read()
            with open(os.path.join(out_diff, package_name), "rb") as f:
                bytes_diff = f.read()

            # Odd second floored to 00 must produce identical bytes to even second 00!
            self.assertEqual(hashlib.sha256(bytes_even1).hexdigest(), hashlib.sha256(bytes_odd).hexdigest(),
                             "Odd epoch was not floored to even second!")

            manifest_odd = _extract_zip_manifest(os.path.join(out_odd, package_name))
            self.assertTrue(all(m[5] == (2024, 1, 1, 0, 0, 0) for m in manifest_odd))

            # Different epoch must produce different timestamp and different hash
            manifest_diff = _extract_zip_manifest(os.path.join(out_diff, package_name))
            self.assertTrue(all(m[5] == (2025, 1, 1, 0, 0, 0) for m in manifest_diff))
            self.assertNotEqual(hashlib.sha256(bytes_even1).hexdigest(), hashlib.sha256(bytes_diff).hexdigest())

    def test_timezone_independence(self):
        """
        Verifies that package builds with identical SOURCE_DATE_EPOCH under different TZ values
        produce byte-for-byte identical archives with matching manifests and SHA-256 hashes.
        """
        package_name = _get_derived_package_name()

        with tempfile.TemporaryDirectory() as tmp_utc, tempfile.TemporaryDirectory() as tmp_tz2, tempfile.TemporaryDirectory() as tmp_tz3:
            env_utc = dict(os.environ, SOURCE_DATE_EPOCH="1704067200", TZ="UTC", TESSERA_SKIP_BUILD="1")
            res_utc = subprocess.run([PACKAGE_SCRIPT, tmp_utc], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_utc)
            self.assertEqual(res_utc.returncode, 0, res_utc.stderr)

            env_tz2 = dict(os.environ, SOURCE_DATE_EPOCH="1704067200", TZ="Asia/Tokyo", TESSERA_SKIP_BUILD="1")
            res_tz2 = subprocess.run([PACKAGE_SCRIPT, tmp_tz2], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_tz2)
            self.assertEqual(res_tz2.returncode, 0, res_tz2.stderr)

            env_tz3 = dict(os.environ, SOURCE_DATE_EPOCH="1704067200", TZ="America/New_York", TESSERA_SKIP_BUILD="1")
            res_tz3 = subprocess.run([PACKAGE_SCRIPT, tmp_tz3], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env_tz3)
            self.assertEqual(res_tz3.returncode, 0, res_tz3.stderr)

            with open(os.path.join(tmp_utc, package_name), "rb") as f:
                h_utc = hashlib.sha256(f.read()).hexdigest()
            with open(os.path.join(tmp_tz2, package_name), "rb") as f:
                h_tz2 = hashlib.sha256(f.read()).hexdigest()
            with open(os.path.join(tmp_tz3, package_name), "rb") as f:
                h_tz3 = hashlib.sha256(f.read()).hexdigest()

            self.assertEqual(h_utc, h_tz2, "Archive differed between UTC and Asia/Tokyo")
            self.assertEqual(h_utc, h_tz3, "Archive differed between UTC and America/New_York")

            m_utc = _extract_zip_manifest(os.path.join(tmp_utc, package_name))
            m_tz2 = _extract_zip_manifest(os.path.join(tmp_tz2, package_name))
            self.assertEqual(m_utc, m_tz2, "Entry manifests differed between timezones")

    def test_invalid_and_out_of_range_epochs(self):
        """
        Verifies rejection of non-integer, pre-1980, and post-2107 epochs with clean diagnostics and no archive.
        """
        invalid_epochs = [
            ("invalid-string", "SOURCE_DATE_EPOCH must be an integer"),
            ("12345.67", "SOURCE_DATE_EPOCH must be an integer"),
            ("", "SOURCE_DATE_EPOCH must be an integer"),
            ("0", "outside the ZIP timestamp range"),
            ("315532799", "outside the ZIP timestamp range"),
            ("-1000", "outside the ZIP timestamp range"),
            ("4354819200", "outside the ZIP timestamp range"),
            ("999999999999999999", "outside the ZIP timestamp range"),
        ]

        for epoch_val, expected_msg in invalid_epochs:
            with tempfile.TemporaryDirectory() as tmp:
                env = dict(os.environ, SOURCE_DATE_EPOCH=epoch_val, TESSERA_SKIP_BUILD="1")
                res = subprocess.run([PACKAGE_SCRIPT, tmp], cwd=PROJECT_ROOT, capture_output=True, text=True, env=env)
                self.assertNotEqual(res.returncode, 0, f"Expected nonzero returncode for epoch {epoch_val!r}")
                self.assertIn(expected_msg, res.stderr, f"Missing diagnostic {expected_msg!r} in:\n{res.stderr}")
                self.assertNotIn("Traceback", res.stderr, f"Unhandled traceback for epoch {epoch_val!r}:\n{res.stderr}")
                self.assertEqual(len(os.listdir(tmp)), 0, f"Archive was erroneously created for invalid epoch {epoch_val!r}")

    def test_disposable_source_missing_file_and_malformed_metadata(self):
        """
        Verifies that in disposable source copies, missing required runtime files and malformed or unsafe
        metadata fail nonzero with diagnostics and without producing an archive.
        """
        # Case 1: Missing required runtime file (contents/ui/main.qml)
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
            _create_disposable_source_copy(src, symlink_node_modules=False)
            os.unlink(os.path.join(src, "contents", "ui", "main.qml"))
            env = dict(os.environ, TESSERA_SKIP_BUILD="1")
            res = subprocess.run([os.path.join(src, "package.sh"), out], cwd=src, capture_output=True, text=True, env=env)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("Missing required file: contents/ui/main.qml", res.stderr)
            self.assertEqual(len(os.listdir(out)), 0)

        # Case 2: Missing metadata.json
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
            _create_disposable_source_copy(src, symlink_node_modules=False)
            os.unlink(os.path.join(src, "metadata.json"))
            env = dict(os.environ, TESSERA_SKIP_BUILD="1")
            res = subprocess.run([os.path.join(src, "package.sh"), out], cwd=src, capture_output=True, text=True, env=env)
            self.assertNotEqual(res.returncode, 0)
            self.assertIn("Missing metadata file", res.stderr)
            self.assertEqual(len(os.listdir(out)), 0)

        # Metadata failure matrix
        meta_cases = [
            ("bad-json", "{broken json", "Failed to parse metadata.json as JSON"),
            ("root-not-dict", "[]", "metadata.json root must be a JSON object"),
            ("missing-kplugin", json.dumps({"KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "KPlugin must be an object"),
            ("kplugin-not-dict", json.dumps({"KPlugin": "str", "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "KPlugin must be an object"),
            ("id-not-tessera", json.dumps({"KPlugin": {"Id": "other", "Version": "1.0.0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "KPlugin.Id must be 'tessera'"),
            ("id-path-traversal", json.dumps({"KPlugin": {"Id": "../tessera", "Version": "1.0.0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "Invalid or unsafe KPlugin.Id"),
            ("id-unsafe-slash", json.dumps({"KPlugin": {"Id": "tes/sera", "Version": "1.0.0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "Invalid or unsafe KPlugin.Id"),
            ("ver-path-traversal", json.dumps({"KPlugin": {"Id": "tessera", "Version": "../1.0.0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "Invalid or unsafe KPlugin.Version"),
            ("ver-unsafe-slash", json.dumps({"KPlugin": {"Id": "tessera", "Version": "1/0/0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "Invalid or unsafe KPlugin.Version"),
            ("ver-unsafe-whitespace", json.dumps({"KPlugin": {"Id": "tessera", "Version": "1.0.0 "}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "ui/main.qml"}), "Invalid or unsafe KPlugin.Version"),
            ("bad-structure", json.dumps({"KPlugin": {"Id": "tessera", "Version": "1.0.0"}, "KPackageStructure": "Plasma/Applet", "X-Plasma-MainScript": "ui/main.qml"}), "KPackageStructure must be 'KWin/Script'"),
            ("bad-mainscript", json.dumps({"KPlugin": {"Id": "tessera", "Version": "1.0.0"}, "KPackageStructure": "KWin/Script", "X-Plasma-MainScript": "code/main.js"}), "X-Plasma-MainScript must be 'ui/main.qml'"),
        ]

        for case_name, meta_content, expected_diagnostic in meta_cases:
            with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
                _create_disposable_source_copy(src, symlink_node_modules=False)
                with open(os.path.join(src, "metadata.json"), "w", encoding="utf-8") as fp:
                    fp.write(meta_content)
                env = dict(os.environ, TESSERA_SKIP_BUILD="1")
                res = subprocess.run([os.path.join(src, "package.sh"), out], cwd=src, capture_output=True, text=True, env=env)
                self.assertNotEqual(res.returncode, 0, f"Case {case_name} succeeded unexpectedly")
                self.assertIn(expected_diagnostic, res.stderr, f"Case {case_name} missing diagnostic {expected_diagnostic!r}")
                self.assertEqual(len(os.listdir(out)), 0, f"Case {case_name} created archive in output dir")

    def test_disposable_source_decoy_isolation(self):
        """
        Verifies that representative decoys (pyc, cache, log, local config, nested js, source ZIP)
        injected under contents in a disposable source copy are completely ignored,
        and the resulting archive contains exactly and only the 11 allowlisted entries.
        """
        with tempfile.TemporaryDirectory() as src, tempfile.TemporaryDirectory() as out:
            _create_disposable_source_copy(src, symlink_node_modules=True)

            # Inject decoys under contents
            os.makedirs(os.path.join(src, "contents", "ui", "__pycache__"), exist_ok=True)
            with open(os.path.join(src, "contents", "ui", "__pycache__", "decoy.cpython-310.pyc"), "wb") as f:
                f.write(b"\x00\x00\x00\x00")
            with open(os.path.join(src, "contents", "code", ".cache_dummy"), "w") as f:
                f.write("dummy cache")
            with open(os.path.join(src, "contents", "build.log"), "w") as f:
                f.write("build log output")
            with open(os.path.join(src, "contents", "config", "local_override.conf"), "w") as f:
                f.write("local override")
            os.makedirs(os.path.join(src, "contents", "code", "nested"), exist_ok=True)
            with open(os.path.join(src, "contents", "code", "nested", "deep.js"), "w") as f:
                f.write("console.log('decoy');")
            with open(os.path.join(src, "contents", "source_backup.zip"), "wb") as f:
                f.write(b"PK\x05\x06" + b"\x00" * 18)
            with open(os.path.join(src, "contents", ".DS_Store"), "wb") as f:
                f.write(b"DS_Store_data")

            env = dict(os.environ, SOURCE_DATE_EPOCH="1704067200")
            res = subprocess.run([os.path.join(src, "package.sh"), out], cwd=src, capture_output=True, text=True, env=env)
            self.assertEqual(res.returncode, 0, f"Build in disposable copy failed:\n{res.stderr}\n{res.stdout}")

            package_name = _get_derived_package_name(os.path.join(src, "metadata.json"))
            pkg_path = os.path.join(out, package_name)
            self.assertTrue(os.path.isfile(pkg_path))

            manifest = _extract_zip_manifest(pkg_path)
            entry_names = [m[0] for m in manifest]
            self.assertEqual(entry_names, EXPECTED_11_ALLOWLIST, f"Decoys leaked into archive: {entry_names}")

            # Verify archive integrity with unzip -t
            unzip_t = subprocess.run(["unzip", "-t", pkg_path], capture_output=True, text=True)
            self.assertEqual(unzip_t.returncode, 0, unzip_t.stderr)

    def test_install_script_safety(self):
        """Verifies install.sh contains shortcut preservation, atomic staging, and no master HUD shortcut."""
        install_sh = os.path.join(PROJECT_ROOT, "install.sh")
        with open(install_sh, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("mktemp -d", content)
        self.assertIn("rollback_install", content)
        self.assertIn("XDG_DATA_HOME", content)
        self.assertIn("XDG_BIN_HOME", content)
        self.assertIn("import PyQt5", content)
        self.assertIn("config/shortcuts.json", content)
        self.assertIn("--default \"$MISSING_VALUE\"", content)
        self.assertNotIn("Increase Master Ratio\"]", content)

    def test_uninstall_script_safety(self):
        """Verifies uninstall.sh supports --purge flag and removes stable control dir."""
        uninstall_sh = os.path.join(PROJECT_ROOT, "uninstall.sh")
        with open(uninstall_sh, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("--purge", content)
        self.assertIn("XDG_DATA_HOME", content)
        self.assertIn("kglobalshortcutsrc", content)

if __name__ == "__main__":
    unittest.main()

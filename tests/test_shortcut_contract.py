import json
import os
import re
import sys
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def load_shortcut_catalog(path=None):
    if path is None:
        path = os.path.join(REPO_ROOT, "config", "shortcuts.json")
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return [(item["label"], item["sequence"]) for item in data.get("shortcuts", [])]


class TestShortcutContract(unittest.TestCase):
    def setUp(self):
        catalog_path = os.path.join(REPO_ROOT, "config", "shortcuts.json")
        with open(catalog_path, "r", encoding="utf-8") as handle:
            self.document = json.load(handle)

    def test_shortcut_catalog_schema_exact(self):
        """11. Validate shortcut catalog schema exactly:
        - exact top-level keys ('version', 'shortcuts', 'legacyNames')
        - version 1
        - each active entry has exactly name/sequence/label with nonempty strings and no control characters
        - names and default sequences are unique
        - legacy names are unique and disjoint from active names
        - no active name/label contains legacy Master terminology."""
        self.assertEqual(set(self.document.keys()), {"version", "shortcuts", "legacyNames"})
        self.assertEqual(self.document.get("version"), 1)
        self.assertIn("shortcuts", self.document)
        self.assertIsInstance(self.document["shortcuts"], list)

        active_names = []
        active_sequences = []

        for idx, item in enumerate(self.document["shortcuts"]):
            self.assertEqual(
                set(item.keys()),
                {"name", "label", "sequence"},
                f"Entry {idx} must have exactly keys ('name', 'label', 'sequence')"
            )
            for field in ("name", "label", "sequence"):
                val = item[field]
                self.assertIsInstance(val, str, f"Entry {idx} {field} must be string")
                self.assertTrue(bool(val.strip()), f"Entry {idx} {field} must be nonempty")
                self.assertFalse(
                    any(ord(c) < 32 or c in "\t\r\n" for c in val),
                    f"Entry {idx} {field} must not contain control characters"
                )

            name = item["name"]
            label = item["label"]
            seq = item["sequence"]

            self.assertNotIn(name, active_names, f"Duplicate active shortcut name: {name}")
            self.assertNotIn(seq, active_sequences, f"Duplicate active default sequence: {seq}")

            active_names.append(name)
            active_sequences.append(seq)

            self.assertNotIn("master", name.lower(), f"Active shortcut name '{name}' must not contain Master terminology")
            self.assertNotIn("master", label.lower(), f"Active shortcut label '{label}' must not contain Master terminology")

        self.assertIn("legacyNames", self.document)
        self.assertIsInstance(self.document["legacyNames"], list)
        legacy_names = self.document["legacyNames"]
        self.assertEqual(len(legacy_names), len(set(legacy_names)), "Legacy names must be unique")

        for lname in legacy_names:
            self.assertIsInstance(lname, str)
            self.assertTrue(bool(lname.strip()))
            self.assertFalse(any(ord(c) < 32 or c in "\t\r\n" for c in lname))

        self.assertTrue(
            set(legacy_names).isdisjoint(set(active_names)),
            "Legacy shortcut names must be disjoint from active names"
        )

    def test_exact_ordered_parity_qml_shortcut_handler(self):
        """12. Assert exact ordered (name, label, sequence) parity with QML ShortcutHandler name/text/sequence."""
        with open(os.path.join(REPO_ROOT, "contents", "ui", "main.qml"), "r", encoding="utf-8") as handle:
            qml = handle.read()

        expected = [(item["name"], item["label"], item["sequence"]) for item in self.document["shortcuts"]]
        actual = re.findall(
            r'ShortcutHandler\s*\{\s*name:\s*"([^"]+)"\s*text:\s*"([^"]+)"\s*sequence:\s*"([^"]+)"',
            qml,
            re.MULTILINE,
        )

        self.assertEqual(len(actual), len(expected))
        self.assertEqual(actual, expected)

    def test_exact_ordered_parity_catalog_loader(self):
        """12. Assert exact shortcut catalog label/sequence loading."""
        expected = [(item["label"], item["sequence"]) for item in self.document["shortcuts"]]
        actual = load_shortcut_catalog()
        self.assertEqual(actual, expected)

    def test_exact_ordered_parity_uninstall_fallback_catalog(self):
        """12. Assert exact ordered parity with uninstall.sh fallback shortcut list."""
        with open(os.path.join(REPO_ROOT, "uninstall.sh"), "r", encoding="utf-8") as handle:
            uninstall_sh = handle.read()

        match = re.search(r'declare -a SHORTCUT_NAMES=\(\s*([^)]+)\s*\)', uninstall_sh, re.MULTILINE)
        self.assertIsNotNone(match, "uninstall.sh must define fallback SHORTCUT_NAMES array")
        lines = [line.strip().strip('"') for line in match.group(1).splitlines() if line.strip() and not line.strip().startswith("#")]

        expected = [item["name"] for item in self.document["shortcuts"]] + self.document["legacyNames"]
        self.assertEqual(lines, expected)

    def test_exact_ordered_parity_readme_table(self):
        """12. Assert exact ordered parity with README action/default table."""
        with open(os.path.join(REPO_ROOT, "README.md"), "r", encoding="utf-8") as handle:
            readme = handle.read()

        table_rows = re.findall(r"^\| (Tessera: [^|]+?) \| ([^|]+?) \|$", readme, re.MULTILINE)
        expected = [(item["name"], item["sequence"]) for item in self.document["shortcuts"]]
        self.assertEqual(table_rows, expected)
        self.assertIn("config/shortcuts.json` is the canonical catalog", readme)

    def test_headless_import_and_load_without_pyqt(self):
        """Proves shortcut contract logic and catalog loading execute with PyQt5 blocked."""
        saved_modules = {
            k: sys.modules.get(k)
            for k in list(sys.modules.keys())
            if k.startswith("PyQt5")
        }
        try:
            for k in list(saved_modules.keys()):
                sys.modules.pop(k, None)

            class BlockedImportFinder:
                def find_spec(self, fullname, path, target=None):
                    if fullname == "PyQt5" or fullname.startswith("PyQt5."):
                        raise ModuleNotFoundError(f"PyQt5 blocked for headless test: {fullname}")
                    return None

            finder = BlockedImportFinder()
            sys.meta_path.insert(0, finder)
            try:
                catalog = load_shortcut_catalog()
                self.assertIsInstance(catalog, list)
                self.assertGreater(len(catalog), 0)
                expected = [(item["label"], item["sequence"]) for item in self.document["shortcuts"]]
                self.assertEqual(catalog, expected)
                self.assertFalse(any(k.startswith("PyQt5") for k in sys.modules))
            finally:
                sys.meta_path.remove(finder)
        finally:
            for k, v in saved_modules.items():
                if v is not None:
                    sys.modules[k] = v
                else:
                    sys.modules.pop(k, None)


if __name__ == "__main__":
    unittest.main()

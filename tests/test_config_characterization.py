import unittest
import os
import xml.etree.ElementTree as ET

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

class TestConfigCharacterization(unittest.TestCase):
    """
    Phase 5D characterization tests capturing configuration drift,
    unsupported keys, missing distribution binaries, and legacy command semantics.
    """

    def setUp(self):
        self.main_xml_path = os.path.join(REPO_ROOT, "contents/config/main.xml")
        self.config_ui_path = os.path.join(REPO_ROOT, "contents/ui/config.ui")
        self.settings_py_path = os.path.join(REPO_ROOT, "tessera-control/tessera_settings.py")
        self.package_sh_path = os.path.join(REPO_ROOT, "package.sh")
        self.drift_matrix_path = os.path.join(REPO_ROOT, "docs/BASELINE_SETTINGS_DRIFT_MATRIX.md")

    def test_distribution_mismatch_control_center(self):
        """
        Characterizes that config.ui references 'tessera-settings', while the packaged KWin script
        (.kwinscript) contains only metadata.json and contents/, omitting
        the standalone Python control center and desktop integration files.
        """
        with open(self.config_ui_path, "r", encoding="utf-8") as f:
            ui_content = f.read()
        self.assertIn("tessera-settings", ui_content)

        with open(self.package_sh_path, "r", encoding="utf-8") as f:
            pkg_script = f.read()

        # The packaging script packages only metadata.json and contents/
        self.assertIn("metadata.json", pkg_script)
        self.assertIn("contents/", pkg_script)
        self.assertNotIn("tessera-control", pkg_script)
        self.assertNotIn("desktop/", pkg_script)

    def test_baseline_drift_matrix_documented(self):
        """
        Verifies that docs/BASELINE_SETTINGS_DRIFT_MATRIX.md documents the baseline omissions
        and fictitious keys.
        """
        self.assertTrue(os.path.exists(self.drift_matrix_path))
        with open(self.drift_matrix_path, "r", encoding="utf-8") as f:
            doc = f.read()
        self.assertIn("perDesktopLayout", doc)
        self.assertIn("tileNewWindows", doc)
        self.assertIn("ignoreMinimized", doc)
        self.assertIn("animationMode", doc)
        self.assertIn("overlayPollingMs", doc)

    def test_canonical_contract_resolves_omissions(self):
        """
        Verifies that the canonical contract and main.xml resolve the baseline omissions.
        """
        tree = ET.parse(self.main_xml_path)
        root = tree.getroot()
        main_xml_keys = {
            entry.attrib.get("name")
            for entry in root.iter()
            if entry.tag.endswith("entry") and entry.attrib.get("name")
        }

        self.assertIn("perDesktopLayout", main_xml_keys)
        self.assertIn("tileNewWindows", main_xml_keys)
        self.assertIn("ignoreMinimized", main_xml_keys)
        self.assertIn("primaryRegionRatio", main_xml_keys)
        self.assertIn("primaryRegionCount", main_xml_keys)
        self.assertIn("reconcileDebounceMs", main_xml_keys)

        # Fictitious keys are excluded
        self.assertNotIn("animationMode", main_xml_keys)
        self.assertNotIn("animationDurationMs", main_xml_keys)
        self.assertNotIn("overlayPollingMs", main_xml_keys)

    def test_tessera_settings_hydration_does_not_trigger_autosave(self):
        """
        Verifies that rebuilt tessera_settings has eliminated the auto_sync_timer storm,
        so that loading settings does not write to disk.
        """
        with open(self.settings_py_path, "r", encoding="utf-8") as f:
            code = f.read()

        self.assertNotIn("auto_sync_timer", code)

    def test_retile_now_does_not_invoke_save_and_apply(self):
        """
        Verifies that 'Retile Now' invokes command runner directly without mutating
        or persisting draft changes.
        """
        with open(self.settings_py_path, "r", encoding="utf-8") as f:
            code = f.read()

        retile_idx = code.find("def retile_kwin(self):")
        self.assertNotEqual(retile_idx, -1)
        retile_body = code[retile_idx:retile_idx+300]
        self.assertNotIn("save_and_apply", retile_body)
        self.assertIn("retile_now", retile_body)

if __name__ == "__main__":
    unittest.main()

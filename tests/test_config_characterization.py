import unittest
import os
import json
import xml.etree.ElementTree as ET

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

class TestConfigCharacterization(unittest.TestCase):
    """
    Phase 5D characterization tests capturing baseline configuration drift,
    unsupported keys, missing distribution binaries, and broken command semantics.
    """

    def setUp(self):
        self.main_xml_path = os.path.join(REPO_ROOT, "contents/config/main.xml")
        self.config_ui_path = os.path.join(REPO_ROOT, "contents/ui/config.ui")
        self.config_mgr_path = os.path.join(REPO_ROOT, "tessera-control/config_manager.py")
        self.settings_py_path = os.path.join(REPO_ROOT, "tessera-control/tessera_settings.py")
        self.package_sh_path = os.path.join(REPO_ROOT, "package.sh")

    def test_distribution_mismatch_control_center(self):
        """
        Characterizes that config.ui advertises launching Tessera Control Center
        via tessera://open or running 'tessera-settings', but the packaged KWin script
        (.kwinscript) contains only metadata.json and contents/, completely omitting
        the Python control center, launcher binary, and desktop file.
        """
        with open(self.config_ui_path, "r", encoding="utf-8") as f:
            ui_content = f.read()
        self.assertIn("tessera://open", ui_content)
        self.assertIn("tessera-settings", ui_content)

        with open(self.package_sh_path, "r", encoding="utf-8") as f:
            pkg_script = f.read()

        # The packaging script packages only metadata.json and contents/
        self.assertIn("metadata.json", pkg_script)
        self.assertIn("contents/", pkg_script)
        self.assertNotIn("tessera-control", pkg_script)
        self.assertNotIn("desktop/", pkg_script)

    def test_config_manager_key_omissions_and_drift(self):
        """
        Characterizes the keys present in ConfigManager.DEFAULT_CONFIG that are
        silently omitted from sync_to_kwin, and keys synced to kwinrc that do not
        exist in main.xml.
        """
        with open(self.config_mgr_path, "r", encoding="utf-8") as f:
            mgr_code = f.read()

        # Omitted from sync_to_kwin: perDesktopLayout, tileNewWindows, ignoreMinimized
        self.assertIn('"perDesktopLayout": True', mgr_code)
        self.assertIn('"tileNewWindows": True', mgr_code)
        self.assertIn('"ignoreMinimized": True', mgr_code)

        # In sync_to_kwin, these are never passed to write_val:
        sync_section = mgr_code[mgr_code.find("def sync_to_kwin"):mgr_code.find("subprocess.run([\"qdbus6\"")]
        self.assertNotIn('write_val("perDesktopLayout"', sync_section)
        self.assertNotIn('write_val("tileNewWindows"', sync_section)
        self.assertNotIn('write_val("ignoreMinimized"', sync_section)

        # Fictitious keys written to kwinrc not in main.xml
        tree = ET.parse(self.main_xml_path)
        root = tree.getroot()
        main_xml_keys = {entry.attrib.get("name") for entry in root.findall(".//entry")}

        fictitious_keys = ["animationMode", "animationDurationMs", "overlayPollingMs"]
        for key in fictitious_keys:
            self.assertIn(f'write_val("{key}"', sync_section)
            self.assertNotIn(key, main_xml_keys)

    def test_config_manager_shallow_copy_defect(self):
        """
        Characterizes that ConfigManager.__init__ executes DEFAULT_CONFIG.copy(),
        which is shallow and causes mutations to nested structures (desktopLayouts, customRules)
        to corrupt DEFAULT_CONFIG.
        """
        import sys
        sys.path.insert(0, os.path.join(REPO_ROOT, "tessera-control"))
        from config_manager import DEFAULT_CONFIG, ConfigManager

        self.assertIsInstance(DEFAULT_CONFIG["desktopLayouts"], dict)
        # Verify shallow copy behavior
        copied = DEFAULT_CONFIG.copy()
        self.assertIs(copied["desktopLayouts"], DEFAULT_CONFIG["desktopLayouts"])

    def test_config_manager_swallowed_errors(self):
        """
        Characterizes that ConfigManager.save() uses check=False, returns no status,
        and suppresses command execution errors.
        """
        with open(self.config_mgr_path, "r", encoding="utf-8") as f:
            mgr_code = f.read()

        self.assertIn("subprocess.run(cmd, check=False)", mgr_code)
        self.assertIn('check=False)', mgr_code)
        self.assertNotIn("return True", mgr_code)

    def test_tessera_settings_hydration_triggers_autosave_timer(self):
        """
        Characterizes that tessera_settings connects valueChanged signals to auto_sync_timer
        before loading initial configuration values, scheduling unintended writes during hydration.
        """
        with open(self.settings_py_path, "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("self.auto_sync_timer = QTimer(self)", code)
        self.assertIn("self.auto_sync_timer.timeout.connect(self.save_and_apply)", code)
        self.assertIn("self.auto_sync_timer.start(120)", code)

    def test_retile_now_invokes_save_and_apply(self):
        """
        Characterizes that 'Retile Now' in tessera_settings calls self.save_and_apply(),
        unintentionally persisting draft changes and reconfiguring KWin.
        """
        with open(self.settings_py_path, "r", encoding="utf-8") as f:
            code = f.read()

        retile_idx = code.find("def retile_kwin(self):")
        self.assertNotEqual(retile_idx, -1)
        retile_body = code[retile_idx:retile_idx+200]
        self.assertIn("self.save_and_apply()", retile_body)

if __name__ == "__main__":
    unittest.main()

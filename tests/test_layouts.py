"""
Automated unit tests for Tessera Layout logic and configuration management.
"""

import unittest
import json
import os
import sys
import tempfile
import shutil

# Add control center to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../tessera-control")))
import config_manager

class TestTessera(unittest.TestCase):
    def setUp(self):
        # Use an isolated temp directory for test config
        self.test_dir = tempfile.mkdtemp()
        self.original_config_file = config_manager.CONFIG_FILE
        config_manager.CONFIG_FILE = os.path.join(self.test_dir, "tesserarc")

    def tearDown(self):
        config_manager.CONFIG_FILE = self.original_config_file
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_config_defaults(self):
        cm = config_manager.ConfigManager()
        self.assertTrue(cm.config.get("enableTiling"))
        self.assertEqual(cm.config.get("defaultLayout"), "master-stack")
        self.assertGreaterEqual(cm.config.get("gapInner"), 0)
        self.assertGreaterEqual(cm.config.get("gapOuter"), 0)
        # Verify no user apps are auto-floated (tile everything period)
        float_filter = cm.config.get("floatFilter", "")
        self.assertNotIn("systemsettings", float_filter)
        self.assertNotIn("pavucontrol", float_filter)
        self.assertNotIn("kcalc", float_filter)

    def test_config_save_and_reload(self):
        cm = config_manager.ConfigManager()
        cm.config["gapOuter"] = 20
        cm.config["gapInner"] = 15
        cm.save()

        cm2 = config_manager.ConfigManager()
        self.assertEqual(cm2.config.get("gapOuter"), 20)
        self.assertEqual(cm2.config.get("gapInner"), 15)

    def test_manifest_structure(self):
        manifest_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../metadata.json"))
        with open(manifest_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        self.assertIn("KPlugin", meta)
        self.assertEqual(meta["KPlugin"]["Id"], "tessera")
        self.assertEqual(meta["X-Plasma-API"], "declarativescript")
        self.assertEqual(meta["X-Plasma-MainScript"], "ui/main.qml")

if __name__ == "__main__":
    unittest.main()

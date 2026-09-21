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

    def test_presets_apply(self):
        cm = config_manager.ConfigManager()
        presets = ["hyprland", "i3_classic", "amethyst", "ultrawide", "zero_gap"]
        for p in presets:
            res = cm.apply_preset(p)
            self.assertTrue(res, f"Preset {p} failed to apply")

    def test_manifest_structure(self):
        manifest_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../metadata.json"))
        with open(manifest_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        self.assertIn("KPlugin", meta)
        self.assertEqual(meta["KPlugin"]["Id"], "tessera")
        self.assertEqual(meta["X-Plasma-API"], "javascript")

if __name__ == "__main__":
    unittest.main()

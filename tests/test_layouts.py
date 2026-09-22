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
        from test_config_manager import MockCommandRunner
        runner = MockCommandRunner()
        cm = config_manager.ConfigManager(runner=runner, tesserarc_path=os.path.join(self.test_dir, "tesserarc"))
        self.assertTrue(cm.config.get("enableTiling"))
        self.assertEqual(cm.config.get("defaultLayout"), "balanced-grid")
        self.assertGreaterEqual(cm.config.get("gapInner"), 0)
        self.assertGreaterEqual(cm.config.get("gapOuter"), 0)

    def test_config_save_and_reload(self):
        from test_config_manager import MockCommandRunner
        runner = MockCommandRunner()
        cm = config_manager.ConfigManager(runner=runner, tesserarc_path=os.path.join(self.test_dir, "tesserarc"))
        cm.set_draft_value("gapOuter", 20)
        cm.set_draft_value("gapInner", 15)
        self.assertTrue(cm.apply()[0])

        cm2 = config_manager.ConfigManager(runner=runner, tesserarc_path=os.path.join(self.test_dir, "tesserarc"))
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

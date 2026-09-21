import unittest
import os
import sys
import json
import tempfile
from typing import Dict, List, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../tessera-control")))

from command_runner import CommandRunner, CommandResult, CommandError
from config_contract import (
    CANONICAL_PROPERTIES,
    load_canonical_defaults,
    normalize_and_validate_value
)
from presets import PRESETS, get_preset, get_preset_names
from config_manager import ConfigManager

class MockCommandRunner(CommandRunner):
    """Mock runner that stores kwinrc key-value pairs in an in-memory dictionary."""
    def __init__(self):
        super().__init__()
        self.store: Dict[str, str] = {}
        self.commands_executed: List[List[str]] = []
        self.fail_write_key: Optional[str] = None
        self.fail_readback_key: Optional[str] = None
        self.fail_reconfigure: bool = False

    def find_executable(self, name: str) -> Optional[str]:
        return f"/usr/bin/{name}"

    def run(self, cmd: List[str], check: bool = True) -> CommandResult:
        self.commands_executed.append(cmd)
        tool = cmd[0].split("/")[-1]

        if tool == "kreadconfig6":
            key = cmd[cmd.index("--key") + 1]
            if key == self.fail_readback_key:
                return CommandResult(0, "corrupted_value", "", cmd)
            val = self.store.get(key, "")
            return CommandResult(0, val, "", cmd)

        elif tool == "kwriteconfig6":
            key = cmd[cmd.index("--key") + 1]
            if key == self.fail_write_key:
                if check:
                    raise CommandError(f"Mock write failure for {key}")
                return CommandResult(1, "", f"Write failure for {key}", cmd)
            val = cmd[-1]
            self.store[key] = val
            return CommandResult(0, "", "", cmd)

        elif tool == "qdbus6":
            if "org.kde.KWin.reconfigure" in cmd:
                if self.fail_reconfigure:
                    return CommandResult(1, "", "Mock DBus reconfigure error", cmd)
                return CommandResult(0, "", "", cmd)
            if "invokeShortcut" in cmd:
                return CommandResult(0, "", "", cmd)

        return CommandResult(0, "", "", cmd)

class TestConfigManager(unittest.TestCase):
    def setUp(self):
        self.runner = MockCommandRunner()
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.tesserarc_path = os.path.join(self.tmp_dir.name, "tesserarc")

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_canonical_defaults_integrity(self):
        defaults = load_canonical_defaults()
        self.assertEqual(defaults["defaultLayout"], "balanced-grid")
        self.assertEqual(defaults["primaryRegionRatio"], 0.50)
        self.assertEqual(defaults["primaryRegionCount"], 1)
        self.assertEqual(defaults["gapInner"], 8)
        self.assertEqual(defaults["gapOuter"], 10)
        self.assertTrue(defaults["enableTiling"])
        self.assertTrue(defaults["perDesktopLayout"])
        self.assertTrue(defaults["tileNewWindows"])

    def test_hydration_performs_zero_writes(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        write_cmds = [c for c in self.runner.commands_executed if "kwriteconfig6" in c[0]]
        self.assertEqual(len(write_cmds), 0, "Hydration must perform zero writes to disk")
        self.assertFalse(mgr.is_dirty())

    def test_draft_session_and_dirty_tracking(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.assertFalse(mgr.is_dirty())

        # Modify draft
        ok, err = mgr.set_draft_value("gapInner", 14)
        self.assertTrue(ok)
        self.assertIsNone(err)
        self.assertTrue(mgr.is_dirty())
        self.assertIn("gapInner", mgr.get_dirty_keys())
        self.assertEqual(mgr.get_draft_value("gapInner"), 14)

        # Reset draft
        mgr.reset_draft()
        self.assertFalse(mgr.is_dirty())
        self.assertEqual(mgr.get_draft_value("gapInner"), 8)

    def test_restore_defaults_to_draft(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 20)
        mgr.set_draft_value("defaultLayout", "monocle")
        self.assertTrue(mgr.is_dirty())

        mgr.restore_defaults_to_draft()
        self.assertEqual(mgr.get_draft_value("gapInner"), 8)
        self.assertEqual(mgr.get_draft_value("defaultLayout"), "balanced-grid")

    def test_apply_transaction_success(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 12)
        mgr.set_draft_value("gapOuter", 16)

        ok, err = mgr.apply(retile=True)
        self.assertTrue(ok)
        self.assertIsNone(err)
        self.assertFalse(mgr.is_dirty())

        # Verify values in store
        self.assertEqual(self.runner.store.get("gapInner"), "12")
        self.assertEqual(self.runner.store.get("gapOuter"), "16")

        # Verify exactly one reconfigure and exactly one retile
        reconfigs = [c for c in self.runner.commands_executed if any("org.kde.KWin.reconfigure" in arg for arg in c)]
        retiles = [c for c in self.runner.commands_executed if any("invokeShortcut" in arg for arg in c)]
        self.assertEqual(len(reconfigs), 1, "Expected exactly 1 reconfigure call")
        self.assertEqual(len(retiles), 1, "Expected exactly 1 retile call")

    def test_apply_rollback_on_write_failure(self):
        self.runner.store["gapInner"] = "8"
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 14)

        # Trigger simulated write failure
        self.runner.fail_write_key = "gapInner"
        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Write failed", err)
        self.assertTrue(mgr.is_dirty())
        # Store should have been rolled back to original
        self.assertEqual(self.runner.store.get("gapInner"), "8")

    def test_apply_rollback_on_readback_mismatch(self):
        self.runner.store["gapInner"] = "8"
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 14)

        # Trigger simulated readback mismatch
        self.runner.fail_readback_key = "gapInner"
        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Readback verification mismatch", err)
        self.assertTrue(mgr.is_dirty())

    def test_retile_now_performs_zero_saves(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.runner.commands_executed.clear()

        ok, err = mgr.retile_now()
        self.assertTrue(ok)
        self.assertIsNone(err)

        writes = [c for c in self.runner.commands_executed if "kwriteconfig6" in c[0]]
        reconfigs = [c for c in self.runner.commands_executed if any("org.kde.KWin.reconfigure" in arg for arg in c)]
        retiles = [c for c in self.runner.commands_executed if any("invokeShortcut" in arg for arg in c)]

        self.assertEqual(len(writes), 0, "retile_now must perform 0 writes")
        self.assertEqual(len(reconfigs), 0, "retile_now must perform 0 reconfigures")
        self.assertEqual(len(retiles), 1, "retile_now must perform exactly 1 retile")

    def test_presets_catalog_and_application(self):
        names = get_preset_names()
        self.assertIn("Balanced", names)
        self.assertIn("Primary + Stack", names)
        self.assertIn("Columns", names)
        self.assertIn("Rows", names)
        self.assertIn("Focus", names)
        self.assertIn("Floating", names)

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        preset = get_preset("Primary + Stack")
        self.assertEqual(preset["defaultLayout"], "primary-stack")
        self.assertEqual(preset["primaryRegionRatio"], 0.55)

        mgr.apply_preset_to_draft(preset)
        self.assertTrue(mgr.is_dirty())
        self.assertEqual(mgr.get_draft_value("defaultLayout"), "primary-stack")
        self.assertEqual(mgr.get_draft_value("primaryRegionRatio"), 0.55)

    def test_one_time_migration_from_tesserarc(self):
        legacy_data = {
            "masterRatio": 0.65,
            "masterCount": 2,
            "defaultLayout": "master-stack",
            "nvidiaDebounceMs": 90,
            "unsupportedFictitiousKey": "foobar"
        }
        with open(self.tesserarc_path, "w", encoding="utf-8") as f:
            json.dump(legacy_data, f)

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)

        # Verify migrated keys in authoritative config
        self.assertEqual(mgr.authoritative_config["primaryRegionRatio"], 0.65)
        self.assertEqual(mgr.authoritative_config["primaryRegionCount"], 2)
        self.assertEqual(mgr.authoritative_config["defaultLayout"], "primary-stack")
        self.assertEqual(mgr.authoritative_config["reconcileDebounceMs"], 90)
        self.assertEqual(mgr.authoritative_config["configSchemaVersion"], 2)

        # Verify tesserarc was NOT deleted
        self.assertTrue(os.path.exists(self.tesserarc_path))

if __name__ == "__main__":
    unittest.main()

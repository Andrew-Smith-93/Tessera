import copy
import json
import os
import sys
import tempfile
import unittest
from typing import Dict, List, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../tessera-control")))

from command_runner import CommandRunner, CommandResult, CommandError
from config_contract import (
    CANONICAL_PROPERTIES,
    load_canonical_defaults,
    normalize_and_validate_value
)
from presets import PRESETS, get_preset, get_preset_names
from config_manager import ConfigManager, MISSING_VALUE_SENTINEL

class MockCommandRunner(CommandRunner):
    """Mock runner that stores kwinrc key-value pairs in an in-memory dictionary."""
    def __init__(self):
        super().__init__()
        self.store: Dict[str, str] = {}
        self.commands_executed: List[List[str]] = []
        self.fail_write_key: Optional[str] = None
        self.fail_readback_key: Optional[str] = None
        self.fail_reconfigure: bool = False
        self.raise_reconfigure: bool = False
        self.fail_retile: bool = False
        self.raise_retile: bool = False
        self.raise_tool: Optional[str] = None
        self.writes_occurred: int = 0
        self.event_log: List[Dict[str, Any]] = []

    def clear_logs(self) -> None:
        self.commands_executed.clear()
        self.event_log.clear()

    def find_executable(self, name: str) -> Optional[str]:
        return f"/usr/bin/{name}"

    def run(self, cmd: List[str], check: bool = True) -> CommandResult:
        self.commands_executed.append(cmd)
        tool = cmd[0].split("/")[-1]
        if tool == self.raise_tool:
            raise CommandError(f"Mock missing utility: {tool}")

        if tool == "kreadconfig6":
            key = cmd[cmd.index("--key") + 1]
            self.event_log.append({"action": "read", "key": key})
            if key == self.fail_readback_key and self.writes_occurred > 0:
                self.fail_readback_key = None
                return CommandResult(0, "corrupted_value", "", cmd)
            val = self.store.get(key, MISSING_VALUE_SENTINEL)
            return CommandResult(0, val, "", cmd)

        elif tool == "kwriteconfig6":
            key = cmd[cmd.index("--key") + 1]
            if "--delete" in cmd:
                self.event_log.append({"action": "delete", "key": key})
                self.store.pop(key, None)
                return CommandResult(0, "", "", cmd)
            self.event_log.append({"action": "write", "key": key})
            if key == self.fail_write_key:
                if check:
                    raise CommandError(f"Mock write failure for {key}")
                return CommandResult(1, "", f"Write failure for {key}", cmd)
            val = cmd[-1]
            self.store[key] = val
            self.writes_occurred += 1
            return CommandResult(0, "", "", cmd)

        elif tool == "qdbus6":
            if "org.kde.KWin.reconfigure" in cmd:
                self.event_log.append({"action": "reconfigure"})
                if self.raise_reconfigure:
                    raise CommandError("Mock DBus reconfigure exception")
                if self.fail_reconfigure:
                    return CommandResult(1, "", "Mock DBus reconfigure error", cmd)
                return CommandResult(0, "", "", cmd)
            if any("invokeShortcut" in arg for arg in cmd):
                self.event_log.append({"action": "retile"})
                if self.raise_retile:
                    raise CommandError("Mock retile exception")
                if self.fail_retile:
                    return CommandResult(1, "", "Mock retile error", cmd)
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

    def test_scalar_types_do_not_silently_coerce_invalid_values(self):
        self.assertFalse(normalize_and_validate_value("primaryRegionCount", 1.5)[0])
        self.assertFalse(normalize_and_validate_value("primaryRegionCount", True)[0])
        self.assertFalse(normalize_and_validate_value("enableTiling", 2)[0])
        self.assertFalse(normalize_and_validate_value("defaultLayout", None)[0])
        self.assertFalse(normalize_and_validate_value("primaryRegionRatio", float("nan"))[0])

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
        self.assertIn("configSchemaVersion", mgr.present_kwin_keys)
        self.assertEqual(mgr.last_kwin_snapshot_hash, mgr._compute_kwin_fingerprint())

    def test_migration_does_not_override_explicit_canonical_default(self):
        self.runner.store["primaryRegionCount"] = "1"
        with open(self.tesserarc_path, "w", encoding="utf-8") as f:
            json.dump({"masterCount": 7}, f)

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)

        self.assertEqual(mgr.authoritative_config["primaryRegionCount"], 1)
        self.assertEqual(self.runner.store["primaryRegionCount"], "1")

    def test_legacy_kwin_alias_is_loaded_and_blocks_file_migration(self):
        self.runner.store["desktopLayouts"] = '{"DP-1//1":{"layout":"columns"}}'
        with open(self.tesserarc_path, "w", encoding="utf-8") as f:
            json.dump({"desktopLayouts": {"DP-1//1": {"layout": "rows"}}}, f)

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)

        parsed = json.loads(mgr.authoritative_config["workspaceLayoutsJson"])
        self.assertEqual(parsed["scopes"]["DP-1//1"]["layout"], "columns")

    def test_failed_migration_rolls_back_all_written_keys(self):
        with open(self.tesserarc_path, "w", encoding="utf-8") as f:
            json.dump({"gapInner": 14, "gapOuter": 18}, f)
        self.runner.fail_write_key = "gapOuter"

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)

        self.assertNotIn("gapInner", self.runner.store)
        self.assertNotIn("gapOuter", self.runner.store)
        self.assertEqual(mgr.authoritative_config["gapInner"], 8)
        self.assertEqual(mgr.authoritative_config["gapOuter"], 10)

    def test_empty_string_is_present_and_part_of_concurrency_fingerprint(self):
        self.runner.store["floatFilter"] = ""
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.assertIn("floatFilter", mgr.present_kwin_keys)

        mgr.set_draft_value("gapInner", 12)
        self.runner.store["floatFilter"] = "changed"
        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Concurrency conflict", err)

    def test_legacy_alias_change_is_part_of_concurrency_fingerprint(self):
        self.runner.store["masterRatio"] = "0.5"
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 12)
        self.runner.store["masterRatio"] = "0.7"

        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Concurrency conflict", err)

    def test_retile_failure_is_reported_after_successful_persist(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 12)
        self.runner.fail_retile = True

        ok, err = mgr.apply(retile=True)

        self.assertFalse(ok)
        self.assertIn("Configuration was applied, but retile failed", err)
        self.assertEqual(mgr.authoritative_config["gapInner"], 12)
        self.assertFalse(mgr.is_dirty())

    def test_missing_qdbus_does_not_escape_apply(self):
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 12)
        self.runner.raise_tool = "qdbus6"

        ok, err = mgr.apply()

        self.assertFalse(ok)
        self.assertIn("KWin reconfigure failed", err)

    def test_apply_absence_preserving_rollback(self):
        # Key 'gapInner' was initially absent from store
        self.assertNotIn("gapInner", self.runner.store)
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 14)

        # Trigger readback failure so rollback occurs
        self.runner.fail_readback_key = "gapInner"
        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Readback verification mismatch", err)

        # Key should NOT remain in store with a default; it should be deleted to preserve absence
        self.assertNotIn("gapInner", self.runner.store)
        deleted_keys = [c[c.index("--key") + 1] for c in self.runner.commands_executed if "kwriteconfig6" in c[0] and "--delete" in c]
        self.assertIn("gapInner", deleted_keys)

    def test_apply_concurrency_conflict_detection(self):
        self.runner.store["gapInner"] = "8"
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        mgr.set_draft_value("gapInner", 12)

        # Simulate concurrent modification by external actor
        self.runner.store["gapInner"] = "14"

        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Concurrency conflict", err)

    def test_bounded_workspace_layouts_json_validation(self):
        # Valid JSON layout spec
        valid_json = json.dumps({
            "DP-1//1": {
                "layout": "primary-stack",
                "ratio": 0.60,
                "primaryCount": 2
            }
        })
        ok, norm, err = normalize_and_validate_value("workspaceLayoutsJson", valid_json)
        self.assertTrue(ok)
        self.assertIsNone(err)
        self.assertEqual(norm, '{"version":1,"scopes":{"DP-1//1":{"layout":"primary-stack","ratio":0.6,"primaryCount":2}}}')

        # Legacy layout alias migration within scope data
        legacy_scope_json = json.dumps({
            "DP-1//1": {
                "layout": "master-stack"
            }
        })
        ok, norm, err = normalize_and_validate_value("workspaceLayoutsJson", legacy_scope_json)
        self.assertTrue(ok)
        parsed = json.loads(norm)
        self.assertEqual(parsed["version"], 1)
        self.assertEqual(parsed["scopes"]["DP-1//1"]["layout"], "primary-stack")

        # Invalid ratio out of bounds
        invalid_ratio_json = json.dumps({
            "DP-1//1": {
                "layout": "primary-stack",
                "ratio": 0.95
            }
        })
        ok, norm, err = normalize_and_validate_value("workspaceLayoutsJson", invalid_ratio_json)
        self.assertFalse(ok)
        self.assertIn("out of bounds", err)

        # Non-dict JSON
        ok, norm, err = normalize_and_validate_value("workspaceLayoutsJson", "[\"not\", \"a\", \"dict\"]")
        self.assertFalse(ok)
        self.assertIn("must be a JSON object", err)

        invalid_documents = [
            ('{"version":2,"scopes":{}}', "Unsupported"),
            ('{"version":1,"scopes":{},"extra":true}', "unknown fields"),
            ('{"version":1,"scopes":{"__proto__//1":{}}}', "Unsafe"),
            ('{"version":1,"scopes":{"DP%ZZ//1":{}}}', "percent escape"),
            ('{"version":1,"scopes":{"DP-1//1":{"unknown":1}}}', "Unknown fields"),
            ('{"version":1,"scopes":{"DP-1//1":{"ratio":"0.5"}}}', "Invalid ratio"),
            ('{"version":1,"scopes":{"DP-1//1":{"primaryCount":1.0}}}', "Invalid primaryCount"),
            ('{"version":1,"scopes":{"DP-1//1":{},"DP-1//1":{}}}', "Duplicate JSON key"),
            ('{"version":1,"scopes":{"DP-1//1":{"ratio":NaN}}}', "Invalid numeric constant"),
        ]
        for document, message in invalid_documents:
            with self.subTest(document=document):
                ok, _norm, err = normalize_and_validate_value("workspaceLayoutsJson", document)
                self.assertFalse(ok)
                self.assertIn(message, err)

    # =========================================================================
    # WP3B: Transaction Ordering, Observable State, and Fault Injection Tests
    # =========================================================================

    def test_clean_apply_retile_false_and_true(self):
        """Case 1: Clean apply(retile=False) does zero writes/reconfigure/retile.
        Clean apply(retile=True) performs exactly one retile only."""
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.assertFalse(mgr.is_dirty())

        self.runner.clear_logs()
        ok, err = mgr.apply(retile=False)
        self.assertTrue(ok)
        self.assertIsNone(err)
        self.assertEqual(len(self.runner.commands_executed), 0)
        self.assertEqual(len(self.runner.event_log), 0)

        self.runner.clear_logs()
        ok, err = mgr.apply(retile=True)
        self.assertTrue(ok)
        self.assertIsNone(err)
        actions = [e["action"] for e in self.runner.event_log]
        self.assertEqual(actions, ["retile"])
        self.assertFalse(mgr.is_dirty())

    def test_full_success_with_multiple_dirty_keys(self):
        """Case 2: Full success with 2+ dirty keys of mixed presence:
        - Deterministic canonical dirty-key write order
        - All writes precede verification reads
        - Exactly one reconfigure after verified readback
        - Exactly zero or one retile according to flag, always after reconfigure
        - authoritative = draft; dirty = false
        - Newly written keys become present; fingerprint equals current store."""
        # Initial store: floatFilter present with empty string, gapInner present with 8,
        # primaryRegionCount absent from store.
        self.runner.store["floatFilter"] = ""
        self.runner.store["gapInner"] = "8"
        self.assertNotIn("primaryRegionCount", self.runner.store)

        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.assertIn("floatFilter", mgr.present_kwin_keys)
        self.assertIn("gapInner", mgr.present_kwin_keys)
        self.assertNotIn("primaryRegionCount", mgr.present_kwin_keys)

        # Dirty 3 keys: floatFilter (present empty string -> non-empty),
        # gapInner (present -> new value), primaryRegionCount (absent -> new value).
        mgr.set_draft_value("primaryRegionCount", 3)
        mgr.set_draft_value("gapInner", 14)
        mgr.set_draft_value("floatFilter", "kcalc")
        self.assertTrue(mgr.is_dirty())

        dirty_keys = mgr.get_dirty_keys()
        self.assertEqual(len(dirty_keys), 3)

        self.runner.clear_logs()
        ok, err = mgr.apply(retile=True)
        self.assertTrue(ok)
        self.assertIsNone(err)

        events = self.runner.event_log
        # Verify write order matches canonical dirty_keys order
        written_keys = [e["key"] for e in events if e["action"] == "write"]
        self.assertEqual(written_keys, dirty_keys)

        # All writes precede verification reads
        last_write_idx = max(i for i, e in enumerate(events) if e["action"] == "write")
        reconfig_indices = [i for i, e in enumerate(events) if e["action"] == "reconfigure"]
        self.assertEqual(len(reconfig_indices), 1)
        reconfig_idx = reconfig_indices[0]

        # Verification reads occur strictly between last write and reconfigure
        verification_reads = [
            i for i, e in enumerate(events)
            if e["action"] == "read" and last_write_idx < i < reconfig_idx
        ]
        self.assertEqual(len(verification_reads), len(dirty_keys))
        verified_keys = [events[i]["key"] for i in verification_reads]
        self.assertEqual(verified_keys, dirty_keys)
        self.assertTrue(reconfig_idx > max(verification_reads))

        # Exactly one retile, after reconfigure
        retile_indices = [i for i, e in enumerate(events) if e["action"] == "retile"]
        self.assertEqual(len(retile_indices), 1)
        self.assertTrue(retile_indices[0] > reconfig_indices[0])

        # State assertions
        self.assertEqual(mgr.authoritative_config, mgr.draft_config)
        self.assertFalse(mgr.is_dirty())
        self.assertTrue(set(dirty_keys).issubset(mgr.present_kwin_keys))
        self.assertEqual(mgr.last_kwin_snapshot_hash, mgr._compute_kwin_fingerprint())

    def test_concurrency_conflict_no_mutation(self):
        """Case 3: Concurrency conflict:
        Reads for fingerprint are allowed, but zero writes/reconfigure/retile;
        on-disk values/presence, authoritative, draft, present_kwin_keys,
        and last snapshot fingerprint remain unchanged; draft remains dirty."""
        self.runner.store["floatFilter"] = ""
        self.runner.store["gapInner"] = "8"
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)

        orig_store = dict(self.runner.store)
        orig_authoritative = copy.deepcopy(mgr.authoritative_config)
        orig_presence = set(mgr.present_kwin_keys)
        orig_fingerprint = mgr.last_kwin_snapshot_hash

        mgr.set_draft_value("gapInner", 16)
        mgr.set_draft_value("primaryRegionCount", 2)
        orig_draft = copy.deepcopy(mgr.draft_config)

        # Concurrent modification of an external key in store
        self.runner.store["showOsd"] = "false"
        orig_store_after_external = dict(self.runner.store)

        self.runner.clear_logs()
        ok, err = mgr.apply(retile=True)
        self.assertFalse(ok)
        self.assertIn("Concurrency conflict", err)

        # Zero writes, zero reconfig, zero retile
        actions = [e["action"] for e in self.runner.event_log]
        self.assertNotIn("write", actions)
        self.assertNotIn("delete", actions)
        self.assertNotIn("reconfigure", actions)
        self.assertNotIn("retile", actions)

        # Observable state unchanged
        self.assertEqual(self.runner.store, orig_store_after_external)
        self.assertEqual(mgr.authoritative_config, orig_authoritative)
        self.assertEqual(mgr.draft_config, orig_draft)
        self.assertEqual(mgr.present_kwin_keys, orig_presence)
        self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)
        self.assertTrue(mgr.is_dirty())

    def test_per_write_failure_at_every_position(self):
        """Case 4: Per-write failure at every dirty-key position, including first and later writes:
        - Error must name the actual attempted failing key
        - Rollback only successfully written keys, in reverse write order
        - Restore exact pre-transaction bytes/presence (delete previously absent, restore empty string)
        - Zero reconfigure/retile
        - In-memory state remains pre-apply; draft remains dirty."""
        test_positions = ["first", "second", "third"]
        for pos in test_positions:
            with self.subTest(failing_position=pos):
                runner = MockCommandRunner()
                runner.store["floatFilter"] = ""
                runner.store["gapInner"] = "8"
                runner.store.pop("primaryRegionCount", None)

                mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
                orig_authoritative = copy.deepcopy(mgr.authoritative_config)
                orig_presence = set(mgr.present_kwin_keys)
                orig_fingerprint = mgr.last_kwin_snapshot_hash
                orig_store = dict(runner.store)

                mgr.set_draft_value("gapInner", 14)
                mgr.set_draft_value("primaryRegionCount", 3)
                mgr.set_draft_value("floatFilter", "krunner")
                orig_draft = copy.deepcopy(mgr.draft_config)

                dirty_keys = mgr.get_dirty_keys()
                # dirty_keys order is deterministic canonical: ['gapInner', 'primaryRegionCount', 'floatFilter']
                if pos == "first":
                    fail_key = dirty_keys[0]
                elif pos == "second":
                    fail_key = dirty_keys[1]
                else:
                    fail_key = dirty_keys[2]

                runner.fail_write_key = fail_key
                runner.clear_logs()

                ok, err = mgr.apply(retile=True)
                self.assertFalse(ok)
                # Error must name the actual attempted failing key
                self.assertIn(f"Write failed for key '{fail_key}'", err)

                # Zero reconfigure, zero retile
                actions = [e["action"] for e in runner.event_log]
                self.assertNotIn("reconfigure", actions)
                self.assertNotIn("retile", actions)

                # Rollback must restore exact pre-transaction store and presence
                self.assertEqual(runner.store, orig_store)
                self.assertEqual(runner.store["floatFilter"], "")  # Empty string preserved
                self.assertNotIn("primaryRegionCount", runner.store)  # Absent key restored to absent

                # Verify rollback occurred in reverse write order
                fail_idx = dirty_keys.index(fail_key)
                keys_written_before_fail = dirty_keys[:fail_idx]
                expected_rollback_order = list(reversed(keys_written_before_fail))

                # Find the index of the write attempt that failed
                fail_event_idx = [i for i, e in enumerate(runner.event_log) if e.get("key") == fail_key and e["action"] == "write"][0]
                rollback_events = [e for e in runner.event_log[fail_event_idx + 1:] if e["action"] in ("write", "delete")]
                actual_rollback_keys = [e["key"] for e in rollback_events]
                self.assertEqual(actual_rollback_keys, expected_rollback_order)

                # In-memory state unchanged and dirty
                self.assertEqual(mgr.authoritative_config, orig_authoritative)
                self.assertEqual(mgr.draft_config, orig_draft)
                self.assertEqual(mgr.present_kwin_keys, orig_presence)
                self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)
                self.assertEqual(mgr._compute_kwin_fingerprint(), mgr.last_kwin_snapshot_hash)
                self.assertTrue(mgr.is_dirty())

    def test_readback_mismatch_at_every_position(self):
        """Case 5: Readback mismatch at every dirty-key position:
        - Mismatch causes reverse-order rollback of all successfully written dirty keys
        - Exact prior bytes/presence restored
        - Zero reconfigure/retile
        - In-memory authoritative/presence/fingerprint unchanged and draft dirty."""
        for fail_idx in (0, 1):
            with self.subTest(readback_fail_index=fail_idx):
                runner = MockCommandRunner()
                runner.store["floatFilter"] = ""
                runner.store.pop("primaryRegionCount", None)

                mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
                orig_authoritative = copy.deepcopy(mgr.authoritative_config)
                orig_presence = set(mgr.present_kwin_keys)
                orig_fingerprint = mgr.last_kwin_snapshot_hash
                orig_store = dict(runner.store)

                mgr.set_draft_value("primaryRegionCount", 2)
                mgr.set_draft_value("floatFilter", "alacritty")
                orig_draft = copy.deepcopy(mgr.draft_config)

                dirty_keys = mgr.get_dirty_keys()
                fail_key = dirty_keys[fail_idx]
                runner.fail_readback_key = fail_key

                runner.clear_logs()
                ok, err = mgr.apply(retile=True)
                self.assertFalse(ok)
                self.assertIn(f"Readback verification mismatch for key '{fail_key}'", err)

                actions = [e["action"] for e in runner.event_log]
                self.assertNotIn("reconfigure", actions)
                self.assertNotIn("retile", actions)

                # Find the index of the readback verification failure event (after forward writes start)
                first_write_idx = min(i for i, e in enumerate(runner.event_log) if e["action"] == "write")
                fail_read_idx = [i for i, e in enumerate(runner.event_log) if i > first_write_idx and e.get("key") == fail_key and e["action"] == "read"][0]
                # Rollback occurs after the failed readback
                rollback_events = [e for e in runner.event_log[fail_read_idx + 1:] if e["action"] in ("write", "delete")]
                actual_rollback_keys = [e["key"] for e in rollback_events]
                self.assertEqual(actual_rollback_keys, list(reversed(dirty_keys)))

                # Disk and presence restored
                self.assertEqual(runner.store, orig_store)
                self.assertEqual(runner.store["floatFilter"], "")
                self.assertNotIn("primaryRegionCount", runner.store)

                # In-memory unchanged
                self.assertEqual(mgr.authoritative_config, orig_authoritative)
                self.assertEqual(mgr.draft_config, orig_draft)
                self.assertEqual(mgr.present_kwin_keys, orig_presence)
                self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)
                self.assertEqual(mgr._compute_kwin_fingerprint(), mgr.last_kwin_snapshot_hash)
                self.assertTrue(mgr.is_dirty())

    def test_reconfigure_failure_by_nonzero_result_and_exception(self):
        """Case 6: Reconfigure failure by nonzero result and raised CommandError:
        - Exactly one reconfigure attempt, then reverse-order rollback
        - Zero retile
        - Exact disk/presence restoration
        - In-memory authoritative/presence/fingerprint unchanged and draft dirty."""
        for mode in ("nonzero", "exception"):
            with self.subTest(reconfigure_failure_mode=mode):
                runner = MockCommandRunner()
                runner.store["floatFilter"] = ""
                runner.store.pop("gapInner", None)

                mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
                orig_authoritative = copy.deepcopy(mgr.authoritative_config)
                orig_presence = set(mgr.present_kwin_keys)
                orig_fingerprint = mgr.last_kwin_snapshot_hash
                orig_store = dict(runner.store)

                mgr.set_draft_value("gapInner", 15)
                mgr.set_draft_value("floatFilter", "foot")
                orig_draft = copy.deepcopy(mgr.draft_config)
                dirty_keys = mgr.get_dirty_keys()

                if mode == "nonzero":
                    runner.fail_reconfigure = True
                else:
                    runner.raise_reconfigure = True

                runner.clear_logs()
                ok, err = mgr.apply(retile=True)
                self.assertFalse(ok)
                self.assertIn("KWin reconfigure failed", err)

                # Exactly one reconfigure attempt
                reconfig_count = sum(1 for e in runner.event_log if e["action"] == "reconfigure")
                self.assertEqual(reconfig_count, 1)

                # Zero retile
                actions = [e["action"] for e in runner.event_log]
                self.assertNotIn("retile", actions)

                # Exact rollback in reverse order
                reconfig_idx = next(i for i, e in enumerate(runner.event_log) if e["action"] == "reconfigure")
                post_reconfig_events = runner.event_log[reconfig_idx + 1:]
                rollback_keys = [e["key"] for e in post_reconfig_events if e["action"] in ("write", "delete")]
                self.assertEqual(rollback_keys, list(reversed(dirty_keys)))

                # Exact store and presence restored
                self.assertEqual(runner.store, orig_store)
                self.assertEqual(runner.store["floatFilter"], "")
                self.assertNotIn("gapInner", runner.store)

                # In-memory unchanged
                self.assertEqual(mgr.authoritative_config, orig_authoritative)
                self.assertEqual(mgr.draft_config, orig_draft)
                self.assertEqual(mgr.present_kwin_keys, orig_presence)
                self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)
                self.assertEqual(mgr._compute_kwin_fingerprint(), mgr.last_kwin_snapshot_hash)
                self.assertTrue(mgr.is_dirty())

    def test_retile_failure_by_nonzero_result_and_exception(self):
        """Case 7: Retile failure by nonzero result and raised CommandError:
        - Writes/readbacks and exactly one reconfigure succeeded
        - Commit is durable even though apply returns False with partial-success error
        - Exactly one retile attempt
        - authoritative = draft, dirty = false, presence and fingerprint updated, no rollback."""
        for mode in ("nonzero", "exception"):
            with self.subTest(retile_failure_mode=mode):
                runner = MockCommandRunner()
                runner.store["floatFilter"] = ""
                runner.store.pop("gapInner", None)

                mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
                mgr.set_draft_value("gapInner", 12)
                mgr.set_draft_value("floatFilter", "wezterm")
                dirty_keys = mgr.get_dirty_keys()

                if mode == "nonzero":
                    runner.fail_retile = True
                else:
                    runner.raise_retile = True

                runner.clear_logs()
                ok, err = mgr.apply(retile=True)
                self.assertFalse(ok)
                self.assertIn("Configuration was applied, but retile failed", err)

                # Exactly one reconfigure, exactly one retile
                reconfig_count = sum(1 for e in runner.event_log if e["action"] == "reconfigure")
                retile_count = sum(1 for e in runner.event_log if e["action"] == "retile")
                self.assertEqual(reconfig_count, 1)
                self.assertEqual(retile_count, 1)

                # Zero delete actions (no rollback occurred)
                actions = [e["action"] for e in runner.event_log]
                self.assertNotIn("delete", actions)

                # Persisted changes remain in store
                self.assertEqual(runner.store["gapInner"], "12")
                self.assertEqual(runner.store["floatFilter"], "wezterm")

                # State updated and clean
                self.assertEqual(mgr.authoritative_config, mgr.draft_config)
                self.assertFalse(mgr.is_dirty())
                self.assertTrue(set(dirty_keys).issubset(mgr.present_kwin_keys))
                self.assertEqual(mgr.last_kwin_snapshot_hash, mgr._compute_kwin_fingerprint())

    def test_validation_failure_has_zero_side_effects(self):
        """Validation failure in apply performs no writes, no reconfig, and no retile."""
        self.runner.store["floatFilter"] = ""
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        orig_store = dict(self.runner.store)

        # Inject invalid value into draft
        mgr.draft_config["gapInner"] = -5
        self.runner.clear_logs()

        ok, err = mgr.apply(retile=True)
        self.assertFalse(ok)
        self.assertIn("Draft validation failed", err)
        self.assertEqual(len(self.runner.commands_executed), 0)
        self.assertEqual(self.runner.store, orig_store)

    def test_retile_now_has_zero_writes_and_reconfigure(self):
        """retile_now itself performs zero writes and zero reconfigure."""
        mgr = ConfigManager(runner=self.runner, tesserarc_path=self.tesserarc_path)
        self.runner.clear_logs()

        ok, err = mgr.retile_now()
        self.assertTrue(ok)
        self.assertIsNone(err)

        actions = [e["action"] for e in self.runner.event_log]
        self.assertEqual(actions, ["retile"])
        self.assertNotIn("write", actions)
        self.assertNotIn("delete", actions)
        self.assertNotIn("reconfigure", actions)

    def test_rollback_preserves_noncanonical_lexical_bytes_and_legacy_aliases(self):
        """Table-driven coverage proving rollback restores exact byte-for-byte strings
        for noncanonical-but-valid representations and preserves legacy aliases:
        - integer '+08' restored as '+08' (not '8')
        - numeric '+0.50' restored as '+0.50' (not '0.5')
        - boolean 'true' restored as 'true'
        - legacy alias 'masterCount' preserved as '3' while attempted canonical 'primaryRegionCount' is deleted
        - _compute_kwin_fingerprint() strictly equals unchanged last_kwin_snapshot_hash
        - Covers: write failure on later key, readback mismatch, reconfigure nonzero, reconfigure exception."""
        failure_cases = [
            ("write_failure_later_key", "write", "tileNewWindows"),
            ("readback_mismatch", "readback", "gapInner"),
            ("reconfigure_nonzero", "reconfigure_nonzero", None),
            ("reconfigure_exception", "reconfigure_exception", None),
        ]

        for case_name, fail_type, target_key in failure_cases:
            with self.subTest(case=case_name):
                runner = MockCommandRunner()
                runner.store = {
                    "gapInner": "+08",              # Noncanonical valid integer
                    "primaryRegionRatio": "+0.50",   # Noncanonical valid number
                    "enableTiling": "true",          # Noncanonical valid boolean
                    "masterCount": "3",              # Legacy alias present, canonical primaryRegionCount absent
                    "floatFilter": "",               # Explicit empty string
                }

                mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
                orig_store = dict(runner.store)
                orig_authoritative = copy.deepcopy(mgr.authoritative_config)
                orig_presence = set(mgr.present_kwin_keys)
                orig_fingerprint = mgr.last_kwin_snapshot_hash

                self.assertNotIn("primaryRegionCount", runner.store)
                self.assertIn("masterCount", mgr.present_kwin_keys)
                self.assertNotIn("primaryRegionCount", mgr.present_kwin_keys)
                self.assertEqual(orig_fingerprint, mgr._compute_kwin_fingerprint())

                # Set draft values to make keys dirty
                mgr.set_draft_value("enableTiling", False)
                mgr.set_draft_value("gapInner", 14)
                mgr.set_draft_value("primaryRegionRatio", 0.60)
                mgr.set_draft_value("primaryRegionCount", 5)
                mgr.set_draft_value("tileNewWindows", False)
                orig_draft = copy.deepcopy(mgr.draft_config)

                dirty_keys = mgr.get_dirty_keys()
                self.assertEqual(
                    dirty_keys,
                    ["enableTiling", "gapInner", "primaryRegionRatio", "primaryRegionCount", "tileNewWindows"]
                )

                if fail_type == "write":
                    runner.fail_write_key = target_key
                elif fail_type == "readback":
                    runner.fail_readback_key = target_key
                elif fail_type == "reconfigure_nonzero":
                    runner.fail_reconfigure = True
                elif fail_type == "reconfigure_exception":
                    runner.raise_reconfigure = True

                runner.clear_logs()
                ok, err = mgr.apply(retile=True)
                self.assertFalse(ok)

                # Segment and order assertions
                first_write_idx = min(i for i, e in enumerate(runner.event_log) if e["action"] == "write")
                self.assertGreater(first_write_idx, 0)
                if fail_type == "write":
                    fail_idx = dirty_keys.index(target_key)
                    written_before_fail = dirty_keys[:fail_idx]
                    fail_write_idx = [i for i, e in enumerate(runner.event_log) if e.get("key") == target_key and e["action"] == "write"][0]
                    rollback_events = [e for e in runner.event_log[fail_write_idx + 1:] if e["action"] in ("write", "delete")]
                    self.assertEqual([e["key"] for e in rollback_events], list(reversed(written_before_fail)))
                elif fail_type == "readback":
                    last_forward_write_idx = [i for i, e in enumerate(runner.event_log) if e["action"] == "write"][:len(dirty_keys)][-1]
                    # Verification read happens strictly after all forward writes
                    fail_read_idx = [i for i, e in enumerate(runner.event_log) if i > last_forward_write_idx and e.get("key") == target_key and e["action"] == "read"][0]
                    rollback_events = [e for e in runner.event_log[fail_read_idx + 1:] if e["action"] in ("write", "delete")]
                    self.assertEqual([e["key"] for e in rollback_events], list(reversed(dirty_keys)))
                else:  # reconfigure failure
                    reconfig_idx = next(i for i, e in enumerate(runner.event_log) if e["action"] == "reconfigure")
                    rollback_events = [e for e in runner.event_log[reconfig_idx + 1:] if e["action"] in ("write", "delete")]
                    self.assertEqual([e["key"] for e in rollback_events], list(reversed(dirty_keys)))

                # 1. Byte-for-byte restoration of the entire store
                self.assertEqual(runner.store, orig_store)
                self.assertEqual(runner.store["gapInner"], "+08")
                self.assertEqual(runner.store["primaryRegionRatio"], "+0.50")
                self.assertEqual(runner.store["enableTiling"], "true")
                self.assertEqual(runner.store["masterCount"], "3")
                self.assertEqual(runner.store["floatFilter"], "")
                self.assertNotIn("primaryRegionCount", runner.store)

                # 2. Fingerprint consistency: actual disk matches in-memory hash exactly
                self.assertEqual(mgr._compute_kwin_fingerprint(), mgr.last_kwin_snapshot_hash)
                self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)

                # 3. In-memory state unchanged and draft remains dirty
                self.assertEqual(mgr.authoritative_config, orig_authoritative)
                self.assertEqual(mgr.draft_config, orig_draft)
                self.assertEqual(mgr.present_kwin_keys, orig_presence)
                self.assertTrue(mgr.is_dirty())

    def test_user_reproduction_raw_gap_inner_write_failure_rollback(self):
        """Concrete reproduction test:
        - pre-store gapInner is '+08'
        - draft gapInner=14, gapOuter=18
        - inject write failure on later key gapOuter
        - rollback must leave gapInner raw value '+08', not '8'
        - last_kwin_snapshot_hash equals _compute_kwin_fingerprint()."""
        runner = MockCommandRunner()
        runner.store = {
            "gapInner": "+08",
            "gapOuter": "10",
        }
        mgr = ConfigManager(runner=runner, tesserarc_path=self.tesserarc_path)
        orig_store = dict(runner.store)
        orig_fingerprint = mgr.last_kwin_snapshot_hash

        mgr.set_draft_value("gapInner", 14)
        mgr.set_draft_value("gapOuter", 18)

        runner.fail_write_key = "gapOuter"
        runner.clear_logs()

        ok, err = mgr.apply()
        self.assertFalse(ok)
        self.assertIn("Write failed for key 'gapOuter'", err)

        self.assertEqual(runner.store["gapInner"], "+08")
        self.assertEqual(runner.store, orig_store)
        self.assertEqual(mgr._compute_kwin_fingerprint(), mgr.last_kwin_snapshot_hash)
        self.assertEqual(mgr.last_kwin_snapshot_hash, orig_fingerprint)


if __name__ == "__main__":
    unittest.main()

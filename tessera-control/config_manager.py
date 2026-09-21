"""
Tessera Configuration Manager (Phase 5D Rebuild)
Authoritative store: ~/.config/kwinrc (group Script-tessera).
Features verified transaction-like persistence (validation, snapshot, write, readback verification, rollback on failure),
one-time migration from ~/.config/tesserarc, and draft session isolation.
"""

import copy
import json
import os
from typing import Any, Dict, List, Optional, Tuple

from command_runner import CommandRunner, CommandError
from config_contract import (
    CANONICAL_PROPERTIES,
    LEGACY_KEY_MAP,
    LEGACY_LAYOUT_MAP,
    load_canonical_defaults,
    normalize_and_validate_value
)

KWINRC_GROUP = "Script-tessera"
LEGACY_TESSERARC_PATH = os.path.expanduser("~/.config/tesserarc")
CONFIG_FILE = LEGACY_TESSERARC_PATH
MIGRATION_BACKUP_PATH = os.path.expanduser("~/.config/tessera_migration_backup.json")

class ConfigTransactionError(Exception):
    def __init__(self, message: str, step: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.step = step
        self.details = details or {}

class ConfigManager:
    def __init__(
        self,
        kwinrc_file: str = "kwinrc",
        runner: Optional[CommandRunner] = None,
        tesserarc_path: Optional[str] = None
    ):
        self.kwinrc_file = kwinrc_file
        self.runner = runner or CommandRunner()
        self.tesserarc_path = tesserarc_path or LEGACY_TESSERARC_PATH

        # In-memory authoritative snapshot and working draft
        self.authoritative_config: Dict[str, Any] = load_canonical_defaults()
        self.draft_config: Dict[str, Any] = copy.deepcopy(self.authoritative_config)

        # Initial load and one-time migration
        self.load_from_kwinrc()
        self._maybe_migrate_tesserarc()

    @property
    def config(self) -> Dict[str, Any]:
        return self.draft_config

    def save(self) -> bool:
        ok, err = self.apply()
        return ok

    # -------------------------------------------------------------------------
    # KWinRC Persistence Layer
    # -------------------------------------------------------------------------

    def _read_kwin_key(self, key: str, val_type: str, default: Any) -> Any:
        cmd = ["kreadconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP, "--key", key]
        if val_type == "boolean":
            cmd.extend(["--type", "bool"])
        res = self.runner.run(cmd, check=False)
        if not res.ok or not res.stdout:
            return default

        raw = res.stdout.strip()
        ok, norm, err = normalize_and_validate_value(key, raw)
        return norm if ok else default

    def _write_kwin_key(self, key: str, val: Any) -> None:
        spec = CANONICAL_PROPERTIES.get(key, {})
        val_type = spec.get("type", "string")

        cmd = ["kwriteconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP, "--key", key]
        if val_type == "boolean":
            cmd.extend(["--type", "bool", "true" if val else "false"])
        elif val_type == "integer":
            cmd.extend(["--type", "int", str(val)])
        elif val_type == "number":
            cmd.extend(["--type", "double", str(val)])
        else:
            cmd.append(str(val))

        self.runner.run(cmd, check=True)

    def load_from_kwinrc(self) -> None:
        """Hydrates authoritative_config from kwinrc without writing anything."""
        for key, spec in CANONICAL_PROPERTIES.items():
            default = spec["default"]
            val_type = spec["type"]

            # Try canonical key first
            val = self._read_kwin_key(key, val_type, default)

            # Check legacy aliases if still default
            if val == default and "legacyAliases" in spec:
                for alias in spec["legacyAliases"]:
                    alias_val = self._read_kwin_key(alias, val_type, default)
                    if alias_val != default:
                        # Migrate layout alias value if needed
                        if key == "defaultLayout" and alias_val in LEGACY_LAYOUT_MAP:
                            alias_val = LEGACY_LAYOUT_MAP[alias_val]
                        val = alias_val
                        break

            self.authoritative_config[key] = val

        self.draft_config = copy.deepcopy(self.authoritative_config)

    def _maybe_migrate_tesserarc(self) -> bool:
        """
        One-time migration from ~/.config/tesserarc.
        Migrates only keys not explicitly configured in kwinrc.
        Preserves unsupported or invalid keys in MIGRATION_BACKUP_PATH.
        Never deletes ~/.config/tesserarc.
        """
        if not os.path.exists(self.tesserarc_path):
            return False

        current_ver = self.authoritative_config.get("configSchemaVersion", 1)
        # If already version 2 or above in kwinrc, migration already occurred
        kwin_ver_res = self.runner.run(
            ["kreadconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP, "--key", "configSchemaVersion"],
            check=False
        )
        if kwin_ver_res.ok and kwin_ver_res.stdout.strip() in ("2", "3", "4", "5"):
            return False

        try:
            with open(self.tesserarc_path, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
        except Exception as e:
            # Malformed legacy file: do not crash or corrupt kwinrc
            return False

        unsupported = {}
        migrated = {}

        for k, v in user_cfg.items():
            canon_k = LEGACY_KEY_MAP.get(k, k)
            if canon_k in CANONICAL_PROPERTIES:
                # Convert dict/list to JSON string if needed
                if canon_k.endswith("Json") and isinstance(v, (dict, list)):
                    v = json.dumps(v)
                ok, norm, err = normalize_and_validate_value(canon_k, v)
                if ok:
                    # Migrate only if not already explicitly different from default in kwinrc
                    if self.authoritative_config.get(canon_k) == CANONICAL_PROPERTIES[canon_k]["default"]:
                        migrated[canon_k] = norm
                        self.authoritative_config[canon_k] = norm
                else:
                    unsupported[k] = {"value": v, "error": err}
            else:
                unsupported[k] = {"value": v, "reason": "Unsupported legacy key"}

        # Preserve unmigrated/unsupported data
        if unsupported:
            try:
                os.makedirs(os.path.dirname(MIGRATION_BACKUP_PATH), exist_ok=True)
                with open(MIGRATION_BACKUP_PATH, "w", encoding="utf-8") as f:
                    json.dump({"unsupported": unsupported, "source": self.tesserarc_path}, f, indent=2)
            except Exception:
                pass

        # Write migrated keys and update schema version in kwinrc
        migrated["configSchemaVersion"] = 2
        for k, v in migrated.items():
            self._write_kwin_key(k, v)

        self.authoritative_config["configSchemaVersion"] = 2
        self.draft_config = copy.deepcopy(self.authoritative_config)
        return True

    # -------------------------------------------------------------------------
    # Draft Session Management
    # -------------------------------------------------------------------------

    def set_draft_value(self, key: str, value: Any) -> Tuple[bool, Optional[str]]:
        """Sets a value in the working draft. Does NOT persist to disk."""
        ok, norm, err = normalize_and_validate_value(key, value)
        if not ok:
            return False, err
        self.draft_config[key] = norm
        return True, None

    def get_draft_value(self, key: str, default: Any = None) -> Any:
        return self.draft_config.get(key, default)

    def is_dirty(self) -> bool:
        return self.draft_config != self.authoritative_config

    def get_dirty_keys(self) -> List[str]:
        return [k for k in CANONICAL_PROPERTIES if self.draft_config.get(k) != self.authoritative_config.get(k)]

    def reset_draft(self) -> None:
        """Discards unpersisted draft changes and restores authoritative values."""
        self.draft_config = copy.deepcopy(self.authoritative_config)

    def restore_defaults_to_draft(self) -> None:
        """Sets canonical defaults into the draft only. Does NOT persist until Apply."""
        self.draft_config = load_canonical_defaults()

    def apply_preset_to_draft(self, preset_values: Dict[str, Any]) -> None:
        """Applies a preset into the draft only. Does NOT persist until Apply."""
        for k, v in preset_values.items():
            self.set_draft_value(k, v)

    # -------------------------------------------------------------------------
    # Verified Transactional Apply
    # -------------------------------------------------------------------------

    def apply(self, retile: bool = False) -> Tuple[bool, Optional[str]]:
        """
        Executes a transaction-like persist operation:
        1. Validates full draft.
        2. Snapshots prior authoritative values.
        3. Writes each changed key.
        4. Reads back values to verify persistence.
        5. Rolls back to snapshot if verification fails.
        6. Calls KWin reconfigure.
        7. Calls KWin retile if requested.
        8. Updates authoritative state on full success.
        """
        # 1. Validate full draft
        validation_errors = {}
        for k, v in self.draft_config.items():
            ok, norm, err = normalize_and_validate_value(k, v)
            if not ok:
                validation_errors[k] = err
        if validation_errors:
            return False, f"Draft validation failed: {validation_errors}"

        dirty_keys = self.get_dirty_keys()
        if not dirty_keys:
            # Clean draft, nothing to persist
            if retile:
                self.retile_now()
            return True, None

        # 2. Snapshot prior authoritative values
        snapshot = copy.deepcopy(self.authoritative_config)

        # 3. Write changed values
        written_keys = []
        try:
            for k in dirty_keys:
                self._write_kwin_key(k, self.draft_config[k])
                written_keys.append(k)
        except Exception as e:
            self._rollback(snapshot, written_keys)
            return False, f"Write failed for key '{written_keys[-1] if written_keys else 'unknown'}': {e}"

        # 4. Readback verification
        for k in dirty_keys:
            spec = CANONICAL_PROPERTIES[k]
            read_back = self._read_kwin_key(k, spec["type"], None)
            expected = self.draft_config[k]
            if read_back != expected:
                self._rollback(snapshot, dirty_keys)
                return False, f"Readback verification mismatch for key '{k}': expected {expected}, read {read_back}"

        # 5. KWin Reconfigure (exactly once)
        reconfig_res = self.runner.run(
            ["qdbus6", "org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"],
            check=False
        )
        if not reconfig_res.ok:
            self._rollback(snapshot, dirty_keys)
            return False, f"KWin reconfigure failed: {reconfig_res.stderr or 'DBus error'}"

        # 6. Retile if requested (exactly once)
        if retile:
            retile_ok, retile_err = self.retile_now()
            if not retile_ok:
                # Configuration was persisted, but retile shortcut failed
                pass

        # 7. Commit authoritative state
        self.authoritative_config = copy.deepcopy(self.draft_config)
        return True, None

    def _rollback(self, snapshot: Dict[str, Any], keys_to_restore: List[str]) -> None:
        """Restores snapshot values to kwinrc on failure."""
        for k in keys_to_restore:
            try:
                self._write_kwin_key(k, snapshot[k])
            except Exception:
                pass

    def retile_now(self) -> Tuple[bool, Optional[str]]:
        """
        Sends an immediate retile request to KWin via DBus shortcut invocation.
        Does NOT save configuration or invoke KWin reconfigure.
        """
        res = self.runner.run(
            [
                "qdbus6",
                "org.kde.kglobalaccel",
                "/component/kwin",
                "org.kde.kglobalaccel.Component.invokeShortcut",
                "Tessera: Retile Current Workspace"
            ],
            check=False
        )
        if not res.ok:
            return False, f"Failed to invoke Retile shortcut: {res.stderr or 'DBus error'}"
        return True, None

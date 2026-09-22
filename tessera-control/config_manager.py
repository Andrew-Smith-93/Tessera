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
MISSING_VALUE_SENTINEL = "__TESSERA_KCONFIG_VALUE_MISSING_8f2b70c1__"

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
        self.present_kwin_keys: set = set()
        self.last_kwin_snapshot_hash: str = ""

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

    def _read_kwin_key_raw(self, key: str, val_type: str) -> Tuple[bool, Optional[str]]:
        # A default sentinel distinguishes an absent key from an explicitly
        # configured empty string. Read raw text so invalid stored values can
        # be rejected by the canonical validator rather than coerced by KDE.
        cmd = [
            "kreadconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP,
            "--key", key, "--default", MISSING_VALUE_SENTINEL
        ]
        try:
            res = self.runner.run(cmd, check=False)
        except CommandError:
            return False, None
        if not res.ok or res.stdout == MISSING_VALUE_SENTINEL:
            return False, None
        return True, res.stdout

    def _read_kwin_key(self, key: str, val_type: str, default: Any) -> Any:
        present, raw = self._read_kwin_key_raw(key, val_type)
        if not present or raw is None:
            return default
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

    def _delete_kwin_key(self, key: str) -> None:
        cmd = ["kwriteconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP, "--key", key, "--delete"]
        self.runner.run(cmd, check=False)

    def _write_kwin_key_raw(self, key: str, raw_val: str) -> None:
        cmd = ["kwriteconfig6", "--file", self.kwinrc_file, "--group", KWINRC_GROUP, "--key", key, raw_val]
        self.runner.run(cmd, check=False)

    def _legacy_aliases_for(self, canonical_key: str) -> List[str]:
        aliases = set(CANONICAL_PROPERTIES[canonical_key].get("legacyAliases", []))
        aliases.update(
            alias for alias, target in LEGACY_KEY_MAP.items()
            if target == canonical_key
        )
        return sorted(aliases)

    def _compute_kwin_fingerprint(self) -> str:
        """Computes a fingerprint of current kwinrc keys for concurrency detection."""
        entries = []
        key_types = {key: spec["type"] for key, spec in CANONICAL_PROPERTIES.items()}
        for canonical_key, spec in CANONICAL_PROPERTIES.items():
            for alias in self._legacy_aliases_for(canonical_key):
                key_types[alias] = spec["type"]

        for key in sorted(key_types):
            present, raw = self._read_kwin_key_raw(key, key_types[key])
            if present and raw is not None:
                entries.append(f"{key}={raw}")
        return ";".join(entries)

    def load_from_kwinrc(self) -> None:
        """Hydrates authoritative_config from kwinrc without writing anything."""
        self.present_kwin_keys.clear()
        for key, spec in CANONICAL_PROPERTIES.items():
            default = spec["default"]
            val_type = spec["type"]

            # Try canonical key first
            present, raw = self._read_kwin_key_raw(key, val_type)
            if present and raw is not None:
                self.present_kwin_keys.add(key)
                ok, norm, err = normalize_and_validate_value(key, raw)
                val = norm if ok else default
            else:
                val = default
                # Check legacy aliases if absent
                aliases = self._legacy_aliases_for(key)
                if aliases:
                    for alias in aliases:
                        a_present, a_raw = self._read_kwin_key_raw(alias, val_type)
                        if a_present and a_raw is not None:
                            ok, a_norm, err = normalize_and_validate_value(key, a_raw)
                            if ok:
                                if key == "defaultLayout" and a_norm in LEGACY_LAYOUT_MAP:
                                    a_norm = LEGACY_LAYOUT_MAP[a_norm]
                                val = a_norm
                                self.present_kwin_keys.add(alias)
                                break

            self.authoritative_config[key] = val

        self.last_kwin_snapshot_hash = self._compute_kwin_fingerprint()
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

        # If already version 2 or above in kwinrc, migration already occurred
        kwin_version_present, kwin_version_raw = self._read_kwin_key_raw("configSchemaVersion", "integer")
        try:
            kwin_version = int(kwin_version_raw) if kwin_version_present and kwin_version_raw is not None else 0
        except ValueError:
            kwin_version = 0
        if kwin_version >= 2:
            return False

        try:
            with open(self.tesserarc_path, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
        except Exception as e:
            # Malformed legacy file: do not crash or corrupt kwinrc
            return False

        config_snapshot = copy.deepcopy(self.authoritative_config)
        presence_snapshot = set(self.present_kwin_keys)
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
                    spec = CANONICAL_PROPERTIES[canon_k]
                    explicit_keys = {canon_k, *self._legacy_aliases_for(canon_k)}
                    # Presence, not value inequality, determines authority: an
                    # explicitly chosen canonical default must never be
                    # overwritten by a legacy file.
                    if self.present_kwin_keys.isdisjoint(explicit_keys):
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
        raw_snapshot: Dict[str, Tuple[bool, Optional[str]]] = {}
        for k in migrated:
            spec = CANONICAL_PROPERTIES.get(k, {})
            raw_snapshot[k] = self._read_kwin_key_raw(k, spec.get("type", "string"))

        written_keys = []
        try:
            for k, v in migrated.items():
                self._write_kwin_key(k, v)
                written_keys.append(k)
        except Exception:
            # Migration is best-effort during hydration and must not leave a
            # partially canonicalized kwinrc if one write fails.
            self._rollback_raw(raw_snapshot, written_keys)
            self.authoritative_config = config_snapshot
            self.present_kwin_keys = presence_snapshot
            self.last_kwin_snapshot_hash = self._compute_kwin_fingerprint()
            self.draft_config = copy.deepcopy(self.authoritative_config)
            return False

        self.authoritative_config["configSchemaVersion"] = 2
        self.present_kwin_keys.update(written_keys)
        self.last_kwin_snapshot_hash = self._compute_kwin_fingerprint()
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
                return self.retile_now()
            return True, None

        # 2. Concurrency Conflict Detection
        current_fingerprint = self._compute_kwin_fingerprint()
        if self.last_kwin_snapshot_hash and current_fingerprint != self.last_kwin_snapshot_hash:
            return False, "Concurrency conflict: kwinrc was modified externally since last read. Please reload settings."

        # 3. Snapshot exact raw values and key presence for dirty keys before any write
        raw_snapshot: Dict[str, Tuple[bool, Optional[str]]] = {}
        for k in dirty_keys:
            spec = CANONICAL_PROPERTIES[k]
            raw_snapshot[k] = self._read_kwin_key_raw(k, spec["type"])

        # 4. Write changed values
        written_keys = []
        attempted_key = None
        try:
            for k in dirty_keys:
                attempted_key = k
                self._write_kwin_key(k, self.draft_config[k])
                written_keys.append(k)
        except Exception as e:
            self._rollback_raw(raw_snapshot, written_keys)
            failing_key = attempted_key if attempted_key is not None else (written_keys[-1] if written_keys else "unknown")
            return False, f"Write failed for key '{failing_key}': {e}"

        # 5. Readback verification
        for k in dirty_keys:
            spec = CANONICAL_PROPERTIES[k]
            read_back = self._read_kwin_key(k, spec["type"], None)
            expected = self.draft_config[k]
            if read_back != expected:
                self._rollback_raw(raw_snapshot, dirty_keys)
                return False, f"Readback verification mismatch for key '{k}': expected {expected}, read {read_back}"

        # 6. KWin Reconfigure (exactly once)
        try:
            reconfig_res = self.runner.run(
                ["qdbus6", "org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"],
                check=False
            )
        except CommandError as e:
            self._rollback_raw(raw_snapshot, dirty_keys)
            return False, f"KWin reconfigure failed: {e}"
        if not reconfig_res.ok:
            self._rollback_raw(raw_snapshot, dirty_keys)
            return False, f"KWin reconfigure failed: {reconfig_res.stderr or 'DBus error'}"

        # The persisted configuration is authoritative after successful
        # readback and reconfigure, even when an optional retile side effect
        # fails. Commit this state before reporting that partial failure.
        self.authoritative_config = copy.deepcopy(self.draft_config)
        self.present_kwin_keys.update(dirty_keys)
        self.last_kwin_snapshot_hash = self._compute_kwin_fingerprint()

        # 7. Retile if requested (exactly once)
        if retile:
            retile_ok, retile_err = self.retile_now()
            if not retile_ok:
                return False, f"Configuration was applied, but retile failed: {retile_err}"

        # 8. Return success after the authoritative state was committed above.
        return True, None

    def _rollback_raw(self, raw_snapshot: Dict[str, Tuple[bool, Optional[str]]], keys_to_restore: List[str]) -> None:
        """Restores exact raw snapshot strings or deletes previously absent keys on failure in reverse write order."""
        for k in reversed(keys_to_restore):
            try:
                present, raw_val = raw_snapshot.get(k, (False, None))
                if not present or raw_val is None:
                    # Key was absent before this transaction; delete it to preserve absence
                    self._delete_kwin_key(k)
                else:
                    self._write_kwin_key_raw(k, raw_val)
            except Exception:
                pass

    def _rollback(self, snapshot: Dict[str, Any], presence_snapshot: set, keys_to_restore: List[str]) -> None:
        """Legacy rollback helper preserving reverse-order restoration."""
        raw_snapshot = {k: (k in presence_snapshot, str(snapshot[k]) if k in presence_snapshot else None) for k in keys_to_restore}
        self._rollback_raw(raw_snapshot, keys_to_restore)

    def retile_now(self) -> Tuple[bool, Optional[str]]:
        """
        Sends an immediate retile request to KWin via DBus shortcut invocation.
        Does NOT save configuration or invoke KWin reconfigure.
        """
        try:
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
        except CommandError as e:
            return False, f"Failed to invoke Retile shortcut: {e}"
        if not res.ok:
            return False, f"Failed to invoke Retile shortcut: {res.stderr or 'DBus error'}"
        return True, None

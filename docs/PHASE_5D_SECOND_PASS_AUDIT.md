# Phase 5D Second Pass — Adversarial Integrity Audit & Verification Matrix

## 1. Executive Summary & Audit Scope

This document provides the adversarial integrity audit for **Phase 5D Second Pass** on branch `fix/slot-runtime-settings-integrity-02`, examining the claims of the first-pass implementation (`refactor/slot-runtime-settings-foundation-01`, HEAD `d6210f6fc27a3b0c143a71fe2daba5cf8c3bfb60`).

> **Independent verification correction:** The original second-pass report below is retained as the finding record, but its claimed closure was not sufficient. Branch `fix/phase-5d-independent-verification-03` independently reproduced the gaps and implemented the corrections summarized in Section 3. Automated evidence does not replace live KWin/KCM acceptance; that gate remains **NOT RUN** on this branch.

Each first-pass claim and additional second-pass attack vector is audited with:
1. First-Pass Claim
2. Source Files & Evidence Inspected
3. Adversarial Test / Vulnerability Discovered
4. Result & Verified Defect
5. Corrective Action Required

---

## 2. Adversarial Findings & Defect Inventory

### ATTACK-01: Multi-Desktop & Sticky Window Scoping
- **First-Pass Claim**: Scoped slot ordering is maintained per workspace without window truncation.
- **Evidence Inspected**: `apps/kwin-adapter/src/qml-reconciler-compat.ts` (lines 69-70), `coordinator-types.ts` (lines 66-67), `runtime-coordinator.ts`.
- **Vulnerability**: `toNormalizedWindow` collapsed `w.desktops` to `String(w.desktops[0])` and `w.activities` to `String(w.activities[0])`. `w.onAllDesktops` was completely ignored. A window assigned to multiple virtual desktops lost secondary desktop memberships. Sticky windows failed to tile across active desktops.
- **Scope Key Collision**: `getWorkspaceScopeKey` used naive `${outputId}:${desktopId}` concatenation, which collides if `outputId` contains colons (e.g. `DP-1:0` + `1` vs `DP-1` + `0:1`).
- **Defect Confirmed**: **DEFECT-01 (High)**. Multiple desktop assignments collapsed to first element; sticky windows ignored; scope keys vulnerable to collision; global scope sentinel not implemented.
- **Correction**:
  1. Add `desktopIds: string[]`, `onAllDesktops: boolean`, `activities: string[]` to `NormalizedWindowInput` and `RetainedWindowState`.
  2. Implement collision-safe scope key encoding using URI percent-encoding: `encodeURIComponent(outputId) + "//" + encodeURIComponent(desktopId)`.
  3. Implement deterministic sticky-window policy: windows with `onAllDesktops=true` participate in the active scope of their output.
  4. Implement `GLOBAL_DESKTOP_SCOPE = "__global__"` when `perDesktopLayout=false`.
  5. Hook `desktopsChanged` and `activitiesChanged` signals in `main.qml`.

### ATTACK-02: Central Geometry Commit Sink
- **First-Pass Claim**: Single authoritative coordinator plans geometry writes.
- **Evidence Inspected**: `contents/ui/main.qml` lines 477, 1263, 1300, 1357, 1415, 1728.
- **Vulnerability**: Direct assignments to `w.frameGeometry` occurred in 6 different functions: `performReconciliation`, `unmaximizeWindow`, `commitSnapZone`, `restoreWindowFromDrag`, `applyProspectiveDropTarget`, and `moveWindowToScreen`. Direct assignments bypassed echo suppression and central validation.
- **Defect Confirmed**: **DEFECT-02 (Medium)**. Multiple geometry write sinks in QML bypass coordinator echo tracking and validation.
- **Correction**:
  1. Create a single `commitWindowGeometry(win, targetRect, reason, epoch)` sink in `contents/ui/main.qml`.
  2. Route all 6 geometry write call sites through `commitWindowGeometry`.
  3. Add a static source isolation test enforcing that `win.frameGeometry =` occurs exactly once in `main.qml`.

### ATTACK-03: Shortcut Authority & User Customization
- **First-Pass Claim**: Plasma 6 shortcuts are unified and documented.
- **Evidence Inspected**: `contents/ui/main.qml` (lines 1809-1987), `install.sh` (lines 48-73), `README.md`, `tessera-control/tessera_settings.py`.
- **Vulnerability**:
  - `main.qml` contained duplicate actions (e.g. `Tessera: Toggle Window Floating (Meta)`).
  - Legacy "Master" terminology remained in active shortcuts: `Tessera: Increase Master Ratio`, `Tessera: Show Master HUD`.
  - `masterHudDialog` in `main.qml` remained active performance theater.
  - `install.sh` unconditionally overwrote existing user customizations in `kglobalshortcutsrc` on every install.
- **Defect Confirmed**: **DEFECT-03 (Medium)**. Shortcut names retain legacy master terminology, duplicate action IDs exist, `install.sh` overwrites user bindings, and `masterHudDialog` persists.
- **Correction**:
  1. Standardize shortcut actions to Primary/Stack terminology with legacy alias fallback.
  2. Delete `masterHudDialog` and its trigger shortcut from `main.qml`.
  3. Update `install.sh` to read `kreadconfig6` before writing shortcuts to preserve user customizations.
  4. Create a unified shortcut catalog test verifying drift between `main.qml`, `install.sh`, `tessera_settings.py`, and `README.md`.

### ATTACK-04: Installer & Uninstaller Safety
- **First-Pass Claim**: Clean distribution and packaging.
- **Evidence Inspected**: `install.sh`, `uninstall.sh`.
- **Vulnerability**:
  - `install.sh` symlinked `~/.local/bin/tessera-settings` into the git checkout directory (`$SCRIPT_DIR/bin/tessera-settings`), breaking if the repo is moved or deleted.
  - `install.sh` performed destructive `rm -rf "$TARGET_DIR"` without staging or rollback on failure.
  - `install.sh` did not verify Python 3 or PyQt5 availability.
  - `uninstall.sh` had no `--purge` option and left shortcut registrations.
- **Defect Confirmed**: **DEFECT-04 (Medium)**. Non-relocatable symlinks, unhandled installation failure, no Python dependency checks, lack of rollback.
- **Correction**:
  1. Install optional Control Center files into `~/.local/share/tessera/control/` with a stable launcher wrapper.
  2. Implement staging, backup, and atomic rollback in `install.sh`.
  3. Add Python and PyQt5 runtime dependency checks in `install.sh`.
  4. Harden `uninstall.sh` with target validation and `--purge` option.
  5. Add sandboxed integration tests for installer and uninstaller in `tests/test_installer_safety.py`.

### ATTACK-05: Configuration Concurrency & Rollback
- **First-Pass Claim**: Transactional persistence with atomic writes and rollback.
- **Evidence Inspected**: `tessera-control/config_manager.py` (lines 218-286).
- **Vulnerability**:
  - Concurrency: `apply()` did not check whether `kwinrc` was modified externally between `load_from_kwinrc()` and `apply()`.
  - Absence Preservation: When rolling back a key that did not exist prior to `apply()`, `_rollback()` wrote `snapshot[k]` (which is default) rather than deleting the key to preserve absence.
- **Defect Confirmed**: **DEFECT-05 (Medium)**. Missing external change detection and failure to preserve key absence during rollback.
- **Correction**:
  1. Track `present_kwin_keys: Set[str]` to distinguish explicit keys from default fallbacks.
  2. Before applying writes, verify no external changes occurred to managed keys.
  3. During rollback, delete previously absent keys via `kwriteconfig6 --delete`.
  4. Add tests for external concurrency conflict and absence-preserving rollback.

### ATTACK-06: Native KConfigXT Bindings
- **First-Pass Claim**: `contents/ui/config.ui` is a real native KConfig page.
- **Evidence Inspected**: `contents/ui/config.ui`, `contents/config/main.xml`.
- **Vulnerability**: XML elements exist, but widget property types and ranges must strictly conform to KConfigXT generic scripted KCM capabilities.
- **Defect Confirmed**: **DEFECT-06 (Low)**. Need rigorous property-type mapping verification and explicit documentation that live KCM execution remains a live gate.
- **Correction**: Expand `tests/test_config_ui_bindings.py` to assert widget property types match KConfigXT specifications and document KCM live gate.

### ATTACK-07: Python Testability without PyQt5
- **First-Pass Claim**: Control Center and ConfigManager are modularized.
- **Evidence Inspected**: `tessera-control/*.py`, `tests/*.py`.
- **Audit Result**: `config_manager.py`, `config_contract.py`, `command_runner.py`, and `presets.py` have zero PyQt5 dependencies.
- **Action**: Add explicit test in `test_config_manager.py` verifying clean headless execution when `PyQt5` is mocked as unavailable.

### ATTACK-08: Package Reproducibility Architecture
- **First-Pass Claim**: Package build produces deterministic reproducible archives.
- **Evidence Inspected**: `package.sh`, `tests/test_package_manifest.py`.
- **Vulnerability**: `test_package_reproducibility_across_builds` ran `package.sh` directly, modifying the actual repository `dist/` folder twice during unit testing.
- **Defect Confirmed**: **DEFECT-08 (Low)**. Unit tests mutate production `dist/` directory.
- **Correction**:
  1. Extract core deterministic packaging into a reusable, testable python/shell module that accepts an explicit input directory and output path.
  2. Unit test tests packaging using two isolated temporary staging directories without touching `dist/`.
  3. Support `SOURCE_DATE_EPOCH`.

### ATTACK-09: Generated Artifact Source of Truth
- **First-Pass Claim**: TypeScript is sole source of truth for bridges.
- **Evidence Inspected**: `npm run bundle:kwin`, `verify:artifacts`.
- **Audit Result**: `verify:artifacts` correctly checks git diff against committed artifacts. Clean regeneration verified.

### ATTACK-10: Configuration Scope Serialization
- **First-Pass Claim**: Workspace-scoped layouts supported.
- **Evidence Inspected**: `config_contract.py`, `main.xml`.
- **Vulnerability**: `workspaceLayoutsJson` lacked structured validation: duplicate scopes, invalid layout IDs, out-of-range ratios, or oversized payloads were not guarded.
- **Defect Confirmed**: **DEFECT-10 (Medium)**. Missing bounding, entry-count limits, and schema validation on `workspaceLayoutsJson`.
- **Correction**:
  1. Add schema validator for `workspaceLayoutsJson` with entry limit (max 50), payload limit (max 64 KB), layout enum check, and ratio/count bounds check.
  2. Add unit tests for malicious/corrupted scope JSON inputs.

### ATTACK-11: New-Default Safety & Migration
- **First-Pass Claim**: `balanced-grid` is new default; existing choices preserved.
- **Evidence Inspected**: `config_manager.py`.
- **Audit Result**: Fresh install vs upgrade logic verified. Add explicit test verifying that existing `master-stack` in `kwinrc` migrates to `primary-stack` without resetting to `balanced-grid`.

### ATTACK-12: Acceptance Report Honesty
- **First-Pass Claim**: Phase 5B acceptance documented.
- **Evidence Inspected**: `docs/LIVE_KWIN_X11_ACCEPTANCE.md`.
- **Audit Result**: Header added in Phase 5D clearly demarcates Phase 5B as historical baseline. Need a dedicated Phase 5D automated results checklist leaving all live desktop tests as NOT RUN for Omega.

---

## 3. Independent Verification Correction Closure

| Area | Independently reproduced gap | Corrected state |
| :--- | :--- | :--- |
| Live object normalization | Desktop/activity objects were stringified as `[object Object]` | Stable `.id`/`.name` extraction is covered by executable adapter tests |
| Active scope/topology | QML did not provide active desktop/activity or topology events | Screen normalization carries both IDs; topology and desktop-change events update retained state and remove retired scopes |
| Runtime authority | QML still owned floating/pre-tiled/saved-geometry/classification maps | Those maps and direct rule authority are removed; coordinator delegates are the only retained source |
| Geometry safety | The single sink accepted malformed/out-of-bounds rectangles | Pure finite/positive normalization, output clamping, destroyed/unmanaged guards, and identical-write skipping precede the only assignment |
| Multi-desktop snap/output moves | Snap changed or removed only one scope membership | All source-output memberships are removed and every destination desktop membership is preserved |
| Global workspace sentinel | `__global__` could collide with a real desktop ID | Internal NUL-prefixed sentinel is outside the KWin desktop-ID domain |
| Workspace override persistence | The Control Center wrote an unknown `desktopLayouts` key; runtime did not consume the canonical field | UI writes versioned wildcard scopes to `workspaceLayoutsJson`; runtime applies exact/wildcard overrides and migrates safe first-pass maps |
| Workspace JSON validation | Duplicate keys, unsafe scopes, unknown fields, wrong versions, and non-finite/coerced values were accepted | Bounded, versioned, canonical parsing rejects all of those cases and deterministically serializes valid data |
| Configuration transactions | Alias changes evaded concurrency checks; explicit defaults could be overwritten; retile failure was reported as success | Fingerprints include aliases/empty values, presence governs migration, command failures are contained, and partial retile failure is explicit |
| Shortcut drift | QML, installer, docs, and Control Center diverged | `config/shortcuts.json` is canonical; executable tests require exact QML and README agreement; installer/UI consume the catalog |
| Installation safety | Replacement was destructive, HOME-specific, and lacked rollback/integration proof | XDG-aware staging, backup/rollback, dependency preflight, binding preservation, purge semantics, and sandboxed integration tests are present |
| Reproducible packaging | Timestamp was hard-coded and ignored `SOURCE_DATE_EPOCH` | ZIP timestamps derive from validated UTC `SOURCE_DATE_EPOCH` and are asserted by the package test |
| Public claims | README/docs claimed unverified GPU, Wayland, store, and HUD behavior | Claims are bounded to automated evidence and historical X11 acceptance; live KWin/KCM/Wayland remain explicit gates |

### Required branch gates

Before this correction branch is considered complete, it must pass type checking, all JavaScript/TypeScript tests, all Python tests, protocol freeze verification, generated-artifact verification, simulator verification (including required seeds), deterministic packaging, `git diff --check`, and exact-head CI. Following the user release decision, the disconnected Rust daemon (`apps/tessera-daemon`, root Cargo workspace) was retired; Tessera ships strictly as a self-contained KWin QML script plus generated TypeScript/JavaScript runtime with zero background native service. Rust formatting/check/clippy/tests and cargo gates are removed. Live KWin script reloading, live KCM settings bindings, Wayland session compatibility, game window policy handling, and multi-monitor hotplug verification remain unexecuted in this automated phase and are explicit **NOT RUN** gates reserved for future manual testing. The final commit and CI run are recorded in the handoff rather than hard-coded into this source document.

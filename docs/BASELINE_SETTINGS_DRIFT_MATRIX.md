# Phase 5D Baseline Settings Drift & Packaging Mismatch Matrix

This document characterizes the baseline architecture flaws in Tessera's configuration and distribution systems prior to the Phase 5D refactoring.

> [!NOTE]
> **Historical Baseline Snapshot**: This document characterizes historical baseline settings drift prior to Phase 5D. It is a historical analysis, not proof of current configuration state. The current canonical contract uses `balanced-grid`, `primaryRegionRatio`, `primaryRegionCount`, `reconcileDebounceMs`, versioned `workspaceLayoutsJson`, and a supported `overlayPollingMs`. Current active authority and verification are tracked in [PHASE_5D_SECOND_PASS_AUDIT.md](PHASE_5D_SECOND_PASS_AUDIT.md).

---

## 1. Key Matrix Comparison

| Configuration Key | `contents/config/main.xml` | `tesserarc` (`DEFAULT_CONFIG`) | `kwinrc` (`sync_to_kwin`) | `contents/ui/main.qml` (`KWin.readConfig`) | Status / Architectural Defect |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `enableTiling` | Yes (true) | Yes (true) | Yes (bool) | Yes | Authoritative |
| `defaultLayout` | Yes ("master-stack") | Yes ("master-stack") | Yes (string) | Yes | Master-centric default |
| `gapInner` | Yes (8) | Yes (8) | Yes (int) | Yes | Authoritative |
| `gapOuter` | Yes (10) | Yes (10) | Yes (int) | Yes | Authoritative |
| `masterRatio` | Yes (0.50) | Yes (0.50) | Yes (float) | Yes | Master-centric naming |
| `masterCount` | Yes (1) | Yes (1) | Yes (int) | Yes | Master-centric naming |
| `perDesktopLayout` | Yes (true) | Yes (true) | **NO (Omitted)** | Yes | **Silent omission**: Visible control never persisted to KWin |
| `tileNewWindows` | Yes (true) | Yes (true) | **NO (Omitted)** | Yes | **Silent omission**: Visible control never persisted to KWin |
| `ignoreMinimized` | Yes (true) | Yes (true) | **NO (Omitted)** | Yes | **Silent omission**: Visible control never persisted to KWin |
| `showOsd` | Yes (true) | Yes (true) | Yes (bool) | Yes | Authoritative |
| `nvidiaDebounceMs` | Yes (60) | Yes (60) | Yes (int) | Yes | Misleading marketing ("NVIDIA" vs general debounce) |
| `smoothResize` | Yes (false) | Yes (false) | Yes (bool) | Yes | Unused/unverified in runtime |
| `gameWindowPolicy` | Yes ("floating") | Yes ("floating") | Yes (string) | Yes | Authoritative |
| `floatFilter` | Yes (comma-str) | Yes (comma-str) | Yes (string) | Yes | Inconsistent default filter strings |
| `customRulesJson` | Yes ("[]") | Yes (`customRules: []`) | Yes (JSON string) | Yes | JSON serialization |
| `desktopLayoutsJson` | Yes ("{}") | Yes (`desktopLayouts: {...}`) | Yes (JSON string) | Yes | JSON serialization, cross-desktop coupling |
| `overlayPollingMs` | **NO** | Yes (16) | Yes (int) | **NO** | Fictitious key written to kwinrc without KConfig schema |
| `animationMode` | **NO** | Yes ("off") | Yes (string) | **NO** | Fictitious key written to kwinrc without KConfig schema |
| `animationDurationMs` | **NO** | Yes (200) | Yes (int) | **NO** | Fictitious key written to kwinrc without KConfig schema |

---

## 2. Broken Command & UI Semantics

1. **Unverified Persistence (`ConfigManager.save`)**:
   - `save()` returns no boolean or error result.
   - `subprocess.run(cmd, check=False)` suppresses all non-zero exit codes.
   - Hardcoded `/usr/bin/kwriteconfig6` breaks on non-standard PATHs.
   - DBus invocation errors (`org.kde.KWin.reconfigure`) are discarded to `/dev/null`.
   - The GUI displays success unconditionally regardless of failure.
2. **Shallow Copy in ConfigManager**:
   - `self.config = DEFAULT_CONFIG.copy()` performs a shallow dictionary copy.
   - Mutating nested dictionaries (such as `desktopLayouts` or `customRules`) mutates the module-level `DEFAULT_CONFIG`.
3. **Hydration Auto-Save Storm**:
   - In `tessera-control/tessera_settings.py`, widget signals (`valueChanged`, `toggled`) are connected to `auto_sync_timer` (120ms single-shot) *before* `load_settings_into_ui()` executes.
   - Populating UI values on application startup triggers `auto_sync_timer.start(120)`, scheduling an unprompted save to disk and a KWin reconfigure/retile.
4. **Retile Now Triggers Unsolicited Save**:
   - In `tessera_settings.py`, `retile_kwin` explicitly calls `self.save_and_apply()`.
   - Clicking "Retile Now" persists any uncommitted draft modifications.
5. **Non-Existent Presets**:
   - Presets are advertised in documentation and UI comments, but zero preset catalog or implementation exists in the codebase.
6. **Obsolete Testing Dialogs**:
   - `MasterScreensTestDialog` invokes non-existent shortcuts (`Tessera: Show Master HUD`).

---

## 3. Package & Settings Distribution Mismatch

- **`contents/ui/config.ui`**:
  - Acts as a placeholder launcher page embedding `tessera://open` and directing the user to run `tessera-settings`.
- **`package.sh` (.kwinscript distribution)**:
  - Packages strictly `metadata.json` and `contents/` (11 entries).
  - Excludes `tessera-control/`, `bin/tessera-settings`, and `desktop/org.kde.tessera.desktop`.
- **Resulting Defect**:
  - A user installing Tessera from the KDE Store or `kpackagetool6` gets a non-functional configuration page referencing an application that was never installed on their machine.
  - Native configuration must be self-contained within `config.ui` using KConfig `kcfg_*` bindings.

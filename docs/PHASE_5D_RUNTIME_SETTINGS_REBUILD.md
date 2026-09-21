# Phase 5D — Slot-Based Runtime and Settings Foundation Rebuild

## 1. Executive Summary & Objective

Phase 5D resolves the architectural deficiencies identified during Phase 5B and Phase 5C before beginning Phase 6:
1. **Terminology and Conceptual Decoupling**: Replaces the overloaded "master" concept across runtime state, layouts, settings, and UI with modern **slot ordering** and **primary/stack** terminology, while maintaining strictly verified backward compatibility.
2. **Single Authoritative Runtime Coordinator**: Permanently eliminates dual authority in `contents/ui/main.qml` (including `retileLegacyFallback()`, local layout maps, and secondary order trackers) by consolidating all layout state, workspace scoping, and transaction planning within `RuntimeCoordinator`.
3. **Multi-Monitor and Corner Drag Fixes**: Resolves cross-monitor prospective preview corruption and corner quadrant slot flipping.
4. **Canonical Settings Contract & Transactional Persistence**: Replaces unvalidated, racing configuration writes with a transactional `ConfigManager`, canonical JSON schema (`config/canonical-config.json`), native KConfigXT bindings (`contents/ui/config.ui`), and an advanced PyQt Control Center (`tessera-control/tessera_settings.py`).

---

## 2. Architectural Rebuild: Scoped Slot Ordering

### 2.1 The Slot Ordering Model
In previous revisions, window order was tracked globally or per-screen using a mutable array that truncated when windows became fullscreen, minimized, or temporarily unmanaged.

Phase 5D introduces **Workspace Scoped Slot Ordering**:
- Every virtual workspace is defined by an output and virtual desktop scope: `"${outputId}:${desktopId}"`.
- `RuntimeCoordinator` maintains a dedicated `WorkspaceLayoutState` for each scope:
  ```typescript
  export interface WorkspaceLayoutState {
    readonly outputId: string;
    readonly desktopId: string;
    activeLayout: LayoutAlgorithm;
    primaryRegionRatio: number;
    primaryRegionCount: number;
    gaps: GapConfig;
    orderedSlotWindowIds: string[];
  }
  ```
- **Slot Order Invariance**: When a window enters fullscreen, minimizes, or becomes transient, its position in `orderedSlotWindowIds` is preserved. When the window exits fullscreen or un-minimizes, it returns to its exact previous slot without shifting peer windows.
- **Explicit Slot Operations**: Supports `moveWindowToSlot(wid, idx)`, `moveWindowToFirstSlot(wid)`, and `swapWindowSlots(widA, widB)`.

### 2.2 Layout Algorithm Modernization
- `solvePrimaryStack` (aliased to `solveMasterStack` for legacy compat) is the modern foundation for split-pane tiling.
- Options support `primaryRegionRatio` (default `0.50`) and `primaryRegionCount` (default `1`).
- Default layout fallback is normalized to `balanced-grid` (with `master-stack` fallback when specified for simulator trace fidelity).

### 2.3 Elimination of Dual Authority in QML
Prior to Phase 5D, `contents/ui/main.qml` maintained shadow dictionaries (`desktopLayouts`, `screenTiledWindows`, `persistentScreenOrder`, `screenLayouts`, `screenMasterRatios`, `screenMasterCounts`) and a legacy fallback retiler (`retileLegacyFallback`).

In Phase 5D:
- `retileLegacyFallback()` is **completely deleted**.
- Shadow maps are **completely removed**.
- All window addition, removal, geometry updates, state changes, and snap actions route exclusively into `RuntimeCoordinator.ingestEvent(...)`.
- `retileNow` and `retileScreen` invoke `performReconciliation()` through the coordinator.

---

## 3. Bug Fixes in Runtime & Interaction

### 3.1 Multi-Monitor Drag Preview Isolation
- **Symptom**: In multi-monitor setups, hovering a dragged window over snap zones on monitor 2 caused windows on monitor 1 to warp, jump, or take the whole screen.
- **Root Cause**: `previewProspectiveLayout` in `main.qml` calculated prospective frames using `activeScreenGeom` (often monitor 1) and directly mutated `other.frameGeometry` on live windows across all screens during drag hover.
- **Resolution**: Removed premature live geometry mutations during drag hover. The visual KZones-style snap card overlay already clearly indicates prospective target bounds without destabilizing peer windows. Real window retiling only executes upon `WindowSnapCommitted`.

### 3.2 Corner Snap Zone Slot Inversion
- **Symptom**: Snapping a window to top-right worked, but dragging to bottom-right inverted top and bottom right windows.
- **Root Cause**: In `apps/kwin-adapter/src/snap-zones.ts`, both `top-right` and `bottom-right` zones were assigned `slotIndex: 1`. In a 3-window primary+stack configuration, inserting at index 1 repeatedly flipped secondary stack slots.
- **Resolution**: Assigned distinct, unambiguous slot indices:
  - Top-Left: `slotIndex: 0`
  - Top-Right: `slotIndex: 1`
  - Bottom-Right: `slotIndex: 2`
  - Bottom-Left: `slotIndex: 3`

---

## 4. Settings Architecture & Native KConfigXT Bindings

### 4.1 Canonical Schema & Transactional Manager
- **Schema (`config/canonical-config.json`)**: Declares canonical keys, types, defaults, and bounds.
- **Migration**: Transparently reads legacy `~/.config/tesserarc` and migrates valid values into `~/.config/kwinrc` under `[Script-tessera]`.
- **Atomic Writes**: Uses temporary files with atomic `os.replace` to prevent corrupted configs on sudden termination.
- **Dirty Tracking & Rollback**: Edits are staged in a draft. If validation or KWin notification fails, writes are rolled back automatically.
- **Zero-Hydration Side Effects**: Eliminated timer-based autosave storms during UI loading.

### 4.2 Native KConfig UI (`contents/ui/config.ui`)
Rebuilt with standard Qt Designer UI XML containing native `kcfg_*` widgets mapping to `contents/config/main.xml`:
- `kcfg_enableTiling` (QCheckBox)
- `kcfg_defaultLayout` (QComboBox)
- `kcfg_gapInner` (QSpinBox)
- `kcfg_gapOuter` (QSpinBox)
- `kcfg_primaryRegionRatio` (QDoubleSpinBox)
- `kcfg_primaryRegionCount` (QSpinBox)
- `kcfg_tileNewWindows` (QCheckBox)
- `kcfg_ignoreMinimized` (QCheckBox)
- `kcfg_perDesktopLayout` (QCheckBox)
- `kcfg_showOsd` (QCheckBox)
- `kcfg_reconcileDebounceMs` (QSpinBox)
- `kcfg_gameWindowPolicy` (QComboBox)
- `kcfg_floatFilter` (QLineEdit)

### 4.3 Advanced Control Center (`tessera-control/tessera_settings.py`)
- Rebuilt using `ConfigManager` and `presets.py`.
- Features clean tabs: Layouts & Presets, Gaps & Primary Region, Workspaces, Window Rules, Performance & Motion, Shortcuts.
- Removed fictitious "Master Screens Test Dialog" and performance theater.
- Provides strict button actions: Retile Now, Reset, Restore Defaults, Save & Apply.

---

## 5. Verification Summary

| Test Suite | Commands | Results |
| :--- | :--- | :--- |
| **Monorepo Unit & Integration** | `npm test` | 22 test files, 270 tests passed (100%) |
| **Runtime Simulator Goldens** | `npm run sim:verify` | 25/25 fixtures matched with invariants satisfied |
| **Protocol V1 Freeze Manifest** | `npm run verify:freeze` | 7/7 tests passed (byte-for-byte identical) |
| **Artifact Sync Check** | `npm run verify:artifacts` | Zero diff against committed bundles |
| **Python Test Suite** | `python3 -m unittest discover -s tests` | 33 tests passed (100%) |
| **Package Build** | `./package.sh` | Deterministic reproducible `.kwinscript` bundle generated |

---

## 6. Remaining Live Gates for Omega

1. **Live Session Installation**: The rebuilt QML script, bundles, and KConfig UI have passed full simulated and automated suites. Installing them into the active running desktop via `kpackagetool6` or `install.sh` remains an operational live gate reserved for Omega.
2. **Daemon Decoupling**: The Rust daemon remains strictly disconnected from KWin and is ready for Phase 6.
3. **Repository Visibility**: Remains private until final pre-publication approval by Omega.

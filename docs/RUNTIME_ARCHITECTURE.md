# Tessera Runtime Architecture & Convergence Blueprint

> **Phase 0 Documentation**  
> Authoritative baseline map of runtime entrypoints, generated artifacts, inactive adapters, and migration boundaries.

---

## 1. Current QML Entrypoint (Active Runtime)

- **Manifest Declaration**: [`metadata.json`](../metadata.json) specifies:
  ```json
  "X-Plasma-API": "declarativescript",
  "X-Plasma-MainScript": "ui/main.qml"
  ```
- **Execution Context**: Loaded directly by KWin 6.3.6 under X11 into the Qt 6.8 QML runtime as a `DeclarativeScript`.
- **Authoritative File**: [`contents/ui/main.qml`](../contents/ui/main.qml)
- **Responsibilities**:
  - Hooks KWin workspace signals (`windowAdded`, `windowRemoved`, `windowActivated`, `currentDesktopChanged`, `screensChanged`).
  - Manages per-window event connections (`frameGeometryChanged`, `minimizedChanged`, `fullScreenChanged`, `interactiveMoveResizeStarted/Stepped/Finished`).
  - Renders the KZones-style visual snap overlay via `PlasmaCore.Dialog` (top maximize card, left/right halves, and 4 corner quadrants).
  - Renders the visual Master HUD dialog (`masterHudDialog`).
  - Dispatches native Plasma OSD notifications via DBus (`org.kde.osdService` / `showText`).
  - Resolves multi-screen affinity with mouse cursor prioritization (`getCurrentTargetScreen()`).
  - Retiles managed windows by invoking the layout calculation module.

---

## 2. Generated Layout Bridge

- **Authoritative File**: [`contents/code/layouts.js`](../contents/code/layouts.js)
- **Role**: High-performance mathematical layout geometry calculation bridge consumed by `main.qml`:
  ```qml
  import "../code/layouts.js" as LayoutsModule
  ```
- **Build Pipeline**: Generated automatically by `esbuild` from the TypeScript monorepo source ([`apps/kwin-adapter/src/qml-compat.ts`](../apps/kwin-adapter/src/qml-compat.ts)) which imports [`@tessera/layout-core`](../packages/layout-core).
- **Exported API**:
  - `Layouts.masterStack(area, count, options)`
  - `Layouts.balancedGrid(area, count, options)`
  - `Layouts.grid(area, count, options)`
  - `Layouts.binarySplit(area, count, options)`
  - `Layouts.columns(area, count, options)`
  - `Layouts.rows(area, count, options)`
  - `Layouts.monocle(area, count, options)`
  - `Layouts.applyGaps(rect, gapInner, gapOuter, ...)`
  - `Layouts.supportedLayouts`
- **Integrity Guarantee**: Enforced in CI and release workflows via `npm run verify:artifacts` (`git diff --exit-code contents/code/layouts.js`). Releases cannot package stale or drifted layout algorithms.

---

## 3. Generated Rules Bridge

- **Authoritative File**: [`contents/code/rules.js`](../contents/code/rules.js)
- **Role**: Authoritative window classification and filtering bridge consumed by `main.qml`:
  ```qml
  import "../code/rules.js" as RulesModule
  ```
- **Build Pipeline**: Generated automatically by `esbuild` from the TypeScript monorepo source ([`apps/kwin-adapter/src/qml-rules-compat.ts`](../apps/kwin-adapter/src/qml-rules-compat.ts)) which imports [`@tessera/rules-engine`](../packages/rules-engine).
- **Exported API**:
  - `RuleEngine.classify(window, options)`: Returns structured `{ classification, reason, source, matchedRuleId, matchedPattern }`.
  - `RuleEngine.shouldFloat(window, userFilterString, customRulesJson, gameWindowPolicy)`: Boolean check for legacy/convenience callers.
  - `RuleEngine.isIgnored(window)`: Boolean check for unmanaged and non-normal surfaces.
  - `RuleEngine.defaultFloatPatterns`: Immutable list of patterns floated by default (Tessera Control Center).
- **Game-Safe Classification & Precedence**:
  1. Unmanaged / non-normal surfaces -> `ignored` (source: `runtime`).
  2. True fullscreen (`fullScreen === true`) -> `fullscreen` (source: `runtime`; cannot be overridden by user tile rule).
  3. Explicit user rules (custom rules / user filter) -> `user-rule` (can override default game recognition or fallback).
  4. Fullscreen-like borderless state (`noBorder === true`, `maximizeMode === 0`, geometry covers >= 98% of physical output with tolerance <= 5px) -> `fullscreen-like` (source: `runtime`).
  5. Default game recognition (`steam_app_*`, `gamescope`, custom patterns; excludes ordinary Steam client and generic Wine without game identity) -> follows `gameWindowPolicy` (default: `floating`, source: `default-rule`).
  6. Dialog / transient -> `dialog` (source: `runtime`).
  7. Default float patterns (Tessera Control Center) -> `floating` (source: `default-rule`).
  8. Default fallback -> `tiled` (source: `fallback`).
- **Integrity Guarantee**: Enforced in CI and release workflows via `npm run verify:artifacts` (`git diff --exit-code contents/code/layouts.js contents/code/rules.js`). Releases cannot package stale or drifted rule logic.

---

## 4. Generated Reconciler Bridge (Phase 2A)

- **Authoritative File**: [`contents/code/reconciler.js`](../contents/code/reconciler.js)
- **Role**: Retained state coordinator and coalesced reconciliation pipeline bridge consumed by `main.qml`:
  ```qml
  import "../code/reconciler.js" as ReconcilerModule
  ```
- **Build Pipeline**: Generated automatically by `esbuild` from the TypeScript monorepo source ([`apps/kwin-adapter/src/qml-reconciler-compat.ts`](../apps/kwin-adapter/src/qml-reconciler-compat.ts)) which imports [`@tessera/layout-core`](../packages/layout-core), [`@tessera/rules-engine`](../packages/rules-engine), and [`RuntimeCoordinator`](../apps/kwin-adapter/src/runtime-coordinator.ts).
- **Exported API**:
  - `ReconcilerBridge.createCoordinator(config)`: Factory creating an isolated `RuntimeCoordinator`.
  - `ReconcilerBridge.getOrCreateCoordinator(config)`: Singleton accessor.
  - `ReconcilerBridge.toNormalizedWindow(w, screen, usableArea)`: Converts KWin window to serializable `NormalizedWindowInput`.
  - `ReconcilerBridge.toNormalizedScreen(scr, usableArea)`: Converts KWin screen to serializable `NormalizedScreenInput`.
- **Integrity Guarantee**: Enforced in CI and release workflows via `npm run verify:artifacts` (`git diff --exit-code HEAD -- contents/code/layouts.js contents/code/rules.js contents/code/reconciler.js`).

---

## 5. Retained State Ownership & Coalesced Reconciliation Architecture

Phase 2A introduces deterministic state retention and a coalesced transaction lifecycle:

### Retained State Ownership
- **QML Layer (`contents/ui/main.qml`)**: Owns KWin signal connections, UI visual dialogs (snap overlay and master HUD), KWin object normalization into serializable data, invoking the coordinator, and applying planned `win.frameGeometry` mutations. QML retains zero window/screen object pointers in durable state.
- **TypeScript Coordinator Layer (`apps/kwin-adapter/src/runtime-coordinator.ts`)**: Owns normalized retained state, event reduction, dirty-scope calculation, transaction planning, geometry diffing, echo suppression, and diagnostics counters.

### Event-to-Transaction Lifecycle
```
KWin Signal (e.g. windowAdded, fullScreenChanged, frameGeometryChanged)
  ↓
Normalize to serializable NormalizedWindowInput / NormalizedEvent
  ↓
Coordinator.ingestEvent(event)
  ├─ Check in-flight echo suppression (suppresses redundant echoes)
  ├─ Update RetainedWindowState / RetainedScreenState
  ├─ Reclassify only if classification inputs or config changed
  └─ Mark affected screen scope dirty & accumulate pending reasons
  ↓
QML scheduleReconcile() [Debounced/coalesced via single-shot Timer]
  ↓
Coordinator.reconcile()
  ├─ Snapshot dirty screens (unaffected screens are skipped)
  ├─ Extract ordered tileable windows (preserving persistentSlotOrder)
  ├─ Compute desired layout via @tessera/layout-core
  ├─ Diff desired vs lastObservedGeometry using documented pixel tolerance (1px)
  ├─ Generate GeometryOperation[] only for genuine delta
  └─ Increment transaction epoch & record in-flight echoes
  ↓
Apply geometry writes to KWin windows (guarded by isArranging flag)
```

### Dirty-Scope Rules
1. **Local Window Events**: An event for a window located on Output A (e.g. geometry change, maximize, border change) marks only Output A dirty. Output B is untouched and zero layout calculations are executed for it.
2. **Output Migration**: Moving a window from Output A to Output B marks both Output A (vacated slot) and Output B (new occupant) dirty.
3. **Global Configuration Changes**: Changes to inner/outer gaps, master ratios, or display topology invalidate all screens.
4. **No-Op Elimination**: If a dirty screen computation yields desired geometries that equal observed geometries (within 1px tolerance), zero writes are generated and no feedback loops occur.

### Geometry Echo Suppression
- When a geometry write is applied, the target rectangle is recorded in `inFlightEchoes` tagged with the current transaction epoch and timestamp.
- Incoming `frameGeometryChanged` events matching the recorded target (within 1px tolerance and 300ms window) are recognized as echoes, updating `lastObservedGeometry` without marking the screen dirty or scheduling a reconciliation pass.
- Mismatched external geometry changes (e.g. user manually moving a window) are not suppressed and properly invalidate the screen.

### Remaining Legacy / Runtime Duplication
- `contents/ui/main.qml` retains a synchronous fallback `retileLegacyFallback()`. In accordance with Phase 2B **Strict Runtime Path Exclusivity**, `runtimeMode` is initialized once (`"reconciler"` or `"legacy-fallback"`). Reconciler mode NEVER calls `retileLegacyFallback()`, and `retileLegacyFallback()` immediately returns if `runtimeMode !== "legacy-fallback"`.
- Visual overlays (`PlasmaCore.Dialog`) remain rendered in QML, but zone geometry calculation and cursor hover matching are delegated to pure TypeScript modules (`computeSnapZones`, `matchSnapZoneHover`).

---

## 6. Geometry Cache & Multi-Screen Affinity (Phase 2B)

Phase 2B completes the convergence of runtime geometry memory, multi-screen affinity resolution, and snap zone calculations into authoritative pure TypeScript:

### Authoritative Runtime Geometry Memory
- **`RuntimeCoordinator` Ownership**:
  - `currentDesiredTiledGeometry`: Persists desired layout geometry across all layout computations, unmaximize operations, and drag restore events.
  - `preMinimizeGeometry`: Captured synchronously on minimize events to preserve exact floating/tiled dimensions prior to being minimized.
  - `isPreTiled`: Tracks whether a window was tiled prior to minimize, maximize, or manual float operations.
  - `outputAffinity`: Retains the screen output association for every window across desktop and screen transitions.
- **QML Compatibility Layer**:
  - Helper functions `getSavedTiledGeometry(wid)`, `setSavedTiledGeometry(wid, rect)`, `getPreMinimizeGeometry(wid)`, and `setPreMinimizeGeometry(wid, rect)` synchronize transparently with `RuntimeCoordinator` in reconciler mode while providing seamless fallback.

### 7-Step Multi-Screen Affinity Precedence Hierarchy
Implemented in [`apps/kwin-adapter/src/screen-affinity.ts`](../apps/kwin-adapter/src/screen-affinity.ts):
1. **Explicit Valid Output Identity**: If the window manager or event provides a valid, connected output ID, select it.
2. **Window Center Point Containment**: If the window center `(cx, cy)` is contained within a screen's usable area or geometry, select that screen.
3. **Maximum Window Intersection Area**: If the window spans multiple monitors, select the screen with the largest intersection area.
4. **Previous Retained Affinity**: If no geometry matches, honor the window's previous valid retained output affinity.
5. **Cursor Position Containment**: If cursor position is provided, select the screen containing `(cursor.x, cursor.y)`.
6. **Deterministic Nearest-Output Fallback**: Calculate Euclidean distance from the window center (or cursor) to screen rectangles and select the nearest screen. Handles negative coordinates, stacked setups, and gaps between displays.
7. **Stable Lexical Tie-Breaker**: If multiple screens are equidistant, break ties deterministically by sorting `outputId` lexically.

### Pure Snap Zone Calculation Engine
Implemented in [`apps/kwin-adapter/src/snap-zones.ts`](../apps/kwin-adapter/src/snap-zones.ts):
- Pure computation of all 7 KZones-style snap targets and trigger boundaries:
  - Top Maximize Bar Card (Index 0)
  - Left Half / Master Slot (Index 1)
  - Right Half / Stack Slot (Index 2)
  - Top-Left Quarter (Index 3)
  - Bottom-Left Quarter (Index 4)
  - Top-Right Quarter (Index 5)
  - Bottom-Right Quarter (Index 6)
- Pure hover matching (`matchSnapZoneHover`) prioritizing corner quadrants over halves and maximize cards.


---

## 6. Inactive TypeScript Adapter (Phase 3+ Target)

- **Source Location**: [`apps/kwin-adapter/src/`](../apps/kwin-adapter/src/)
- **Bundle Output**: `dist/kwin-adapter.js` (standalone self-executing bundle)
- **Architecture**:
  - [`TilingEngine`](../apps/kwin-adapter/src/tiling-engine.ts): Type-safe KWin 6.3.6 event coordinator.
  - [`ScreenStateManager`](../apps/kwin-adapter/src/screen-state.ts): Isolated multi-screen state model.
  - [`RuntimeCoordinator`](../apps/kwin-adapter/src/runtime-coordinator.ts): State retention and transaction planner.
- **Current Status**: TypeScript engine is active via generated bridges (`layouts.js`, `rules.js`, `reconciler.js`) in `ui/main.qml`. Standalone adapter mode is reserved for future native TS runner.

---

## 7. Pruned Legacy Files (Phase 1B)

During Phase 1B (Runtime Surface Pruning), the following dead candidate files were rigorously audited across all imports, packaging scripts, manifest definitions, and runtime loaders. Having been proven completely inactive, they were permanently pruned from the codebase:

| File | Status | Proof of Inactivity |
| :--- | :--- | :--- |
| `contents/code/main.js` | **Pruned** | Legacy 1118-line monolithic JavaScript script from initial prototype. Inactive because `metadata.json` configures KWin in `declarativescript` mode with `ui/main.qml`; ignored by KWin runtime. No imports or packaging dependencies. |
| `contents/ui/tessera.qml` | **Pruned** | Superseded prototype declarative entrypoint. Inactive because `metadata.json` specifies `"X-Plasma-MainScript": "ui/main.qml"`. Not loaded or referenced anywhere. |
| `contents/ui/ZoneOverlay.qml`| **Pruned** | Standalone snap overlay experiment only loaded by the dead `tessera.qml`. Inactive because `contents/ui/main.qml` renders the KZones-style visual snap overlay inline via `PlasmaCore.Dialog`. |
| `contents/ui/TopNotification.qml` | **Pruned** | Notification overlay experiment only loaded by the dead `tessera.qml`. Inactive because `contents/ui/main.qml` uses native Plasma DBus OSD (`org.kde.osdService` / `showText`) and an inline HUD dialog. |

Absence of these files is enforced by automated packaging assertions in `.github/workflows/ci.yml` and unit tests in `tests/test_package_manifest.py`.

---

## 8. Deterministic Runtime Simulator (Phase 3)

- **Authoritative Package**: [`apps/runtime-simulator`](../apps/runtime-simulator)
- **Role**: Headless, offline test runner and trace replay harness that directly consumes the production TypeScript runtime modules:
  - [`RuntimeCoordinator`](../apps/kwin-adapter/src/runtime-coordinator.ts)
  - [`@tessera/layout-core`](../packages/layout-core)
  - [`@tessera/rules-engine`](../packages/rules-engine)
  - Screen affinity and snap zone geometry solvers.
- **Execution Architecture**:
  ```
  ┌────────────────────────────────────────────────────────┐
  │                 apps/runtime-simulator                 │
  │  ┌────────────────────────┐  ┌──────────────────────┐  │
  │  │ Trace Fixtures (1.0.0) │  │ Seeded PRNG Stress   │  │
  │  └───────────┬────────────┘  └──────────┬───────────┘  │
  │              │                          │              │
  │              ▼                          ▼              │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ RuntimeSimulator Engine & Injectable LogicalClock│  │
  │  └───────────────────────┬──────────────────────────┘  │
  │                          │                             │
  │                          ▼                             │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ Production RuntimeCoordinator (apps/kwin-adapter)│  │
  │  │   ├── @tessera/layout-core                       │  │
  │  │   └── @tessera/rules-engine                      │  │
  │  └───────────────────────┬──────────────────────────┘  │
  │                          │                             │
  │                          ▼                             │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ SimulatedKWinSession (Echo Simulation Boundary)  │  │
  │  │   (immediate, delayed, missing, mismatched, dup) │  │
  │  └───────────────────────┬──────────────────────────┘  │
  │                          │                             │
  │                          ▼                             │
  │  ┌──────────────────────────────────────────────────┐  │
  │  │ Canonical JSON Serialization & Invariant Checker │  │
  │  │   (13 Structural Rules, SHA-256 Digest)          │  │
  │  └──────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────┘
  ```
- **Guarantees**:
  - Zero wall-clock dependence via `LogicalClock`.
  - Turn-based event coalescing and explicit flush boundaries.
  - Byte-level determinism with deep key-sorted canonical JSON.
  - Verification enforced in CI via `npm run sim:verify`.
  - Strictly excluded from release `.kwinscript` bundles.

---

## 9. Intended Migration Boundary

Future convergence will separate concerns across strict architectural layers:

```
┌────────────────────────────────────────────────────────┐
│                   KWin Script Host                     │
│  ┌───────────────────────────┐ ┌────────────────────┐  │
│  │   apps/kwin-adapter       │ │   contents/ui/     │  │
│  │   (Realtime Event Loop)   │ │   (QML Overlays)   │  │
│  └─────────────┬─────────────┘ └─────────┬──────────┘  │
│                │                         │             │
│  ┌─────────────▼─────────────────────────▼──────────┐  │
│  │         packages/layout-core (Pure Math)         │  │
│  │         packages/rules-engine (Classification)   │  │
│  │         packages/protocol (Domain Types)         │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────▲────────────────────────────┘
                            │ (Asynchronous Unix Socket / DBus)
┌───────────────────────────▼────────────────────────────┐
│          Cold-Path Companion Daemon (Phase 3+)         │
│  - Configuration persistence, CLI tooling, IPC         │
│  - Zero IPC on KWin layout hot path                    │
│└───────────────────────────────────────────────────────┘
```

---

## 10. Critical Features to Preserve During Migration

Any subsequent convergence or refactoring MUST preserve the following runtime invariants:

1. **Cursor-Prioritized Multi-Screen Targeting**: Master count adjustments and layout switches target the monitor under the cursor (`Workspace.cursorPos`). Screen 0 changes never contaminate Screen 1.
2. **50/50 2-Window Split**: When 2 windows are present, they must split 50/50 side-by-side.
3. **0-Masters Balanced Square Grid**: Setting `masterCount: 0` must delegate to `solveBalancedGrid` (4 equal quarters for 4 windows, 5-pane center stack for 5 windows, symmetrical square partitions for $N \ge 6$).
4. **Maximized Window Slot Memory**: Maximized windows do not break background tiling. When unmaximized, they must return directly to their designated tile.
5. **Minimized Window Slot Persistence**: Windows restored from minimize must preserve their slot index in `persistentScreenOrder` without reshuffling active windows.
6. **X11 Echo Suppression**: Programmatic frameGeometry assignments must suppress feedback loops to prevent compositor stutter and oscillation.
7. **KZones-Style 60 FPS Overlay**: Live mouse-tracking preview cards with visual drop feedback.
8. **Native DBus OSD & Master HUD**: Clean user feedback upon layout switching and master adjustments.

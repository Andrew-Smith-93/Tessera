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

## 3. Inactive TypeScript Adapter

- **Source Location**: [`apps/kwin-adapter/src/`](../apps/kwin-adapter/src/)
- **Bundle Output**: `dist/kwin-adapter.js` (34 KB standalone self-executing bundle)
- **Architecture**:
  - [`TilingEngine`](../apps/kwin-adapter/src/tiling-engine.ts): Type-safe KWin 6.3.6 event coordinator.
  - [`ScreenStateManager`](../apps/kwin-adapter/src/screen-state.ts): Isolated multi-screen state model.
  - [`EchoFilter`](../apps/kwin-adapter/src/echo-filter.ts): Tokenized X11 `frameGeometryChanged` echo suppressor.
  - [`registerShortcuts`](../apps/kwin-adapter/src/shortcuts.ts): KWin global shortcut binding.
- **Current Status**: **Inactive** at runtime because `metadata.json` delegates execution to `ui/main.qml`.
- **Purpose**: Serves as the foundation for the Phase 1/2 runtime convergence where KWin scripting logic transitions completely into TypeScript with verified type safety.

---

## 4. Duplicated & Dead Candidate Files

The following files exist in the repository but represent legacy or duplicated code paths. Per Phase 0 constraints, they are preserved and documented here rather than prematurely deleted:

| File | Status | Rationale |
| :--- | :--- | :--- |
| `contents/code/main.js` | **Dead Candidate** | Legacy 1118-line monolithic script containing obsolete layout and rule code. Ignored by KWin when running in `declarativescript` mode (`ui/main.qml`). |
| `contents/code/rules.js` | **Duplicated Candidate** | 105-line legacy rule engine superseded by `@tessera/rules-engine`. |
| `contents/ui/tessera.qml` | **Dead Candidate** | Older alternative declarative entrypoint superseded by `contents/ui/main.qml`. |
| `contents/ui/ZoneOverlay.qml`| **Dead Candidate** | Standalone QML overlay experiment; snap overlay is now rendered inline inside `main.qml`. |
| `contents/ui/TopNotification.qml` | **Dead Candidate** | Custom notification overlay; superseded by native Plasma DBus OSD service. |

---

## 5. Intended Migration Boundary

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
└────────────────────────────────────────────────────────┘
```

---

## 6. Critical Features to Preserve During Migration

Any subsequent convergence or refactoring MUST preserve the following runtime invariants:

1. **Cursor-Prioritized Multi-Screen Targeting**: Master count adjustments and layout switches target the monitor under the cursor (`Workspace.cursorPos`). Screen 0 changes never contaminate Screen 1.
2. **50/50 2-Window Split**: When 2 windows are present, they must split 50/50 side-by-side.
3. **0-Masters Balanced Square Grid**: Setting `masterCount: 0` must delegate to `solveBalancedGrid` (4 equal quarters for 4 windows, 5-pane center stack for 5 windows, symmetrical square partitions for $N \ge 6$).
4. **Maximized Window Slot Memory**: Maximized windows do not break background tiling. When unmaximized, they must return directly to their designated tile.
5. **Minimized Window Slot Persistence**: Windows restored from minimize must preserve their slot index in `persistentScreenOrder` without reshuffling active windows.
6. **X11 Echo Suppression**: Programmatic frameGeometry assignments must suppress feedback loops to prevent compositor stutter and oscillation.
7. **KZones-Style 60 FPS Overlay**: Live mouse-tracking preview cards with visual drop feedback.
8. **Native DBus OSD & Master HUD**: Clean user feedback upon layout switching and master adjustments.

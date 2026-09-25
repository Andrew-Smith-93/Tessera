# Tessera Runtime Architecture Specification

> **Authoritative Technical Specification**: This document details the runtime architecture, component structure, data flow, and reconciliation pipeline of Tessera for KDE Plasma 6.

---

## 1. System Overview & Architectural Principles

Tessera is an automatic dynamic tiling window manager designed natively for KDE Plasma 6. It operates strictly as an in-process KWin declarative script with bundled mathematical bridges and native KDE System Settings integration.

### Core Principles
1. **In-Process KWin Execution**: Tessera executes directly within KWin's QML and JavaScript runtime. Zero background daemons, external services, or standalone helper processes are required or shipped.
2. **Single Authoritative Coordinator**: All window ordering, slot assignments, geometry diffing, and transaction planning are centralized in `RuntimeCoordinator`. No competing shadow order maps exist.
3. **Turn-Based Event Coalescing**: Rapid bursts of compositor signals (e.g. multi-window launches or interactive resizing) coalesce into single, debounced reconciliation passes.
4. **Echo Suppression**: Programmatic window geometry writes are tracked and filtered to eliminate feedback loops and compositor stutter.
5. **Region Occupancy Model**: Explicit user drag-and-drop snaps to halves, corner quadrants, and 3 equal pillars coexist deterministically with custom user resizes and layout-inferred window placements.
6. **Cancellation-Safe Animations**: Smooth easing transitions apply only while windows remain valid and managed; closed, fullscreen, or user-dragged windows cancel immediately without stale geometry writes.
7. **Native KConfigXT Settings**: Configuration is declared via KConfigXT schemas and edited directly in KDE System Settings without external configuration tools.

---

## 2. Shipped Component Architecture

The following diagram illustrates the components shipped in the production Tessera `.kwinscript` package:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                             KDE Plasma 6 / KWin Runtime                              │
│                                                                                      │
│  ┌──────────────────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │           Declarative Script Host            │  │  Native Configuration (KCM)  │  │
│  │           (contents/ui/main.qml)             │  │  (contents/ui/config.ui)     │  │
│  │                                              │  │  (contents/config/main.xml)  │  │
│  │  • KWin Workspace & Window Signals           │  └──────────────┬───────────────┘  │
│  │  • 12-Zone Visual Snap Overlay               │                 │                  │
│  │  • Plasma DBus OSD (org.kde.osdService)      │                 │ Reads & Writes   │
│  │  • Safe Window Animator (cubic easing)       │                 ▼                  │
│  │  • Central Window Geometry Commit Sink       │◄───── ~/.config/kwinrc             │
│  │  • 22 Super-Primary Global Shortcuts         │       [Script-tessera]             │
│  └──────────────────────┬───────────────────────┘                                    │
│                         │                                                            │
│                         │ imports ReconcilerModule exclusively                       │
│                         ▼                                                            │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ reconciler.js (Active Runtime Bridge — Compiled via esbuild)                   │  │
│  │                                                                                │  │
│  │  • RuntimeCoordinator (Single In-Process Retained State Authority)             │  │
│  │    ├─ Retained State Management (Screens, Workspaces, Window Slots)            │  │
│  │    ├─ 7-Step Multi-Screen Affinity Resolution                                  │  │
│  │    ├─ Region Occupancy Model & Cross-Family Collision Resolution               │  │
│  │    ├─ Turn-Based Event Coalescing & Dirty-Scope Detection                      │  │
│  │    ├─ In-Flight Geometry Echo Suppression Filter                               │  │
│  │    └─ Transaction Planning & Minimal Delta Geometry Operations                 │  │
│  │                                                                                │  │
│  │  • Statically Bundled Core Modules (Compiled Inlined):                         │  │
│  │    ├─ @tessera/layout-core (Balanced Grid, Primary-Stack, BSP, Columns, Rows)  │  │
│  │    ├─ @tessera/rules-engine (Window Classifier & Policy Resolution)            │  │
│  │    └─ Snap Zone Math (12 Zones, Cursor Targeting, Region Transitions)          │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Standalone Compatibility Bridges (Packaged in .kwinscript, NOT imported by QML)│  │
│  │                                                                                │  │
│  │  • layouts.js: Standalone @tessera/layout-core bridge (isolated tests)         │  │
│  │  • rules.js:   Standalone @tessera/rules-engine bridge (isolated tests)        │  │
│  │  (Zero runtime invocation by main.qml; zero shared mutable state)              │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Shipped Component Specifications

### 3.1 Declarative Script Host (`contents/ui/main.qml`)
- **Type**: Qt 6 Quick / QML DeclarativeScript loaded by KWin 6.
- **Manifest**: Declared in `metadata.json` (`"X-Plasma-API": "declarativescript"`, `"X-Plasma-MainScript": "ui/main.qml"`).
- **Signal Hooks**:
  - Workspace level: `windowAdded`, `windowRemoved`, `windowActivated`, `currentDesktopChanged`, `screensChanged`.
  - Window level: `frameGeometryChanged`, `minimizedChanged`, `fullScreenChanged`, `desktopsChanged`, `activitiesChanged`, `interactiveMoveResizeStarted/Stepped/Finished`.
- **Visual Snap Overlay**: Renders interactive drop preview targets when dragging windows near screen edges or trigger regions.
- **OSD Integration**: Dispatches notifications via DBus (`org.kde.osdService /showText`) on region snapping, tiling toggle, floating toggle, and workspace retiling.
- **Single Commit Sink**: All programmatic window geometry assignments route exclusively through `commitWindowGeometry(win, targetRect, reason, epoch)`.

### 3.2 Active Runtime Bridge (`contents/code/reconciler.js`)
- **Role**: The **sole** active JavaScript runtime bridge imported by `contents/ui/main.qml` (`import "../code/reconciler.js" as ReconcilerModule`).
- **Source**: Compiled via `esbuild` from `apps/kwin-adapter/src/qml-reconciler-compat.ts` and `apps/kwin-adapter/src/runtime-coordinator.ts`.
- **Statically Inlines**: Directly bundles `@tessera/layout-core`, `@tessera/rules-engine`, and snap geometry mathematics into a single cohesive runtime bundle.
- **QML-Owned Coordinator Lifecycle**: The coordinator instance is owned and retained directly by the QML script host (`property var coordinator: null` in `contents/ui/main.qml`). Upon first access or configuration load, `getCoordinator()` calls `ReconcilerModule.ReconcilerBridge.createCoordinator(config)` and caches the instance in `root.coordinator`. The bridge's exported module-level helper `getOrCreateCoordinator(config)` is not consumed by QML; instance lifetime and state persistence are bound directly to the active QML component lifecycle.
- **Normalizer**: Converts live KWin objects to serializable records (`toNormalizedWindow`, `toNormalizedScreen`).
- **Workspace Scoping**: Maintains collision-safe workspace scopes (`encodeURIComponent(outputId) + "//" + encodeURIComponent(desktopId)`).
- **Slot Persistence**: Preserves window slot assignments across minimize, restore, and fullscreen cycles.

### 3.3 Standalone Layout Bridge (`contents/code/layouts.js`)
- **Role**: Standalone compatibility bridge packaged in `.kwinscript` for isolated contract validation and independent testing.
- **Source**: Compiled via `esbuild` from `apps/kwin-adapter/src/qml-compat.ts` importing `@tessera/layout-core`.
- **Runtime Execution**: **None during standard operation.** `main.qml` does not import `layouts.js`; all layout mathematics during active reconciliation execute through the inlined `layout-core` solvers inside `reconciler.js`. Zero shared state exists between `layouts.js` and `RuntimeCoordinator`.

### 3.4 Standalone Window Rules Bridge (`contents/code/rules.js`)
- **Role**: Standalone compatibility bridge packaged in `.kwinscript` for isolated rule engine testing.
- **Source**: Compiled via `esbuild` from `apps/kwin-adapter/src/qml-rules-compat.ts` importing `@tessera/rules-engine`.
- **Runtime Execution**: **None during standard operation.** `main.qml` does not import `rules.js`; window classification during active reconciliation executes through the inlined `rules-engine` modules inside `reconciler.js`. Zero shared state exists between `rules.js` and `RuntimeCoordinator`.

### 3.5 Native Configuration Interface
- **`contents/config/main.xml`**: Canonical KConfigXT schema declaring types, keys, and default values.
- **`contents/ui/config.ui`**: Qt Designer form embedded directly in KDE System Settings (Window Management → KWin Scripts → Tessera).

---

## 4. Reconciliation Lifecycle & Data Flow

```
 Compositor Signals             Declarative QML                   RuntimeCoordinator
────────────────────           ─────────────────                 ────────────────────
         │                             │                                   │
Window Created / Moved                 │                                   │
         ├────────────────────────────►│                                   │
         │                             │ toNormalizedWindow()              │
         │                             │ toNormalizedScreen()              │
         │                             ├──────────────────────────────────►│
         │                             │                                   │ ingestEvent()
         │                             │                                   │   ├─ Check EchoFilter
         │                             │                                   │   ├─ Update Retained State
         │                             │                                   │   └─ Mark Screen Scope Dirty
         │                             │                                   │
         │                       reconcileTimer (60ms debounced)           │
         │                             ├──────────────────────────────────►│
         │                             │                                   │ reconcile()
         │                             │                                   │   ├─ Resolve Screen Affinity
         │                             │                                   │   ├─ Resolve Region Occupancy
         │                             │                                   │   ├─ Solve Layout Geometry
         │                             │                                   │   ├─ Diff vs Observed (>1px)
         │                             │◄──────────────────────────────────┤   └─ Record In-Flight Echoes
         │                             │ Emit GeometryOperation[]          │
         │                             │                                   │
         │   commitWindowGeometry()    │                                   │
         │◄────────────────────────────┤                                   │
         │ (or animateWindow)          │ recordCommand(wid, target, epoch) │
         │                             ├──────────────────────────────────►│
         │                             │                                   │ Record expected geometry in EchoFilter
         │                             │                                   │
frameGeometryChanged (Echo)            │                                   │
         ├────────────────────────────►│                                   │
         │                             │ checkAndHandleEcho(wid, observed) │
         │                             ├──────────────────────────────────►│
         │                             │                                   │ Matched echo -> Suppressed!
         │                             │                                   │ (Redundant retile prevented)
```

### Dirty-Scope Calculation Rules
- **Local Window Events**: An event for a window on Screen A marks only Screen A dirty. Screen B computation is completely bypassed.
- **Output Migration**: Moving a window between screens marks both the source (vacated slot) and destination (new occupant) scopes dirty.
- **Configuration Changes**: Global gap or policy adjustments mark all active scopes dirty.
- **No-Op Pruning**: If computed rectangles match observed rectangles within 1px tolerance, zero writes are issued.

---

## 5. Region Occupancy Model & 12 Snap Zones

Tessera implements a deterministic **Region Occupancy Model** that resolves interactions between explicit snaps, custom keyboard/drag resizes, and automatic layout tiling:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        12 Visual Snap Zones                            │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    Top Maximize Bar (maximize)                   │  │
│  ├─────────────────┬──────────────────────────────┬─────────────────┤  │
│  │                 │    Center Top (center-top)   │                 │  │
│  │                 ├──────────────────────────────┤                 │  │
│  │                 │ Center Bottom (center-bottom)│                 │  │
│  │                 ├──────────────────────────────┤                 │  │
│  │   Left Half     │  Center Pillar (full height) │   Right Half    │  │
│  │  (left-half)    │       (center-pillar)        │  (right-half)   │  │
│  │                 ├──────────────────────────────┤                 │  │
│  │                 │         Left Pillar          │   Right Pillar  │  │
│  │                 │        (left-pillar)         │  (right-pillar) │  │
│  ├─────────────────┼──────────────────────────────┼─────────────────┤  │
│  │ Top-Left Corner │                              │Top-Right Corner │  │
│  │    (top-left)   │                              │   (top-right)   │  │
│  ├─────────────────┤                              ├─────────────────┤  │
│  │Bottom-Left Corn.│                              │Bottom-Right Corn│  │
│  │  (bottom-left)  │                              │  (bottom-right) │  │
│  └─────────────────┴──────────────────────────────┴─────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Geometric Collision Resolution
When windows belonging to different snap families occupy the same screen:
- **Left-Half vs. Center-Pillar**: A left-half peer automatically adapts to the left pillar when a center pillar window is committed, avoiding geometric overlap.
- **Quadrant vs. Center-Split**: A top-left quadrant peer adapts to the top half of the left pillar when center-top is committed.
- **Custom Resize Priority**: Windows with active custom resize rectangles (`customTiledGeometry`) maintain their dimensions unless superseded by an explicit snap drop.
- **Overcrowding Safeguard**: Overcrowded regions clamp to valid non-negative, non-zero dimensions with guaranteed minimum bounds (`minW >= 40px`, `minH >= 30px`).

---

## 6. Safe Window Animation Engine

Smooth transitions between layout states are managed by `windowAnimator` inside `contents/ui/main.qml`:

- **Easing Curve**: Smooth cubic deceleration (`easeOutCubic(t) = 1 - (1 - t)^3`).
- **Configurable Duration**: Defaults to 180ms, adjustable via `animationDurationMs` in configuration.
- **Cancellation Safety**:
  - If a window is unmapped, closed, minimized, switched to fullscreen, or dragged by the user, the active animation cancels immediately **without writing the stale target rectangle**.
  - Subsequent layout retargeting transitions retarget smoothly from the window's current observed position.

---

## 7. Global Shortcuts Architecture

Tessera registers 22 canonical keyboard shortcuts under KDE Plasma's Global Shortcuts (`kglobalshortcutsrc`). All shortcuts use the Super (<kbd>Meta</kbd>) modifier:

- **Tiling & Overlay Controls**:
  - `Meta+Shift+C`: Toggle Zone Overlay
  - `Meta+Shift+T`: Toggle Tiling Globally
  - `Meta+Shift+F`: Toggle Active Window Floating
  - `Meta+Shift+R`: Force Retile Current Workspace
- **Region Snapping & Placement**:
  - `Meta+Left`: Move Window to Left Snap Region
  - `Meta+Right`: Move Window to Right Snap Region
  - `Meta+Up`: Move Window to Upper Snap Region
  - `Meta+Down`: Move Window to Lower Snap Region
- **Keyboard Resize**:
  - `Meta+Shift+Right` / `Meta+Shift+Left`: Expand / Shrink Window Width
  - `Meta+Shift+Down` / `Meta+Shift+Up`: Expand / Shrink Window Height
- **Multi-Monitor Migration**:
  - `Meta+Ctrl+Left` / `Meta+Ctrl+Right`: Move Window to Screen Left / Right
  - `Meta+Ctrl+Up` / `Meta+Ctrl+Down`: Move Window to Screen Above / Below
- **Spatial Focus & Window Swapping (WASD)**:
  - `Meta+Alt+A` / `Meta+Alt+D` / `Meta+Alt+W` / `Meta+Alt+S`: Focus Left / Right / Up / Down
  - `Meta+Alt+Q` / `Meta+Alt+E`: Swap Window Left / Right

User-customized keybindings and empty bindings are preserved across installer executions. Preserved legacy shortcut keys in `kglobalshortcutsrc` from earlier versions are retained to prevent configuration loss, but remain **dormant** because the active QML runtime only registers the 22 canonical `ShortcutHandler` actions. Opt-in spatial migration (`./install.sh --migrate-spatial-shortcuts`) transfers legacy bindings from retired cyclical actions (such as `Focus Next Window`) to active 2D directional replacements (such as `Focus Right Window`), adopting directional spatial navigation.

---

## 8. Development, Testing & Verification Infrastructure

The repository is organized as a monorepo separating production runtime code from verification tools:

- **Authoritative Modules**:
  - `packages/layout-core`: Mathematical layout solvers and geometry models.
  - `packages/rules-engine`: Window classification and rule matching.
  - `apps/kwin-adapter`: Runtime coordinator, dirty-scope tracking, and snap zone calculations.
- **Offline Simulation Framework**:
  - `apps/runtime-simulator`: Headless KWin session emulator with an injectable logical clock. Validates 25 golden trace scenarios and seeded PRNG stress tests across 13 structural invariants.
- **Contract & Protocol Integrity**:
  - `packages/protocol`: Frozen Protocol V1 domain schemas (`protocol-v1.freeze.json`).
- **Packaging Isolation**:
  - `./package.sh` builds the release `.kwinscript` bundle with a verified 12-entry manifest (including root `LICENSE` for recipient license integration), completely isolating runtime script code from development tools, simulator code, and test suites.

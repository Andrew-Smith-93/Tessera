# Tessera Runtime Simulator (`apps/runtime-simulator`)

The Tessera Runtime Simulator is a headless, deterministic simulation and trace-replay environment for Tessera's tiling window manager runtime.

It executes the production TypeScript runtime directly—including `RuntimeCoordinator`, `@tessera/layout-core` solvers, `@tessera/rules-engine`, and screen affinity algorithms—without requiring KDE Plasma, KWin, QML, X11/Wayland display servers, DBus, or a live desktop session.

---

## Architecture & Production Module Reuse

The simulator does **not** reimplement layout mathematics, rule classification, or geometry state tracking. Instead, it imports and drives the authoritative production modules:

```
[Trace Fixture (*.fixture.json)]
             │
             ▼
  [RuntimeSimulator Engine]
             │
             ├──► Injectable LogicalClock (tick-based, deterministic)
             ├──► Production RuntimeCoordinator (@tessera/kwin-adapter)
             │          ├──► @tessera/layout-core (solveMasterStack, solveBalancedGrid, etc.)
             │          ├──► @tessera/rules-engine (WindowRuleEngine)
             │          └──► Screen Affinity & Snap Zone Math
             │
             ▼
  [SimulatedKWinSession Boundary]
   (Emulates KWin geometry application & echo behaviors: immediate, delayed, missing, mismatched, duplicate)
             │
             ▼
  [Canonical JSON Serialization & Invariant Verification]
             │
             ├──► Invariant Validation (13 structural rules)
             ├──► Byte-level deterministic key sorting
             └──► SHA-256 State Digest
```

---

## Trace Schema Version 1.0.0

Trace fixtures use a versioned JSON schema (`schemaVersion: "1.0.0"`). Each fixture specifies:
- `schemaVersion`: Must be `"1.0.0"`.
- `name`: Descriptive fixture name.
- `description`: Scenario explanation.
- `initialConfig`: Coordinator configuration parameters (gaps, layout, master ratio, etc.).
- `initialScreens`: Initial display outputs and usable work areas.
- `initialWindows`: Initial windows in the session.
- `echoMode`: Geometry echo emulation mode (`immediate`, `delayed`, `missing`, `mismatched`, `duplicate`).
- `echoDelayTicks`: Tick delay before returning echoes in delayed mode.
- `events`: Array of discrete, ordered `TraceEvent` records.

### Supported Events
- `window-discovered`: Window mapped/created.
- `window-removed`: Window unmapped/destroyed.
- `geometry-change`: Observed geometry modification.
- `fullscreen-change`: Fullscreen state change.
- `no-border-change`: Borderless state change.
- `maximize-change`: Maximize mode transition.
- `minimize-change`: Minimize/restore transition.
- `output-move`: Window migration between screen outputs.
- `desktop-move`: Window virtual desktop switch.
- `screen-added`: New display output plugged in.
- `screen-removed`: Display output unplugged.
- `screen-geometry-change`: Display resolution or usable area change.
- `layout-change`: Algorithm change on specific output.
- `gap-change`: Inner/outer gap reconfiguration.
- `master-count-change`: Master area window count adjustment.
- `master-ratio-change`: Master split ratio adjustment.
- `rules-config-change`: Global configuration update.
- `cursor-position-update`: Cursor movement across zones.
- `snap-preview`: Visual snap zone hover preview.
- `snap-commit`: Drag-and-drop snap commit.
- `flush`: Turn boundary triggering coalesced reconciliation pass.
- `advance-clock`: Explicit logical tick advancement.

---

## Logical Clock & Coalescing Semantics

- **Zero Wall-Clock Dependence**: Wall-clock APIs (`Date.now()`, `performance.now()`) are replaced with an injectable `LogicalClock`.
- **Turn-based Coalescing**: Multiple events within a single turn coalesce into a single reconciliation pass when `flush` is called or at trace boundaries.
- **Echo Suppression Expiration**: Geometry write echo suppression respects logical tick advancement; echoes arriving beyond `echoExpiryMs` are treated as external changes.

---

## Invariant Verification

Every simulation run validates 13 structural invariants:
1. `SCREEN_RECT_NOT_FINITE` / `WINDOW_FRAME_NOT_FINITE` / `OPERATION_RECT_NOT_FINITE`: All coordinates are finite numbers.
2. `SCREEN_RECT_NEGATIVE_DIMENSIONS` / `WINDOW_FRAME_NEGATIVE_DIMENSIONS`: Widths and heights are nonnegative.
3. `TILED_GEOMETRY_OUT_OF_BOUNDS`: Active tiled windows reside inside screen usableArea.
4. `DUPLICATE_WINDOW_RETAINED`: Each window belongs to at most one output.
5. `WINDOW_OUTPUT_MISMATCH`: Window output affiliation matches screen list.
6. `TRANSACTION_EPOCH_NOT_STRICTLY_INCREASING`: Transaction epochs strictly increase monotonically.
7. `TILED_WINDOWS_OVERLAP`: Non-overlapping layouts (master-stack, grid, columns, rows, bsp) have zero overlap between active visible tiled windows.
8. Minimized and fullscreen windows are excluded from active tiling operations.
9. Persistent slot identity survives minimize and fullscreen restore cycles.
10. Expected geometry echoes do not cause feedback loops or redundant retiles.
11. No-op reconciliation produces zero geometry writes.
12. Output removal deterministically relocates windows to surviving screens.
13. Unaffected screens undergo zero recomputation.

---

## Canonicalization & Digest Rules

To guarantee cross-platform byte-identical golden output:
- **Key Sorting**: All JSON object keys are deeply sorted alphabetically.
- **Ordered Collections**: Screens, windows, and transactions are sorted by stable IDs.
- **Digest Calculation**: A SHA-256 hash is computed over canonical JSON (excluding the digest field itself).
- **Zero Environmental Artifacts**: Output contains no machine paths, OS usernames, or real-time timestamps.

---

## Seeded Deterministic Stress Testing

The simulator includes a Mulberry32 32-bit pseudo-random trace generator:
- **Deterministic**: A given integer seed generates the exact same sequence of events and final digest across runs and platforms.
- **Exploratory**: Tests window discoveries, removals, state transitions, output moves, gap changes, and flushes under high churn.
- **Automated Invariant Auditing**: Evaluates all invariants across every state change.

CI validates three fixed regression seeds: `42`, `12345`, and `99999`.

---

## Trace Recording & Redaction Boundary

`TraceRecorder` in `apps/kwin-adapter` provides an in-memory event recording facility:
- Disabled by default in production.
- Bounded memory buffer (evicts oldest events when capacity reached).
- Zero disk I/O, zero network access.
- Optional redaction of window titles, application IDs (`appId`), and resource classes.

---

## CLI Usage

Run simulator commands from the repository root:

```bash
# Verify all 25 fixtures against their committed goldens
npm run sim:verify

# Run a specific trace fixture
npm run sim:run -- apps/runtime-simulator/fixtures/01-single-screen-three-windows.fixture.json

# Run deterministic seeded stress test
npm run sim:run -- --seed 42

# Update golden files (explicit developer action)
npm run sim:update-goldens
```

CLI flags:
- `--verify-goldens`, `--verify`: Check all fixtures against goldens (default if no path given).
- `--update-goldens`, `--update`: Recompute and overwrite golden files.
- `--json`: Output full canonical JSON to stdout.
- `--quiet`, `-q`: Quiet mode for CI.
- `--seed <num>`: Run seeded Mulberry32 stress generator.
- `--help`, `-h`: Show usage instructions.

---

## Package Archive Safety

The runtime simulator is strictly a testing and verification framework. Packaging scripts (`package.sh` and `test_package_manifest.py`) enforce that no simulator code, fixtures, or CLI tools are packaged into the release `.kwinscript` bundle.

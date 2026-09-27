# 💠 Tessera (`K-Tessera`)

> **A native dynamic tiling window manager script for KDE Plasma 6.**

[![Platform: KDE Plasma 6](https://img.shields.io/badge/KDE_Plasma-6.0+-3daee9.svg?logo=kde&logoColor=white)](https://kde.org/plasma-desktop/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI](https://github.com/Andrew-Smith-93/Tessera/actions/workflows/ci.yml/badge.svg)](https://github.com/Andrew-Smith-93/Tessera/actions/workflows/ci.yml)
[![KDE Store](https://img.shields.io/badge/KDE_Store-2375512-3daee9.svg?logo=kde&logoColor=white)](https://store.kde.org/p/2375512/)
[![Release: v1.0.1](https://img.shields.io/badge/release-v1.0.1-blue.svg)](https://github.com/Andrew-Smith-93/Tessera/releases/tag/v1.0.1)

> [!IMPORTANT]
> **Release Verification & Public Baseline (`v1.0.1`)**:
> Tessera v1.0.1 has completed release verification and public transition.
> - **Automated Verification**: Monorepo TypeScript suites (448/448 passed across 29 suites), Python unit/contract/sandbox tests (82 fast tests passed locally across 8 modules; 25 installer integration tests partitioned across 3 shards: 9, 8, 8; total 107 tests across 9 modules passed), protocol freeze checks, and golden simulation traces (25/25 matching) pass cleanly. Detailed evidence stratification is audited in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md).
> - **Live Desktop Boundary**: Candidate v1.0.1 was loaded live in KWin with clean QML root initialization without SEGV or coordinator errors (`isScriptLoaded: true`, KWin PID stable). In live 3-screen desktop testing (X11), interactive window drag-and-drop committed left-half, top-left quadrant, and pillar snaps with exact single writes and clean echo suppression (`suppressedEchoes=5`). Certain live boundaries (Wayland session compatibility, physical display cable hotplug, and visual dark/light theme side-by-side audit) remain explicit live gates. Principal governance and decision gates are tracked in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md).

---

## 🌟 What is Tessera?

Tessera brings keyboard-driven dynamic tiling to KDE Plasma 6 without replacing your desktop environment, display manager, or compositor.

Built as a **pure KWin declarative script**, Tessera executes directly within KWin's process, operates alongside native KDE Plasma panels and widgets, and is configured entirely through standard **KDE System Settings**. It is centered on an intuitive **Quadrant and Three-Pillar Workflow** designed for both traditional displays and modern ultrawide monitors.

```
┌───────────────────┬───────────────────┐     ┌──────────────┬──────────────┬──────────────┐
│                   │                   │     │              │  Center Top  │              │
│    Top-Left       │    Top-Right      │     │              │ (focal 50%)  │              │
│    Quadrant       │    Quadrant       │     │  Left        ├──────────────┤  Right       │
│                   │                   │     │  Pillar      │Center Bottom │  Pillar      │
├───────────────────┼───────────────────┤     │  (33%)       │ (focal 50%)  │  (33%)       │
│                   │                   │     │              │              │              │
│   Bottom-Left     │   Bottom-Right    │     │              │              │              │
│    Quadrant       │    Quadrant       │     │              │              │              │
└───────────────────┴───────────────────┘     └──────────────┴──────────────┴──────────────┘
          4-Corner Quadrants                       3-Column Pillars (Center Stacked or Full*)
```
*(Center column also accommodates a single full-height Center Full pillar)*

---

## ✨ Features

- 🏎️ **In-Process & Coalesced**: Executes inside KWin with turn-based event coalescing (60ms debounce default), dirty-screen invalidation, and geometry echo suppression (`recordCommand`, `checkAndHandleEcho`) to prevent redundant geometry operations.
- 📐 **7 Automatic Layout Engines (Internal & Compatibility Strategies)**:
  - Tessera's internal layout solver includes 7 deterministic arrangement algorithms (Balanced Grid default, Primary + Stack, Binary Split, Columns, Rows, Monocle, and Floating).
  - In alignment with Tessera's clean "no presets" design, there are no user-facing preset menus or layout-cycling shortcuts. All workspace layout algorithms normalize to the canonical Balanced Grid engine, while preserving custom per-window floating and game policies.
- 🎯 **12 Visual Snap Zones & Region Occupancy**:
  - Interactive drop targets: Top Maximize Bar, Left/Right Halves, 4 Corner Quadrants, and 3 Equal Pillars (Left, Center Full/Split, Right).
  - Deterministic Region Occupancy Model adapts older peer windows to remaining space while protecting the newest requested drop target and preserving custom user resize geometries.
- 🎞️ **Safe Window Animations**:
  - Linear timer-driven interpolation (16ms interval, configurable 180ms duration) with cubic deceleration (`easeOutCubic`).
  - Active animations cancel immediately upon window closure, minimization, fullscreen transition, or interactive user drag to prevent writing stale geometries.
- ⌨️ **22 Super-Primary Global Shortcuts**: Keyboard navigation for region snapping, keyboard resizing, multi-monitor movement, and spatial focus.
- 🖥️ **Multi-Screen & Virtual Desktop Integration**: Gaps and per-window states are maintained independently across connected outputs and virtual desktops.
- 📏 **Live Gaps & Margins**: Configurable inner gaps (default: 8px) and outer screen margins (default: 10px).
- 🛡️ **Smart Window Rules**: Automatic floating for transient dialogs, splash screens, and recognized games (`steam_app_*`, `gamescope`), with full support for custom application rules.
- 🔔 **Native Plasma OSD**: Visual feedback toasts via KDE Plasma's native `org.kde.osdService` on layout or region adjustments.
- 🎛️ **Native System Settings Integration**: No external GUI binaries or companion daemons; all settings are managed directly in **KDE System Settings → Window Management → KWin Scripts**.

---

## 📐 Snap Semantics: Quadrants & Three Pillars

Tessera provides 12 distinct snap drop zones that support both standard halves/quadrants and three-column ultrawide workflows:

### Corner Quadrants
- The usable screen area is divided into four equal corners: **Top-Left**, **Top-Right**, **Bottom-Left**, and **Bottom-Right**.
- Each quadrant occupies 50% of the screen width and 50% of the screen height (adjusted for configured gaps).
- Dropping a window into a corner pins it to that quadrant. When additional windows are dropped, Tessera automatically arranges peer windows into compatible adjacent quadrants or stacks them vertically.

### Three Pillars (Ultrawide & Multi-Column)
- The screen width is divided into three equal columns: **Left Pillar** (left 33%), **Center Pillar** (middle 33%), and **Right Pillar** (right 33%).
- **Center Pillar Configuration**: The center column accommodates either a single full-height **Center Full** (33% width, 100% usable height) focal window or two stacked half-height slots (**Center Top** and **Center Bottom**). Tessera never creates three stacked cells in the center column.
- **Cross-Family Resolution**: When windows from different snap families share the screen, the Deterministic Region Occupancy Model resolves geometric arrangements:
  - If a window occupies **Left-Half** (50% width) and a new window is dropped into **Center Pillar**, the left-half window adapts to **Left Pillar** (33% width).
  - The newest requested target geometry is protected, adapting older peers to remaining screen space.
  - User-driven keyboard resizes are preserved over inferred allocations whenever geometrically compatible.

---

## 🎞️ Window Animations & Technical Limitations

- **Timer-Driven Interpolation**: Window animations interpolate frame bounds via KWin's script API using periodic 16ms timer ticks over a configurable duration (default: 180ms).
- **Cancellation Safety**: Active animations cancel immediately when a window receives a compositor event (e.g. user drag, manual resize, window closure, minimization, or fullscreen transition) without writing stale target bounds.
- **Explicit Compositor Limitations**: Tessera does not bypass KWin's frame scheduling or use native Wayland presentation-time callbacks / direct GPU sync. Animation timing relies on the compositor event loop; under heavy system load or rapid window creation, animation frame steps may exhibit jitter.

---

## 🚀 Installation & Lifecycle

### System Requirements
- **Operating System**: Linux with KDE Plasma 6.0+ and KWin 6.
- **Packaged Installation Utilities**: `python3`, `kreadconfig6`, `kwriteconfig6` (standard in Plasma 6; sufficient when installing from a prebuilt `.kwinscript` bundle).
- **Source Checkout Prerequisites**: Node.js 22.12+ (or supported ranges `^24.0.0`, `>=26.0.0`), `npm ci` (or `npm install`), and `npm run build`. When `./install.sh` is executed from a git source checkout, it performs preflight AST validation on generated bridges (`contents/code/*.js`) to guarantee KWin QML host compatibility (rejecting unlowered class fields) and verifies that generated bridges are not stale compared to TypeScript sources before making any system modifications.

### Fresh Installation

Clone the repository, install dependencies, compile fresh bridges, and run the transactional installer:

```bash
git clone https://github.com/Andrew-Smith-93/Tessera.git
cd Tessera
npm ci
npm run build
./install.sh
```

*(Note: When modifying TypeScript source files, run `npm run build` prior to `./install.sh` to compile fresh bridge artifacts).*

The installer:
1. Validates system dependencies and file manifest integrity before modifying any configuration.
2. Deploys the KWin script package to `~/.local/share/kwin/scripts/tessera/`.
3. Enables Tessera in `~/.config/kwinrc`.
4. Registers canonical global shortcuts in `~/.config/kglobalshortcutsrc` (migrating recognized older defaults while strictly preserving existing custom and unbound bindings; does not force-restore defaults or automatically resolve collisions with other Plasma actions).
5. Cleans up any obsolete configuration files or shortcuts from retired versions.
6. Notifies KWin to reload the script configuration.

> [!NOTE]
> **Staging & Rollback Scope**:
> - **Pre-Commit Staging**: The installer validates preconditions and stages all files in an isolated temporary staging directory (`$XDG_DATA_HOME/.tessera-install.XXXXXX`). If aborted (<kbd>Ctrl</kbd>+<kbd>C</kbd>) or if a validation error occurs prior to commit, the temporary directory is discarded with zero system modification.
> - **Commit Phase Rollback**: If a failure occurs during file copying or configuration writes, modified shortcuts and settings are restored from in-flight transaction snapshots.
> - **Post-Commit State**: Once committed (`COMMITTED=true`), the temporary transaction directory is cleaned up and deleted. The installer does not retain persistent configuration backups on disk. If interrupted during post-commit notification, files are already committed to `~/.local/share/kwin/scripts/tessera/` and `~/.config/kwinrc`; trigger a manual KWin reload to complete activation.

### Upgrading

To update an existing installation to the latest version:

```bash
git pull
npm ci
npm run build
./install.sh
```

### Uninstallation

To remove Tessera while preserving your configuration:

```bash
./uninstall.sh
```

Standard uninstallation removes the installed KWin script, disables the plugin in `kwinrc`, removes legacy Control Center artifacts, and deletes recognized Tessera default shortcut registrations from `kglobalshortcutsrc`. Personal configuration options (`[Script-tessera]`), intentional unbound bindings, and user-customized active or retired shortcuts are preserved byte-for-byte. Unrelated KRunner and Plasma shortcuts are never touched.

To perform a complete purge (removing the script, all settings in `kwinrc`, legacy config backups, and all Tessera shortcut registrations):

```bash
./uninstall.sh --purge
```

> [!WARNING]
> `--purge` permanently deletes all custom Tessera layout options, gaps, rules, and shortcut registrations (both default and custom) from your configuration files. Do **not** use `--purge` merely to resolve shortcut conflicts; use native KDE System Settings instead.

### Recovery & Configuration Realities

Before modifying an existing live installation, users are encouraged to create a personal backup of `~/.config/kwinrc` and `~/.config/kglobalshortcutsrc`.

Understand the operational distinctions between **reloading**, **removing**, and **restoring**:
- **Reloading Configuration vs. Script Code**:
  - **Apply Configuration Changes (`kwinrc`)**: Per official KDE KWin scripting documentation, running `reconfigure` instructs KWin to re-read `kwinrc`, start newly enabled scripts, unload disabled scripts, and emit `options.configChanged()` to active script instances:
    ```bash
    qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
    ```
  - **Reload Updated Script Code**: If a script is already loaded and you have updated its QML/JS files on disk, unload and restart via KWin's Scripting interface to reload the code into memory without logging out:
    ```bash
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "tessera"
    qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
    ```
    *(Note: `org.kde.KWin.reconfigure` updates settings for running scripts; because KWin's `loadDeclarativeScript` returns -1 when a script is already registered, an explicit `unloadScript` is required before `start` to reload updated code into memory. Note that `isScriptLoaded` reflects script registration, not proof of successful QML root object instantiation).*
- **Removing (Uninstall)**: Running `./uninstall.sh` removes the Tessera script from `~/.local/share/kwin/scripts/tessera/`; it does **not** restore previous versions or previous configuration snapshots.
- **Restoring Shortcuts & Settings**:
  - **Native Shortcut Reset (Recommended)**: To reset shortcuts to defaults or resolve collisions with other Plasma actions, open **KDE System Settings → Shortcuts → KWin**, select Tessera actions, and click **Defaults** or reassign competing bindings. Re-running `./install.sh` preserves existing custom and unbound bindings; it does **not** force-restore defaults or resolve collisions with other Plasma actions.
  - **Full Reset**: If a complete configuration wipe is genuinely intended, back up your files first, run `./uninstall.sh --purge`, and reinstall via `./install.sh`.

---

## ⌨️ Default Keybindings

All shortcuts use the Super (<kbd>Meta</kbd>) key as their primary modifier, integrate directly into KDE Plasma's Global Shortcuts system, and can be customized in **KDE System Settings → Shortcuts → KWin**.

| Action ID | Default sequence |
| :--- | :--- |
| Tessera: Toggle Zone Overlay | Meta+Shift+C |
| Tessera: Toggle Tiling | Meta+Shift+T |
| Tessera: Toggle Window Floating | Meta+Shift+F |
| Tessera: Move Window to Left Region | Meta+Left |
| Tessera: Move Window to Right Region | Meta+Right |
| Tessera: Move Window to Up Region | Meta+Up |
| Tessera: Move Window to Down Region | Meta+Down |
| Tessera: Expand Window Width | Meta+Shift+Right |
| Tessera: Shrink Window Width | Meta+Shift+Left |
| Tessera: Expand Window Height | Meta+Shift+Down |
| Tessera: Shrink Window Height | Meta+Shift+Up |
| Tessera: Move Window to Screen Left | Meta+Ctrl+Left |
| Tessera: Move Window to Screen Right | Meta+Ctrl+Right |
| Tessera: Move Window to Screen Above | Meta+Ctrl+Up |
| Tessera: Move Window to Screen Below | Meta+Ctrl+Down |
| Tessera: Focus Left Window | Meta+Alt+A |
| Tessera: Focus Right Window | Meta+Alt+D |
| Tessera: Focus Up Window | Meta+Alt+W |
| Tessera: Focus Down Window | Meta+Alt+S |
| Tessera: Swap Left Window | Meta+Alt+Q |
| Tessera: Swap Right Window | Meta+Alt+E |
| Tessera: Retile Current Workspace | Meta+Shift+R |

`config/shortcuts.json` is the canonical catalog. Installation preserves every existing user binding, including an explicitly empty binding.

### Preserved Legacy Shortcuts & Spatial Migration
When upgrading from older Tessera installations:
- **Dormant Legacy Bindings**: Custom bindings on retired legacy actions (such as `Focus Next Window` or `Swap Window Forward`) are preserved in `kglobalshortcutsrc` to protect your configuration. However, because retired cyclical actions lack active QML runtime handlers (`ShortcutHandler`) in `main.qml`, these preserved legacy entries remain **dormant** and will not trigger actions.
- **Opt-in Spatial Migration**: Running `./install.sh --migrate-spatial-shortcuts` (or `--migrate-legacy-spatial`) migrates custom bindings from retired cyclical actions to active 2D directional replacements (for example, `Focus Next Window` becomes `Focus Right Window`). Note that this introduces a semantic shift from list-order window cycling to 2D spatial navigation.
- Old shortcuts do not functionally trigger retired actions unless migrated or re-assigned to one of the 22 active shortcuts in KDE System Settings.

### Resolving Plasma Shortcut Conflicts
By default, KDE Plasma may assign certain `Meta` key combinations (such as `Meta+Left` / `Meta+Right` for KWin Quick Tiling). `Meta+Space` is reserved for Plasma Search / KRunner and is not bound by Tessera.
To resolve conflicts:
1. Open **KDE System Settings → Shortcuts**.
2. Search for the conflicting shortcut (e.g. `Quick Tile Window to the Left`).
3. Reassign or disable the default Plasma binding, allowing Tessera's registered handler to receive the key sequence.

---

## 🎛️ Native Configuration

All configuration lives in native KDE interfaces. Open **KDE System Settings → Window Management → KWin Scripts** and click the configure icon next to **Tessera**:

- **General**: Toggle global tiling, new window tiling behavior, minimize behavior, virtual desktop layout independence, and Plasma OSD notifications.
- **Layout & Spacing**: Configure inner gap (default: 8px) and outer margin (default: 10px) sizes. User-facing layout preset menus, layout-cycling shortcuts, and primary ratio controls are retired; legacy stored layout algorithms (such as Primary + Stack, Monocle, Floating, Binary Split, Columns, and Rows) are automatically normalized to the canonical Balanced Grid layout by the runtime reconciler, while per-window floating is managed separately via window rules and game policies.
- **Window Rules**: Add window classes or application IDs to float automatically, and configure game window policy (`floating`, `tiled`, `monocle`).
- **Performance**: Adjust reconciliation debounce duration (default: 60ms, range 0–1000ms), animation duration (default: 180ms), and snap overlay polling interval (default: 16ms).

Configuration values are stored in standard KDE configuration files:
- Script settings: `~/.config/kwinrc` under the `[Script-tessera]` group.
- Global shortcuts: `~/.config/kglobalshortcutsrc` under the `[kwin]` group.

---

## 🔍 Verification & Acceptance Scope

To provide rigorous technical transparency, repository evidence is categorized into distinct verification tiers:

1. **Automated Non-Live Verification (Passing)**:
   - **TypeScript Unit & Integration Suites**: 448/448 tests passing across 29 Vitest suites locally on current worktree (430/430 in exact-SHA CI for committed `c8483b5`; fresh CI required after commit; includes core layout solvers, rule classification, kwin adapter, region occupancy, snap persistence, KWin QML host compatibility, and multi-cycle delayed clamp feedback loop bounds).
   - **Runtime Simulator**: 25/25 golden trace fixtures match byte-for-byte under `npm run sim:verify` on current candidate tree; invariant checks and fixed stress seeds (42, 12345, 99999) pass.
   - **Protocol V1 Freeze**: Locked and verified against `packages/protocol/protocol-v1.freeze.json`.
   - **Python Quality & Hygiene**: 107 tests defined across 9 modules (82 fast unit/contract tests across 8 modules + 25 installer integration tests partitioned across 3 shards: 9, 8, 8). On the current candidate worktree, 82/82 fast tests pass cleanly and 3-shard partition integrity (9/8/8) is verified; all 25/25 installer integration tests passed locally across the 3 shards on the current worktree (including targeted unbound/custom shortcut preservation regressions), and full `python3 -m unittest discover tests` passed all 107 tests cleanly, while a fresh exact-SHA CI run remains required after commit.
   - **Reproducible Packaging & License Digest**: `./package.sh` generates a deterministic `.kwinscript` bundle matching the exact 12-entry package manifest; root `LICENSE` matches the official GNU GPL-3 digest (`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`), and independent package archives contain byte-for-byte identical `LICENSE` files.
2. **Historical Phase 5B Evidence**:
   - Earlier development testing under KDE Plasma 6.3.6 (X11) is preserved as dated historical context in [docs/LIVE_KWIN_X11_ACCEPTANCE.md](docs/LIVE_KWIN_X11_ACCEPTANCE.md).
3. **Live Gates (NOT RUN in Current Phase)**:
   - Live interactive session installation and verification (candidate live KWin script loading with bounded disposable drag verified; live KCM GUI bidirectional sync, Wayland session compatibility, multi-monitor physical hotplug, and Steam/Wine fullscreen game window policy handling have not been run in this automated phase and remain explicit pre-release live gates). Authority is tracked in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md).

---

## 🛍️ Distribution & Publishing

The repository produces an upload-ready `.kwinscript` bundle via `./package.sh`.

Official releases and store listings:
- **KDE Store Listing**: [store.kde.org/p/2375512](https://store.kde.org/p/2375512/) (Product ID `2375512`)
- **GitHub Release**: [v1.0.1](https://github.com/Andrew-Smith-93/Tessera/releases/tag/v1.0.1)

Store publication, AUR availability, and release upload are separate maintainer actions and are not claimed by this repository state. Maintainers should refer to [docs/KDE_STORE_PUBLISHING.md](docs/KDE_STORE_PUBLISHING.md) for the publishing checklist.

---

## 📂 Project Structure

```
├── metadata.json              # KWin 6 script manifest
├── package.sh                 # Deterministic .kwinscript package builder
├── install.sh                 # Transactional installer with automatic rollback
├── uninstall.sh               # Clean uninstaller (--purge supported)
├── LICENSE                    # GNU General Public License v3
├── contents/                  # Native KWin 6 Declarative Engine
│   ├── config/
│   │   └── main.xml           # KConfigXT schema
│   ├── code/
│   │   ├── layouts.js         # Layout math bridge (compiled from layout-core)
│   │   ├── rules.js           # Window classifier bridge (compiled from rules-engine)
│   │   └── reconciler.js      # Retained coordinator bridge (compiled from kwin-adapter)
│   └── ui/
│       ├── config.ui          # Native KCM configuration dialog
│       └── main.qml           # KWin event listener, snap overlay, OSD & shortcuts
├── packages/                  # Monorepo Core TypeScript Packages
│   ├── layout-core/           # Mathematical tiling solvers and geometry algorithms
│   ├── rules-engine/          # Window rule evaluation and classification
│   └── protocol/              # IPC Protocol V1 schemas and frozen contract
├── apps/                      # Monorepo Applications & Testing Frameworks
│   ├── kwin-adapter/          # Retained coordinator, Region Occupancy, snap zones
│   └── runtime-simulator/     # Headless KWin session simulator (25 golden traces)
└── tests/                     # Integration, contract, and hygiene verification suites
```

---

## 🤝 Community & Contributing

Contributions, bug reports, and layout proposals are welcome!
- 📖 [Contributor Guide](CONTRIBUTING.md): Monorepo setup, build rules, and verification matrix.
- 🛠️ [Troubleshooting Guide](docs/TROUBLESHOOTING.md): Installation lifecycle, runtime diagnostics, and log sanitization.
- 🏛️ [Runtime Architecture](docs/RUNTIME_ARCHITECTURE.md): Detailed component specifications and data flow.
- 🛡️ [Security Policy](SECURITY.md): Vulnerability intake and handling procedures.
- 💬 [Support Guidelines](.github/SUPPORT.md): How to get help and report issues.
- 📜 [Code of Conduct](CODE_OF_CONDUCT.md): Community standards and pledge.

---

## 📄 License

Tessera is licensed under the [GNU General Public License v3.0](LICENSE).

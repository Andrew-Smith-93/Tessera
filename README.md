# 💠 Tessera (`K-Tessera`)

> **A dynamic tiling KWin script for KDE Plasma 6 with native KConfig settings and an optional PyQt Control Center.**

[![Platform: KDE Plasma 6](https://img.shields.io/badge/KDE_Plasma-6.3+-3daee9.svg?logo=kde&logoColor=white)](https://kde.org/plasma-desktop/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI: Passing](https://img.shields.io/badge/CI-Automated_Testing-success.svg)](.github/workflows/ci.yml)

---

## 🛍️ Distribution

The repository builds a deterministic `.kwinscript` bundle with `./package.sh` and provides a source installer with `./install.sh`. Store publication, AUR availability, and release upload are separate maintainer actions and are not claimed by this repository state. See [docs/KDE_STORE_PUBLISHING.md](docs/KDE_STORE_PUBLISHING.md) for the bounded publication procedure.

---

## 🌟 Why Tessera?

Tessera keeps Plasma as the desktop environment while adding automatic, workspace-aware tiling. Its retained coordinator coalesces KWin events, suppresses geometry echoes, and avoids redundant writes. The optional Control Center adds previews, gap controls, presets, and rule editing.

```
┌─────────────────────────────────┬───────────────────────────────┐
│                                 │       Stack Window 1          │
│                                 │                               │
│                                 ├───────────────────────────────┤
│       Primary Window            │       Stack Window 2          │
│   (Configurable ratio,          │                               │
│    e.g. 50% / 60%)              ├───────────────────────────────┤
│                                 │       Stack Window 3          │
│                                 │                               │
└─────────────────────────────────┴───────────────────────────────┘
  ◀────────── Outer Gap ─────────▶ ◀─ Inner Gap ─▶
```

---

## ✨ Features

- 🏎️ **Coalesced Geometry Pipeline**: Configurable event debouncing and echo suppression reduce redundant geometry work.
- 📐 **Dynamic Tiling Layouts**:
  - **Balanced Grid**: Optimal square tiles with equitable distribution across all windows.
  - **Primary + Stack**: Prominent primary work area on the left with vertical stack of secondary windows.
  - **Binary Split (BSP / Dwindle)**: Recursive alternating horizontal/vertical splits (Hyprland / bspwm style).
  - **Columns**: Clean vertical multi-column arrangement.
  - **Rows**: Horizontal band slicing.
  - **Monocle (Deck)**: Maximized working area per window with instant cycling.
  - **Floating**: Full manual window freedom.
- 🖥️ **Virtual Desktop Layout Independence**: Assign Primary-Stack to Desktop 1 (coding), Columns to Desktop 2 (communications), and Floating to Desktop 3 (gaming / Steam).
- 📏 **Live Gap & Margin Studio**: Interactive sliders for inner gaps and outer margins paired with a **real-time desktop preview canvas**.
- 🎯 **Visual Window Rule Builder**: Stop guessing arcane regex! Click **"Capture Active Window"** to automatically extract any app's class and title, and assign 1-click float or tile rules.
- 🎨 **1-Click Presets**:
  - *Hyprland Aesthetic*: BSP Dwindle with modern 8px/12px gaps.
  - *i3 / Sway Classic*: Compact 4px gaps and 50% split ratio.
  - *macOS Amethyst*: 55% primary ratio with 10px/14px gaps.
  - *Ultrawide Productivity*: 65% primary pane with two primary-region windows for 21:9 & 32:9 displays.
  - *Zero Gap Hacker*: 0px gaps for maximum terminal screen estate.
- 🔔 **Native Plasma 6 OSD**: Clean HUD toasts displayed via KDE Plasma's native `org.kde.osdService` whenever layouts or modes change.

---

## 🚀 Quick Start & Installation

### Prerequisites & Verification Scope
- KDE Plasma 6.0+ and KWin 6
- Python 3 with PyQt5 for the source-installed Control Center

**Verification & Acceptance Scope**:
- **Automated Evidence**: Unit, contract, integration, and simulator suites verify tiling algorithms, geometry reconciliation, config transactions, installer idempotency/purge, and reproducible packaging.
- **Historical Phase 5B Evidence**: Past live desktop testing on KDE Plasma 6.3.6 under X11 is preserved as historical baseline evidence in `docs/LIVE_KWIN_X11_ACCEPTANCE.md`.
- **Live Gates (NOT RUN in Current Phase)**: Live KWin script reloading, live KCM settings bindings, Wayland session compatibility, game window policy handling, and multi-monitor hotplug verification remain unexecuted in this automated phase and require dedicated manual live desktop sessions.

### Installation

Clone the repository and run the installer:

```bash
git clone https://github.com/Andrew-Smith-93/tiling-window-manager.git
cd tiling-window-manager
./install.sh
```

The installer will:
1. Register and deploy the KWin 6 declarative script.
2. Enable Tessera in the active KDE configuration.
3. Install the `tessera-settings` CLI executable under `${XDG_BIN_HOME:-$HOME/.local/bin}`.
4. Install the desktop entry into your KDE Application Launcher (`Applications -> Settings -> Tessera Control Center`).
5. Trigger KWin to immediately reload.

---

## ⌨️ Default Keybindings

All shortcuts integrate directly into KDE Plasma's Global Shortcuts system and can be customized in **KDE System Settings → Shortcuts → KWin**.

| Action ID | Default sequence |
| :--- | :--- |
| Tessera: Toggle Zone Overlay | Ctrl+Shift+C |
| Tessera: Next Layout | Ctrl+Space |
| Tessera: Previous Layout | Ctrl+Shift+Space |
| Tessera: Toggle Tiling | Ctrl+Shift+T |
| Tessera: Toggle Window Floating | Ctrl+Shift+F |
| Tessera: Focus Left Window | Ctrl+Shift+A |
| Tessera: Focus Right Window | Ctrl+Shift+D |
| Tessera: Focus Up Window | Ctrl+Shift+W |
| Tessera: Focus Down Window | Ctrl+Shift+S |
| Tessera: Swap Left Window | Ctrl+Shift+Q |
| Tessera: Swap Right Window | Ctrl+Shift+E |
| Tessera: Focus Next Window | Ctrl+Shift+J |
| Tessera: Focus Previous Window | Ctrl+Shift+K |
| Tessera: Swap Window Forward | Ctrl+Alt+J |
| Tessera: Swap Window Backward | Ctrl+Alt+K |
| Tessera: Increase Primary Ratio | Ctrl+Shift+L |
| Tessera: Decrease Primary Ratio | Ctrl+Shift+H |
| Tessera: Increase Primary Count | Ctrl+Shift+I |
| Tessera: Decrease Primary Count | Ctrl+Shift+O |
| Tessera: Retile Current Workspace | Ctrl+Shift+R |
| Tessera: Move Window to Next Screen | Ctrl+Shift+Z |
| Tessera: Cycle Layout on Other Screen | Ctrl+Shift+X |
| Tessera: Swap Screen Layouts | Ctrl+Alt+X |

`config/shortcuts.json` is the canonical catalog. Installation preserves every existing user binding, including an explicitly empty binding.

---

## 🎛️ The Intuitive Control Center

Launch the control center at any time:
```bash
tessera-settings
```
Or press <kbd>Alt</kbd> + <kbd>Space</kbd> to open KRunner and type `Tessera`.

### Visual Layout Selector
Choose between layouts using visual cards. Clicking any card immediately previews the tiling behavior and sets the active layout.

### Live Gap Studio
Slide the **Inner Gap** and **Outer Gap** sliders and watch the real-time mock desktop canvas adapt before your eyes!

### Interactive Window Rules
1. Open any app you want to float (e.g. Steam or a utility).
2. Click **"🎯 Capture Active Window"** in Tessera Control Center.
3. Select **Action: Float** and click **➕ Add Rule**.
4. Click **💾 Save & Apply**.

---

## ⚡ Performance controls

The Control Center exposes reconciliation debounce and snap-overlay polling intervals. These are general scheduling controls; no GPU-vendor-specific performance guarantee is claimed. Fullscreen windows are excluded from active tiling while their slot membership is retained.

---

## 📂 Project Structure

```
├── metadata.json              # KWin 6 script manifest
├── install.sh                 # One-click automated installer
├── uninstall.sh               # Clean uninstallation script
├── LICENSE                    # GNU General Public License v3
├── contents/                  # Native KWin 6 Declarative Engine
│   ├── config/
│   │   └── main.xml           # KConfigXT schema
│   ├── code/
│   │   ├── layouts.js         # Pure geometry calculation engine
│   │   └── rules.js           # Smart window classifier & custom filters
│   └── ui/
│       └── main.qml           # KWin event listener, OSD hook & shortcuts
├── tessera-control/           # Intuitive Configuration GUI
│   ├── tessera_settings.py    # PyQt5 Control Center application
│   ├── config_manager.py      # Bidirectional config sync (kwinrc & DBus)
│   ├── ui_preview.py          # Real-time miniature desktop painter
│   └── window_picker.py       # Active window metadata inspector
├── desktop/
│   ├── org.kde.tessera.desktop# Application launcher entry
│   └── tessera.svg            # Scalable vector icon
└── bin/
    └── tessera-settings       # CLI wrapper script
```

---

## 🤝 Contributing

Contributions, bug reports, and layout suggestions are warmly welcomed!
Feel free to open an issue or pull request on GitHub.

## 📄 License

Tessera is licensed under the [GNU General Public License v3.0](LICENSE).

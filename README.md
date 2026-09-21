# 💠 Tessera (`K-Tessera`)

> **The modern, GPU-optimized dynamic tiling window manager for KDE Plasma 6 with an intuitive, beautiful configuration control center.**

[![Platform: KDE Plasma 6](https://img.shields.io/badge/KDE_Plasma-6.3+-3daee9.svg?logo=kde&logoColor=white)](https://kde.org/plasma-desktop/)
[![Hardware: NVIDIA GPU Optimized](https://img.shields.io/badge/Hardware-NVIDIA_Optimized-76b900.svg?logo=nvidia&logoColor=white)](https://www.nvidia.com/)
[![KDE Store: Pling / Discover](https://img.shields.io/badge/KDE_Store-Get_New_Scripts-1d99f3.svg?logo=kde&logoColor=white)](https://store.kde.org/)
[![Arch AUR: kwin-script-tessera-git](https://img.shields.io/badge/Arch_AUR-kwin--script--tessera--git-1793d1.svg?logo=arch-linux&logoColor=white)](packaging/aur/PKGBUILD)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![CI: Passing](https://img.shields.io/badge/CI-Automated_Testing-success.svg)](.github/workflows/ci.yml)

---

## 🛍️ Distribution & App Store Availability

Tessera is built for frictionless distribution across the entire Linux ecosystem:

1. **KDE Plasma Built-in Store ("Get New Scripts...")**:
   - Available directly inside your desktop: **System Settings** → **Window Management** → **KWin Scripts** → **"Get New Scripts..."**.
   - Search for **Tessera** and click **Install**.
   - See [docs/KDE_STORE_PUBLISHING.md](docs/KDE_STORE_PUBLISHING.md) for maintainer upload instructions.
2. **Arch Linux (AUR)**:
   ```bash
   yay -S kwin-script-tessera-git
   ```
3. **Official `.kwinscript` Bundle**:
   - Download the latest standalone bundle from [GitHub Releases](https://github.com/Andrew-Smith-93/tiling-window-manager/releases).
   - Install via terminal:
     ```bash
     kpackagetool6 --type KWin/Script --install tessera-v1.0.1.kwinscript
     ```

---

## 🌟 Why Tessera?

Most tiling window managers for Linux make huge sacrifices:
- **Standalone WMs (Hyprland, Sway)** discard the entire KDE Plasma desktop (taskbars, system tray, KRunner, notification center, display settings), require Wayland, and have historically suffered on NVIDIA GPUs (especially Pascal / Turing cards like GTX 1070/1080 with proprietary 550 drivers) with explicit sync stutter, flickering, and video glitches.
- **Legacy KWin Scripts (Bismuth, Krohnkite)** were abandoned or broke completely during the Plasma 6 transition.
- **Polonium** is rigid, prone to multi-monitor geometry lockups, and has **virtually no intuitive configuration interface**—forcing users to wrestle with raw JSON or cryptic numbers.
- **Plasma 6 Built-in Quick Tile (`Meta+T`)** is strictly static snapping; it cannot dynamically auto-tile newly spawned windows, balance trees, or manage per-workspace layouts.

**Tessera solves all of this.** It is a native KWin 6 dynamic tiling engine with dedicated NVIDIA geometry buffering, accompanied by a sleek, modern **Control Center** with live graphical previews, interactive gap sliders, and one-click window rule creation.

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

- 🏎️ **NVIDIA GPU-Optimized Pipeline**: Hardware geometry debouncing eliminates X11/Wayland repaint storms, visual tearing, and resize stutters on NVIDIA proprietary drivers.
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
  - *macOS Amethyst*: 55% master ratio with 10px/14px gaps.
  - *Ultrawide Productivity*: 65% primary pane with dual masters for 21:9 & 32:9 displays.
  - *Zero Gap Hacker*: 0px gaps for maximum terminal screen estate.
- 🔔 **Native Plasma 6 OSD**: Clean HUD toasts displayed via KDE Plasma's native `org.kde.osdService` whenever layouts or modes change.

---

## 🚀 Quick Start & Installation

### Prerequisites
- KDE Plasma 6.0+ (Tested on Plasma 6.3.6)
- Python 3 with PyQt5 (pre-installed on most Debian/Ubuntu/Arch/Fedora KDE systems)
- KWin 6 (`kwin_x11` or `kwin_wayland`)

### Installation

Clone the repository and run the installer:

```bash
git clone https://github.com/Andrew-Smith-93/tiling-window-manager.git
cd tiling-window-manager
./install.sh
```

The installer will:
1. Register and deploy the KWin 6 declarative script.
2. Enable Tessera in `~/.config/kwinrc`.
3. Install the `tessera-settings` CLI executable into `~/.local/bin/`.
4. Install the desktop entry into your KDE Application Launcher (`Applications -> Settings -> Tessera Control Center`).
5. Trigger KWin to immediately reload.

---

## ⌨️ Default Keybindings

All shortcuts integrate directly into KDE Plasma's Global Shortcuts system and can be customized in **KDE System Settings → Shortcuts → KWin**.

| Action | Shortcut |
| :--- | :--- |
| **Toggle Tiling Globally** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> |
| **Cycle Next Layout** | <kbd>Meta</kbd> + <kbd>Space</kbd> |
| **Cycle Previous Layout** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>Space</kbd> |
| **Toggle Active Window Floating** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> |
| **Focus Next Window** | <kbd>Meta</kbd> + <kbd>J</kbd> *(or <kbd>Meta</kbd> + <kbd>Down</kbd>)* |
| **Focus Previous Window** | <kbd>Meta</kbd> + <kbd>K</kbd> *(or <kbd>Meta</kbd> + <kbd>Up</kbd>)* |
| **Swap Window Forward** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>J</kbd> |
| **Swap Window Backward** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>K</kbd> |
| **Expand Master Ratio (+5%)** | <kbd>Meta</kbd> + <kbd>L</kbd> *(or <kbd>Meta</kbd> + <kbd>Right</kbd>)* |
| **Shrink Master Ratio (-5%)** | <kbd>Meta</kbd> + <kbd>H</kbd> *(or <kbd>Meta</kbd> + <kbd>Left</kbd>)* |
| **Increase Master Window Count** | <kbd>Meta</kbd> + <kbd>I</kbd> |
| **Decrease Master Window Count** | <kbd>Meta</kbd> + <kbd>D</kbd> |
| **Force Retile Current Workspace** | <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd> |

*(Note: `<kbd>Meta</kbd>` is the Super / Windows key on your keyboard).*

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

## ⚡ NVIDIA Troubleshooting & Tips

If you are running NVIDIA proprietary drivers (e.g. 550.x) on X11 or Wayland:
1. **GPU Redraw Debounce**: Located in the *NVIDIA & Performance* tab of the Control Center. Set between `50ms` and `80ms`. This batches geometry changes so the X11 server does not get flooded during rapid window creation.
2. **Smooth Geometry Commit**: For NVIDIA X11, keeping "Smooth Animated Geometry" disabled provides instant, tear-free window resizing without latency.
3. **Compositor Fullscreen Bypass**: Tessera automatically ignores fullscreen games (Steam, Lutris, Heroic), allowing the NVIDIA driver to unredirect games for maximum FPS and minimal input lag.

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

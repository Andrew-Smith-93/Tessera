# 💠 Tessera: Dynamic Tiling Window Manager for KDE Plasma 6

> **Copy-Paste Product Description for KDE Store / Pling / Discover**
> **Product URL**: [store.kde.org/p/2375512](https://store.kde.org/p/2375512/)
> **Category**: `KWin Scripts` (Plasma 6 Extensions)

---

## 🌟 Overview

**Tessera** (`K-Tessera`) brings keyboard-driven dynamic tiling to **KDE Plasma 6** without replacing your desktop environment, display manager, or compositor.

Built as a **pure KWin declarative script**, Tessera executes directly within KWin's process, operates alongside native KDE Plasma panels and widgets, and is configured entirely through standard **KDE System Settings**. It is centered on an intuitive **Quadrant and Three-Pillar Workflow** designed for both traditional 16:9 displays and modern ultrawide monitors.

---

## ✨ Features

- 🏎️ **In-Process & Coalesced**: Executes inside KWin with turn-based event coalescing (60ms debounce default), dirty-screen invalidation, and geometry echo suppression to eliminate redundant geometry operations.
- 📐 **Intuitive Quadrant & Three-Pillar Workflow**:
  - **4-Corner Quadrants**: 50% width and 50% height corner slots for focused multitasking.
  - **3-Column Pillars**: Equal 33% columns designed for ultrawide screens, supporting a single focal center window or two vertically stacked center tiles.
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
- 🎛️ **Native System Settings Integration**: No external GUI binaries or companion daemons; all settings are managed directly in **KDE System Settings → Window Management → KWin Scripts**, with starting keybindings and layout visual reference directly accessible in the **Shortcuts** tab.

---

## 📐 Layout & Workflow Visual Reference

```
┌───────────────────┬───────────────────┐     ┌──────────────┬──────────────┬──────────────┐
│  Top-Left (50%)   │  Top-Right (50%)  │     │              │  Center Top  │              │
│  [Meta + Up]      │                   │     │  Left Pillar ├──────────────┤ Right Pillar │
├───────────────────┼───────────────────┤     │  (33%)       │Center Bottom │ (33%)        │
│ Bottom-Left (50%) │Bottom-Right (50%) │     │ [Meta + Left]│ (focal 50%)  │[Meta + Right]│
│  [Meta + Down]    │                   │     │              │              │              │
└───────────────────┴───────────────────┘     └──────────────┴──────────────┴──────────────┘
          4-Corner Quadrants                       3-Column Pillars (Center Stacked or Full)
```

---

## ⌨️ Default Keybindings Cheat Sheet

All shortcuts use the Super (<kbd>Meta</kbd>) key as their primary modifier, integrate directly into KDE Plasma's Global Shortcuts system, and can be customized in **KDE System Settings → Shortcuts → KWin**.

### Snap & Region Navigation
| Action | Default Sequence | Description |
| :--- | :--- | :--- |
| Move Window to Left Region | **Meta+Left** | Snap window to left half or left pillar |
| Move Window to Right Region | **Meta+Right** | Snap window to right half or right pillar |
| Move Window to Up Region | **Meta+Up** | Snap window to upper quadrant or upper half |
| Move Window to Down Region | **Meta+Down** | Snap window to lower quadrant or lower half |
| Toggle Zone Overlay | **Meta+Shift+C** | Display 12 visual interactive snap zones |

### Tiling & Window State
| Action | Default Sequence | Description |
| :--- | :--- | :--- |
| Toggle Tiling | **Meta+Shift+T** | Enable/disable automatic tiling globally |
| Toggle Window Floating | **Meta+Shift+F** | Toggle floating state for active window |
| Retile Current Workspace | **Meta+Shift+R** | Recompute and apply tiling arrangements |

### Keyboard Resizing
| Action | Default Sequence | Description |
| :--- | :--- | :--- |
| Expand Window Width | **Meta+Shift+Right** | Increase active window width |
| Shrink Window Width | **Meta+Shift+Left** | Decrease active window width |
| Expand Window Height | **Meta+Shift+Down** | Increase active window height |
| Shrink Window Height | **Meta+Shift+Up** | Decrease active window height |

### Spatial Focus & Window Swap
| Action | Default Sequence | Description |
| :--- | :--- | :--- |
| Focus Left Window | **Meta+Alt+A** | Focus adjacent window to the left |
| Focus Right Window | **Meta+Alt+D** | Focus adjacent window to the right |
| Focus Up Window | **Meta+Alt+W** | Focus adjacent window above |
| Focus Down Window | **Meta+Alt+S** | Focus adjacent window below |
| Swap Left Window | **Meta+Alt+Q** | Swap positions with window to the left |
| Swap Right Window | **Meta+Alt+E** | Swap positions with window to the right |

### Multi-Screen Movement
| Action | Default Sequence | Description |
| :--- | :--- | :--- |
| Move Window to Screen Left | **Meta+Ctrl+Left** | Move active window to display on left |
| Move Window to Screen Right | **Meta+Ctrl+Right** | Move active window to display on right |
| Move Window to Screen Above | **Meta+Ctrl+Up** | Move active window to display above |
| Move Window to Screen Below | **Meta+Ctrl+Down** | Move active window to display below |

---

## 🚀 How to Install

### Method 1: Via KDE System Settings (Recommended)
1. Open **KDE System Settings** → **Window Management** → **KWin Scripts**.
2. Click **"Get New Scripts..."** (KNewStuff).
3. Search for **Tessera**.
4. Click **Install**.
5. Enable the **Tessera** checkbox and click **Apply**.

### Method 2: Manual Package Installation
Download `tessera-v1.0.2.kwinscript` from the **Files** section and run:
```bash
kpackagetool6 --type KWin/Script --install tessera-v1.0.2.kwinscript
```
Then enable in **System Settings → KWin Scripts**.

---

## 🎛️ How to Customize

- **Settings & Gaps**: Open **System Settings → Window Management → KWin Scripts** and click the configure icon next to **Tessera**. Here you can tune inner/outer gaps, animation duration, debounce timing, and window rules. You can also view the **Shortcuts** tab to inspect starting keybindings and the layout diagram.
- **Keybindings**: Open **System Settings → Shortcuts → KWin**, search for **Tessera**, and click any action to set your own custom keys.

---

## 📋 Changelog

### v1.0.2 (Current Release)
- **Shortcuts Tab in KCM Settings**: Inspect starting keybindings and visual layout diagrams directly within KDE System Settings.
- **Multi-Monitor Vertical Snap Fix**: Resolved window drop displacement on vertically stacked displays.
- **Persistent Monitor Affinity State**: Guarded window screen affinity against KWin 6 C++ wrapper recreation during drag-and-drop.
- **Corner Quadrant Precision**: Removed 1-pixel deadbands on screen boundaries.
- **Full Test Suite & Quality**: 452 Vitest tests and 82 fast Python tests verifying all layout engines and lifecycle invariants.

### v1.0.1
- Official public release on KDE Store and GitHub.
- Multi-monitor overlay unmapping fix eliminating display blackouts under X11.
- Complete 22 Super shortcuts, 12 visual snap zones, and Quadrant / 3-Pillar layout.
- Private Vulnerability Reporting activated.

---

## 🔗 Links & Source Code

- **GitHub Repository**: [github.com/Andrew-Smith-93/Tessera](https://github.com/Andrew-Smith-93/Tessera)
- **Bug Tracker & Feature Requests**: [github.com/Andrew-Smith-93/Tessera/issues](https://github.com/Andrew-Smith-93/Tessera/issues)
- **License**: GNU General Public License v3.0 (`GPL-3.0-or-later`)

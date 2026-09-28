# 📱 Tessera App Store Changelog

This document contains formatted release notes tailored for app store listings (**KDE Store**, **Pling.com**, **KDE Discover Software Center**, and **AppStream metainfo**).

When uploading a new `.kwinscript` bundle or updating product details on [store.kde.org/p/2375512](https://store.kde.org/p/2375512/):
1. Navigate to your product page on store.kde.org.
2. In the **Files** section, click **Add File** or **Edit** on the release.
3. Paste the corresponding version notes below into the **Changelog** field.

---

## Version 1.0.2 (Upcoming / Next Update)

### Highlights
- **Configuration Shortcuts Tab**: Added a dedicated "Shortcuts" tab inside the KDE System Settings configuration dialog! You can now view the visual Quadrant & Three-Pillar layout diagram and review all 22 starting keybindings without leaving the settings window.
- **Shortcut Customization Guide**: Step-by-step instructions on customizing, reassigning, and resetting keybindings natively in KDE System Settings (Shortcuts → KWin).
- **Store & Documentation Enhancements**: Complete changelog integration and refined feature walkthroughs for new users.

### Detailed Changes
- Added `tabShortcuts` to `config.ui` with workflow layout ASCII diagram and directory of all 22 starting keybindings.
- Direct guidance on reassigning shortcuts via System Settings → Shortcuts → KWin.
- Verified 100% adherence to KDE Plasma 6 KConfig and UI contracts.

---

## Version 1.0.1 (Current Live Release)

### Highlights
- **Official KDE Store Launch**: First official release published to the KDE Store and KDE Discover!
- **Display Stability Fix**: Fixed an issue where idle snap overlay dialog mapping on multi-monitor setups could cause screen blackouts or compositor context resets under X11. Overlays now dynamically unmap when idle.
- **Security & Vulnerability Reporting**: Enabled native GitHub Security Advisories Private Vulnerability Reporting (PVR).

### Detailed Changes
- Packaged deterministic `dist/tessera-v1.0.1.kwinscript` bundle for KDE Plasma 6.
- Dynamic overlay unmapping (`visible: overlayActive`) eliminates virtual bounding box composite disruption.
- Verified multi-monitor clean startup and Terraria fullscreen OpenGL gaming on active KDE Plasma 6.3 desktop.
- Sanitized repository metadata and established official release channels.

---

## Version 1.0.0 (Initial Release Candidate)

### Highlights
- **Dynamic Tiling for KDE Plasma 6**: In-process tiling window manager script executing directly within KWin.
- **Quadrant & Three-Pillar Layout**: Intuitive 4-corner quadrants and 3-column pillar layout for standard and ultrawide screens.
- **12 Interactive Snap Zones**: Drag-and-drop drop targets with visual cards and Deterministic Region Occupancy model.
- **22 Super Shortcuts**: Full keyboard control for snapping, moving across displays, spatial focus, and resizing.
- **Smooth Animations**: Safe timer-driven cubic window animations with instant interaction cancellation.
- **Native Configuration**: 100% native configuration via KDE System Settings (KWin Scripts).

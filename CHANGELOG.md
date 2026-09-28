# Changelog

All notable changes to Tessera (`K-Tessera`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Shortcuts & Layout Tab in Configuration**: Added a dedicated "Shortcuts" tab in the native KWin configuration dialog (`config.ui`). It displays the visual Quadrant and Three-Pillar layout diagram, a complete categorized directory of all 22 starting keybindings, and step-by-step guidance on customizing shortcuts in KDE System Settings.
- **App Store Changelog Guide**: Added `docs/APP_STORE_CHANGELOG.md` with compact, user-centric release notes tailored for the KDE Store, Discover, and AppStream.
- **Enhanced KDE Store Description**: Added `docs/KDE_STORE_LISTING_DESCRIPTION.md` providing rich marketing copy, feature spotlights, workflow diagrams, and keybinding cheat sheets for store listings.

---

## [1.0.1] - 2026-09-27

### Added
- **KDE Store Listing**: Official publication on the KDE Store under KWin Scripts ([store.kde.org/p/2375512](https://store.kde.org/p/2375512/)).
- **GitHub Release**: Published official release bundle `dist/tessera-v1.0.1.kwinscript` with SHA-256 checksum verification.
- **Private Vulnerability Reporting**: Activated native GitHub Security Advisories Private Vulnerability Reporting (PVR).

### Fixed
- **Multi-Monitor Composite Disruption Fix**: Resolved an issue where idle snap overlay dialog mapping across multi-monitor virtual bounding boxes caused X11 compositor resets and screen blackouts. Overlays now cleanly unmap when inactive (`visible: overlayActive`).

### Changed
- **Branding & Repository Alignment**: Standardized all project references and URLs to `Tessera` (`Andrew-Smith-93/Tessera`).
- **Documentation Truth**: Updated `README.md`, `docs/KDE_STORE_PUBLISHING.md`, and `docs/PUBLIC_RELEASE_CHECKLIST.md` with live release badges, links, and completed Gate C verification.

---

## [1.0.0] - 2026-09-27

### Added
- **Declarative KWin 6 Engine**: In-process tiling window manager script executing directly within KWin without external background daemons or companion binaries.
- **Quadrant & Three-Pillar Workflow**: Native support for 4 corner quadrants and 3-column pillar layouts tailored for traditional displays and ultrawide monitors.
- **12 Interactive Snap Zones**: Drag-and-drop snap target regions with visual cards and Deterministic Region Occupancy resolution.
- **22 Super-Primary Global Shortcuts**: Comprehensive keyboard navigation for region movement, directional snapping, keyboard resizing, spatial focus, and window swapping.
- **Safe Window Animations**: Timer-driven cubic deceleration animations (16ms interval, 180ms duration) with instant cancellation on user interaction or window state changes.
- **Native KDE System Settings**: 100% native configuration via KDE System Settings (`config.ui` + `main.xml`) with live gaps, margin adjustments, debounce tuning, and window filtering.
- **Smart Window Rules**: Automatic floating for transient dialogs and recognized Steam/Wine/Gamescope games, with user-extensible JSON rule support.

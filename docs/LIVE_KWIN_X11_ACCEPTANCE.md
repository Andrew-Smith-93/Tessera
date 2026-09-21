# Phase 5B — Live KWin/X11 Acceptance Report

## 1. System & Environment Preflight
- **Repository**: Andrew-Smith-93/tiling-window-manager
- **Parent Commit**: d670262d4c4429a3ae73ace5a2c37309731399a2
- **Branch**: test/live-kwin-x11-acceptance-01
- **Session Type**: x11 (XDG_SESSION_TYPE=x11)
- **Desktop Environment**: KDE Plasma 6.3.6 (XDG_CURRENT_DESKTOP=KDE)
- **Compositor**: kwin_x11 6.3.6
- **Node.js**: v22.23.1
- **npm**: 10.9.8
- **Python**: 3.13.5
- **Rust / Cargo**: 1.90.0
- **Displays**:
  - HDMI-0: 1920x1080 +0+0 (Primary)
  - DP-4: 1920x1080 +1920+0 (Secondary)

## 2. Package Artifact & Packaging Isolation
- **Artifact**: dist/tessera-v1.0.1.kwinscript
- **SHA-256**: db4b212eed7b0cd0ec52a75ad218161ae4c6a6918fec8e99959465dd00ac1157
- **Package Archive Inspection**:
  - Contains strictly: metadata.json, contents/code/layouts.js, contents/code/reconciler.js, contents/code/rules.js, contents/config/main.xml, contents/ui/main.qml, contents/ui/config.ui.
  - Zero Rust sources, zero Cargo manifests, zero daemon binaries, zero protocol fixtures, zero simulator files, zero test files.

## 3. Installation & Safety Rollback
- **Active Plugin**: kwinrc [Plugins] tesseraEnabled=true (all competing tilers disabled).
- **Installed Package Path**: /home/drew/.local/share/kwin/scripts/tessera/
- **Timestamped Backup**: /home/drew/.local/share/kwin/scripts/tessera.bak.20260921_0605/
- **Installation Commands**:
  - kpackagetool6 --type KWin/Script --upgrade dist/tessera-v1.0.1.kwinscript
  - qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
- **Rollback Commands**:
  - rm -rf ~/.local/share/kwin/scripts/tessera && cp -a ~/.local/share/kwin/scripts/tessera.bak.20260921_0605 ~/.local/share/kwin/scripts/tessera && qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure

## 4. Defect Discovery & Resolution

### Defect 1: Stale Window Signal Connections & Missing Destruction Cleanup
- **Symptom**:
  Journal logs upon script reload reported repeated TypeErrors:
  main.qml: TypeError: Cannot read property 'visible' of null
  main.qml: TypeError: Property 'checkFilter' of object [null] is not a function
- **Root Cause**:
  In KWin QML scripting, C++ KWin::Window instances persist across script reloads. When anonymous closures were connected directly to window signals (w.interactiveMoveResizeStarted.connect(function() { ... })), KWin did not disconnect them on script reload or package upgrade. When the old QML engine instance was destroyed, its lexical scope references (overlayDialog, checkFilter) became null, but the surviving closures on C++ window objects were still triggered by window move/resize events. Furthermore, w._tesseraHooked = true prevented newly loaded script instances from attaching fresh hooks to existing windows.
- **Correction**:
  1. Implemented explicit unhookWindow(w) storing connected signal callbacks on w._tesseraHooks and invoking .disconnect() on each signal.
  2. Guarded every signal handler with if (!root || !root.coordinator || isArranging) return; to immediately exit if the component is invalid.
  3. Added Component.onDestruction in contents/ui/main.qml to iterate all Workspace.stackingOrder windows and call unhookWindow(w).
  4. Added unhookWindow(w) to onWindowRemoved(w) in Workspace event connections.
  5. If hookWindow(w) is called on an already-hooked window, it cleanly invokes unhookWindow(w) first before attaching fresh hooks.
- **Regression Tests**: Added Test 9 to apps/kwin-adapter/tests/qml-source-isolation.test.ts asserting unhookWindow, Component.onDestruction, and onWindowRemoved lifecycle cleanup.

### Defect 2: Intrusive Desktop Master Resizing on Window Border Drag
- **Symptom**:
  Window border resizing was hooked in w.interactiveMoveResizeStepped and w.interactiveMoveResizeFinished, calculating screen aspect ratios and mutating config.masterRatio on every mouse step.
- **Root Cause**:
  Legacy experimental code in hookWindow intercepted generic window resize events to compute dynamic master ratios, which conflicted with standard KDE Plasma window management.
- **Correction**:
  Removed the dynamic master ratio mutation on border resize from interactiveMoveResizeStepped and interactiveMoveResizeFinished, letting standard window sizing and layout slotting operate without intrusive OS-level interference.

## 5. Live Acceptance Matrix Summary
- PASS: 65
- NOT RUN: 13 (G1-G12 game tests requiring manual user application launch, and H7 physical monitor replug)
- FAIL: 0
- BLOCKED: 0
- Total Cases: 78

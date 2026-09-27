# Tessera Troubleshooting & Diagnostic Guide

This guide provides practical resolutions for common issues encountered during installation, configuration, shortcut registration, and runtime execution of Tessera on KDE Plasma 6.

---

## 1. System Requirements & Dependency Preflight

Tessera requires a standard KDE Plasma 6 desktop environment with KWin 6.

### Required Utilities
Before installing or troubleshooting, verify that the following utilities are available in your `PATH`:

```bash
# Verify required command-line tools
command -v python3 kreadconfig6 kwriteconfig6 qdbus6 kpackagetool6
```

If any KDE utility is missing, install your distribution's Plasma workspace package:
- **Arch Linux / Manjaro**: `sudo pacman -S kwin plasma-workspace`
- **Fedora**: `sudo dnf install kwin plasma-workspace`
- **Debian / Ubuntu (Plasma 6)**: `sudo apt install kwin-common plasma-workspace`

### Source Checkout Prerequisites
When installing or upgrading directly from a Git source checkout (rather than a prepackaged `.kwinscript` bundle), Node.js and npm are required:
```bash
# Verify Node.js and npm availability
command -v node npm
```
- **Node.js**: v22.12.0 or later (supported ranges: `^22.12.0`, `^24.0.0`, `>=26.0.0`)
- **Required Build Step**: You must execute `npm ci` and `npm run build` prior to running `./install.sh`. The installer performs preflight AST verification on generated bridges (`contents/code/*.js`) to ensure they are fully up-to-date with TypeScript sources and contain no unlowered ECMAScript class fields before making any system modifications.

---

## 2. Installation, Upgrade & Recovery Lifecycle

Tessera's installer (`./install.sh`) and uninstaller (`./uninstall.sh`) are designed with deterministic safety guarantees.

### Fresh Installation
From the root of a cloned repository:
```bash
git clone https://github.com/Andrew-Smith-93/Tessera.git
cd Tessera
npm ci
npm run build
./install.sh
```

### Transactional Staging & Rollback Scope
- **Pre-Commit Staging**: The installer validates all system dependencies, configuration schemas, and bridge AST compatibility in an isolated temporary staging directory (`$XDG_DATA_HOME/.tessera-install.XXXXXX`). If aborted (<kbd>Ctrl</kbd>+<kbd>C</kbd>) or if a preflight validation fails, the staging directory is discarded with zero system modifications.
- **In-Flight Snapshot Rollback**: If a failure occurs during file copying or configuration writes before commit, modified shortcuts and settings are restored from in-flight transaction snapshots.
- **Post-Commit State**: Once committed (`COMMITTED=true`), the temporary transaction directory is cleaned up and deleted. The installer does not retain persistent backups on disk. Subsequent operations (legacy cleanup, Sycoca cache rebuild, and KWin reconfigure) are best-effort post-commit tasks; if interrupted during post-commit notification, files are already committed to `~/.local/share/kwin/scripts/tessera/` and `~/.config/kwinrc`. Trigger a manual KWin reload to complete activation.
- **Uninstallation vs Restoration**: Running `./uninstall.sh` removes the installed script files, but does not restore previous configuration snapshots or older versions. To reset shortcuts to defaults or resolve collisions, use native KDE System Settings.

### Upgrading an Existing Installation
To upgrade to a newer revision:
```bash
git pull
npm ci
npm run build
./install.sh
```
- Upgrades safely replace the KWin script package and generated bridges, while cleaning up any legacy Control Center or launcher files from older installations.
- **Shortcut Preservation**: The installer preserves all user-customized shortcuts and explicit empty bindings. Custom bindings on retired legacy actions are retained in `kglobalshortcutsrc` to protect user configuration, but remain **dormant** because active QML runtime handlers only exist for the 22 canonical shortcuts.
- **Opt-in Spatial Migration**: Running `./install.sh --migrate-spatial-shortcuts` (or `--migrate-legacy-spatial`) migrates custom bindings from retired cyclical actions (e.g. `Focus Next Window`) to active 2D directional replacements (e.g. `Focus Right Window`), adopting directional navigation.
- **Legacy Cleanup**: Uncustomized legacy defaults that no longer exist in the runtime are safely unregistered from KWin.

### Standard Uninstallation
To remove Tessera without deleting your personal configuration:
```bash
./uninstall.sh
```
This removes:
- The KWin script from `~/.local/share/kwin/scripts/tessera/`
- Any legacy Control Center files (`~/.local/share/tessera/control/`, desktop entry, launcher)
- Disables the plugin in `kwinrc` (`tesseraEnabled=false`)
- Recognized Tessera default shortcut registrations from `kglobalshortcutsrc`

User configurations (`[Script-tessera]`), intentional unbound bindings, and user-customized active or retired shortcuts are preserved byte-for-byte. Unrelated KRunner and Plasma shortcuts are never touched.

### Complete Purge
To completely remove all Tessera files, configurations, and shortcuts:
```bash
./uninstall.sh --purge
```
This additionally deletes:
- All Tessera configuration properties from `kwinrc` (`[Script-tessera]`)
- Legacy configuration files (`~/.config/tesserarc`, migration backups)
- All Tessera shortcut registrations (both default and custom) from `~/.config/kglobalshortcutsrc`

Unrelated KRunner, Plasma, and KWin shortcuts remain untouched.

---

## 3. Runtime & Window Management Issues

### Issue: Windows Are Not Tiling
1. **Verify Plugin is Enabled in KWin**:
   ```bash
   kreadconfig6 --file kwinrc --group Plugins --key tesseraEnabled
   ```
   If this returns `false` or empty, enable it manually and trigger KWin reconfiguration:
   ```bash
   kwriteconfig6 --file kwinrc --group Plugins --key tesseraEnabled true
   qdbus6 org.kde.KWin /KWin org.kde.KWin.reconfigure
   ```
   *(Note: In upstream KWin, `reconfigure` connects to `Scripting::start`, loading newly enabled absent scripts and unloading disabled scripts. However, `reconfigure` does not reload an already loaded declarative script whose files have changed on disk because `loadDeclarativeScript` returns -1 if `isScriptLoaded` is true. To reload modified QML/JS code without restarting your session, execute `qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "tessera"` followed by `qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start`). Note also that `isScriptLoaded` reflects script registration in KWin; it is not proof that the QML root object successfully instantiated if QML errors occurred during component creation.*

2. **Verify Script Registration**:
   ```bash
   kpackagetool6 --type KWin/Script --list | grep tessera
   ```
   If not listed, re-run `./install.sh`.

3. **Check Global Tiling Toggle**:
   Press <kbd>Meta</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> to ensure tiling has not been toggled off globally.

### Issue: Specific Application Tiles Unexpectedly (or Floats Unexpectedly)
- Tessera automatically tiles standard application windows and floats transient dialogs, splash screens, and utilities.
- To customize window rules:
  1. Open **KDE System Settings → Window Management → KWin Scripts**.
  2. Click the configure icon next to **Tessera**.
  3. Manage custom rules or exclusions directly in the configuration dialog.
  4. Alternatively, use standard KDE **Window Rules** (**KDE System Settings → Window Management → Window Rules**).

### Issue: Shortcut Keybinding Collisions
- Tessera defaults to Super (<kbd>Meta</kbd>) key combinations for tiling and region navigation.
- If another application or Plasma component conflicts with a shortcut:
  1. Open **KDE System Settings → Shortcuts → KWin**.
  2. Search for `Tessera:`.
  3. Assign custom alternative key combinations or reassign the conflicting Plasma action.
  4. Note that re-running `./install.sh` preserves existing custom and unbound bindings; it does not force-restore defaults or automatically resolve collisions with other Plasma actions.
  5. If you have custom bindings on retired legacy actions (e.g., `Focus Next Window`), pass `--migrate-spatial-shortcuts` to migrate them to active directional equivalents, or re-bind them to active actions in System Settings. Preserved legacy actions without active QML handlers remain dormant.

### Issue: KWin Script Parser Error / SyntaxError in Journalctl
If the script registers with KWin or loads via D-Bus (`isScriptLoaded: true`), but fails to initialize the QML root object, no overlay displays, or KWin logs report JavaScript parser errors:
1. **Check Journalctl for ECMAScript Parser Errors**:
   ```bash
   journalctl --user -b -g "js:.*[Tt]essera" --no-pager | tail -n 50
   ```
   Look for lines indicating parse or syntax failures, such as:
   - `js: SyntaxError: Unexpected token`
   - `js: SyntaxError: Fields are not currently supported`
   - `js: Failed to load script ...`
2. **Root Cause (ECMAScript 7th Edition Compatibility)**:
   KWin 6's declarative script host runs an embedded Qt Quick QML JavaScript engine conforming to ECMAScript 7th edition. Modern syntax features such as unlowered class property declarations (`class Foo { bar = 1; }`) are unsupported by the KWin QML host engine and cause syntax parse failures during QML component evaluation.
3. **Resolution**:
   - Verify that your build configuration (`esbuild.config.mjs`) specifies `target: 'es2020'` with class field lowering enabled.
   - Run `npm run build` from the repository root to recompile `contents/code/layouts.js`, `contents/code/rules.js`, and `contents/code/reconciler.js`.
   - Run the preflight bridge AST validator to verify zero unlowered class fields remain:
     ```bash
     npm test apps/kwin-adapter/tests/kwin-script-compatibility.test.ts
     ```
   - Re-run `./install.sh` to stage and commit the lowered bridge artifacts.
   - Unload and restart the script in KWin:
     ```bash
     qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.unloadScript "tessera"
     qdbus6 org.kde.KWin /Scripting org.kde.kwin.Scripting.start
     ```

---

## 4. Collecting Sanitized Diagnostics

When reporting an issue or filing a bug report, providing targeted system logs helps isolate the problem. Always sanitize sensitive information before sharing.

### 1. KWin Journal Logs
Capture KWin compositor messages related to Tessera:
```bash
journalctl --user -b -g "js:.*[Tt]essera" --no-pager | tail -n 50 > tessera-kwin.log
```

### 2. Sanitizing Log Output
Before pasting logs into GitHub issues:
- **Redact Personal Identifiers**: Manually review and replace usernames, home directory paths (e.g., `/home/<user>`), IP addresses, and machine hostnames with generic placeholders (`~`, `<user>`, `<host>`).
- **Redact Window Titles & URLs**: If window titles in logs contain private project names, document titles, credentials, or sensitive URLs, replace them with generic tokens (e.g., `[Redacted Window]`).
- Do not rely on automated search-and-replace scripts alone; explicit manual inspection and redaction before posting is required.

### 3. Desktop Environment Information
Include the following baseline information in your report:
```bash
echo "KDE Plasma: $(plasmashell --version 2>/dev/null || echo 'Unknown')"
echo "KWin: $(kwin_x11 --version 2>/dev/null || kwin_wayland --version 2>/dev/null || echo 'Unknown')"
echo "Session Type: ${XDG_SESSION_TYPE:-Unknown}"
echo "Python: $(python3 --version)"
```

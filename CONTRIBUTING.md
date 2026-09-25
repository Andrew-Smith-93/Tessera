# Contributing to Tessera

Thank you for your interest in improving Tessera! We welcome community contributions, bug reports, layout algorithms, and documentation improvements.

---

## 🏛️ Architecture Overview

Tessera is built as a self-contained KDE Plasma 6 KWin declarative script with a modern TypeScript monorepo architecture and native KDE System Settings configuration:

- **`packages/layout-core`**: Pure mathematical tiling algorithms (Balanced Grid default, Primary-Stack, Binary Split, Columns, Rows, Monocle, and Floating internal and compatibility solvers; no user-facing preset menus or cycling shortcuts), history navigation, and slot trees.
- **`packages/rules-engine`**: Window matching, floating rules, and application classifier filters.
- **`packages/protocol`**: Canonical IPC Protocol V1 specifications, commands, error taxonomy, and frozen JSON schemas.
- **`apps/kwin-adapter`**: Retained coordinator, dirty reconciliation, echo suppression filter, Region Occupancy model, and visual snap zone geometry.
- **`apps/runtime-simulator`**: Headless KWin session simulator and 25 deterministic golden trace fixtures verifying runtime invariants.
- **`contents/`**: Native KWin 6 declarative engine (`ui/main.qml`, `config/main.xml`, `ui/config.ui`).

> [!IMPORTANT]
> **Generated Bridge Rule**:
> `contents/code/layouts.js`, `contents/code/rules.js`, and `contents/code/reconciler.js` are **generated build artifacts** compiled from TypeScript.
> **DO NOT** edit `contents/code/*.js` directly. Changes must be made in the corresponding TypeScript packages under `packages/` or `apps/` and built via `npm run build`.

---

## 🛠️ Development Environment

### Prerequisites
- **Node.js**: v22.12.0 or later (supported ranges: ^22.12.0, ^24.0.0, >=26.0.0)
- **npm**: v10.x or later
- **Python**: 3.11 or later (for test verification suites and packaging validations)

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/Andrew-Smith-93/tiling-window-manager.git
   cd tiling-window-manager
   ```

2. Install dependencies cleanly:
   ```bash
   npm ci
   ```

3. Configure your local Git identity to use your GitHub noreply address:
   ```bash
   git config --local user.name "Your Name"
   git config --local user.email "<username>@users.noreply.github.com"
   ```

---

## 🧪 Quality Verification Matrix

All pull requests must pass the complete non-live verification matrix before merge:

1. **TypeScript Unit Tests**:
   ```bash
   npm test
   ```
2. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
3. **Monorepo Build**:
   ```bash
   npm run build
   ```
4. **Generated Artifact Integrity**:
   ```bash
   npm run verify:artifacts
   ```
5. **Protocol V1 Freeze Conformance**:
   ```bash
   npm run verify:freeze
   ```
6. **Runtime Simulator Verification**:
   ```bash
   npm run sim:verify
   npm run sim:run -- --seed 42 --quiet
   npm run sim:run -- --seed 12345 --quiet
   npm run sim:run -- --seed 99999 --quiet
   ```
7. **Python Syntax & Unit Tests**:
   ```bash
   python3 -m py_compile tests/*.py
   python3 -m unittest discover -s tests -p "test_*.py" -v
   ```
8. **Dependency Audit**:
   ```bash
   npm audit --omit=dev
   ```
9. **Deterministic Packaging**:
   ```bash
   ./package.sh
   ```

---

## 🔒 Protocol V1 Stability & Frozen Manifest

The Protocol V1 schemas and manifest in `packages/protocol/protocol-v1.freeze.json` represent a frozen contract. Changes to protocol types, envelope schemas, or event payloads will be rejected by `npm run verify:freeze` unless accompanied by an authorized protocol revision plan.

---

## 🖥️ Live Desktop Verification Boundaries

Automated CI and local test suites run in headless environments and do not manipulate your active desktop windows or restart KWin.

If you test the installer (`./install.sh`) locally on an active desktop session:
- Use a dedicated development machine or VM where possible.
- The installer operates inside an isolated temporary staging directory (`$DATA_HOME/.tessera-install.XXXXXX`) with transactional pre-commit staging. If aborted or interrupted prior to commit, the staging directory is cleanly discarded with zero desktop modifications; if a failure occurs during pre-commit installation, configuration and shortcuts are restored from recorded transaction snapshots. Once the core installation succeeds (`COMMITTED=true`), the installer deletes the temporary transaction directory and clears error traps; subsequent steps (legacy Control Center cleanup, Sycoca cache refresh, and KWin reconfigure) are best-effort post-commit actions without automatic rollback. The installer does not retain persistent backups. Triggering a manual KWin reload reapplies configuration from disk (does not revert), and running `./uninstall.sh` removes the script (does not restore previous configuration snapshots).
- Live KWin script reloading, live KCM settings bindings, Wayland session compatibility, and multi-monitor hotplug are reserved manual live gates.

---

## 🚀 Submitting Contributions

1. Create a feature branch off `main`:
   ```bash
   git checkout -b feat/my-enhancement
   ```
2. Make targeted, focused changes and add automated test coverage.
3. Verify that `git diff --check` shows no whitespace errors.
4. Run the full verification matrix above.
5. Push your branch to your fork and submit a Pull Request against `main`.
6. Complete all items in the Pull Request checklist.

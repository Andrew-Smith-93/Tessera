# Tessera Pre-Publication Safety, Privacy, Code-Quality, and Integrity Audit

> [!NOTE]
> **Historical Audit Snapshot**: This document records the pre-publication audit conducted during Phase 5C. It is a historical record of that checkpoint, not proof of current product state. Current authoritative architecture, audit findings, and verification gates are tracked in [PHASE_5D_SECOND_PASS_AUDIT.md](PHASE_5D_SECOND_PASS_AUDIT.md).

## 1. Audit Scope & Executive Summary

This audit assesses the readiness of **Tessera** (`Andrew-Smith-93/tiling-window-manager`) for a possible future transition from a private repository to a public open-source project under **Phase 5C**.

- **Repository**: `Andrew-Smith-93/tiling-window-manager`
- **Audit Branch**: `audit/pre-publication-safety-privacy-01`
- **Parent Commit**: `353dafd324abba1722a247e00f5d212bc1ee088a`
- **Repository Visibility**: **PRIVATE** (remains strictly private; no public toggle performed)
- **Rust Daemon Status**: **DISCONNECTED** (zero KWin integration, zero daemon background services or autostart units installed)
- **Protocol V1**: **FROZEN** (exact 7 schemas, 16 error codes, 6 events, 10 methods, 6 canonical capabilities preserved byte-for-byte)
- **Acceptance Matrix Accounting**: **EXACT 91 CASES** across 11 sections (A through K) preserved with zero modifications

### Summary of Actions Taken
1. **Current-Tree Privacy Sanitization**: Removed all local filesystem path leakages (`/home/<user>/...`) from `desktop/org.kde.tessera.desktop` and `docs/LIVE_KWIN_X11_ACCEPTANCE.md`. Zero local path references remain across all tracked files.
2. **Deterministic Reproducible Packaging**: Diagnosed packaging non-determinism caused by filesystem timestamp fluctuations and directory iteration order. Re-engineered `package.sh` with deterministic entry sorting, fixed timestamp (`2026-01-01 00:00:00`), and normalized POSIX file modes. Repeated builds now generate an invariant SHA-256 (`aa1b7f799b96acdb195214cf2db0cd604ac715c4a26e7b5f5f6d9c28e7ae01ab`). Added regression tests in `tests/test_package_manifest.py`.
3. **Full Security & History Audit**: Verified zero credentials, API keys, private keys, or personal phone/physical address disclosures exist across working tree or Git history.
4. **Licensing & Identity Inventory**: Compiled a decision inventory for Omega regarding author identity and license harmonization between GPL-3.0+ (KWin script) and MIT (daemon).

---

## 2. Reviewed Surfaces & Methodology

| Surface | Scope & Methodology |
| :--- | :--- |
| **Current Working Tree** | Exhaustive static regex scan of all tracked files for credentials, private keys, local paths, emails, and sensitive patterns. |
| **Complete Git History** | Full inspection of all reachable commits (`git log -p --all`), commit metadata, author/committer identities, and blob sizes. |
| **GitHub Surface** | Read-only inspection via GitHub CLI (`gh repo view`, `gh pr list`, `gh issue list`, `gh release list`, workflow configurations). |
| **Runtime Security** | Code audit of KWin QML script, bundled JavaScript bridges, TypeScript protocol package, and Rust daemon for unsafe evaluations (`eval`, `Function`), shell execution, IPC permissions, and path traversal. |
| **Dependencies & Supply Chain** | `npm audit`, `Cargo.lock` review, and GitHub Actions workflow permission review. |
| **Packaging & Manifest** | Archive entry inspection (`unzip -v`), reproducible packaging hash verification across repeated runs, and manifest isolation checks. |
| **Acceptance Matrix** | Verification of test counts, section totals, and Protocol V1 freeze integrity. |

---

## 3. Sanitized Findings Table

| ID | Surface | Severity | Finding Description | Status | Remediation / Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Packaging | **MEDIUM** | Non-deterministic packaging: timestamps and directory entry ordering varied between builds. | **RESOLVED** | Implemented deterministic ordering and fixed timestamp in `package.sh`. SHA-256 is now invariant. |
| **SEC-02** | Desktop File | **LOW** | Hardcoded local user path `/home/<user>/.local/bin/tessera-settings` in `Exec` field of `desktop/org.kde.tessera.desktop`. | **RESOLVED** | Replaced with standard PATH binary lookup: `Exec=tessera-settings %u`. |
| **SEC-03** | Documentation | **INFORMATIONAL** | Local paths `/home/<user>/.local/...` recorded in manual recovery instructions in `docs/LIVE_KWIN_X11_ACCEPTANCE.md`. | **RESOLVED** | Normalized to user-relative `~/.local/...` paths. |
| **SEC-04** | Dependencies | **LOW** | 2 moderate vulnerabilities in dev-dependency `@vitest/mocker` (Vitest: Path Traversal in mocker redirect mock). | **DEFERRED** | Dev tooling only; does not affect packaged KWin runtime. Deferred wholesale upgrade to prevent destabilization. |
| **SEC-05** | Identity / Contact | **INFORMATIONAL** | Mixed author email and maintainer fields across `metadata.json`, `PKGBUILD`, and `Cargo.toml`. | **DECISION FOR OMEGA** | Documented for Omega's explicit selection of public-facing identity. |
| **SEC-06** | Licensing | **INFORMATIONAL** | License divergence: `metadata.json` and AUR `PKGBUILD` specify `GPL-3.0+`, while `daemon/Cargo.toml` specifies `MIT`. | **DECISION FOR OMEGA** | Documented for Omega's approval on whether daemon should adopt GPL-3.0+ or remain MIT. |
| **SEC-07** | Workflows | **LOW** | CI workflow lacked `audit/*` branch trigger and `workflow_dispatch`. Third-party actions reference tags rather than commit SHAs. | **RESOLVED / DEFERRED** | Added `audit/*` branch trigger and `workflow_dispatch` to `.github/workflows/ci.yml`. Pinning actions to full commit SHAs is deferred to P1. |

---

## 4. Current-Tree Privacy Audit

- **Credentials & Secrets**: 0 active API keys, tokens, SSH private keys, certificates, or passwords found in the repository.
- **Local Path Leakage**:
  - `desktop/org.kde.tessera.desktop`: Sanitized hardcoded `/home/<user>/` path.
  - `docs/LIVE_KWIN_X11_ACCEPTANCE.md`: Sanitized local path strings to `~/.local/...`.
  - Verification: `git grep -rnI "/home/<user>"` returns **0 matches** across the entire working tree.
- **Runtime Telemetry**: Audited `contents/ui/main.qml`. Window identity logging is strictly confined to redacted internal tracking; window titles, captions, and process arguments are not emitted to default logs.
- **Media & Binary Assets**: All tracked SVG/PNG icons and UI assets were verified free of extraneous EXIF metadata, personal data, or private filesystem references.

---

## 5. Complete Git-History & Ref Audit

- **Reachable Commits**: All reachable commits across all branches were examined.
- **Secret Scanning across Diffs**: `git log -p --all` revealed zero API keys, private keys, database connection strings, or cloud tokens.
- **Author Identity Exposure**:
  - Commits consistently identify author/committer as:
    `Andrew Smith <137859776+Andrew-Smith-93@users.noreply.github.com>`
  - No personal physical addresses, personal telephone numbers, or financial identifiers exist in Git history.
- **Blob Sizes & History Integrity**:
  - Largest tracked blobs in history are `contents/ui/main.qml` (~88 KB) and `package-lock.json` (~68 KB).
  - No database dumps, crash logs, core dumps, binary build artifacts, or node_modules trees were ever committed.
- **Conclusion**: **No Git history rewriting is required or recommended.** Rewriting history would break developer refs and provide no privacy benefit given the absence of actual secrets.

---

## 6. GitHub-Side Exposure Surface

Read-only inspection of the GitHub remote (`Andrew-Smith-93/tiling-window-manager`):

| Surface | Current State | Exposure Risk upon Public Transition |
| :--- | :--- | :--- |
| **Visibility** | `PRIVATE` | Transitioning to `PUBLIC` would expose repository content, commit history, and PRs. |
| **Description & Topics**| Empty | None. |
| **Issues** | 0 open, 0 closed | None. |
| **Pull Requests** | 1 open PR (`#2 build(deps): bump @vitest/mocker...`) | PR #2 was opened by dependabot against main; contains only dev-dependency bump diff. |
| **Releases & Assets** | 0 releases, 0 tags | None. |
| **Actions Workflows** | 2 workflows (`ci.yml`, `release.yml`) | Standard CI checks; `release.yml` uses scoped permissions `contents: write`. |
| **GitHub Pages** | Not enabled | None. |
| **Discussions / Wiki** | Disabled | None. |

---

## 7. Security Review

- **KWin Script & QML Runtime**:
  - No use of `eval()` or dynamic `Function()` constructor.
  - No external command execution via shell or unvalidated child processes from QML.
  - Timer and signal handlers correctly disconnect on window unmanage events, preventing memory leaks or zombie event loops.
- **Protocol V1 & Serialization**:
  - TypeScript and Rust implementations share identical canonical schemas.
  - Frame length is strictly capped at 16 MiB; zero-length or oversized frames are rejected immediately before memory allocation.
  - Deterministic fuzzing suites (`packages/protocol/tests/fuzz.test.ts`) demonstrate resilience against arbitrary byte fragments and malformed JSON payloads.
- **Rust Daemon Socket Security**:
  - IPC endpoint placed strictly in `$XDG_RUNTIME_DIR/tessera/tessera.sock`.
  - Refuses execution if socket directory permissions are not `0700`.
  - Rejects `/tmp` paths and path traversal attempts (`..`).
  - Verifies peer credentials (UID matching) on incoming Unix domain socket connections.
- **Temporary Files & File Operations**:
  - Build and packaging scripts use localized directory paths (`build/`, `dist/`) without unsafe `/tmp` usage.

---

## 8. Dependency and Supply-Chain Audit

- **NPM Ecosystem**:
  - Monorepo manages dependencies via `package-lock.json` (lockfile version 3).
  - `npm audit` reported 2 moderate severity vulnerabilities in dev-dependency `@vitest/mocker`.
  - **Runtime Impact**: **Zero.** The packaged `.kwinscript` bundle is self-contained JavaScript produced via esbuild; npm runtime dependencies are not packaged into the KWin script.
- **Cargo Ecosystem**:
  - `Cargo.lock` pinned and locked.
  - Zero vulnerable crates identified in `tessera_daemon`.
- **GitHub Actions Workflows**:
  - Workflows use official actions: `actions/checkout@v4`, `actions/setup-node@v4`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`.
  - Permissions in `ci.yml` run with default read tokens.
  - Permissions in `release.yml` are explicitly restricted to `contents: write`.

---

## 9. Public Documentation Review

The repository documentation has been audited for clarity, accuracy, and tone:

- **Target Platform**: Accurately specifies **KDE Plasma 6 on KWin X11** as the presently verified live target. Wayland is explicitly documented as untested/deferred.
- **Daemon Status**: All documents accurately reflect that the Rust daemon is an optional decoupled component and is **currently disconnected** from KWin.
- **Acceptance Claims**: Accurately reflects the 91-case acceptance matrix, distinguishing live-verified cases from automated simulation fixtures. No unexecuted game or hardware hotplugging tests are claimed as passed.
- **No Personal Path Leakage**: All installation, troubleshooting, and configuration examples use generic or user-relative paths (`~/.local/...`).

---

## 10. Reproducible Packaging Audit

### Diagnosis of Prior Non-Determinism
Prior to Phase 5C, packaging `dist/tessera-v1.0.1.kwinscript` via standard `zip -r` resulted in fluctuating SHA-256 hashes across consecutive builds despite an identical source tree. Investigation revealed:
1. `zip` embedded host filesystem modification timestamps into the zip local headers and central directory.
2. File traversal order was dependent on filesystem inode ordering.

### Implementation of Deterministic Packager
In `package.sh`, the packaging step was updated to use a deterministic Python packager:
- **Normalized Timestamp**: `2026-01-01 00:00:00 UTC` applied to all archive entries.
- **Normalized Permissions**: `0o100644` for regular files, `0o40755` for directories.
- **Deterministic Entry Sorting**: `metadata.json` placed first, followed by remaining files and directories in strict lexicographical order.
- **Archive Entry Preservation**: Preserves the exact 11 archive entries (7 files and 4 directories) required by KPackage.

### Reproducibility Verification
Two consecutive builds performed from an unchanged tree produced identical SHA-256 hashes:
- **Build 1 Hash**: `aa1b7f799b96acdb195214cf2db0cd604ac715c4a26e7b5f5f6d9c28e7ae01ab`
- **Build 2 Hash**: `aa1b7f799b96acdb195214cf2db0cd604ac715c4a26e7b5f5f6d9c28e7ae01ab`
- **Result**: Byte-for-byte identical.

### Package Entry Inventory (Exact 11 Entries)
```
metadata.json (file, mode 0644)
contents/ (dir, mode 0755)
contents/code/ (dir, mode 0755)
contents/code/layouts.js (file, mode 0644)
contents/code/reconciler.js (file, mode 0644)
contents/code/rules.js (file, mode 0644)
contents/config/ (dir, mode 0755)
contents/config/main.xml (file, mode 0644)
contents/ui/ (dir, mode 0755)
contents/ui/config.ui (file, mode 0644)
contents/ui/main.qml (file, mode 0644)
```
*Note: Excludes all Rust source files, Cargo manifests, tests, fixtures, logs, and development artifacts.*

---

## 11. Automated Test Suite Verification

All verification suites execute cleanly with zero errors:

| Suite / Command | Total Tests / Files | Result |
| :--- | :--- | :--- |
| `cargo fmt --check` | All daemon source files | **PASS** |
| `cargo check --locked --all-targets` | All daemon targets | **PASS** |
| `cargo clippy --locked --all-targets -- -D warnings` | Zero warnings | **PASS** |
| `cargo test --locked` | 46 tests across 8 suites | **PASS** (46 passed, 0 failed) |
| `npm run typecheck` | Monorepo TypeScript packages | **PASS** |
| `npm test` | 21 test files | **PASS** (265 passed, 0 failed) |
| `npm run verify:freeze` | Protocol V1 freeze manifest | **PASS** (7 passed, 0 failed) |
| `npm run verify:artifacts` | Generated JavaScript artifacts | **PASS** (clean diff) |
| `npm run sim:verify` | 25 simulator golden fixtures | **PASS** (25 passed, 0 failed) |
| `npm run sim:run` (seeds 42, 12345, 99999) | 3 pseudo-random simulation runs | **PASS** |
| `python3 -m unittest discover tests` | Manifest, privacy & packaging tests | **PASS** (15 passed, 0 failed) |
| `package.sh` | Deterministic bundle build | **PASS** (SHA verified) |
| `kpackagetool6 --type KWin/Script --appstream-metainfo` | KPackage metadata validation | **PASS** (valid AppStream XML) |

---

## 12. Licensing and Author Identity Decisions for Omega

Before transitioning this repository to public visibility, Omega must decide and approve two configuration items:

### Decision 1: License Harmonization
- **Current State**:
  - Repository root `LICENSE`: GNU General Public License v3.0 (GPLv3).
  - Package metadata (`metadata.json`): `"License": "GPL-3.0+"`.
  - Arch Linux package (`desktop/PKGBUILD`): `license=('GPL3')`.
  - Rust Daemon (`daemon/Cargo.toml`): `license = "MIT"`.
- **Options for Omega**:
  1. *Dual License / Permissive Daemon*: Maintain GPL-3.0+ for the KWin QML script and MIT for the daemon crate.
  2. *Unified GPLv3*: Standardize the entire repository (including daemon) under GPL-3.0+.
- **Recommendation**: Retain current dual licensing or standardize to GPL-3.0+ across the repository upon public release.

### Decision 2: Public Author Name and Contact Address
- **Current State**:
  - `metadata.json`: `"Author": "Drew <user@localhost>"`
  - `PKGBUILD`: `Maintainer: Drew <user@localhost>`
  - Git Commits: `Andrew Smith <137859776+Andrew-Smith-93@users.noreply.github.com>`
  - GitHub Organization/User: `Andrew-Smith-93`
- **Options for Omega**:
  1. Retain `Drew` and `Andrew Smith <137859776+Andrew-Smith-93@users.noreply.github.com>` as the public maintainer identity.
  2. Normalize all package metadata to a preferred public display name and contact email address (e.g., `Andrew Smith <137859776+Andrew-Smith-93@users.noreply.github.com>`).

---

## 13. Ranked Refactor Backlog

### P0 — Publication Blockers
*None.* (All critical security, path disclosure, and packaging reproducibility issues are resolved.)

### P1 — Should Be Fixed Before First Public Release
1. **Multi-Monitor Drag Prospective Layout Isolation**: **RESOLVED in Phase 5D**. Eliminated premature live geometry mutations during drag hover across monitor boundaries. Real retiling triggers only upon commit.
2. **Corner Snap Slot Index Disambiguation**: **RESOLVED in Phase 5D**. Disambiguated corner quadrant slot indices (top-left: 0, top-right: 1, bottom-right: 2, bottom-left: 3) in `snap-zones.ts`.
3. **Pin GitHub Actions to Commit SHAs**: In `.github/workflows/ci.yml` and `release.yml`, pin third-party actions to full commit SHAs instead of version tags to protect against upstream tag mutation.

### P2 — Safe Post-Public Cleanup
1. **Dev-Dependency Vulnerability Remediation**: Upgrade `@vitest/mocker` once the upstream Vitest ecosystem publishes a stable minor release that does not break mock APIs.
2. **Telemetry Format Harmonization**: Align structured log field names between the runtime simulator and the KWin adapter.

### P3 — Optional Architectural Improvements
1. **Event-Driven Daemon Window Classification**: Implement future decoupled classification architecture:
   - Window classification triggered purely on window discovery events.
   - Reclassification only on relevant X11/KWin property changes.
   - Cache application policies.
   - No shader or framebuffer inspection.
   - No continuous polling or repeated process-tree traversal.
   - Strict fallback when classification is uncertain.

---

## 14. Recommended Remediation Sequence

1. **Omega Decision**: Provide decisions on Author Contact Identity and License Harmonization.
2. **P1 Code Fixes**: Implement the multi-monitor drag prospective layout fix and corner snap slot disambiguation on a dedicated feature branch.
3. **Workflow Hardening**: Pin GitHub Actions to commit SHAs.
4. **Public Transition**: Once approved by Omega, update repository settings on GitHub from Private to Public.

---

## 15. Architectural Confirmation

**The Rust daemon remains completely disconnected from KWin.** No IPC sockets are connected, and no systemd services, socket activation units, autostart entries, or background processes have been installed or enabled.

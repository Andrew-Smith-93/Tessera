## Description

Briefly describe the change, motivation, and context for this pull request.

## Type of Change

- [ ] Bug fix (non-breaking change fixing an issue)
- [ ] New feature / layout algorithm
- [ ] Documentation update
- [ ] Build / CI / tooling improvement
- [ ] Refactoring (no functional or protocol changes)

## Evidence Scope & Gating

- **Candidate Commit SHA**: `[Record exact 40-character commit SHA tested]`
- **Actual Verification Commands & Results**:
  - `npm test`: `[Record test file and test counts, e.g. 28 files, 407 passed]`
  - `npm run build`: `[Record build status]`
  - `python3 -m unittest ...`: `[Record python test results, e.g. 44 passed]`
- [ ] **Automated Test Evidence**: Unit tests, integration suites, simulation traces, and package builders pass completely.
- [ ] **Source Verification**: Monorepo builds, TypeScript typechecks, Protocol V1 freeze, and artifact checks pass.
- [ ] **Live Desktop Gates**: Explicitly state live testing status below (per `docs/PUBLIC_RELEASE_CHECKLIST.md`, automated non-live evidence does not replace live KWin/KCM acceptance):
  - [ ] Live Desktop Gates: **NOT RUN** (purely automated / CI non-live verification)
  - [ ] Live Desktop Gates: **VERIFIED** (specify KDE Plasma / KWin version, X11 or Wayland, and minimal manually sanitized evidence, never broad logs)

## Migration & Compatibility Risks

- [ ] **Configuration Schema & KCM**: Assessed impact on `contents/config/main.xml`, `contents/ui/config.ui`, or kconfig values; migration or default handling documented.
- [ ] **Shortcut Contract**: Assessed impact on `config/shortcuts.json`, QML registrations, or Plasma default shortcuts (`Meta+Left/Right`, `Meta+Space`); no undocumented collisions.

## Documentation & Community Inventory

- [ ] **Documentation Inventory Updated**: Tracked documentation surfaces (`README.md`, `docs/RUNTIME_ARCHITECTURE.md`, `docs/TROUBLESHOOTING.md`, etc.) updated with zero stale claims.
- [ ] **Link Integrity**: Verified internal relative Markdown links with `test_markdown_relative_links_integrity`.

## Quality & Verification Checklist

Before submitting this pull request, please verify the following:

- [ ] **TypeScript Tests**: Executed `npm test` and recorded actual command results above.
- [ ] **Type Checking**: `npm run typecheck` passes with zero errors.
- [ ] **Monorepo Build**: `npm run build` succeeds cleanly.
- [ ] **Artifact Integrity**: `npm run verify:artifacts` confirms generated bridges are up to date.
- [ ] **Generated Bridges**: Did **not** manually edit `contents/code/*.js` directly (sources live under `packages/` and `apps/`).
- [ ] **Protocol Freeze**: `npm run verify:freeze` confirms Protocol V1 freeze manifest is unchanged (or protocol change is explicitly justified).
- [ ] **Simulator & Goldens**: `npm run sim:verify` and stress seed checks pass.
- [ ] **Python & Packaging**: Python tests pass (`python3 -m unittest discover -s tests -p "test_*.py"`) and `./package.sh` builds cleanly.
- [ ] **Privacy & Secrets**: Verified no unapproved personal contacts or email addresses (outside authorized community governance in `CODE_OF_CONDUCT.md`), private file paths, or credentials are introduced in code, documentation, or commit messages.

# Security Policy

## Supported Versions

Tessera is currently in active pre-release development. Security fixes and patches are applied to the active default branch.

| Version / Branch | Supported | Notes |
| :--- | :--- | :--- |
| `main` (active dev) | :white_check_mark: | Active pre-release development |
| Prior release tags | :x: | Unreleased / historical |

## Reporting a Vulnerability

We take the security and integrity of Tessera seriously.

1. **Private Reporting Status (Pending Activation)**:
   - An authenticated private vulnerability intake mechanism (GitHub Private Vulnerability Reporting) is **currently unavailable / pending** repository publication and administrative activation (see Gate B in [docs/PUBLIC_RELEASE_CHECKLIST.md](docs/PUBLIC_RELEASE_CHECKLIST.md)).
   - Once the repository is published and Private Vulnerability Reporting is enabled in GitHub repository settings, security disclosures should be submitted directly via GitHub's **Security** tab (`Report a vulnerability`).

2. **Strict Public Disclosure Prohibition**:
   - Do **NOT** open public GitHub issues, discussion threads, or pull requests containing sensitive vulnerability descriptions, exploitation details, or reproduction payloads.
   - Do **NOT** post or transmit confidential vulnerability details through public comments or unencrypted public channels.

3. **Disclosure Information Requirements**:
   When Private Vulnerability Reporting is activated, disclosure submissions should include:
   - A clear description of the vulnerability and its potential impact.
   - Exact steps or a minimal proof-of-concept to reproduce the behavior in an isolated environment.
   - Affected desktop environment details (KDE Plasma version, KWin version, X11 or Wayland session).
   - Any proposed remediation or patch if available.

### Response & Handling Process

- **Triage & Remediation**: Once privately received, confirmed vulnerabilities will be resolved in an isolated private security advisory branch and validated against automated test suites before release.
- **Coordinated Disclosure**: Fixes will be coordinated and released alongside an advisory notice to give users sufficient opportunity to update.

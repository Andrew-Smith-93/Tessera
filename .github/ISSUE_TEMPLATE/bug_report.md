---
name: Bug report
about: Create a report to help us improve Tessera
title: '[BUG] '
labels: bug
assignees: ''
---

> [!WARNING]
> **Privacy First**: Do NOT include passwords, personal file paths, tokens, personal email addresses, or identifying user data in your report. Sanitize all log output before submitting.

### Environment Information

- **Tessera Exact Version / Commit**: [e.g., v1.0.1, commit `39538df`, installed via `install.sh` / `.kwinscript` / AUR]
- **Linux Distribution**: [e.g., Arch Linux, Fedora 40, openSUSE Tumbleweed]
- **KDE Plasma Version**: [e.g., 6.3.6]
- **KWin Version**: [e.g., 6.3.6]
- **Session Type**: [KWin Wayland or KWin X11]
- **Display & Screen Facts**: [e.g., Screen count, resolutions, per-output scale factors (e.g., Screen 0: 2560x1440 @ 125%, Screen 1: 1920x1080 @ 100%)]

### Describe the Bug

A clear and concise description of the issue.

### Minimal Steps to Reproduce

1. Start from clean/known state with layout '...'
2. Open window(s) '...'
3. Trigger shortcut / snap / resize action '...'
4. Observe the failure.

### Expected Behavior

A clear and concise description of what you expected to happen.

### Actual Observed Behavior

A clear description of what actually occurred (e.g., window overlap, geometry drift, missing slot).

### Targeted Diagnostic Logs (Sanitized)

> [!CAUTION]
> **Do NOT attach raw, unfiltered system or KWin logs** (such as `journalctl -n 50` or full session logs). Broad journal dumps capture unrelated desktop events, private application titles, URLs, and file paths.

If attaching diagnostics, provide **only targeted, manually sanitized Tessera script messages**:

```bash
# Query only Tessera script console output (explicitly review and manually redact all output before posting):
journalctl --user -b -g "js:.*[Tt]essera" --no-pager | tail -n 50
```

> [!IMPORTANT]
> **Manual Review Required**: Explicitly review and redact all output before posting. Check for window titles, private URLs, account identifiers, file paths, hostnames, or credentials. Automated search-and-replace scripts only mask predictable strings and are unsafe; always perform manual review.

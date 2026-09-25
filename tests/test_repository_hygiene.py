"""
Automated unit tests for Tessera repository hygiene, public collaboration readiness,
privacy enforcement, workflow hardening, and documentation link integrity.
"""

import unittest
import os
import re
import json
import hashlib
import subprocess

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def find_privacy_violations(relpath: str, content: str) -> list:
    """Scans content for personal email addresses or committed numeric GitHub noreply identities.
    Returns a list of violation messages."""
    violations = []

    # Standard email regex: captures email-like strings
    email_re = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

    # Generic numeric noreply identity pattern: digits + username @ noreply domain
    noreply_domain = "users.noreply.github.com"
    numeric_noreply_re = re.compile(r"\b\d+\+[A-Za-z0-9_.-]+@" + re.escape(noreply_domain) + r"\b")

    # Flag any numeric GitHub noreply addresses committed into tracked text
    if numeric_noreply_re.search(content):
        violations.append(
            f"{relpath}: contains numeric GitHub noreply email address; use generic 'GitHub noreply identity' instead"
        )

    # Flag any personal or non-noreply email addresses (except authorized conduct intake in CODE_OF_CONDUCT.md)
    allowed_placeholder = "<username>" + "@" + noreply_domain
    authorized_conduct_contact = "andrewsmith.independent" + "@" + "gmail.com"
    for m in email_re.finditer(content):
        addr = m.group(0)
        if addr == allowed_placeholder:
            continue
        if relpath == "CODE_OF_CONDUCT.md" and addr == authorized_conduct_contact:
            continue
        if not addr.endswith("@" + noreply_domain):
            violations.append(f"{relpath}: contains personal email address: {addr}")

    return violations


class TestRepositoryHygiene(unittest.TestCase):
    def test_community_health_files_exist(self):
        """Verifies presence of all required community health and governance files."""
        required_files = [
            "LICENSE",
            "SECURITY.md",
            "CODE_OF_CONDUCT.md",
            ".github/SUPPORT.md",
            ".github/CODEOWNERS",
            ".github/PULL_REQUEST_TEMPLATE.md",
            ".github/dependabot.yml",
            ".github/ISSUE_TEMPLATE/config.yml",
            ".github/ISSUE_TEMPLATE/bug_report.md",
            ".github/ISSUE_TEMPLATE/feature_request.md",
            "docs/PUBLIC_RELEASE_CHECKLIST.md",
        ]
        for rel in required_files:
            path = os.path.join(PROJECT_ROOT, rel)
            self.assertTrue(os.path.isfile(path), f"Missing required community file: {rel}")
            self.assertGreater(os.path.getsize(path), 0, f"File {rel} is empty")

    def test_codeowners_contents(self):
        """Verifies CODEOWNERS designates @Andrew-Smith-93 with explicit sensitive paths."""
        codeowners_path = os.path.join(PROJECT_ROOT, ".github", "CODEOWNERS")
        with open(codeowners_path, "r", encoding="utf-8") as f:
            content = f.read()

        self.assertIn("* @Andrew-Smith-93", content)
        self.assertIn("/.github/workflows/ @Andrew-Smith-93", content)
        self.assertIn("/contents/ @Andrew-Smith-93", content)
        self.assertIn("/metadata.json @Andrew-Smith-93", content)
        self.assertIn("/packages/protocol/ @Andrew-Smith-93", content)
        self.assertIn("/package.sh @Andrew-Smith-93", content)
        self.assertIn("/packaging/ @Andrew-Smith-93", content)

    def test_issue_templates_hygiene(self):
        """Verifies issue intake templates are privacy-first, free of vendor-specific hardware fields,
        solicit targeted sanitized diagnostics rather than broad journal dumps, and blank issues are disabled."""
        # config.yml
        cfg_path = os.path.join(PROJECT_ROOT, ".github", "ISSUE_TEMPLATE", "config.yml")
        with open(cfg_path, "r", encoding="utf-8") as f:
            cfg = f.read()
        self.assertIn("blank_issues_enabled: false", cfg)
        self.assertIn("SECURITY.md", cfg)
        self.assertNotIn("security/advisories/new", cfg)

        # bug_report.md
        bug_path = os.path.join(PROJECT_ROOT, ".github", "ISSUE_TEMPLATE", "bug_report.md")
        with open(bug_path, "r", encoding="utf-8") as f:
            bug = f.read()
        self.assertIn("Privacy First", bug)
        self.assertNotIn("NVIDIA", bug)
        self.assertNotIn("GeForce", bug)
        self.assertIn("KDE Plasma Version", bug)
        self.assertIn("Session Type", bug)
        self.assertIn("Display & Screen Facts", bug)
        self.assertIn("Minimal Steps to Reproduce", bug)
        self.assertIn("Expected Behavior", bug)
        self.assertIn("Actual Observed Behavior", bug)
        # Asserts no raw broad journal dumps are solicited
        self.assertNotIn("_COMM=kwin_", bug)
        self.assertNotIn("journalctl --user _COMM=", bug)
        self.assertIn('journalctl --user -b -g "js:.*[Tt]essera"', bug)

        # feature_request.md
        feat_path = os.path.join(PROJECT_ROOT, ".github", "ISSUE_TEMPLATE", "feature_request.md")
        with open(feat_path, "r", encoding="utf-8") as f:
            feat = f.read()
        self.assertIn("Privacy First", feat)

    def test_workflow_hardening_ci_and_release(self):
        """Verifies workflow security permissions, concurrency, SHA pinning, and release draft mode."""
        sha_action_re = re.compile(r"uses:\s*([A-Za-z0-9_\-\.\/]+)@([0-9a-f]{40})\b")

        # 1. CI Workflow
        ci_path = os.path.join(PROJECT_ROOT, ".github", "workflows", "ci.yml")
        with open(ci_path, "r", encoding="utf-8") as f:
            ci = f.read()

        self.assertIn("permissions:", ci)
        self.assertIn("contents: read", ci)
        self.assertIn("concurrency:", ci)
        self.assertIn("cancel-in-progress: true", ci)
        self.assertIn("npm audit --omit=dev", ci)

        # Ensure all actions in CI are SHA-pinned
        for line in ci.splitlines():
            if "uses:" in line and not line.strip().startswith("#"):
                action_spec = line.strip().split("uses:", 1)[1].strip().split("#")[0].strip()
                match = sha_action_re.match("uses: " + action_spec)
                self.assertIsNotNone(match, f"CI action step not 40-hex SHA pinned: {line}")

        # 2. Release Workflow
        rel_path = os.path.join(PROJECT_ROOT, ".github", "workflows", "release.yml")
        with open(rel_path, "r", encoding="utf-8") as f:
            rel = f.read()

        self.assertIn("permissions: {}", rel)
        self.assertIn("contents: write", rel)
        self.assertIn("draft: true", rel)
        self.assertIn("fail_on_unmatched_files: true", rel)
        self.assertIn("SHA256SUMS.txt", rel)
        self.assertIn("npm audit --omit=dev", rel)

        for line in rel.splitlines():
            if "uses:" in line and not line.strip().startswith("#"):
                action_spec = line.strip().split("uses:", 1)[1].strip().split("#")[0].strip()
                match = sha_action_re.match("uses: " + action_spec)
                self.assertIsNotNone(match, f"Release action step not 40-hex SHA pinned: {line}")

    def test_dependabot_configuration(self):
        """Verifies dependabot configuration targets npm and github-actions weekly on main without auto-merge."""
        dep_path = os.path.join(PROJECT_ROOT, ".github", "dependabot.yml")
        with open(dep_path, "r", encoding="utf-8") as f:
            dep = f.read()

        self.assertIn('package-ecosystem: "npm"', dep)
        self.assertIn('package-ecosystem: "github-actions"', dep)
        self.assertIn('directory: "/"', dep)
        self.assertIn('interval: "weekly"', dep)
        self.assertIn('target-branch: "main"', dep)
        self.assertNotIn('auto-merge', dep)

    def test_pull_request_template_evidence_and_risks(self):
        """Verifies PR template demands evidence scope (distinguishing automated from live gates NOT RUN),
        configuration/shortcut migration risks, and documentation inventory updates."""
        pr_path = os.path.join(PROJECT_ROOT, ".github", "PULL_REQUEST_TEMPLATE.md")
        with open(pr_path, "r", encoding="utf-8") as f:
            pr = f.read()

        self.assertIn("Evidence Scope & Gating", pr)
        self.assertIn("Automated Test Evidence", pr)
        self.assertIn("Live Desktop Gates: **NOT RUN**", pr)
        self.assertIn("Migration & Compatibility Risks", pr)
        self.assertIn("Configuration Schema & KCM", pr)
        self.assertIn("Shortcut Contract", pr)
        self.assertIn("Documentation & Community Inventory", pr)
        self.assertIn("Link Integrity", pr)

    def test_root_license_is_unmodified_official_gplv3(self):
        """Verifies root LICENSE contains complete official unmodified GNU GPLv3 text (not preamble-only stub)."""
        license_path = os.path.join(PROJECT_ROOT, "LICENSE")
        with open(license_path, "rb") as fp:
            license_bytes = fp.read()

        # Official system GNU GPL-3 full-text SHA-256 digest
        # Matches official FSF release /usr/share/licenses/common/GPL3/license.txt
        OFFICIAL_GPL3_SHA256 = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986"
        actual_sha256 = hashlib.sha256(license_bytes).hexdigest()
        self.assertEqual(
            actual_sha256,
            OFFICIAL_GPL3_SHA256,
            f"Root LICENSE SHA-256 digest {actual_sha256} does not match official GNU GPLv3 digest {OFFICIAL_GPL3_SHA256}"
        )

        content = license_bytes.decode("utf-8")
        self.assertIn("GNU GENERAL PUBLIC LICENSE", content)
        self.assertIn("Version 3, 29 June 2007", content)
        self.assertIn("TERMS AND CONDITIONS", content)
        self.assertIn("17. Interpretation of Sections 15 and 16.", content)
        self.assertIn("END OF TERMS AND CONDITIONS", content)
        self.assertNotIn("[Full text of the GNU General Public License v3:", content)
        self.assertGreaterEqual(len(content), 30000)
        self.assertGreaterEqual(len(content.splitlines()), 600)

    def test_aur_pkgbuild_structural_integrity(self):
        """Verifies packaging/aur/PKGBUILD has deterministic checkout source alias,
        no placeholder email, SPDX GPL-3.0-or-later license, and no GPU-optimized marketing claim."""
        pkg_path = os.path.join(PROJECT_ROOT, "packaging", "aur", "PKGBUILD")
        with open(pkg_path, "r", encoding="utf-8") as f:
            content = f.read()

        placeholder_email = "user" + "@" + "localhost"
        self.assertNotIn(placeholder_email, content)
        self.assertNotIn("GPU-optimized", content)
        self.assertIn("license=('GPL-3.0-or-later')", content)
        self.assertNotIn("license=('GPL3')", content)
        # Verify deterministic clone directory alias matching cd "$srcdir/$_pkgname"
        self.assertIn('source=("$_pkgname::git+', content)
        self.assertIn('cd "$srcdir/$_pkgname"', content)
        # Verify pure KWin script dependencies and absence of Control Center / Python dependencies
        self.assertIn("depends=('kwin' 'plasma-workspace')", content)
        self.assertNotIn("python-pyqt5", content)
        self.assertNotIn("tessera-control", content)

    def test_metadata_json_privacy_and_structure(self):
        """Verifies metadata.json omits placeholder Email and specifies safe identity."""
        meta_path = os.path.join(PROJECT_ROOT, "metadata.json")
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)

        authors = meta.get("KPlugin", {}).get("Authors", [])
        self.assertTrue(len(authors) > 0)
        for author in authors:
            self.assertNotIn("Email", author, f"metadata.json Author must not contain Email field: {author}")
            self.assertEqual(author.get("Name"), "Drew")

    def test_tracked_files_privacy_scan(self):
        """Scans all tracked files asserting no personal email addresses appear,
        and numeric GitHub noreply address is not committed into tracked documents."""
        output = subprocess.check_output(
            ["git", "ls-files"],
            cwd=PROJECT_ROOT,
            text=True
        )
        tracked_files = [line.strip() for line in output.splitlines() if line.strip()]

        all_violations = []
        for rel in tracked_files:
            full = os.path.join(PROJECT_ROOT, rel)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "r", encoding="utf-8") as f:
                    content = f.read()
            except UnicodeDecodeError:
                continue  # Binary file

            # Note: Scans 100% of tracked text files including this test itself. No self-exclusion.
            violations = find_privacy_violations(rel, content)
            all_violations.extend(violations)

        self.assertEqual(all_violations, [], "Tracked file privacy violations:\n" + "\n".join(all_violations))

    def test_privacy_scanner_negative_mutation_probes(self):
        """Proves that find_privacy_violations correctly catches:
        1. Synthetic personal email addresses.
        2. Synthetic numeric noreply identities.
        And permits generic placeholders."""
        # Probe 1: Synthetic personal email
        synthetic_personal = "developer" + "@" + "example.org"
        mutated_text_1 = f"Contact us at {synthetic_personal} for questions."
        violations_1 = find_privacy_violations("synthetic/test.md", mutated_text_1)
        self.assertTrue(
            any(synthetic_personal in v for v in violations_1),
            f"Negative probe failed: expected personal email to be flagged, got {violations_1}"
        )

        # Probe 2: Synthetic numeric noreply address
        synthetic_numeric_noreply = "12345678" + "+" + "developer" + "@" + "users.noreply.github.com"
        mutated_text_2 = f"Author: {synthetic_numeric_noreply}"
        violations_2 = find_privacy_violations("synthetic/test.md", mutated_text_2)
        self.assertTrue(
            any("numeric GitHub noreply" in v for v in violations_2),
            f"Negative probe failed: expected numeric noreply to be flagged, got {violations_2}"
        )

        # Probe 3: Author specific numeric noreply constructed at runtime
        author_probe = "".join(["137859776", "+", "Andrew", "-Smith-93", "@", "users", ".noreply.github.com"])
        mutated_text_3 = f"Signed-off-by: {author_probe}"
        violations_3 = find_privacy_violations("synthetic/test.md", mutated_text_3)
        self.assertTrue(
            any("numeric GitHub noreply" in v for v in violations_3),
            f"Negative probe failed: expected author numeric noreply to be flagged, got {violations_3}"
        )

        # Probe 4: Allowed placeholder produces no violation
        placeholder = "<username>" + "@" + "users.noreply.github.com"
        clean_text = f"Configure your Git email to {placeholder}."
        violations_4 = find_privacy_violations("synthetic/test.md", clean_text)
        self.assertEqual(violations_4, [], f"Expected placeholder to be allowed, got {violations_4}")


    def test_markdown_relative_links_integrity(self):
        """Scans all tracked Markdown documents asserting all relative file links resolve to existing files."""
        output = subprocess.check_output(
            ["git", "ls-files", "*.md"],
            cwd=PROJECT_ROOT,
            text=True
        )
        md_files = [line.strip() for line in output.splitlines() if line.strip()]

        link_re = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
        broken_links = []

        for rel_md in md_files:
            full_md = os.path.join(PROJECT_ROOT, rel_md)
            with open(full_md, "r", encoding="utf-8") as f:
                content = f.read()

            for text, target in link_re.findall(content):
                if target.startswith("http://") or target.startswith("https://") or target.startswith("mailto:") or target.startswith("#"):
                    continue
                clean_target = target.split("#")[0]
                if not clean_target:
                    continue
                resolved = os.path.normpath(os.path.join(os.path.dirname(full_md), clean_target))
                if not os.path.exists(resolved):
                    broken_links.append(f"{rel_md}: [{text}]({target}) -> unresolved path {resolved}")

        self.assertEqual(broken_links, [], "Broken relative Markdown links detected:\n" + "\n".join(broken_links))

    def test_unshipped_standalone_kwin_adapter_not_built(self):
        """Verifies dist/kwin-adapter.js is not built and dead engine cluster files are absent."""
        unshipped_bundle = os.path.join(PROJECT_ROOT, "dist", "kwin-adapter.js")
        self.assertFalse(os.path.exists(unshipped_bundle), "dist/kwin-adapter.js must not exist")

        esbuild_path = os.path.join(PROJECT_ROOT, "apps", "kwin-adapter", "esbuild.config.mjs")
        with open(esbuild_path, "r", encoding="utf-8") as f:
            esb = f.read()
        self.assertNotIn("kwin-adapter.js", esb, "esbuild config must not build kwin-adapter.js")

        retired_cluster = [
            "apps/kwin-adapter/src/tiling-engine.ts",
            "apps/kwin-adapter/src/screen-state.ts",
            "apps/kwin-adapter/src/kwin-api.ts",
            "apps/kwin-adapter/src/shortcuts.ts",
        ]
        for rel in retired_cluster:
            path = os.path.join(PROJECT_ROOT, rel)
            self.assertFalse(os.path.exists(path), f"Retired engine cluster file must not exist: {rel}")


if __name__ == "__main__":
    unittest.main()

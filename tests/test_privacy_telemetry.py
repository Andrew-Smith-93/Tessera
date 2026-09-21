import unittest
import os
import re

class TestPrivacyTelemetry(unittest.TestCase):
    def setUp(self):
        self.qml_path = os.path.join(os.path.dirname(__file__), "../contents/ui/main.qml")
        self.code_dir = os.path.join(os.path.dirname(__file__), "../contents/code")

    def test_main_qml_logging_privacy(self):
        self.assertTrue(os.path.exists(self.qml_path))
        with open(self.qml_path, "r", encoding="utf-8") as f:
            content = f.read()

        log_matches = re.findall(r"log\s*\(([^)]+)\)", content)
        self.assertGreater(len(log_matches), 0)

        disallowed_props = [
            "caption",
            "resourceClass",
            "resourceName",
            "appId",
            "desktopFileName",
            "windowRole",
            "internalId"
        ]

        for stmt in log_matches:
            stmt = stmt.strip()
            for prop in disallowed_props:
                pattern = rf"\b(?:w|target|win|o)\.{prop}\b"
                self.assertFalse(
                    bool(re.search(pattern, stmt, re.IGNORECASE)),
                    f"Disallowed property interpolation '{prop}' in log statement: log({stmt})"
                )

            # Disallow wid / windowId variable interpolation
            self.assertFalse(
                bool(re.search(r"(\+\s*\b(?:wid|windowId)\b|\b(?:wid|windowId)\b\s*\+)", stmt)),
                f"Disallowed window ID variable interpolation in log statement: log({stmt})"
            )

            # Disallow private paths
            self.assertFalse(
                bool(re.search(r"(?:/home/|/usr/bin/|/proc/)", stmt)),
                f"Filesystem path leaked in log statement: log({stmt})"
            )

    def test_runtime_code_artifacts_have_no_console_logs(self):
        self.assertTrue(os.path.exists(self.code_dir))
        for fname in os.listdir(self.code_dir):
            if fname.endswith(".js"):
                fpath = os.path.join(self.code_dir, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    data = f.read()
                self.assertNotIn("console.log(", data, f"{fname} must not contain console.log")
                self.assertNotIn("console.warn(", data, f"{fname} must not contain console.warn")
                self.assertNotIn("console.error(", data, f"{fname} must not contain console.error")
                self.assertFalse(bool(re.search(r"\bprint\s*\(", data)), f"{fname} must not contain print()")

    def test_no_local_path_leakage_in_tracked_files(self):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        import subprocess
        output = subprocess.check_output(
            ["git", "ls-files"], cwd=repo_root, text=True
        )
        tracked_files = [f.strip() for f in output.splitlines() if f.strip()]
        for relpath in tracked_files:
            # Skip test itself
            if relpath == "tests/test_privacy_telemetry.py":
                continue
            fullpath = os.path.join(repo_root, relpath)
            if not os.path.isfile(fullpath):
                continue
            with open(fullpath, "rb") as f:
                content = f.read()
            self.assertNotIn(
                b"/home/drew",
                content,
                f"Tracked file {relpath} contains local path leakage '/home/drew'"
            )

if __name__ == "__main__":
    unittest.main()

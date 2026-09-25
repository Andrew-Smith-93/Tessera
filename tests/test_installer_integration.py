import copy
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
REPO_IGNORE_PATTERNS = (".git", "node_modules", "target", "dist", "__pycache__")


class SandboxHarness:
    """Stateful sandbox harness for installer/uninstaller tests.
    Uses temporary HOME, XDG directories, controlled PATH, and models kreadconfig6/kwriteconfig6
    with exact presence vs empty string, raw values, failure injection, and fail-after-side-effect."""
    def __init__(self, root: str):
        self.root = root
        self.fake_bin = os.path.join(root, "fake-bin")
        self.home = os.path.join(root, "home")
        self.data_home = os.path.join(root, "xdg-data")
        self.config_home = os.path.join(root, "xdg-config")
        self.bin_home = os.path.join(root, "xdg-bin")
        self.state_file = os.path.join(root, "kconfig_state.json")
        self.tool_py = os.path.join(root, "kconfig_tool.py")

        for d in (self.fake_bin, self.home, self.data_home, self.config_home, self.bin_home):
            os.makedirs(d, exist_ok=True)

        self._init_state()
        self._write_kconfig_tool()
        self._write_mock_executables()

    def _init_state(self):
        state = {"store": {}, "log": [], "fail_rules": []}
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(state, f)

    def _read_state(self):
        with open(self.state_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save_state(self, state):
        with open(self.state_file, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)

    def _write_file(self, path: str, content: str, make_executable: bool = False):
        with open(path, "w", encoding="utf-8") as f:
            f.write(textwrap.dedent(content).lstrip())
        if make_executable:
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    def _write_kconfig_tool(self):
        code = f"""
        import sys, os, json

        STATE_FILE = {self.state_file!r}
        SENTINEL = "__TESSERA_MISSING_INTERNAL_SENTINEL__"

        def load_state():
            if os.path.exists(STATE_FILE):
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            return {{"store": {{}}, "log": [], "fail_rules": []}}

        def save_state(s):
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(s, f, indent=2)

        def main():
            if len(sys.argv) < 2:
                sys.exit(1)
            tool = sys.argv[1]
            args = sys.argv[2:]

            state = load_state()

            file = ""
            group = ""
            key = ""
            default = None
            is_delete = False
            value = None

            i = 0
            while i < len(args):
                arg = args[i]
                if arg == "--file" and i + 1 < len(args):
                    file = args[i+1]; i += 2
                elif arg == "--group" and i + 1 < len(args):
                    group = args[i+1]; i += 2
                elif arg == "--key" and i + 1 < len(args):
                    key = args[i+1]; i += 2
                elif arg == "--default" and i + 1 < len(args):
                    default = args[i+1]; i += 2
                elif arg == "--delete":
                    is_delete = True; i += 1
                elif arg == "--type" and i + 1 < len(args):
                    i += 2
                else:
                    value = arg; i += 1

            if tool == "kreadconfig6":
                state["log"].append({{"action": "read", "file": file, "group": group, "key": key}})
                save_state(state)

                # Check fail rules
                for r in list(state.get("fail_rules", [])):
                    if r.get("tool") == "kreadconfig6" and r.get("key") in (None, key):
                        if r.get("file") in (None, file) and r.get("group") in (None, group):
                            if r.get("once"):
                                state["fail_rules"].remove(r)
                                save_state(state)
                            sys.exit(r.get("exit_code", 1))

                val = state["store"].get(file, {{}}).get(group, {{}}).get(key, SENTINEL)
                if val == SENTINEL:
                    if default is not None:
                        sys.stdout.write(default + "\\n")
                        sys.exit(0)
                    else:
                        sys.exit(1)
                else:
                    sys.stdout.write(val + "\\n")
                    sys.exit(0)

            elif tool == "kwriteconfig6":
                if os.environ.get("MOCK_SIGINT_ON_KEY") and key == os.environ.get("MOCK_SIGINT_ON_KEY"):
                    import signal, time
                    os.kill(os.getppid(), signal.SIGINT)
                    time.sleep(1)
                    sys.exit(130)

                state["log"].append({{"action": "delete" if is_delete else "write", "file": file, "group": group, "key": key, "value": value}})

                matched_rule = None
                for r in list(state.get("fail_rules", [])):
                    if r.get("tool") == "kwriteconfig6" and r.get("key") in (None, key):
                        if r.get("file") in (None, file) and r.get("group") in (None, group):
                            matched_rule = r
                            break

                if matched_rule and matched_rule.get("mode") == "fail_before":
                    if matched_rule.get("once"):
                        state["fail_rules"].remove(matched_rule)
                    save_state(state)
                    sys.exit(matched_rule.get("exit_code", 1))

                # Apply side effect
                if is_delete:
                    if file in state["store"] and group in state["store"][file]:
                        state["store"][file][group].pop(key, None)
                else:
                    state["store"].setdefault(file, {{}}).setdefault(group, {{}})[key] = "" if value is None else str(value)

                if matched_rule and matched_rule.get("mode") == "fail_after":
                    if matched_rule.get("once"):
                        state["fail_rules"].remove(matched_rule)
                    save_state(state)
                    sys.exit(matched_rule.get("exit_code", 1))

                save_state(state)
                sys.exit(0)

        if __name__ == "__main__":
            main()
        """
        self._write_file(self.tool_py, code)

    def _write_mock_executables(self):
        real_python = sys.executable

        # python3 mock
        self._write_file(
            os.path.join(self.fake_bin, "python3"),
            f"""
            #!/usr/bin/env bash
            if [ "${{MOCK_FAIL_PYTHON3:-0}}" = "1" ]; then
                echo "Mock python3 missing" >&2
                exit 127
            fi
            if [ "${{1:-}}" = "-c" ] && [ "${{2:-}}" = "import PyQt5" ]; then
                if [ "${{MOCK_FAIL_PYQT5:-0}}" = "1" ]; then
                    exit 1
                fi
                exit 0
            fi
            exec {real_python!r} "$@"
            """,
            make_executable=True
        )

        # kreadconfig6 mock
        self._write_file(
            os.path.join(self.fake_bin, "kreadconfig6"),
            f"""
            #!/usr/bin/env bash
            if [ "${{MOCK_FAIL_KREADCONFIG6:-0}}" = "1" ]; then
                echo "Mock kreadconfig6 missing" >&2
                exit 127
            fi
            exec {real_python!r} {self.tool_py!r} kreadconfig6 "$@"
            """,
            make_executable=True
        )

        # kwriteconfig6 mock
        self._write_file(
            os.path.join(self.fake_bin, "kwriteconfig6"),
            f"""
            #!/usr/bin/env bash
            if [ "${{MOCK_FAIL_KWRITECONFIG6:-0}}" = "1" ]; then
                echo "Mock kwriteconfig6 missing" >&2
                exit 127
            fi
            exec {real_python!r} {self.tool_py!r} kwriteconfig6 "$@"
            """,
            make_executable=True
        )

        # mv mock for phase-aware target replacement failure injection
        self._write_file(
            os.path.join(self.fake_bin, "mv"),
            """
            #!/usr/bin/env bash
            fail_target="${MOCK_FAIL_MV_TARGET:-}"
            fail_phase="${MOCK_FAIL_MV_PHASE:-backup}"
            log_file="${MOCK_MV_LOG:-}"
            if [ -n "$fail_target" ]; then
                if [ "$fail_phase" = "backup" ]; then
                    if [ "$1" = "$fail_target" ] && [[ "$2" == *"/backup/"* ]]; then
                        [ -n "$log_file" ] && echo "HIT_BACKUP $fail_target" >> "$log_file"
                        echo "Mock mv failure backing up $fail_target" >&2
                        exit 66
                    fi
                elif [ "$fail_phase" = "stage" ]; then
                    if [ "$2" = "$fail_target" ] && [[ "$1" == *"/stage/"* ]]; then
                        [ -n "$log_file" ] && echo "HIT_STAGE $fail_target" >> "$log_file"
                        echo "Mock mv failure staging $fail_target" >&2
                        exit 67
                    fi
                fi
            fi
            exec /bin/mv "$@"
            """,
            make_executable=True
        )

        # cp mock for staging failure injection
        self._write_file(
            os.path.join(self.fake_bin, "cp"),
            """
            #!/usr/bin/env bash
            if [ "${MOCK_FAIL_CP:-0}" = "1" ]; then
                echo "Mock cp failure" >&2
                exit 77
            fi
            exec /bin/cp "$@"
            """,
            make_executable=True
        )

        # kbuildsycoca6 and qdbus6 stubs
        self._write_file(os.path.join(self.fake_bin, "kbuildsycoca6"), "#!/usr/bin/env bash\nexit 0\n", make_executable=True)
        self._write_file(os.path.join(self.fake_bin, "qdbus6"), "#!/usr/bin/env bash\nexit 0\n", make_executable=True)

    def make_controlled_path(self, omit: str = None) -> str:
        """Construct a controlled PATH directory containing required standard POSIX utilities
        and mocks, physically omitting `omit` ('python3', 'kreadconfig6', or 'kwriteconfig6')."""
        ctrl_dir = os.path.join(self.root, f"ctrl_path_omit_{omit or 'none'}")
        os.makedirs(ctrl_dir, exist_ok=True)
        for util in ("bash", "sh", "sed", "mkdir", "rm", "chmod", "mktemp", "cat", "dirname", "readlink", "grep", "node"):
            p = shutil.which(util)
            if p and os.path.exists(p):
                target = os.path.join(ctrl_dir, util)
                if not os.path.exists(target):
                    os.symlink(p, target)
        for mock_tool in ("kreadconfig6", "kwriteconfig6", "mv", "cp", "kbuildsycoca6", "qdbus6"):
            if mock_tool != omit:
                src = os.path.join(self.fake_bin, mock_tool)
                target = os.path.join(ctrl_dir, mock_tool)
                if not os.path.exists(target):
                    os.symlink(src, target)
        if omit != "python3":
            src = os.path.join(self.fake_bin, "python3")
            target = os.path.join(ctrl_dir, "python3")
            if not os.path.exists(target):
                os.symlink(src, target)
        return ctrl_dir

    def env(self, extra_env: dict = None) -> dict:
        merged = dict(
            os.environ,
            HOME=self.home, XDG_DATA_HOME=self.data_home,
            XDG_CONFIG_HOME=self.config_home,
            XDG_BIN_HOME=self.bin_home,
            PATH=f"{self.fake_bin}:{os.environ.get('PATH', '/usr/bin:/bin')}",
            KCONFIG_STATE_FILE=self.state_file,
            NODE_PATH=f"{os.environ.get('NODE_PATH','')}:{os.path.join(REPO_ROOT, 'node_modules')}".strip(':'),
        )
        if extra_env:
            merged.update(extra_env)
        return merged

    def set_kconfig(self, file: str, group: str, key: str, val: str):
        state = self._read_state()
        state["store"].setdefault(file, {}).setdefault(group, {})[key] = val
        self._save_state(state)

    def get_kconfig(self, file: str, group: str, key: str):
        state = self._read_state()
        if file in state["store"] and group in state["store"][file] and key in state["store"][file][group]:
            return True, state["store"][file][group][key]
        return False, None

    def delete_kconfig(self, file: str, group: str, key: str):
        state = self._read_state()
        if file in state["store"] and group in state["store"][file]:
            state["store"][file][group].pop(key, None)
        self._save_state(state)

    def add_fail_rule(self, tool: str, key: str = None, mode: str = "fail_before", exit_code: int = 1, file: str = None, group: str = None, once: bool = True):
        state = self._read_state()
        state.setdefault("fail_rules", []).append({
            "tool": tool,
            "key": key,
            "mode": mode,
            "exit_code": exit_code,
            "file": file,
            "group": group,
            "once": once
        })
        self._save_state(state)

    def clear_logs(self):
        state = self._read_state()
        state["log"] = []
        self._save_state(state)

    def get_logs(self):
        state = self._read_state()
        return state.get("log", [])

    def run_installer(self, cwd: str = REPO_ROOT, extra_env: dict = None, args: list = None) -> subprocess.CompletedProcess:
        cmd = [os.path.join(cwd, "install.sh")] + (args or [])
        return subprocess.run(cmd, cwd=cwd, env=self.env(extra_env), capture_output=True, text=True)

    def run_uninstaller(self, cwd: str = REPO_ROOT, extra_env: dict = None, args: list = None) -> subprocess.CompletedProcess:
        cmd = [os.path.join(cwd, "uninstall.sh")] + (args or [])
        return subprocess.run(cmd, cwd=cwd, env=self.env(extra_env), capture_output=True, text=True)


EXPECTED_KWIN_FILES = {
    "metadata.json",
    "contents/code/layouts.js",
    "contents/code/reconciler.js",
    "contents/code/rules.js",
    "contents/config/main.xml",
    "contents/ui/config.ui",
    "contents/ui/main.qml",
}




def get_relative_files(base_dir: str) -> set:
    rel_files = set()
    for root, _, files in os.walk(base_dir):
        for f in files:
            rel_files.add(os.path.relpath(os.path.join(root, f), base_dir))
    return rel_files


class TestInstallerIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sb = SandboxHarness(self.tmp.name)

        with open(os.path.join(REPO_ROOT, "config", "shortcuts.json"), "r", encoding="utf-8") as f:
            self.shortcuts_doc = json.load(f)

    def tearDown(self):
        self.tmp.cleanup()

    def test_fresh_install_acceptance(self):
        """1. Fresh install:
        - exact intended installed files matching runtime allowlists
        - plugin enabled
        - only absent active shortcuts receive defaults
        - no transaction temp dirs remain."""
        res = self.sb.run_installer()
        self.assertEqual(res.returncode, 0, f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}")

        # Check installed targets against exact allowlists
        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        control_dir = os.path.join(self.sb.data_home, "tessera", "control")
        desktop_file = os.path.join(self.sb.data_home, "applications", "org.kde.tessera.desktop")
        icon_file = os.path.join(self.sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")

        self.assertEqual(get_relative_files(kwin_script), EXPECTED_KWIN_FILES)
        self.assertFalse(os.path.exists(control_dir))
        self.assertFalse(os.path.exists(desktop_file))
        self.assertFalse(os.path.exists(icon_file))
        self.assertFalse(os.path.exists(launcher))

        # Plugin enabled
        present, val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
        self.assertTrue(present)
        self.assertEqual(val, "true")

        # All 22 active shortcuts written with defaults
        self.assertEqual(len(self.shortcuts_doc["shortcuts"]), 22)
        for item in self.shortcuts_doc["shortcuts"]:
            name = item["name"]
            seq = item["sequence"]
            lbl = item["label"]
            sc_present, sc_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", name)
            self.assertTrue(sc_present, f"Shortcut {name} must be present")
            self.assertEqual(sc_val, f"{seq},{seq},{lbl}")

        # No transaction temp dirs remain
        temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
        self.assertEqual(temp_dirs, [])

    def test_provenance_and_decoy_isolation(self):
        """Proves that untracked and local files (e.g. __pycache__, .pyc, logs, local configs)
        in the checkout are never copied to the installed trees, and installed trees match
        the exact allowlist."""
        with tempfile.TemporaryDirectory(prefix="tessera-decoy-test-") as disp_tmp:
            disp_repo = os.path.join(disp_tmp, "repo")
            shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns(*REPO_IGNORE_PATTERNS))

            # Inject decoys into contents
            os.makedirs(os.path.join(disp_repo, "contents", "__pycache__"), exist_ok=True)
            with open(os.path.join(disp_repo, "contents", "__pycache__", "leak.pyc"), "wb") as f:
                f.write(b"junk")
            with open(os.path.join(disp_repo, "contents", "leak.log"), "w") as f:
                f.write("junk")
            with open(os.path.join(disp_repo, "contents", "code", "untracked.js"), "w") as f:
                f.write("// junk")
            with open(os.path.join(disp_repo, "contents", "ui", "extra.qml"), "w") as f:
                f.write("// junk")
            os.makedirs(os.path.join(disp_repo, "contents", "extra_dir"), exist_ok=True)
            with open(os.path.join(disp_repo, "contents", "extra_dir", "junk.dat"), "w") as f:
                f.write("junk")

            res = self.sb.run_installer(cwd=disp_repo)
            self.assertEqual(res.returncode, 0, res.stderr)

            kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")

            # Assert exact allowlist
            self.assertEqual(get_relative_files(kwin_script), EXPECTED_KWIN_FILES)

            # Assert no decoys or pycache anywhere in data_home
            all_installed_files = get_relative_files(self.sb.data_home)
            for f in all_installed_files:
                self.assertFalse(f.endswith(".pyc"), f"Bytecode file leaked: {f}")
                self.assertFalse(f.endswith(".log"), f"Log file leaked: {f}")
                self.assertNotIn("__pycache__", f, f"__pycache__ leaked: {f}")
                self.assertNotIn("local-config.json", f, f"Local config leaked: {f}")
                self.assertNotIn("nested.txt", f, f"Nested extra file leaked: {f}")
                self.assertNotIn("untracked.js", f, f"Untracked js leaked: {f}")
                self.assertNotIn("extra.qml", f, f"Extra qml leaked: {f}")
                self.assertNotIn("junk.dat", f, f"Junk file leaked: {f}")

    def test_update_preserves_custom_and_empty_bindings_and_removes_legacy(self):
        """2. Update:
        - seed installed targets with prior content
        - seed active shortcut states: customized nonempty binding and explicitly empty binding
        - update replaces intended files
        - cleans up legacy control center and launcher files
        - preserves both bindings exactly
        - removes obsolete legacy action."""
        # Seed targets (script and legacy targets)
        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        control_dir = os.path.join(self.sb.data_home, "tessera", "control")
        desktop_file = os.path.join(self.sb.data_home, "applications", "org.kde.tessera.desktop")
        icon_file = os.path.join(self.sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")

        os.makedirs(kwin_script, exist_ok=True)
        os.makedirs(control_dir, exist_ok=True)
        os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
        os.makedirs(os.path.dirname(icon_file), exist_ok=True)
        os.makedirs(os.path.dirname(launcher), exist_ok=True)

        with open(os.path.join(kwin_script, "old_file.txt"), "w") as f: f.write("old script")
        with open(os.path.join(control_dir, "old_file.txt"), "w") as f: f.write("old control")
        with open(desktop_file, "w") as f: f.write("old desktop")
        with open(icon_file, "w") as f: f.write("old icon")
        with open(launcher, "w") as f: f.write("old launcher")

        # Seed shortcuts: custom nonempty, explicit empty, and legacy action
        custom_key = "Tessera: Toggle Tiling"
        empty_key = "Tessera: Toggle Zone Overlay"
        legacy_key = "Tessera: Increase Master Ratio"
        legacy_custom_key = "Tessera: Decrease Master Ratio"
        proven_default_key = "Tessera: Next Layout"
        true_default_master_key = "Tessera: Increase Master Count"

        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_key, "Meta+T,Meta+T,Custom user binding")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_key, "")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_key, "Ctrl+Shift+L,Ctrl+Shift+L,Expand Primary Region Ratio")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_custom_key, "Ctrl+Shift+H,Ctrl+Shift+H,Old Master")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", proven_default_key, "Ctrl+Space,Ctrl+Space,Cycle to Next Layout")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", true_default_master_key, "Ctrl+Shift+I,Ctrl+Shift+I,Tessera: Increase Master Count")

        res = self.sb.run_installer()
        self.assertEqual(res.returncode, 0, res.stderr)

        # Targets replaced (old files gone, new files present)
        self.assertFalse(os.path.exists(os.path.join(kwin_script, "old_file.txt")))
        self.assertTrue(os.path.exists(os.path.join(kwin_script, "metadata.json")))

        # Legacy control center files cleaned up
        self.assertFalse(os.path.exists(control_dir))
        self.assertFalse(os.path.exists(desktop_file))
        self.assertFalse(os.path.exists(icon_file))
        self.assertFalse(os.path.exists(launcher))

        # Custom and empty bindings preserved exactly
        _, custom_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_key)
        self.assertEqual(custom_val, "Meta+T,Meta+T,Custom user binding")

        has_empty, empty_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_key)
        self.assertTrue(has_empty)
        self.assertEqual(empty_val, "")

        # Legacy binding with cross-action label preserved byte-for-byte
        has_legacy, legacy_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_key)
        self.assertTrue(has_legacy, f"Legacy shortcut {legacy_key} with cross-action label must be preserved")
        self.assertEqual(legacy_val, "Ctrl+Shift+L,Ctrl+Shift+L,Expand Primary Region Ratio")

        # Legacy binding with custom label preserved byte-for-byte
        has_legacy_custom, legacy_custom_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_custom_key)
        self.assertTrue(has_legacy_custom, f"Legacy shortcut {legacy_custom_key} with custom label must be preserved")
        self.assertEqual(legacy_custom_val, "Ctrl+Shift+H,Ctrl+Shift+H,Old Master")

        # Separately proven historical default legacy actions safely deleted
        proven_present, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", proven_default_key)
        self.assertFalse(proven_present, f"Proven old default {proven_default_key} must be removed after commit")

        true_master_present, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", true_default_master_key)
        self.assertFalse(true_master_present, f"True old default {true_default_master_key} must be removed after commit")

        # Positive true-default removal regression for Increase Master Ratio
        with self.subTest(case="true_default_master_ratio_removal"):
            self.sb.clear_logs()
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_key, f"Ctrl+Shift+L,Ctrl+Shift+L,{legacy_key}")
            res_td = self.sb.run_installer()
            self.assertEqual(res_td.returncode, 0)
            has_td, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_key)
            self.assertFalse(has_td, f"True historical default for {legacy_key} must be removed")

    def test_moved_deleted_checkout_kwin_script_installation(self):
        """3. Moved/deleted checkout:
        - run install from a disposable source copy
        - rename/delete that source after success
        - prove installed script is self-contained and matches allowlist."""
        disposable = tempfile.mkdtemp(prefix="disposable-tessera-")
        try:
            # Copy source repo to disposable
            shutil.copytree(REPO_ROOT, os.path.join(disposable, "repo"), symlinks=True, ignore=shutil.ignore_patterns(*REPO_IGNORE_PATTERNS))
            disp_repo = os.path.join(disposable, "repo")

            res = self.sb.run_installer(cwd=disp_repo)
            self.assertEqual(res.returncode, 0, res.stderr)

            # Now delete the source checkout completely!
            shutil.rmtree(disp_repo)

            kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
            self.assertEqual(get_relative_files(kwin_script), EXPECTED_KWIN_FILES)
        finally:
            if os.path.exists(disposable):
                shutil.rmtree(disposable)

    @staticmethod
    def _write_raw(path: str, content: str):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    @staticmethod
    def _patch_json(path: str, mutate_fn):
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f)
        mutate_fn(doc)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=4)

    def test_dependency_preflight_diagnostics_and_zero_mutations(self):
        """1. Dependency preflight:
        - physically omits each required executable from PATH
        - tests missing python3, kreadconfig6, and kwriteconfig6
        - asserts exact diagnostic before any mutation and zero mutation events."""
        cases = [
            ("omit_python3", "python3", "Error: required utility 'python3' was not found in PATH."),
            ("omit_kreadconfig6", "kreadconfig6", "Error: required utility 'kreadconfig6' was not found in PATH."),
            ("omit_kwriteconfig6", "kwriteconfig6", "Error: required utility 'kwriteconfig6' was not found in PATH."),
        ]
        for name, omit, expected_diag in cases:
            with self.subTest(dependency_case=name):
                self.sb._init_state()
                self.sb.clear_logs()
                ctrl_path = self.sb.make_controlled_path(omit=omit)
                extra = {"PATH": ctrl_path}

                res = self.sb.run_installer(extra_env=extra)
                self.assertNotEqual(res.returncode, 0)
                self.assertIn(expected_diag, res.stderr)

                # Zero tool/config mutation events
                self.assertEqual(self.sb.get_logs(), [])
                state = self.sb._read_state()
                self.assertEqual(state["store"], {})

                # Zero installed file mutations
                kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
                launcher = os.path.join(self.sb.bin_home, "tessera-settings")
                self.assertFalse(os.path.exists(kwin_script))
                self.assertFalse(os.path.exists(launcher))

                # Zero transaction dirs
                temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
                self.assertEqual(temp_dirs, [])

    def test_staging_copy_failure_preserves_targets_and_config(self):
        """2. Staging copy failure:
        - seed all prior targets and configuration
        - inject copy failure during staging before path replacement
        - assert exact unchanged target bytes, unchanged config, and no temp dirs."""
        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        control_dir = os.path.join(self.sb.data_home, "tessera", "control")
        desktop_file = os.path.join(self.sb.data_home, "applications", "org.kde.tessera.desktop")
        icon_file = os.path.join(self.sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")

        os.makedirs(kwin_script, exist_ok=True)
        os.makedirs(control_dir, exist_ok=True)
        os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
        os.makedirs(os.path.dirname(icon_file), exist_ok=True)
        os.makedirs(os.path.dirname(launcher), exist_ok=True)

        with open(os.path.join(kwin_script, "marker.txt"), "w") as f: f.write("orig script")
        with open(os.path.join(control_dir, "marker.txt"), "w") as f: f.write("orig control")
        with open(desktop_file, "w") as f: f.write("orig desktop")
        with open(icon_file, "w") as f: f.write("orig icon")
        with open(launcher, "w") as f: f.write("orig launcher")

        self.sb.set_kconfig("kwinrc", "Script-tessera", "gapInner", "12")
        self.sb.set_kconfig("kwinrc", "Plugins", "tesseraEnabled", "true")
        self.sb.clear_logs()

        res = self.sb.run_installer(extra_env={"MOCK_FAIL_CP": "1"})
        self.assertNotEqual(res.returncode, 0)
        self.assertIn("Mock cp failure", res.stderr)

        # Prior targets completely untouched
        with open(os.path.join(kwin_script, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig script")
        with open(os.path.join(control_dir, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig control")
        with open(desktop_file, "r") as f: self.assertEqual(f.read(), "orig desktop")
        with open(icon_file, "r") as f: self.assertEqual(f.read(), "orig icon")
        with open(launcher, "r") as f: self.assertEqual(f.read(), "orig launcher")

        # Prior config untouched
        has_gap, gap_val = self.sb.get_kconfig("kwinrc", "Script-tessera", "gapInner")
        self.assertTrue(has_gap)
        self.assertEqual(gap_val, "12")

        # Zero transaction dirs
        temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
        self.assertEqual(temp_dirs, [])

    def test_target_replacement_failure_phases_and_reverse_rollback(self):
        """3. Failure/rollback at target replacements across both backup and stage phases:
        - covers failure backing up existing target to backup dir
        - covers failure moving staged source into target after backup succeeded
        - each subcase uses a fresh sandbox harness
        - asserts intended failure phase was hit via log
        - asserts exact reverse rollback restores all targets and leaves no temp dirs."""
        target_defs = [
            ("target_1_script", lambda sb: os.path.join(sb.data_home, "kwin", "scripts", "tessera")),
        ]

        for label, get_target_path in target_defs:
            for phase in ("backup", "stage"):
                with self.subTest(target=label, phase=phase):
                    with tempfile.TemporaryDirectory(prefix=f"tessera-target-fail-{label}-{phase}-") as sub_tmp:
                        sub_sb = SandboxHarness(sub_tmp)
                        kwin_script = os.path.join(sub_sb.data_home, "kwin", "scripts", "tessera")
                        control_dir = os.path.join(sub_sb.data_home, "tessera", "control")
                        desktop_file = os.path.join(sub_sb.data_home, "applications", "org.kde.tessera.desktop")
                        icon_file = os.path.join(sub_sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
                        launcher = os.path.join(sub_sb.bin_home, "tessera-settings")

                        os.makedirs(kwin_script, exist_ok=True)
                        os.makedirs(control_dir, exist_ok=True)
                        os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
                        os.makedirs(os.path.dirname(icon_file), exist_ok=True)
                        os.makedirs(os.path.dirname(launcher), exist_ok=True)

                        with open(os.path.join(kwin_script, "marker.txt"), "w") as f: f.write("orig script")
                        with open(os.path.join(control_dir, "marker.txt"), "w") as f: f.write("orig control")
                        with open(desktop_file, "w") as f: f.write("orig desktop")
                        with open(icon_file, "w") as f: f.write("orig icon")
                        with open(launcher, "w") as f: f.write("orig launcher")

                        fail_target_path = get_target_path(sub_sb)
                        mv_log = os.path.join(sub_tmp, "mv_hit.log")

                        res = sub_sb.run_installer(extra_env={
                            "MOCK_FAIL_MV_TARGET": fail_target_path,
                            "MOCK_FAIL_MV_PHASE": phase,
                            "MOCK_MV_LOG": mv_log,
                        })
                        self.assertNotEqual(res.returncode, 0)
                        self.assertIn("restoring the previous Tessera installation", res.stderr)

                        # Verify intended phase was hit
                        self.assertTrue(os.path.exists(mv_log), f"Mock mv did not record hit for {phase} on {label}")
                        with open(mv_log, "r") as f:
                            hit_content = f.read()
                        self.assertIn(f"HIT_{phase.upper()} {fail_target_path}", hit_content)

                        # All targets restored with original marker text
                        with open(os.path.join(kwin_script, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig script")
                        with open(os.path.join(control_dir, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig control")
                        with open(desktop_file, "r") as f: self.assertEqual(f.read(), "orig desktop")
                        with open(icon_file, "r") as f: self.assertEqual(f.read(), "orig icon")
                        with open(launcher, "r") as f: self.assertEqual(f.read(), "orig launcher")

                        # No temp dirs remain
                        temp_dirs = [d for d in os.listdir(sub_sb.data_home) if d.startswith(".tessera-install.")]
                        self.assertEqual(temp_dirs, [])

    def test_interrupted_install_signal_rollback_restores_state(self):
        """4. Interrupted install signal handling:
        - injects SIGINT during shortcut configuration
        - proves exit handler catches signal and completes full rollback
        - restores all prior targets and prior config, leaves no temp dirs."""
        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        control_dir = os.path.join(self.sb.data_home, "tessera", "control")
        desktop_file = os.path.join(self.sb.data_home, "applications", "org.kde.tessera.desktop")
        icon_file = os.path.join(self.sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")

        os.makedirs(kwin_script, exist_ok=True)
        os.makedirs(control_dir, exist_ok=True)
        os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
        os.makedirs(os.path.dirname(icon_file), exist_ok=True)
        os.makedirs(os.path.dirname(launcher), exist_ok=True)

        with open(os.path.join(kwin_script, "marker.txt"), "w") as f: f.write("orig script")
        with open(os.path.join(control_dir, "marker.txt"), "w") as f: f.write("orig control")
        with open(desktop_file, "w") as f: f.write("orig desktop")
        with open(icon_file, "w") as f: f.write("orig icon")
        with open(launcher, "w") as f: f.write("orig launcher")

        self.sb.set_kconfig("kwinrc", "Plugins", "tesseraEnabled", "false")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Zone Overlay", "Meta+Z,Meta+Z,Toggle Zone Overlay")

        target_key = "Tessera: Toggle Tiling"
        res = self.sb.run_installer(extra_env={"MOCK_SIGINT_ON_KEY": target_key})
        self.assertIn(res.returncode, (130, -signal.SIGINT))
        self.assertIn("restoring the previous Tessera installation", res.stderr)

        # Replaced targets restored
        with open(os.path.join(kwin_script, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig script")
        with open(os.path.join(control_dir, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig control")
        with open(desktop_file, "r") as f: self.assertEqual(f.read(), "orig desktop")
        with open(icon_file, "r") as f: self.assertEqual(f.read(), "orig icon")
        with open(launcher, "r") as f: self.assertEqual(f.read(), "orig launcher")

        # Prior config restored
        has_plug, plug_val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
        self.assertTrue(has_plug)
        self.assertEqual(plug_val, "false")

        # Interrupted key not left written
        has_key, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", target_key)
        self.assertFalse(has_key)

        # Zero temp dirs
        temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
        self.assertEqual(temp_dirs, [])

    def test_source_inventory_and_metadata_preflight_rejection(self):
        """5. Table-driven source inventory and metadata preflight:
        - tests missing/malformed metadata essentials (Id, main script, package structure)
        - tests missing runtime, control, desktop/icon, shortcut files
        - asserts zero config/file mutations and no temp dirs."""
        inventory_cases = [
            ("missing_metadata", lambda r: os.remove(os.path.join(r, "metadata.json")), "metadata.json"),
            ("malformed_metadata_json", lambda r: self._write_raw(os.path.join(r, "metadata.json"), "{not-json"), "malformed metadata.json"),
            ("metadata_wrong_id", lambda r: self._patch_json(os.path.join(r, "metadata.json"), lambda d: d["KPlugin"].__setitem__("Id", "other")), "KPlugin.Id must be 'tessera'"),
            ("metadata_missing_kplugin", lambda r: self._patch_json(os.path.join(r, "metadata.json"), lambda d: d.pop("KPlugin")), "KPlugin.Id must be 'tessera'"),
            ("metadata_wrong_main_script", lambda r: self._patch_json(os.path.join(r, "metadata.json"), lambda d: d.__setitem__("X-Plasma-MainScript", "other.qml")), "X-Plasma-MainScript must be 'ui/main.qml'"),
            ("metadata_wrong_package_structure", lambda r: self._patch_json(os.path.join(r, "metadata.json"), lambda d: d.__setitem__("KPackageStructure", "other")), "KPackageStructure must be 'KWin/Script'"),
            ("missing_main_qml", lambda r: os.remove(os.path.join(r, "contents", "ui", "main.qml")), "main.qml"),
            ("missing_config_ui", lambda r: os.remove(os.path.join(r, "contents", "ui", "config.ui")), "config.ui"),
            ("missing_reconciler_js", lambda r: os.remove(os.path.join(r, "contents", "code", "reconciler.js")), "reconciler.js"),
            ("missing_layouts_js", lambda r: os.remove(os.path.join(r, "contents", "code", "layouts.js")), "layouts.js"),
            ("missing_rules_js", lambda r: os.remove(os.path.join(r, "contents", "code", "rules.js")), "rules.js"),
            ("missing_main_xml", lambda r: os.remove(os.path.join(r, "contents", "config", "main.xml")), "main.xml"),
            ("missing_shortcuts_json", lambda r: os.remove(os.path.join(r, "config", "shortcuts.json")), "shortcuts.json"),
        ]

        for case_name, mutate_fn, expected_diag in inventory_cases:
            with self.subTest(source_inventory_case=case_name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-src-preflight-{case_name}-") as disp_tmp:
                    disp_repo = os.path.join(disp_tmp, "repo")
                    shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns(*REPO_IGNORE_PATTERNS))
                    mutate_fn(disp_repo)

                    self.sb._init_state()
                    self.sb.clear_logs()

                    res = self.sb.run_installer(cwd=disp_repo)
                    self.assertNotEqual(res.returncode, 0)
                    self.assertIn(expected_diag, res.stderr)

                    # Zero config mutations
                    self.assertEqual(self.sb.get_logs(), [])
                    state = self.sb._read_state()
                    self.assertEqual(state["store"], {})

                    # Zero installed file mutations
                    kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
                    self.assertFalse(os.path.exists(kwin_script))

                    # Zero temp dirs
                    temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
                    self.assertEqual(temp_dirs, [])

    def test_shortcut_catalog_canonical_schema_rejection(self):
        """6. Table-driven installer shortcut catalog canonical schema validation:
        - top-level keys, item keys, unique names/sequences, unique/disjoint legacy names
        - nonempty and control-safe strings, no active Master terminology
        - asserts zero installed or config mutations and no temp dirs."""
        catalog_cases = [
            ("wrong_version", lambda d: d.__setitem__("version", 2)),
            ("missing_version", lambda d: d.pop("version")),
            ("extra_top_level_key", lambda d: d.__setitem__("extraKey", 123)),
            ("missing_shortcuts", lambda d: d.pop("shortcuts")),
            ("missing_legacy_names", lambda d: d.pop("legacyNames")),
            ("entry_missing_label", lambda d: d["shortcuts"][0].pop("label")),
            ("entry_extra_key", lambda d: d["shortcuts"][0].__setitem__("extra", "val")),
            ("duplicate_active_name", lambda d: d["shortcuts"].append(dict(d["shortcuts"][0], sequence="Meta+Ctrl+Alt+1"))),
            ("duplicate_active_sequence", lambda d: d["shortcuts"].append(dict(d["shortcuts"][0], name="Tessera: Another Name"))),
            ("active_name_contains_master", lambda d: d["shortcuts"][0].__setitem__("name", "Tessera: Master HUD")),
            ("active_label_contains_master", lambda d: d["shortcuts"][0].__setitem__("label", "Show Master HUD")),
            ("control_char_in_sequence", lambda d: d["shortcuts"][0].__setitem__("sequence", "Meta+\t+T")),
            ("empty_name", lambda d: d["shortcuts"][0].__setitem__("name", "   ")),
            ("empty_label", lambda d: d["shortcuts"][0].__setitem__("label", "")),
            ("duplicate_legacy_name", lambda d: d["legacyNames"].append(d["legacyNames"][0])),
            ("legacy_overlapping_active", lambda d: d["legacyNames"].append(d["shortcuts"][0]["name"])),
            ("control_char_in_legacy_name", lambda d: d["legacyNames"].append("Tessera: Bad\nLegacy")),
        ]

        for case_name, mutate_fn in catalog_cases:
            with self.subTest(catalog_case=case_name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-catalog-fail-{case_name}-") as disp_tmp:
                    disp_repo = os.path.join(disp_tmp, "repo")
                    shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns(*REPO_IGNORE_PATTERNS))

                    cat_file = os.path.join(disp_repo, "config", "shortcuts.json")
                    with open(cat_file, "r", encoding="utf-8") as f:
                        doc = json.load(f)
                    mutate_fn(doc)
                    with open(cat_file, "w", encoding="utf-8") as f:
                        json.dump(doc, f, indent=4)

                    self.sb._init_state()
                    self.sb.clear_logs()

                    res = self.sb.run_installer(cwd=disp_repo)
                    self.assertNotEqual(res.returncode, 0)
                    self.assertIn("invalid shortcut catalog", res.stderr)

                    # Zero config mutations
                    self.assertEqual(self.sb.get_logs(), [])
                    state = self.sb._read_state()
                    self.assertEqual(state["store"], {})

                    # Zero installed file mutations
                    kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
                    self.assertFalse(os.path.exists(kwin_script))

                    # Zero temp dirs
                    temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
                    self.assertEqual(temp_dirs, [])

    def test_rollback_on_shortcut_write_fail_before_and_fail_after(self):
        """6. Failure/rollback on absent-shortcut default write:
        - test both fail_before and fail_after side effect
        - restore prior target bytes, shortcut presence/values, and plugin presence."""
        for mode in ("fail_before", "fail_after"):
            with self.subTest(shortcut_failure_mode=mode):
                self.sb._init_state()

                # Seed prior target
                kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
                os.makedirs(kwin_script, exist_ok=True)
                with open(os.path.join(kwin_script, "marker.txt"), "w") as f: f.write("orig script")

                # Seed existing custom shortcut
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Tiling", "Meta+T,Meta+T,Custom")

                # Inject failure on 3rd shortcut
                third_shortcut = self.shortcuts_doc["shortcuts"][2]["name"]
                self.sb.add_fail_rule("kwriteconfig6", key=third_shortcut, mode=mode, exit_code=43)

                res = self.sb.run_installer()
                self.assertNotEqual(res.returncode, 0)
                self.assertIn("restoring the previous Tessera installation", res.stderr)

                # Custom shortcut preserved
                has_custom, custom_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Tiling")
                self.assertTrue(has_custom)
                self.assertEqual(custom_val, "Meta+T,Meta+T,Custom")

                # Newly written shortcuts (including the failing key in fail_after) are rolled back / deleted
                first_shortcut = self.shortcuts_doc["shortcuts"][0]["name"]
                has_first, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", first_shortcut)
                self.assertFalse(has_first, f"{first_shortcut} must be deleted on rollback")

                has_third, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", third_shortcut)
                self.assertFalse(has_third, f"{third_shortcut} must be deleted on rollback")

                # Targets restored
                with open(os.path.join(kwin_script, "marker.txt"), "r") as f: self.assertEqual(f.read(), "orig script")

                # No transaction dirs remain
                temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
                self.assertEqual(temp_dirs, [])

    def test_rollback_on_plugin_write_fail_before_and_fail_after(self):
        """6. Failure/rollback on plugin-enable write:
        - test both fail_before and fail_after side effect
        - restore plugin value/presence and all targets/shortcuts."""
        for mode in ("fail_before", "fail_after"):
            with self.subTest(plugin_failure_mode=mode):
                self.sb._init_state()

                # Seed prior plugin state
                self.sb.set_kconfig("kwinrc", "Plugins", "tesseraEnabled", "false")

                # Inject failure on plugin write
                self.sb.add_fail_rule("kwriteconfig6", key="tesseraEnabled", mode=mode, exit_code=44)

                res = self.sb.run_installer()
                self.assertNotEqual(res.returncode, 0)
                self.assertIn("restoring the previous Tessera installation", res.stderr)

                # Plugin restored to false
                has_plugin, plug_val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
                self.assertTrue(has_plugin)
                self.assertEqual(plug_val, "false")

                # Shortcuts deleted
                first_shortcut = self.shortcuts_doc["shortcuts"][0]["name"]
                has_first, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", first_shortcut)
                self.assertFalse(has_first)

    def test_safe_target_handling_symlink_to_external_sentinel(self):
        """7. Safe target handling:
        - prior target is a symlink to an external sentinel
        - successful install replaces symlink without touching sentinel
        - failed install restores symlink without touching sentinel."""
        sentinel_dir = os.path.join(self.tmp.name, "external_sentinel_dir")
        os.makedirs(sentinel_dir, exist_ok=True)
        sentinel_file = os.path.join(sentinel_dir, "sentinel.txt")
        with open(sentinel_file, "w") as f: f.write("precious external data")

        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        os.makedirs(os.path.dirname(kwin_script), exist_ok=True)
        os.symlink(sentinel_dir, kwin_script)

        # 1. Successful install
        res = self.sb.run_installer()
        self.assertEqual(res.returncode, 0, res.stderr)

        # kwin_script is now a real directory
        self.assertFalse(os.path.islink(kwin_script))
        self.assertTrue(os.path.isdir(kwin_script))

        # External sentinel untouched
        with open(sentinel_file, "r") as f: self.assertEqual(f.read(), "precious external data")

        # 2. Failed install with symlink prior target
        os.remove(kwin_script) if os.path.islink(kwin_script) else shutil.rmtree(kwin_script)
        os.symlink(sentinel_dir, kwin_script)

        # Fail during plugin write after script replacement
        self.sb.add_fail_rule("kwriteconfig6", key="tesseraEnabled", mode="fail_before", exit_code=44)
        res_fail = self.sb.run_installer()
        self.assertNotEqual(res_fail.returncode, 0)

        # Symlink restored
        self.assertTrue(os.path.islink(kwin_script))
        self.assertEqual(os.path.realpath(kwin_script), os.path.realpath(sentinel_dir))
        with open(sentinel_file, "r") as f: self.assertEqual(f.read(), "precious external data")

    def test_uninstaller_no_purge_mode(self):
        """8. Uninstaller (No purge):
        - removes only installed artifacts and shortcuts
        - disables plugin
        - preserves Script-tessera config and legacy tesserarc/migration backup
        - idempotent second run
        - unknown argument rejected before mutation."""
        # 1. Run install
        res_inst = self.sb.run_installer()
        self.assertEqual(res_inst.returncode, 0)

        # Seed Script-tessera config and legacy config files
        self.sb.set_kconfig("kwinrc", "Script-tessera", "gapInner", "12")
        self.sb.set_kconfig("kwinrc", "Script-tessera", "customRulesJson", '{"test": 1}')
        self.sb.set_kconfig("kwinrc", "General", "focusPolicy", "ClickToFocus")

        # Seed shortcuts for selective uninstall assertions:
        # - custom active binding (must be preserved byte-for-byte)
        # - intentional unbound binding (must be preserved byte-for-byte)
        # - custom dormant-legacy binding (must be preserved byte-for-byte)
        # - recognized old default legacy binding (must be removed)
        # - unrelated KRunner, Plasma, and KWin shortcuts (must be preserved untouched)
        custom_active_name = "Tessera: Focus Left Window"
        custom_active_val = "Meta+Alt+Z,Meta+Alt+A,Focus Window to the Left"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_active_name, custom_active_val)

        unbound_active_name = "Tessera: Focus Down Window"
        unbound_active_val = "none,Meta+Alt+S,Focus Window Downwards"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name, unbound_active_val)

        empty_active_name = "Tessera: Focus Right Window"
        empty_active_val = ""
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_active_name, empty_active_val)

        custom_legacy_name = "Tessera: Focus Next Window"
        custom_legacy_val = "Meta+Ctrl+9,Meta+J,Focus Next Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name, custom_legacy_val)

        custom_retired_name = "Tessera: Swap Window Forward"
        custom_retired_val = "Meta+Ctrl+F,none,Custom Swap Forward"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_retired_name, custom_retired_val)

        unbound_legacy_name = "Tessera: Swap Screen Layouts"
        unbound_legacy_val = "none,none,Swap Screen Layouts"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_legacy_name, unbound_legacy_val)

        empty_legacy_name = "Tessera: Cycle Layout on Other Screen"
        empty_legacy_val = ""
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_legacy_name, empty_legacy_val)

        old_default_legacy_name = "Tessera: Next Layout"
        old_default_legacy_val = "Ctrl+Space,Ctrl+Space,Cycle to Next Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name, old_default_legacy_val)

        meta_default_legacy_name = "Tessera: Previous Layout"
        meta_default_legacy_val = "Meta+Shift+Space,Meta+Shift+Space,Cycle to Previous Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", meta_default_legacy_name, meta_default_legacy_val)

        shortened_legacy_name = "Tessera: Swap Window Reverse"
        shortened_legacy_val = "Ctrl+Space,Ctrl+Space,Next Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name, shortened_legacy_val)

        krunner_name = "_launch"
        krunner_val = "Meta+Space,none,KRunner"
        self.sb.set_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name, krunner_val)

        plasma_name = "activate task manager entry 1"
        plasma_val = "Meta+1,none,Activate Task Manager Entry 1"
        self.sb.set_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name, plasma_val)

        kwin_other_name = "Window Close"
        kwin_other_val = "Alt+F4,Alt+F4,Close Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name, kwin_other_val)

        legacy_tesserarc = os.path.join(self.sb.config_home, "tesserarc")
        legacy_backup = os.path.join(self.sb.config_home, "tessera_migration_backup.json")
        with open(legacy_tesserarc, "w") as f: f.write("saved tesserarc")
        with open(legacy_backup, "w") as f: f.write("saved backup")

        legacy_launcher = os.path.join(self.sb.bin_home, "tessera-settings")
        with open(legacy_launcher, "w") as f: f.write("#!/bin/sh\n")

        # Test unknown argument rejection
        res_unk = self.sb.run_uninstaller(args=["--unknown-flag"])
        self.assertEqual(res_unk.returncode, 2)
        self.assertTrue(os.path.exists(os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")))
        self.assertTrue(os.path.exists(legacy_launcher))

        # Run uninstall (no purge)
        res_un = self.sb.run_uninstaller()
        self.assertEqual(res_un.returncode, 0, res_un.stderr)
        self.assertIn("saved layout settings were preserved", res_un.stdout)

        # Targets removed
        self.assertFalse(os.path.exists(os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")))
        self.assertFalse(os.path.exists(os.path.join(self.sb.data_home, "tessera")))
        self.assertFalse(os.path.exists(legacy_launcher))

        # Plugin disabled
        has_plug, plug_val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
        self.assertTrue(has_plug)
        self.assertEqual(plug_val, "false")

        # Recognized default shortcuts removed
        first_shortcut = self.shortcuts_doc["shortcuts"][0]["name"]
        has_sc, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", first_shortcut)
        self.assertFalse(has_sc)

        has_old_sc, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name)
        self.assertFalse(has_old_sc)

        has_meta_sc, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", meta_default_legacy_name)
        self.assertFalse(has_meta_sc)

        # Custom active, intentional unbound, empty, and custom/unbound legacy shortcuts preserved byte-for-byte
        has_cust, cust_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)
        self.assertTrue(has_cust)
        self.assertEqual(cust_val, custom_active_val)

        has_unbound, unb_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name)
        self.assertTrue(has_unbound)
        self.assertEqual(unb_val, unbound_active_val)

        has_empty_act, emp_act_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_active_name)
        self.assertTrue(has_empty_act)
        self.assertEqual(emp_act_val, empty_active_val)

        has_cust_leg, cust_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)
        self.assertTrue(has_cust_leg)
        self.assertEqual(cust_leg_val, custom_legacy_val)

        has_cust_ret, cust_ret_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_retired_name)
        self.assertTrue(has_cust_ret)
        self.assertEqual(cust_ret_val, custom_retired_val)

        has_short_leg, short_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
        self.assertTrue(has_short_leg, f"Shortened custom label {shortened_legacy_name} must be preserved")
        self.assertEqual(short_leg_val, shortened_legacy_val)

        has_unb_leg, unb_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_legacy_name)
        self.assertTrue(has_unb_leg)
        self.assertEqual(unb_leg_val, unbound_legacy_val)

        has_emp_leg, emp_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_legacy_name)
        self.assertTrue(has_emp_leg)
        self.assertEqual(emp_leg_val, empty_legacy_val)

        # Unrelated KRunner, Plasma, and KWin shortcuts untouched byte-for-byte
        has_kr, kr_val = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr)
        self.assertEqual(kr_val, krunner_val)

        has_pl, pl_val = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl)
        self.assertEqual(pl_val, plasma_val)

        has_kc, kc_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc)
        self.assertEqual(kc_val, kwin_other_val)

        # Script-tessera and legacy configs PRESERVED
        has_gap, gap_val = self.sb.get_kconfig("kwinrc", "Script-tessera", "gapInner")
        self.assertTrue(has_gap)
        self.assertEqual(gap_val, "12")

        has_rules, _ = self.sb.get_kconfig("kwinrc", "Script-tessera", "customRulesJson")
        self.assertTrue(has_rules)

        has_focus, focus_val = self.sb.get_kconfig("kwinrc", "General", "focusPolicy")
        self.assertTrue(has_focus)
        self.assertEqual(focus_val, "ClickToFocus")

        self.assertTrue(os.path.exists(legacy_tesserarc))
        self.assertTrue(os.path.exists(legacy_backup))

        # Idempotent second run
        res_un2 = self.sb.run_uninstaller()
        self.assertEqual(res_un2.returncode, 0)

        # Custom and unrelated shortcuts remain preserved byte-for-byte on idempotent second run
        has_cust2, cust_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)
        self.assertTrue(has_cust2)
        self.assertEqual(cust_val2, custom_active_val)

        has_unbound2, unb_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name)
        self.assertTrue(has_unbound2)
        self.assertEqual(unb_val2, unbound_active_val)

        has_empty_act2, emp_act_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_active_name)
        self.assertTrue(has_empty_act2)
        self.assertEqual(emp_act_val2, empty_active_val)

        has_cust_leg2, cust_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)
        self.assertTrue(has_cust_leg2)
        self.assertEqual(cust_leg_val2, custom_legacy_val)

        has_cust_ret2, cust_ret_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_retired_name)
        self.assertTrue(has_cust_ret2)
        self.assertEqual(cust_ret_val2, custom_retired_val)

        has_short_leg2, short_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
        self.assertTrue(has_short_leg2)
        self.assertEqual(short_leg_val2, shortened_legacy_val)

        has_unb_leg2, unb_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_legacy_name)
        self.assertTrue(has_unb_leg2)
        self.assertEqual(unb_leg_val2, unbound_legacy_val)

        has_emp_leg2, emp_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_legacy_name)
        self.assertTrue(has_emp_leg2)
        self.assertEqual(emp_leg_val2, empty_legacy_val)

        has_kr2, kr_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr2)
        self.assertEqual(kr_val2, krunner_val)

        has_pl2, pl_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl2)
        self.assertEqual(pl_val2, plasma_val)

        has_kc2, kc_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc2)
        self.assertEqual(kc_val2, kwin_other_val)

    def test_uninstaller_no_purge_fallback_shortcut_names_mode(self):
        """8b. Uninstaller fallback SHORTCUT_NAMES path (No purge):
        Verifies behavior when config/shortcuts.json is unavailable, unreadable, partially malformed,
        or same-length corrupted (replaced with non-Tessera key or duplicate entries):
        - removes recognized active and legacy default shortcuts
        - preserves custom active bindings byte-for-byte
        - preserves custom dormant-legacy bindings byte-for-byte
        - preserves intentional unbound ('none') bindings byte-for-byte
        - leaves unrelated KRunner, Plasma, and KWin shortcuts untouched byte-for-byte in both normal and purge modes
        - preserves Script-tessera config and legacy files
        - disables plugin
        - second-run idempotence preserves all custom and unrelated bindings
        - maintains explicit --purge distinction (purges custom Tessera bindings, strictly keeps unrelated)."""
        with open(os.path.join(REPO_ROOT, "config", "shortcuts.json"), "r", encoding="utf-8") as f:
            base_catalog = json.load(f)

        cat_non_tessera = copy.deepcopy(base_catalog)
        cat_non_tessera["shortcuts"][0]["name"] = "Window Close"

        cat_duplicate = copy.deepcopy(base_catalog)
        cat_duplicate["shortcuts"][0]["name"] = cat_duplicate["shortcuts"][1]["name"]

        for mode, corrupt_content in [
            ("missing", None),
            ("unreadable", "{\"shortcuts\": INVALID_JSON"),
            ("partial_malformed", '{"shortcuts":[{"name":"Tessera: Toggle Tiling"}],"legacyNames":null}'),
            ("same_length_non_tessera_key", json.dumps(cat_non_tessera)),
            ("same_length_duplicate_entry", json.dumps(cat_duplicate)),
        ]:
            with self.subTest(mode=mode):
                self.sb.clear_logs()
                res_inst = self.sb.run_installer()
                self.assertEqual(res_inst.returncode, 0)

                iso_dir = os.path.join(self.sb.root, f"fallback_{mode}")
                os.makedirs(iso_dir, exist_ok=True)
                iso_uninstaller = os.path.join(iso_dir, "uninstall.sh")
                shutil.copy2(os.path.join(REPO_ROOT, "uninstall.sh"), iso_uninstaller)
                os.chmod(iso_uninstaller, 0o755)

                if corrupt_content is not None:
                    iso_config_dir = os.path.join(iso_dir, "config")
                    os.makedirs(iso_config_dir, exist_ok=True)
                    with open(os.path.join(iso_config_dir, "shortcuts.json"), "w", encoding="utf-8") as f:
                        f.write(corrupt_content)

                # Seed Script-tessera config and general settings
                self.sb.set_kconfig("kwinrc", "Script-tessera", "gapInner", "16")
                self.sb.set_kconfig("kwinrc", "General", "focusPolicy", "ClickToFocus")

                # Seed shortcut matrix:
                # 1. Recognized default active shortcut (must be removed)
                default_active_name = "Tessera: Toggle Zone Overlay"
                default_active_val = "Meta+Shift+C,Meta+Shift+C,Toggle Zone Overlay"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", default_active_name, default_active_val)

                # 2. Recognized old default legacy shortcut (must be removed)
                old_default_legacy_name = "Tessera: Next Layout"
                old_default_legacy_val = "Ctrl+Space,Ctrl+Space,Cycle to Next Layout"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name, old_default_legacy_val)

                # 2b. Shortened custom label on legacy action (must be preserved byte-for-byte in no-purge mode)
                shortened_legacy_name = "Tessera: Previous Layout"
                shortened_legacy_val = "Meta+Shift+Space,Meta+Shift+Space,Previous Layout"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name, shortened_legacy_val)

                # 3. Custom active binding (must be preserved byte-for-byte)
                custom_active_name = "Tessera: Focus Left Window"
                custom_active_val = "Meta+Alt+Z,Meta+Alt+A,Focus Window to the Left"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_active_name, custom_active_val)

                # 4. Intentional unbound binding (must be preserved byte-for-byte)
                unbound_active_name = "Tessera: Focus Down Window"
                unbound_active_val = "none,Meta+Alt+S,Focus Window Downwards"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name, unbound_active_val)

                # 5. Custom dormant-legacy binding (must be preserved byte-for-byte)
                custom_legacy_name = "Tessera: Focus Next Window"
                custom_legacy_val = "Meta+Ctrl+9,Meta+J,Focus Next Window"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name, custom_legacy_val)

                # 6. Unrelated application entries (must be preserved untouched)
                krunner_name = "_launch"
                krunner_val = "Meta+Space,none,KRunner"
                self.sb.set_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name, krunner_val)

                plasma_name = "activate task manager entry 1"
                plasma_val = "Meta+1,none,Activate Task Manager Entry 1"
                self.sb.set_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name, plasma_val)

                kwin_other_name = "Window Close"
                kwin_other_val = "Alt+F4,Alt+F4,Close Window"
                self.sb.set_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name, kwin_other_val)

                # Run uninstaller in isolated directory (no purge)
                res_un = self.sb.run_uninstaller(cwd=iso_dir)
                self.assertEqual(res_un.returncode, 0, f"STDOUT:\n{res_un.stdout}\nSTDERR:\n{res_un.stderr}")
                self.assertIn("saved layout settings were preserved", res_un.stdout)

                # Targets removed
                self.assertFalse(os.path.exists(os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")))

                # Plugin disabled
                has_plug, plug_val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
                self.assertTrue(has_plug)
                self.assertEqual(plug_val, "false")

                # Recognized defaults removed
                has_def, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", default_active_name)
                self.assertFalse(has_def, f"Expected default active shortcut '{default_active_name}' to be removed")

                has_old_def, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name)
                self.assertFalse(has_old_def, f"Expected old default shortcut '{old_default_legacy_name}' to be removed")

                # Custom active, intentional unbound, and custom dormant-legacy preserved byte-for-byte
                has_cust, cust_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)
                self.assertTrue(has_cust)
                self.assertEqual(cust_val, custom_active_val)

                has_unbound, unb_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name)
                self.assertTrue(has_unbound)
                self.assertEqual(unb_val, unbound_active_val)

                has_cust_leg, cust_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)
                self.assertTrue(has_cust_leg)
                self.assertEqual(cust_leg_val, custom_legacy_val)

                has_short_leg, short_leg_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
                self.assertTrue(has_short_leg, f"Shortened custom label {shortened_legacy_name} must be preserved")
                self.assertEqual(short_leg_val, shortened_legacy_val)

                # Unrelated shortcuts untouched byte-for-byte
                has_kr, kr_val = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
                self.assertTrue(has_kr)
                self.assertEqual(kr_val, krunner_val)

                has_pl, pl_val = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
                self.assertTrue(has_pl)
                self.assertEqual(pl_val, plasma_val)

                has_kc, kc_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
                self.assertTrue(has_kc)
                self.assertEqual(kc_val, kwin_other_val)

                # Script-tessera and general configs preserved
                has_gap, gap_val = self.sb.get_kconfig("kwinrc", "Script-tessera", "gapInner")
                self.assertTrue(has_gap)
                self.assertEqual(gap_val, "16")

                has_focus, focus_val = self.sb.get_kconfig("kwinrc", "General", "focusPolicy")
                self.assertTrue(has_focus)
                self.assertEqual(focus_val, "ClickToFocus")

                # Idempotent second run
                res_un2 = self.sb.run_uninstaller(cwd=iso_dir)
                self.assertEqual(res_un2.returncode, 0)

                # Custom and unrelated shortcuts remain preserved byte-for-byte on idempotent second run
                has_cust2, cust_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)
                self.assertTrue(has_cust2)
                self.assertEqual(cust_val2, custom_active_val)

                has_unbound2, unb_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name)
                self.assertTrue(has_unbound2)
                self.assertEqual(unb_val2, unbound_active_val)

                has_cust_leg2, cust_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)
                self.assertTrue(has_cust_leg2)
                self.assertEqual(cust_leg_val2, custom_legacy_val)

                has_short_leg2, short_leg_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
                self.assertTrue(has_short_leg2)
                self.assertEqual(short_leg_val2, shortened_legacy_val)

                has_kr2, kr_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
                self.assertTrue(has_kr2)
                self.assertEqual(kr_val2, krunner_val)

                has_pl2, pl_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
                self.assertTrue(has_pl2)
                self.assertEqual(pl_val2, plasma_val)

                has_kc2, kc_val2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
                self.assertTrue(has_kc2)
                self.assertEqual(kc_val2, kwin_other_val)

                # Verify explicit --purge distinction in fallback mode:
                # --purge deletes all Tessera shortcuts (including custom), but still preserves unrelated keys
                res_purge = self.sb.run_uninstaller(cwd=iso_dir, args=["--purge"])
                self.assertEqual(res_purge.returncode, 0)

                has_cust_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)
                self.assertFalse(has_cust_purged, "Custom active shortcut must be removed by --purge")

                has_cust_leg_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)
                self.assertFalse(has_cust_leg_purged, "Custom legacy shortcut must be removed by --purge")

                has_short_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
                self.assertFalse(has_short_purged, "Shortened legacy shortcut must be removed by --purge")

                has_kr_after_purge, kr_val_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
                self.assertTrue(has_kr_after_purge)
                self.assertEqual(kr_val_after_purge, krunner_val)

                has_pl_after_purge, pl_val_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
                self.assertTrue(has_pl_after_purge)
                self.assertEqual(pl_val_after_purge, plasma_val)

                has_kc_after_purge, kc_val_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
                self.assertTrue(has_kc_after_purge)
                self.assertEqual(kc_val_after_purge, kwin_other_val)

    def test_uninstaller_preserves_custom_reused_old_default(self):
        """8c. Uninstaller preserves custom bindings reusing old defaults (No purge):
        - preserves custom user binding reusing a historical default byte-for-byte
        - cleanly removes uncustomized old defaults where current == default
        - conservatively preserves indistinguishable entries lacking a default field
        - preserves intentional unbound ('none' or empty) bindings byte-for-byte
        - preserves unrelated KRunner, Plasma, and KWin shortcuts byte-for-byte
        - proves second normal uninstallation idempotence
        - verifies --purge distinction removes custom Tessera shortcuts while preserving unrelated shortcuts."""
        res_inst = self.sb.run_installer()
        self.assertEqual(res_inst.returncode, 0)

        # 1. Custom user binding deliberately reusing historical default:
        # Current binding is old recognized default (Ctrl+Shift+A), but default field is current default (Meta+Alt+A).
        # Normal uninstall must preserve this byte-for-byte.
        custom_reused_name = "Tessera: Focus Left Window"
        custom_reused_val = "Ctrl+Shift+A,Meta+Alt+A,My custom focus"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name, custom_reused_val)

        # 2. Negative regression: unproven stripped label (Focus Right Window) preserved as custom:
        # Since stripped label was never shipped (6a6eb57 stored full action name, main.qml stored WASD),
        # an uncustomized-sequence entry with a stripped label must be preserved byte-for-byte as custom metadata.
        stripped_label_name = "Tessera: Focus Right Window"
        stripped_label_val = "Ctrl+Shift+D,Ctrl+Shift+D,Focus Right Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", stripped_label_name, stripped_label_val)

        # 2b. Custom note on old recognized default sequence preserved byte-for-byte:
        custom_note_active_name = "Tessera: Focus Up Window"
        custom_note_active_val = "Ctrl+Shift+W,Ctrl+Shift+W,My personal focus note"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_note_active_name, custom_note_active_val)

        # 2c. True uncustomized old defaults on active actions (proven WASD and full-name labels):
        # Normal uninstall must remove these.
        old_default_wasd_name = "Tessera: Focus Down Window"
        old_default_wasd_val = "Ctrl+Shift+S,Ctrl+Shift+S,Focus Down Window (WASD)"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_wasd_name, old_default_wasd_val)

        old_default_full_name = "Tessera: Swap Right Window"
        old_default_full_name_val = "Ctrl+Shift+E,Ctrl+Shift+E,Tessera: Swap Right Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_full_name, old_default_full_name_val)

        # 3. True uncustomized old default on retired legacy action (proven historical main.qml and 6a6eb57 labels):
        # Normal uninstall must remove these.
        old_default_legacy_name = "Tessera: Next Layout"
        old_default_legacy_val = "Ctrl+Space,Ctrl+Space,Cycle to Next Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name, old_default_legacy_val)

        meta_default_legacy_name = "Tessera: Previous Layout"
        meta_default_legacy_val = "Meta+Shift+Space,Meta+Shift+Space,Tessera: Previous Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", meta_default_legacy_name, meta_default_legacy_val)

        # 4. Intentional unbound bindings ('none' and empty):
        # Normal uninstall must preserve these byte-for-byte.
        unbound_name = "Tessera: Move Window to Left Region"
        unbound_val = "none,Meta+Left,Move Window to Left Snap Region"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_name, unbound_val)

        empty_name = "Tessera: Retile Current Workspace"
        empty_val = ""
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_name, empty_val)

        # 5. Indistinguishable old default missing default field:
        # Conservative preservation required.
        indistinguishable_name = "Tessera: Swap Left Window"
        indistinguishable_val = "Ctrl+Shift+Q"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", indistinguishable_name, indistinguishable_val)

        # 5b. Active current default with stored default 'none' or missing stored default:
        # User may have chosen the active sequence while registered default was none/unknown.
        # Conservative preservation required in normal mode.
        active_none_name = "Tessera: Expand Window Width"
        active_none_val = "Meta+Shift+Right,none,Expand Window Width"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", active_none_name, active_none_val)

        active_missing_name = "Tessera: Shrink Window Width"
        active_missing_val = "Meta+Shift+Left"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", active_missing_name, active_missing_val)

        # 6. Unrelated shortcuts (KRunner, Plasma, and KWin):
        # Must be preserved untouched byte-for-byte across normal and purge uninstall.
        krunner_name = "_launch"
        krunner_val = "Meta+Space,none,KRunner"
        self.sb.set_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name, krunner_val)

        plasma_name = "activate task manager entry 1"
        plasma_val = "Meta+1,none,Activate Task Manager Entry 1"
        self.sb.set_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name, plasma_val)

        kwin_other_name = "Window Close"
        kwin_other_val = "Alt+F4,Alt+F4,Close Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name, kwin_other_val)

        # Run normal uninstall (no --purge)
        res_un = self.sb.run_uninstaller()
        self.assertEqual(res_un.returncode, 0, f"STDOUT:\n{res_un.stdout}\nSTDERR:\n{res_un.stderr}")

        # Assert custom reused old default is preserved byte-for-byte
        has_reused, actual_reused = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name)
        self.assertTrue(has_reused, f"Custom shortcut {custom_reused_name} must be preserved")
        self.assertEqual(actual_reused, custom_reused_val)

        # Assert custom note on old default is preserved byte-for-byte
        has_custom_note, actual_custom_note = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_note_active_name)
        self.assertTrue(has_custom_note, f"Custom shortcut {custom_note_active_name} with custom note must be preserved")
        self.assertEqual(actual_custom_note, custom_note_active_val)

        # Assert negative stripped-label regression is preserved byte-for-byte as custom
        has_stripped, actual_stripped = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", stripped_label_name)
        self.assertTrue(has_stripped, f"Stripped label shortcut {stripped_label_name} must be preserved")
        self.assertEqual(actual_stripped, stripped_label_val)

        # Assert true old defaults with proven labels are removed
        has_old_wasd, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_wasd_name)
        self.assertFalse(has_old_wasd, f"Proven WASD default {old_default_wasd_name} must be removed")

        has_old_full, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_full_name)
        self.assertFalse(has_old_full, f"Proven full-name default {old_default_full_name} must be removed")

        has_old_leg, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name)
        self.assertFalse(has_old_leg, f"True old default {old_default_legacy_name} must be removed")

        has_meta_leg, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", meta_default_legacy_name)
        self.assertFalse(has_meta_leg, f"True retired default {meta_default_legacy_name} must be removed")

        # Assert intentional unbound and empty bindings are preserved byte-for-byte
        has_unbound, actual_unbound = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_name)
        self.assertTrue(has_unbound, f"Unbound shortcut {unbound_name} must be preserved")
        self.assertEqual(actual_unbound, unbound_val)

        has_empty, actual_empty = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_name)
        self.assertTrue(has_empty, f"Empty shortcut {empty_name} must be preserved")
        self.assertEqual(actual_empty, empty_val)

        # Assert indistinguishable entry missing default field is conservatively preserved
        has_indist, actual_indist = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", indistinguishable_name)
        self.assertTrue(has_indist, f"Indistinguishable shortcut {indistinguishable_name} must be preserved conservatively")
        self.assertEqual(actual_indist, indistinguishable_val)

        # Assert active current default with stored default 'none' or missing stored default is conservatively preserved
        has_act_none, actual_act_none = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_none_name)
        self.assertTrue(has_act_none, f"Active shortcut with default none {active_none_name} must be preserved")
        self.assertEqual(actual_act_none, active_none_val)

        has_act_missing, actual_act_missing = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_missing_name)
        self.assertTrue(has_act_missing, f"Active shortcut with missing default {active_missing_name} must be preserved")
        self.assertEqual(actual_act_missing, active_missing_val)

        # Assert unrelated shortcuts remain untouched byte-for-byte
        has_kr, actual_kr = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr)
        self.assertEqual(actual_kr, krunner_val)

        has_pl, actual_pl = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl)
        self.assertEqual(actual_pl, plasma_val)

        has_kc, actual_kc = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc)
        self.assertEqual(actual_kc, kwin_other_val)

        # Run second normal uninstallation to verify idempotence
        res_un2 = self.sb.run_uninstaller()
        self.assertEqual(res_un2.returncode, 0)

        has_reused2, actual_reused2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name)
        self.assertTrue(has_reused2)
        self.assertEqual(actual_reused2, custom_reused_val)

        has_custom_note2, actual_custom_note2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_note_active_name)
        self.assertTrue(has_custom_note2)
        self.assertEqual(actual_custom_note2, custom_note_active_val)

        has_stripped2, actual_stripped2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", stripped_label_name)
        self.assertTrue(has_stripped2)
        self.assertEqual(actual_stripped2, stripped_label_val)

        has_old_wasd2, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_wasd_name)
        self.assertFalse(has_old_wasd2)

        has_old_full2, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_full_name)
        self.assertFalse(has_old_full2)

        has_unbound2, actual_unbound2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_name)
        self.assertTrue(has_unbound2)
        self.assertEqual(actual_unbound2, unbound_val)

        has_empty2, actual_empty2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_name)
        self.assertTrue(has_empty2)
        self.assertEqual(actual_empty2, empty_val)

        has_indist2, actual_indist2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", indistinguishable_name)
        self.assertTrue(has_indist2)
        self.assertEqual(actual_indist2, indistinguishable_val)

        has_act_none2, actual_act_none2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_none_name)
        self.assertTrue(has_act_none2)
        self.assertEqual(actual_act_none2, active_none_val)

        has_act_missing2, actual_act_missing2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_missing_name)
        self.assertTrue(has_act_missing2)
        self.assertEqual(actual_act_missing2, active_missing_val)

        has_kr2, actual_kr2 = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr2)
        self.assertEqual(actual_kr2, krunner_val)

        has_pl2, actual_pl2 = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl2)
        self.assertEqual(actual_pl2, plasma_val)

        has_kc2, actual_kc2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc2)
        self.assertEqual(actual_kc2, kwin_other_val)

        # Subtest for prompt contrast fixture: Focus Left Window having true old default (Ctrl+Shift+A,Ctrl+Shift+A,Focus Left Window (WASD))
        with self.subTest(case="contrast_focus_left_true_old_default"):
            self.sb.clear_logs()
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name, "Ctrl+Shift+A,Ctrl+Shift+A,Focus Left Window (WASD)")
            res_contrast = self.sb.run_uninstaller()
            self.assertEqual(res_contrast.returncode, 0)
            has_contrast, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name)
            self.assertFalse(has_contrast, "True old default on Focus Left Window must be cleanly removed")

        # Verify --purge distinction:
        # Re-seed custom, stripped, unbound, indistinguishable, and active none/missing entries before purge
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name, custom_reused_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_note_active_name, custom_note_active_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", stripped_label_name, stripped_label_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_name, unbound_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_name, empty_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", indistinguishable_name, indistinguishable_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", active_none_name, active_none_val)
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", active_missing_name, active_missing_val)

        res_purge = self.sb.run_uninstaller(args=["--purge"])
        self.assertEqual(res_purge.returncode, 0)

        has_reused_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_reused_name)
        self.assertFalse(has_reused_purged, "Custom shortcut must be purged by --purge")

        has_custom_note_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_note_active_name)
        self.assertFalse(has_custom_note_purged, "Custom shortcut with custom note must be purged by --purge")

        has_stripped_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", stripped_label_name)
        self.assertFalse(has_stripped_purged, "Stripped label shortcut must be purged by --purge")

        has_unbound_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_name)
        self.assertFalse(has_unbound_purged, "Unbound shortcut must be purged by --purge")

        has_empty_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_name)
        self.assertFalse(has_empty_purged, "Empty shortcut must be purged by --purge")

        has_indist_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", indistinguishable_name)
        self.assertFalse(has_indist_purged, "Indistinguishable shortcut must be purged by --purge")

        has_act_none_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_none_name)
        self.assertFalse(has_act_none_purged, "Active shortcut with default none must be purged by --purge")

        has_act_missing_purged, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_missing_name)
        self.assertFalse(has_act_missing_purged, "Active shortcut with missing default must be purged by --purge")

        # Unrelated shortcuts must STILL be preserved untouched byte-for-byte after --purge
        has_kr_after_purge, actual_kr_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr_after_purge)
        self.assertEqual(actual_kr_after_purge, krunner_val)

        has_pl_after_purge, actual_pl_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl_after_purge)
        self.assertEqual(actual_pl_after_purge, plasma_val)

        has_kc_after_purge, actual_kc_after_purge = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc_after_purge)
        self.assertEqual(actual_kc_after_purge, kwin_other_val)

    def test_uninstaller_purge_mode(self):
        """9. Uninstaller (--purge):
        - removes complete canonical+legacy Script-tessera key set and legacy files
        - asserts derived expected purge set matches behaviorally deleted keys
        - preserves unrelated keys
        - honest output on failure."""
        res_inst = self.sb.run_installer()
        self.assertEqual(res_inst.returncode, 0)

        # Load canonical-config.json and derive expected purge set
        with open(os.path.join(REPO_ROOT, "config", "canonical-config.json"), "r", encoding="utf-8") as f:
            canon_doc = json.load(f)

        expected_purge_keys = set(canon_doc["properties"].keys())
        for prop in canon_doc["properties"].values():
            for alias in prop.get("legacyAliases", []):
                expected_purge_keys.add(alias)
        expected_purge_keys.update({"desktopLayouts", "customRules"})

        # Seed every expected key with a distinct raw value
        for idx, key in enumerate(sorted(expected_purge_keys)):
            self.sb.set_kconfig("kwinrc", "Script-tessera", key, f"raw_val_{idx}_{key}")

        # Seed unrelated config keys
        self.sb.set_kconfig("kwinrc", "General", "focusPolicy", "ClickToFocus")
        self.sb.set_kconfig("kwinrc", "UnrelatedGroup", "otherKey", "preserveMe")

        # Seed custom active, unbound, custom legacy, recognized old default, and unrelated shortcuts
        custom_active_name = "Tessera: Focus Left Window"
        custom_active_val = "Meta+Alt+Z,Meta+Alt+A,Focus Window to the Left"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_active_name, custom_active_val)

        unbound_active_name = "Tessera: Focus Down Window"
        unbound_active_val = "none,Meta+Alt+S,Focus Window Downwards"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name, unbound_active_val)

        custom_legacy_name = "Tessera: Focus Next Window"
        custom_legacy_val = "Meta+Ctrl+9,Meta+J,Focus Next Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name, custom_legacy_val)

        old_default_legacy_name = "Tessera: Next Layout"
        old_default_legacy_val = "Ctrl+Space,Ctrl+Space,Cycle to Next Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name, old_default_legacy_val)

        krunner_name = "_launch"
        krunner_val = "Meta+Space,none,KRunner"
        self.sb.set_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name, krunner_val)

        plasma_name = "activate task manager entry 1"
        plasma_val = "Meta+1,none,Activate Task Manager Entry 1"
        self.sb.set_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name, plasma_val)

        kwin_other_name = "Window Close"
        kwin_other_val = "Alt+F4,Alt+F4,Close Window"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name, kwin_other_val)

        legacy_tesserarc = os.path.join(self.sb.config_home, "tesserarc")
        legacy_backup = os.path.join(self.sb.config_home, "tessera_migration_backup.json")
        with open(legacy_tesserarc, "w") as f: f.write("saved tesserarc")
        with open(legacy_backup, "w") as f: f.write("saved backup")

        self.sb.clear_logs()

        # 1. Normal purge
        res_purge = self.sb.run_uninstaller(args=["--purge"])
        self.assertEqual(res_purge.returncode, 0, res_purge.stderr)
        self.assertIn("Tessera and its saved configuration have been removed", res_purge.stdout)

        # Assert derived expected set equals the exact set of Script-tessera keys deleted behaviorally
        deleted_script_keys = {
            entry["key"] for entry in self.sb.get_logs()
            if entry.get("action") == "delete" and entry.get("file") == "kwinrc" and entry.get("group") == "Script-tessera"
        }
        self.assertEqual(deleted_script_keys, expected_purge_keys)

        # Assert every expected key is absent from kwinrc store
        for key in expected_purge_keys:
            has_key, _ = self.sb.get_kconfig("kwinrc", "Script-tessera", key)
            self.assertFalse(has_key, f"Purged key {key} must not remain in kwinrc")

        # Assert all Tessera shortcuts are completely deleted in purge mode (default, custom, unbound, legacy)
        first_shortcut = self.shortcuts_doc["shortcuts"][0]["name"]
        self.assertFalse(self.sb.get_kconfig("kglobalshortcutsrc", "kwin", first_shortcut)[0])
        self.assertFalse(self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_active_name)[0])
        self.assertFalse(self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_active_name)[0])
        self.assertFalse(self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_legacy_name)[0])
        self.assertFalse(self.sb.get_kconfig("kglobalshortcutsrc", "kwin", old_default_legacy_name)[0])

        # Unrelated shortcuts preserved byte-for-byte in purge mode
        has_kr, kr_val = self.sb.get_kconfig("kglobalshortcutsrc", "krunner.desktop", krunner_name)
        self.assertTrue(has_kr)
        self.assertEqual(kr_val, krunner_val)

        has_pl, pl_val = self.sb.get_kconfig("kglobalshortcutsrc", "plasmashell", plasma_name)
        self.assertTrue(has_pl)
        self.assertEqual(pl_val, plasma_val)

        has_kc, kc_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", kwin_other_name)
        self.assertTrue(has_kc)
        self.assertEqual(kc_val, kwin_other_val)

        # Unrelated keys preserved exactly
        has_focus, focus_val = self.sb.get_kconfig("kwinrc", "General", "focusPolicy")
        self.assertTrue(has_focus)
        self.assertEqual(focus_val, "ClickToFocus")

        has_other, other_val = self.sb.get_kconfig("kwinrc", "UnrelatedGroup", "otherKey")
        self.assertTrue(has_other)
        self.assertEqual(other_val, "preserveMe")

        self.assertFalse(os.path.exists(legacy_tesserarc))
        self.assertFalse(os.path.exists(legacy_backup))

        # 2. Honest output when config removal tool fails
        self.sb.set_kconfig("kwinrc", "Script-tessera", "gapInner", "15")
        self.sb.add_fail_rule("kwriteconfig6", key="gapInner", mode="fail_before", exit_code=1, once=False)

        res_partial = self.sb.run_uninstaller(args=["--purge"])
        self.assertEqual(res_partial.returncode, 0)
        self.assertIn("some saved configuration could not be deleted", res_partial.stdout)
        self.assertNotIn("Tessera and its saved configuration have been removed", res_partial.stdout)

    def test_uninstaller_symlink_safety(self):
        """10. Symlink safety across standard and purge modes:
        - table-driven over standard and --purge modes with a fresh SandboxHarness per mode
        - all five destructive targets (KWin script tree, Control Center tree, desktop, icon, launcher)
          are symlinks to separate external sentinel directories and files
        - asserts only install-path symlinks are removed while external sentinel directories, files,
          and exact bytes are untouched
        - asserts purge-specific local config deletion does not touch unrelated external sentinels."""
        for mode_name, args in [("standard", []), ("purge", ["--purge"])]:
            with self.subTest(uninstaller_mode=mode_name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-symlink-safe-{mode_name}-") as sub_tmp:
                    sub_sb = SandboxHarness(sub_tmp)

                    # External sentinels outside install paths
                    sentinel_root = os.path.join(sub_tmp, "external_sentinels")
                    sentinel_script_dir = os.path.join(sentinel_root, "ext_script_dir")
                    sentinel_control_dir = os.path.join(sentinel_root, "ext_control_dir")
                    sentinel_desktop_file = os.path.join(sentinel_root, "ext_app.desktop")
                    sentinel_icon_file = os.path.join(sentinel_root, "ext_icon.svg")
                    sentinel_launcher_file = os.path.join(sentinel_root, "ext_launcher.sh")
                    sentinel_config_file = os.path.join(sentinel_root, "ext_precious_config.json")

                    os.makedirs(sentinel_script_dir, exist_ok=True)
                    os.makedirs(sentinel_control_dir, exist_ok=True)

                    with open(os.path.join(sentinel_script_dir, "script_data.txt"), "w") as f: f.write("precious script data")
                    with open(os.path.join(sentinel_control_dir, "control_data.txt"), "w") as f: f.write("precious control data")
                    with open(sentinel_desktop_file, "w") as f: f.write("precious desktop data")
                    with open(sentinel_icon_file, "w") as f: f.write("precious icon data")
                    with open(sentinel_launcher_file, "w") as f: f.write("precious launcher data")
                    with open(sentinel_config_file, "w") as f: f.write("precious external config")

                    # Install paths set as symlinks pointing to external sentinels
                    kwin_script = os.path.join(sub_sb.data_home, "kwin", "scripts", "tessera")
                    control_dir = os.path.join(sub_sb.data_home, "tessera")
                    desktop_file = os.path.join(sub_sb.data_home, "applications", "org.kde.tessera.desktop")
                    icon_file = os.path.join(sub_sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
                    launcher = os.path.join(sub_sb.bin_home, "tessera-settings")

                    os.makedirs(os.path.dirname(kwin_script), exist_ok=True)
                    os.makedirs(os.path.dirname(control_dir), exist_ok=True)
                    os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
                    os.makedirs(os.path.dirname(icon_file), exist_ok=True)
                    os.makedirs(os.path.dirname(launcher), exist_ok=True)

                    os.symlink(sentinel_script_dir, kwin_script)
                    os.symlink(sentinel_control_dir, control_dir)
                    os.symlink(sentinel_desktop_file, desktop_file)
                    os.symlink(sentinel_icon_file, icon_file)
                    os.symlink(sentinel_launcher_file, launcher)

                    # Seed local config files that purge would remove
                    legacy_tesserarc = os.path.join(sub_sb.config_home, "tesserarc")
                    legacy_backup = os.path.join(sub_sb.config_home, "tessera_migration_backup.json")
                    with open(legacy_tesserarc, "w") as f: f.write("local tesserarc")
                    with open(legacy_backup, "w") as f: f.write("local backup")

                    res = sub_sb.run_uninstaller(args=args)
                    self.assertEqual(res.returncode, 0, res.stderr)

                    # All five install-path symlinks are removed
                    self.assertFalse(os.path.exists(kwin_script))
                    self.assertFalse(os.path.islink(kwin_script))
                    self.assertFalse(os.path.exists(control_dir))
                    self.assertFalse(os.path.islink(control_dir))
                    self.assertFalse(os.path.exists(desktop_file))
                    self.assertFalse(os.path.islink(desktop_file))
                    self.assertFalse(os.path.exists(icon_file))
                    self.assertFalse(os.path.islink(icon_file))
                    self.assertFalse(os.path.exists(launcher))
                    self.assertFalse(os.path.islink(launcher))

                    # All external sentinel directories, files, and exact bytes remain intact
                    self.assertTrue(os.path.isdir(sentinel_script_dir))
                    with open(os.path.join(sentinel_script_dir, "script_data.txt"), "r") as f:
                        self.assertEqual(f.read(), "precious script data")

                    self.assertTrue(os.path.isdir(sentinel_control_dir))
                    with open(os.path.join(sentinel_control_dir, "control_data.txt"), "r") as f:
                        self.assertEqual(f.read(), "precious control data")

                    self.assertTrue(os.path.isfile(sentinel_desktop_file))
                    with open(sentinel_desktop_file, "r") as f:
                        self.assertEqual(f.read(), "precious desktop data")

                    self.assertTrue(os.path.isfile(sentinel_icon_file))
                    with open(sentinel_icon_file, "r") as f:
                        self.assertEqual(f.read(), "precious icon data")

                    self.assertTrue(os.path.isfile(sentinel_launcher_file))
                    with open(sentinel_launcher_file, "r") as f:
                        self.assertEqual(f.read(), "precious launcher data")

                    # Purge-specific check: local config files removed if purge, preserved if standard
                    if mode_name == "purge":
                        self.assertFalse(os.path.exists(legacy_tesserarc))
                        self.assertFalse(os.path.exists(legacy_backup))
                    else:
                        self.assertTrue(os.path.exists(legacy_tesserarc))
                        self.assertTrue(os.path.exists(legacy_backup))

                    # External config sentinel untouched in both modes
                    self.assertTrue(os.path.isfile(sentinel_config_file))
                    with open(sentinel_config_file, "r") as f:
                        self.assertEqual(f.read(), "precious external config")

    def test_uninstaller_reporting_on_failures(self):
        """11. Truthful uninstaller reporting across standard and purge modes with failures:
        - tests missing kwriteconfig6 tool
        - tests plugin disable failure
        - tests shortcut deletion failure
        - asserts honest reporting, preserved unrelated state, and bounded file deletion."""
        subcases = [
            ("missing_tool_standard", [], False, "missing_tool"),
            ("missing_tool_purge", ["--purge"], True, "missing_tool"),
            ("plugin_fail_standard", [], False, "plugin_fail"),
            ("plugin_fail_purge", ["--purge"], True, "plugin_fail"),
            ("shortcut_fail_standard", [], False, "shortcut_fail"),
            ("shortcut_fail_purge", ["--purge"], True, "shortcut_fail"),
        ]

        for name, args, is_purge, fail_kind in subcases:
            with self.subTest(uninstaller_case=name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-uninst-{name}-") as sub_tmp:
                    sub_sb = SandboxHarness(sub_tmp)

                    # Seed installed targets
                    kwin_script = os.path.join(sub_sb.data_home, "kwin", "scripts", "tessera")
                    control_dir = os.path.join(sub_sb.data_home, "tessera", "control")
                    desktop_file = os.path.join(sub_sb.data_home, "applications", "org.kde.tessera.desktop")
                    icon_file = os.path.join(sub_sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
                    launcher = os.path.join(sub_sb.bin_home, "tessera-settings")

                    os.makedirs(kwin_script, exist_ok=True)
                    os.makedirs(control_dir, exist_ok=True)
                    os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
                    os.makedirs(os.path.dirname(icon_file), exist_ok=True)
                    os.makedirs(os.path.dirname(launcher), exist_ok=True)

                    with open(os.path.join(kwin_script, "marker.txt"), "w") as f: f.write("installed script")
                    with open(os.path.join(control_dir, "marker.txt"), "w") as f: f.write("installed control")
                    with open(desktop_file, "w") as f: f.write("installed desktop")
                    with open(icon_file, "w") as f: f.write("installed icon")
                    with open(launcher, "w") as f: f.write("installed launcher")

                    # Seed config
                    sub_sb.set_kconfig("kwinrc", "Plugins", "tesseraEnabled", "true")
                    sub_sb.set_kconfig("kwinrc", "Script-tessera", "gapInner", "12")
                    sub_sb.set_kconfig("kwinrc", "General", "focusPolicy", "ClickToFocus")
                    sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Tiling", "Meta+Shift+T,Meta+Shift+T,Toggle Tiling Globally")

                    extra_env = {}
                    if fail_kind == "missing_tool":
                        ctrl_path = sub_sb.make_controlled_path(omit="kwriteconfig6")
                        extra_env["PATH"] = ctrl_path
                    elif fail_kind == "plugin_fail":
                        sub_sb.add_fail_rule("kwriteconfig6", file="kwinrc", group="Plugins", key="tesseraEnabled", mode="fail_before", exit_code=1, once=False)
                    elif fail_kind == "shortcut_fail":
                        sub_sb.add_fail_rule("kwriteconfig6", file="kglobalshortcutsrc", group="kwin", key="Tessera: Toggle Tiling", mode="fail_before", exit_code=1, once=False)

                    res = sub_sb.run_uninstaller(extra_env=extra_env, args=args)
                    self.assertEqual(res.returncode, 0, res.stderr)

                    # Bounded file removal always succeeded
                    self.assertFalse(os.path.exists(kwin_script))
                    self.assertFalse(os.path.exists(os.path.join(sub_sb.data_home, "tessera")))
                    self.assertFalse(os.path.exists(desktop_file))
                    self.assertFalse(os.path.exists(icon_file))
                    self.assertFalse(os.path.exists(launcher))

                    # Unrelated config always preserved
                    has_focus, focus_val = sub_sb.get_kconfig("kwinrc", "General", "focusPolicy")
                    self.assertTrue(has_focus)
                    self.assertEqual(focus_val, "ClickToFocus")

                    # Honest reporting check
                    if is_purge:
                        self.assertIn("some saved configuration could not be deleted", res.stdout)
                        self.assertNotIn("Tessera and its saved configuration have been removed", res.stdout)
                    else:
                        self.assertIn("some configuration could not be disabled or deleted", res.stdout)
                        self.assertNotIn("saved layout settings were preserved", res.stdout)

    def test_upgrade_from_previous_catalog_migrates_defaults_and_preserves_custom_and_unbound(self):
        """12. Real upgrade fixture from previous catalog:
        - recognized old Ctrl defaults migrate to new Super defaults
        - custom user bindings on active actions are strictly preserved
        - intentionally unbound active shortcuts ("" or "none") remain unbound
        - old default on legacy action is safely deleted
        - custom user binding on exact semantic legacy ratio action transfers to replacement
        - custom user binding on non-spatial action without opt-in is preserved
        - unrelated Plasma/KWin shortcuts remain completely untouched
        - regression subcase: upgrade with existing Meta+Space and Meta+Shift+Space retired defaults
          verifies both current Meta defaults are removed, genuinely custom retired bindings remain
          byte-for-byte preserved, and unrelated KRunner/Plasma configurations remain untouched."""
        legacy_ratio_key = "Tessera: Increase Master Ratio"
        legacy_ratio_custom_key = "Tessera: Decrease Master Ratio"

        with self.subTest(catalog="ctrl_defaults"):
            # Seed shortcuts
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Next Layout", "Ctrl+Space,Ctrl+Space,Cycle to Next Layout")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Previous Layout", "Ctrl+Alt+P,Ctrl+Shift+Space,My Prev Layout")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Zone Overlay", "Ctrl+Shift+C,Ctrl+Shift+C,Toggle Zone Overlay")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Tiling", "Ctrl+Alt+T,Ctrl+Shift+T,Custom Toggle Tiling")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Window Floating", "")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_ratio_key, "Ctrl+Shift+L,Ctrl+Shift+L,Tessera: Increase Master Ratio")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_ratio_custom_key, "Ctrl+Alt+Minus,Ctrl+Shift+H,Custom Ratio")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Focus Next Window", "Ctrl+Alt+N,Ctrl+Shift+J,My Next Focus")
            self.sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", "Meta+Left,Meta+Left,Quick Tile Left")

            res = self.sb.run_installer()
            self.assertEqual(res.returncode, 0, res.stderr)

            # 1. Recognized old Ctrl defaults migrated to Super defaults or deleted if retired without replacement
            has_next_layout, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Next Layout")
            self.assertFalse(has_next_layout)

            has_prev_layout, prev_layout_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Previous Layout")
            self.assertTrue(has_prev_layout)
            self.assertEqual(prev_layout_val, "Ctrl+Alt+P,Ctrl+Shift+Space,My Prev Layout")

            _, overlay_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Zone Overlay")
            self.assertEqual(overlay_val, "Meta+Shift+C,Meta+Shift+C,Toggle Zone Overlay")

            # 2. Custom active binding preserved
            _, tiling_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Tiling")
            self.assertEqual(tiling_val, "Ctrl+Alt+T,Ctrl+Shift+T,Custom Toggle Tiling")

            # 3. Intentionally unbound active binding preserved
            has_floating, floating_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Window Floating")
            self.assertTrue(has_floating)
            self.assertEqual(floating_val, "")

            # 4. Old default on legacy action deleted
            legacy_ratio_present, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_ratio_key)
            self.assertFalse(legacy_ratio_present)

            # 5. Retired ratio action received no active registration
            has_prim_ratio, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Increase Primary Ratio")
            self.assertFalse(has_prim_ratio)

            # 6. Custom user binding on legacy ratio action preserved on legacy action itself
            legacy_custom_ratio_present, legacy_custom_ratio_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_ratio_custom_key)
            self.assertTrue(legacy_custom_ratio_present)
            self.assertEqual(legacy_custom_ratio_val, "Ctrl+Alt+Minus,Ctrl+Shift+H,Custom Ratio")
            has_dec_ratio, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Decrease Primary Ratio")
            self.assertFalse(has_dec_ratio)

            # 7. Custom user binding on non-spatial action without opt-in preserved on compatibility key
            has_compat_focus, compat_focus_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Focus Next Window")
            self.assertTrue(has_compat_focus)
            self.assertEqual(compat_focus_val, "Ctrl+Alt+N,Ctrl+Shift+J,My Next Focus")

            # 8. Unrelated Plasma shortcut untouched
            has_tile, tile_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left")
            self.assertTrue(has_tile)
            self.assertEqual(tile_val, "Meta+Left,Meta+Left,Quick Tile Left")

        with self.subTest(catalog="meta_defaults_krunner_conflict"):
            with tempfile.TemporaryDirectory(prefix="tessera-meta-upgrade-") as sub_tmp:
                sub_sb = SandboxHarness(sub_tmp)

                # Seed existing retired Meta defaults (causing the KRunner conflict before fix)
                sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Next Layout", "Meta+Space,Meta+Space,Cycle to Next Layout")
                sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Previous Layout", "Meta+Shift+Space,Meta+Shift+Space,Cycle to Previous Layout")

                # Seed genuinely custom retired binding on legacy action without replacement
                custom_retired_key = "Tessera: Cycle Layout on Other Screen"
                custom_retired_val = "Ctrl+Alt+O,Ctrl+Shift+X,Custom Other Screen Cycle"
                sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_retired_key, custom_retired_val)

                # Seed unrelated KRunner configuration and Plasma shortcut
                krunner_orig_val = "Meta+Space,Meta+Space,KRunner"
                plasma_orig_val = "Meta+Left,Meta+Left,Quick Tile Left"
                sub_sb.set_kconfig("kglobalshortcutsrc", "org.kde.krunner.desktop", "_launch", krunner_orig_val)
                sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", plasma_orig_val)

                # Run installer upgrade
                sub_res = sub_sb.run_installer()
                self.assertEqual(sub_res.returncode, 0, f"STDOUT:\n{sub_res.stdout}\nSTDERR:\n{sub_res.stderr}")

                # 1. Assert both retired Meta defaults are cleanly removed
                has_meta_next, _ = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Next Layout")
                self.assertFalse(has_meta_next, "Retired Meta+Space Next Layout default must be removed on upgrade")

                has_meta_prev, _ = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Previous Layout")
                self.assertFalse(has_meta_prev, "Retired Meta+Shift+Space Previous Layout default must be removed on upgrade")

                # 2. Assert genuinely custom retired binding remains byte-for-byte preserved
                has_custom_ret, actual_custom_ret = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_retired_key)
                self.assertTrue(has_custom_ret, f"Genuinely custom retired binding {custom_retired_key} must be preserved")
                self.assertEqual(actual_custom_ret, custom_retired_val, "Custom retired binding must be preserved byte-for-byte")

                # 3. Assert unrelated KRunner and Plasma configurations remain untouched
                has_krunner, actual_krunner = sub_sb.get_kconfig("kglobalshortcutsrc", "org.kde.krunner.desktop", "_launch")
                self.assertTrue(has_krunner, "Unrelated KRunner configuration must remain present")
                self.assertEqual(actual_krunner, krunner_orig_val, "Unrelated KRunner configuration must be untouched")

                has_plasma, actual_plasma = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left")
                self.assertTrue(has_plasma, "Unrelated Plasma shortcut must remain present")
                self.assertEqual(actual_plasma, plasma_orig_val, "Unrelated Plasma shortcut must be untouched")

                # Assert KRunner is never falsely flagged as a conflict by active shortcuts
                self.assertNotIn("KRunner", sub_res.stdout, "Retired Next Layout Meta+Space must not conflict with KRunner")

        with self.subTest(catalog="custom_active_shortcut_metadata_preserved"):
            with tempfile.TemporaryDirectory(prefix="tessera-custom-meta-") as sub_tmp:
                sub_sb = SandboxHarness(sub_tmp)

                # Seed active shortcuts where:
                # 1) current is old default, stored default is different/none/missing, and label is custom
                # 2) current == stored historical default, but third field is a user-custom label
                custom_cases = [
                    ("Tessera: Focus Left Window", "Ctrl+Shift+A,Meta+Alt+A,My custom focus left"),
                    ("Tessera: Focus Right Window", "Ctrl+Shift+D,none,Custom focus right"),
                    ("Tessera: Focus Up Window", "Ctrl+Shift+W,,Custom focus up"),
                    ("Tessera: Toggle Tiling", "Ctrl+Shift+T,Ctrl+Shift+T,My custom tiling note"),
                ]
                for key, val in custom_cases:
                    sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", key, val)

                # Also seed a genuine uncustomized old default that SHOULD migrate
                sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Window Floating", "Ctrl+Shift+F,Ctrl+Shift+F,Toggle Window Floating")

                sub_res = sub_sb.run_installer()
                self.assertEqual(sub_res.returncode, 0, f"STDOUT:\n{sub_res.stdout}\nSTDERR:\n{sub_res.stderr}")

                # Verify all custom active shortcuts (including current==stored default with custom label)
                # are preserved byte-for-byte
                for key, expected_val in custom_cases:
                    has_key, actual_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", key)
                    self.assertTrue(has_key, f"Custom active shortcut '{key}' must be preserved")
                    self.assertEqual(actual_val, expected_val, f"Custom active shortcut '{key}' must be preserved byte-for-byte")

                # Verify genuine old default with standard label migrated to new Super default
                has_floating, actual_floating = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Window Floating")
                self.assertTrue(has_floating)
                self.assertTrue(actual_floating.startswith("Meta+Shift+F,Meta+Shift+F,"))

        with self.subTest(catalog="zone_overlay_historical_kzones_label_migration_and_preservation"):
            test_cases = [
                # Case 1: Exact historical default with former KZones-Style label migrates to Meta+Shift+C while preserving label
                (
                    "case_1_historical_default_migrates_preserving_third_field",
                    "Ctrl+Shift+C,Ctrl+Shift+C,Toggle Zone Overlay (KZones-Style)",
                    "Meta+Shift+C,Meta+Shift+C,Toggle Zone Overlay (KZones-Style)"
                ),
                # Case 2a: Arbitrary user-custom label on old default bindings is preserved byte-for-byte
                (
                    "case_2a_arbitrary_custom_label_preserved",
                    "Ctrl+Shift+C,Ctrl+Shift+C,My Custom Overlay Shortcut",
                    "Ctrl+Shift+C,Ctrl+Shift+C,My Custom Overlay Shortcut"
                ),
                # Case 2b: Current/default mismatch (customized binding) is preserved byte-for-byte
                (
                    "case_2b_current_default_mismatch_preserved",
                    "Meta+Alt+Z,Ctrl+Shift+C,Toggle Zone Overlay (KZones-Style)",
                    "Meta+Alt+Z,Ctrl+Shift+C,Toggle Zone Overlay (KZones-Style)"
                ),
                # Case 3: Already-Meta+Shift+C entry with the old label remains completely unchanged
                (
                    "case_3_already_meta_with_old_label_unchanged",
                    "Meta+Shift+C,Meta+Shift+C,Toggle Zone Overlay (KZones-Style)",
                    "Meta+Shift+C,Meta+Shift+C,Toggle Zone Overlay (KZones-Style)"
                ),
            ]
            for desc, initial_val, expected_after in test_cases:
                with tempfile.TemporaryDirectory(prefix=f"tessera-{desc}-") as sub_tmp:
                    sub_sb = SandboxHarness(sub_tmp)
                    sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Zone Overlay", initial_val)
                    sub_res = sub_sb.run_installer()
                    self.assertEqual(sub_res.returncode, 0, f"{desc} installer failed: {sub_res.stderr}")
                    has_key, actual_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Toggle Zone Overlay")
                    self.assertTrue(has_key, f"{desc}: key must exist")
                    self.assertEqual(
                        actual_val,
                        expected_after,
                        f"{desc}: value mismatch (before: {initial_val!r}, expected: {expected_after!r}, got: {actual_val!r})"
                    )

    def test_transferred_custom_binding_provenance_and_rollback_minimal_fixture(self):
        """13. Minimal fixture: Focus Next Window custom Ctrl+Shift+D, Focus Right Window absent.
        - Legacy pass with opt-in copies Ctrl+Shift+D to Focus Right.
        - Active pass recognizes transferred-custom provenance and never reclassifies as old default.
        - On success: Focus Right retains Ctrl+Shift+D (not overwritten with Meta+Alt+D).
        - On failure before commit: rollback deletes Focus Right Window (originally absent)
          and restores Focus Next Window to Ctrl+Shift+D without intermediate contamination."""
        subcases = [
            ("success", None),
            ("fail_before_write", "fail_before"),
            ("fail_after_write", "fail_after"),
        ]

        for name, fail_mode in subcases:
            with self.subTest(case=name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-transferred-{name}-") as sub_tmp:
                    sub_sb = SandboxHarness(sub_tmp)

                    legacy_key = "Tessera: Focus Next Window"
                    dest_key = "Tessera: Focus Right Window"

                    # Seed minimal fixture: Focus Next Window has custom Ctrl+Shift+D; Focus Right Window is absent
                    sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_key, "Ctrl+Shift+D,Ctrl+Shift+J,Old Focus Next")

                    if fail_mode is not None:
                        # Inject write failure on plugin enable to trigger rollback after shortcut mutations
                        sub_sb.add_fail_rule(
                            "kwriteconfig6",
                            file="kwinrc",
                            group="Plugins",
                            key="tesseraEnabled",
                            mode=fail_mode,
                            exit_code=1,
                            once=False,
                        )

                    res = sub_sb.run_installer(args=["--migrate-legacy-spatial"])

                    if fail_mode is None:
                        self.assertEqual(res.returncode, 0, res.stderr)
                        # Success: Focus Right Window retained transferred custom Ctrl+Shift+D
                        # and was NOT overwritten by Meta+Alt+D
                        has_dest, dest_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", dest_key)
                        self.assertTrue(has_dest, "Focus Right Window must be present after opt-in migration")
                        self.assertEqual(
                            dest_val,
                            "Ctrl+Shift+D,Meta+Alt+D,Focus Right Window (WASD)",
                            "Transferred custom binding must not be reclassified as old default or overwritten"
                        )
                        # Legacy key was deleted
                        has_legacy, _ = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_key)
                        self.assertFalse(has_legacy, "Migrated legacy key must be removed")
                    else:
                        self.assertNotEqual(res.returncode, 0)
                        # Rollback: Focus Right Window was originally absent, so it must be completely deleted
                        has_dest, dest_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", dest_key)
                        self.assertFalse(
                            has_dest,
                            f"Focus Right Window was originally absent and must not survive rollback (got: {dest_val})"
                        )
                        # Focus Next Window must be restored to its exact original pre-transaction state
                        has_legacy, legacy_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_key)
                        self.assertTrue(has_legacy, "Focus Next Window must be restored by rollback")
                        self.assertEqual(
                            legacy_val,
                            "Ctrl+Shift+D,Ctrl+Shift+J,Old Focus Next",
                            "Focus Next Window must be restored to exact pre-transaction value"
                        )

    def test_plasma_conflict_detection_reads_actual_active_bindings(self):
        """14. Plasma conflict detection reads actual active bindings:
        - Does NOT warn when a Tessera shortcut is intentionally unbound
        - DOES detect and surface collisions with custom user bindings
        - Preserves unrelated Plasma shortcuts completely untouched."""
        with tempfile.TemporaryDirectory(prefix="tessera-conflict-unbound-") as sub_tmp:
            sub_sb = SandboxHarness(sub_tmp)
            # Intentionally unbind Tessera: Move Window to Left Region
            sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Move Window to Left Region", "")
            # Seed Plasma Quick Tile Left
            sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", "Meta+Left,Meta+Left,Quick Tile Left")

            res = sub_sb.run_installer()
            self.assertEqual(res.returncode, 0, res.stderr)
            # Must not warn for unbound Tessera shortcut
            self.assertNotIn(
                "Tessera 'Tessera: Move Window to Left Region'",
                res.stdout,
                "Must not warn of conflict for intentionally unbound Tessera shortcut"
            )
            # Unrelated Plasma shortcut untouched
            has_plasma, plasma_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left")
            self.assertTrue(has_plasma)
            self.assertEqual(plasma_val, "Meta+Left,Meta+Left,Quick Tile Left")

        with tempfile.TemporaryDirectory(prefix="tessera-conflict-custom-") as sub_tmp:
            sub_sb = SandboxHarness(sub_tmp)
            # Custom bind Tessera: Toggle Tiling to Meta+Left (colliding with Plasma Quick Tile Left)
            sub_sb.set_kconfig(
                "kglobalshortcutsrc",
                "kwin",
                "Tessera: Toggle Tiling",
                "Meta+Left,Ctrl+Shift+T,Custom Tiling"
            )
            sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", "Meta+Left,Meta+Left,Quick Tile Left")

            res = sub_sb.run_installer()
            self.assertEqual(res.returncode, 0, res.stderr)
            # Must detect collision with custom active binding
            self.assertIn(
                "Tessera 'Tessera: Toggle Tiling' (bound to 'Meta+Left') and Plasma 'Window Quick Tile Left'",
                res.stdout,
                "Must detect conflict against actual active custom binding"
            )
            # Unrelated Plasma shortcut untouched
            has_plasma, plasma_val = sub_sb.get_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left")
            self.assertTrue(has_plasma)
        with tempfile.TemporaryDirectory(prefix="tessera-conflict-plasma-unbound-") as sub_tmp:
            sub_sb = SandboxHarness(sub_tmp)
            # Explicitly unbind Plasma Quick Tile Left (empty sequence before comma)
            sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", ",none,Quick Tile Left")
            # Tessera shortcut uses its default Meta+Left
            res = sub_sb.run_installer()
            self.assertEqual(res.returncode, 0, res.stderr)
            # Must NOT warn of conflict when Plasma shortcut is explicitly unbound with empty sequence
            self.assertNotIn(
                "Window Quick Tile Left",
                res.stdout,
                "Must not emit false conflict warning when Plasma shortcut is explicitly unbound with empty sequence"
            )

            # Also test when explicitly unbound with 'none' sequence
            sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Window Quick Tile Left", "none,none,Quick Tile Left")
            res2 = sub_sb.run_installer()
            self.assertEqual(res2.returncode, 0, res2.stderr)
            self.assertNotIn(
                "Window Quick Tile Left",
                res2.stdout,
                "Must not emit false conflict warning when Plasma shortcut is explicitly unbound with 'none'"
            )

        with tempfile.TemporaryDirectory(prefix="tessera-conflict-plasma-missing-") as sub_tmp:
            sub_sb = SandboxHarness(sub_tmp)
            # Plasma Quick Tile Left is completely missing from kglobalshortcutsrc (Plasma uses built-in default Meta+Left)
            # Tessera Move Window to Left Region will receive default Meta+Left
            res = sub_sb.run_installer()
            self.assertEqual(res.returncode, 0, res.stderr)
            # Must detect conflict against missing Plasma shortcut using its built-in default
            self.assertIn(
                "Tessera 'Tessera: Move Window to Left Region' (bound to 'Meta+Left') and Plasma 'Window Quick Tile Left'",
                res.stdout,
                "Must detect conflict when Plasma shortcut is missing from kglobalshortcutsrc and defaults to Meta+Left"
            )

    def test_control_center_cleanup_failure_reports_warning_without_claiming_complete_retirement(self):
        """15. Control Center cleanup failure handling:
        - If removing a legacy control target fails, captures failure
        - Emits meaningful warning to stderr with failed targets
        - Reports 'Installation complete with warnings' instead of claiming complete retirement."""
        with tempfile.TemporaryDirectory(prefix="tessera-cleanup-fail-") as sub_tmp:
            sub_sb = SandboxHarness(sub_tmp)
            control_dir = os.path.join(sub_sb.data_home, "tessera", "control")
            os.makedirs(control_dir, exist_ok=True)
            nested_file = os.path.join(control_dir, "legacy_file.txt")
            with open(nested_file, "w") as f:
                f.write("legacy")

            # Remove write permissions from control_dir so rm -rf fails to delete nested_file
            os.chmod(control_dir, 0o555)
            try:
                res = sub_sb.run_installer()
                self.assertEqual(res.returncode, 0, res.stderr)
                self.assertIn("Warning: failed to remove legacy Control Center files:", res.stderr)
                self.assertIn("Legacy cleanup incomplete; please remove remaining files manually.", res.stderr)
                self.assertIn("Installation complete with warnings.", res.stdout)
                self.assertNotIn("Installation complete. Configure Tessera", res.stdout)
            finally:
                # Restore permissions for temp directory cleanup
                os.chmod(control_dir, 0o755)

    def test_direct_install_rejects_stale_and_incompatible_bridges(self):
        """16. Table-driven direct install rejection of stale and incompatible bridges:
        - rejects stale bridge compared to TypeScript sources
        - rejects incompatible bridge with unlowered class fields (userFilterTokens)
        - rejects incompatible bridge with arbitrary class fields (layoutSchemaVersion)
        - asserts zero config/file mutations and no temp dirs."""
        bridge_cases = [
            ("stale_reconciler_js", lambda r: os.utime(os.path.join(r, "contents", "code", "reconciler.js"), (1000, 1000)), "is stale compared to TypeScript sources"),
            ("incompatible_reconciler_js_unlowered_class_field", lambda r: self._write_raw(os.path.join(r, "contents", "code", "reconciler.js"), "class Reconciler {\n    userFilterTokens = [];\n}\n"), "contains unlowered class field 'userFilterTokens'"),
            ("incompatible_layouts_js_arbitrary_class_field", lambda r: self._write_raw(os.path.join(r, "contents", "code", "layouts.js"), "class CustomLayout {\n    static layoutSchemaVersion = 1;\n}\n"), "contains unlowered class field 'layoutSchemaVersion'"),
        ]

        for case_name, mutate_fn, expected_diag in bridge_cases:
            with self.subTest(bridge_case=case_name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-bridge-preflight-{case_name}-") as disp_tmp:
                    disp_repo = os.path.join(disp_tmp, "repo")
                    shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns(*REPO_IGNORE_PATTERNS))
                    mutate_fn(disp_repo)

                    self.sb._init_state()
                    self.sb.clear_logs()

                    res = self.sb.run_installer(cwd=disp_repo)
                    self.assertNotEqual(res.returncode, 0)
                    self.assertIn(expected_diag, res.stderr)

                    # Zero config mutations
                    self.assertEqual(self.sb.get_logs(), [])
                    state = self.sb._read_state()
                    self.assertEqual(state["store"], {})

                    # Zero installed file mutations
                    kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
                    self.assertFalse(os.path.exists(kwin_script))

                    # Zero temp dirs
                    temp_dirs = [d for d in os.listdir(self.sb.data_home) if d.startswith(".tessera-install.")]
                    self.assertEqual(temp_dirs, [])

    def test_installer_preserves_intentionally_unbound_and_empty_legacy_shortcuts(self):
        """17. Regression coverage for intentionally unbound and empty legacy shortcuts:
        - intentionally unbound legacy action ("none,none,Swap Screen Layouts") is preserved byte-for-byte
        - intentionally unbound legacy action with replacement ("none,Ctrl+Shift+L,Old Ratio") is preserved byte-for-byte
        - explicitly empty legacy action ("") is preserved byte-for-byte
        - legacy action with empty current binding (",Ctrl+Alt+X,Cycle Layout on Other Screen") is preserved byte-for-byte
        - contrast: proven uncustomized old default legacy action is deleted
        - active replacement action receives target default without inheriting "none"."""
        # 1. Unbound legacy action without replacement
        unbound_no_repl_name = "Tessera: Swap Screen Layouts"
        unbound_no_repl_val = "none,none,Swap Screen Layouts"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_no_repl_name, unbound_no_repl_val)

        # 2. Unbound legacy action that has a replacement (Increase Master Ratio -> Increase Primary Ratio)
        unbound_with_repl_name = "Tessera: Increase Master Ratio"
        unbound_with_repl_val = "none,Ctrl+Shift+L,Increase Master Ratio"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", unbound_with_repl_name, unbound_with_repl_val)

        # 3. Explicitly empty legacy action
        empty_legacy_name = "Tessera: Decrease Master Ratio"
        empty_legacy_val = ""
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_legacy_name, empty_legacy_val)

        # 4. Legacy action with empty current binding but stored default and label
        empty_cur_legacy_name = "Tessera: Cycle Layout on Other Screen"
        empty_cur_legacy_val = ",Ctrl+Shift+X,Cycle Layout on Other Screen"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_cur_legacy_name, empty_cur_legacy_val)

        # 5. Proven uncustomized old default legacy action (for contrast: MUST be deleted)
        proven_default_legacy_name = "Tessera: Next Layout"
        proven_default_legacy_val = "Ctrl+Space,Ctrl+Space,Cycle to Next Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", proven_default_legacy_name, proven_default_legacy_val)

        # 5b. Shortened custom label on legacy action (for contrast: MUST be preserved byte-for-byte)
        shortened_legacy_name = "Tessera: Previous Layout"
        shortened_legacy_val = "Meta+Shift+Space,Meta+Shift+Space,Previous Layout"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name, shortened_legacy_val)

        # 6. Active custom shortcut (must also be preserved)
        active_custom_name = "Tessera: Toggle Tiling"
        active_custom_val = "Meta+Ctrl+T,Meta+Shift+T,Custom Toggle Tiling"
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", active_custom_name, active_custom_val)

        res = self.sb.run_installer()
        self.assertEqual(res.returncode, 0, res.stderr)

        # Assert 1: unbound legacy action without replacement preserved byte-for-byte
        has_u1, val_u1 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_no_repl_name)
        self.assertTrue(has_u1, f"{unbound_no_repl_name} must be preserved in kglobalshortcutsrc")
        self.assertEqual(val_u1, unbound_no_repl_val, "Unbound legacy action must be preserved byte-for-byte")

        # Assert 2: unbound legacy action with replacement preserved byte-for-byte (not deleted or migrated)
        has_u2, val_u2 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", unbound_with_repl_name)
        self.assertTrue(has_u2, f"{unbound_with_repl_name} must be preserved in kglobalshortcutsrc")
        self.assertEqual(val_u2, unbound_with_repl_val, "Unbound legacy action with replacement must be preserved byte-for-byte")

        # Assert 3: explicitly empty legacy action preserved byte-for-byte
        has_u3, val_u3 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_legacy_name)
        self.assertTrue(has_u3, f"{empty_legacy_name} must be preserved in kglobalshortcutsrc")
        self.assertEqual(val_u3, empty_legacy_val, "Empty legacy action must be preserved byte-for-byte")

        # Assert 4: legacy action with empty current binding preserved byte-for-byte
        has_u4, val_u4 = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_cur_legacy_name)
        self.assertTrue(has_u4, f"{empty_cur_legacy_name} must be preserved in kglobalshortcutsrc")
        self.assertEqual(val_u4, empty_cur_legacy_val, "Legacy action with empty current binding must be preserved byte-for-byte")

        # Assert 5: proven old default legacy action is deleted
        has_del, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", proven_default_legacy_name)
        self.assertFalse(has_del, f"Proven old default {proven_default_legacy_name} must be deleted")

        # Assert 5b: shortened custom label on legacy action is preserved byte-for-byte
        has_short, val_short = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", shortened_legacy_name)
        self.assertTrue(has_short, f"Shortened custom label {shortened_legacy_name} must be preserved")
        self.assertEqual(val_short, shortened_legacy_val, "Shortened custom label must be preserved byte-for-byte")

        # Assert 6: retired ratio action is not registered as active shortcut, and active default shortcut receives default
        has_ratio, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Increase Primary Ratio")
        self.assertFalse(has_ratio, "Retired ratio action must not be registered as active shortcut")
        has_act_def, val_act_def = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Focus Right Window")
        self.assertTrue(has_act_def)
        self.assertEqual(val_act_def, "Meta+Alt+D,Meta+Alt+D,Focus Right Window (WASD)")

        # Assert 7: active custom shortcut preserved byte-for-byte
        has_act, val_act = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", active_custom_name)
        self.assertTrue(has_act)
        self.assertEqual(val_act, active_custom_val)


if __name__ == "__main__":
    unittest.main()


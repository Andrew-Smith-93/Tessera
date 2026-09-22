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
        for util in ("bash", "sh", "sed", "mkdir", "rm", "chmod", "mktemp", "cat", "dirname", "readlink", "grep"):
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
            HOME=self.home,
            XDG_DATA_HOME=self.data_home,
            XDG_CONFIG_HOME=self.config_home,
            XDG_BIN_HOME=self.bin_home,
            PATH=f"{self.fake_bin}:/usr/bin:/bin",
            KCONFIG_STATE_FILE=self.state_file,
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

EXPECTED_CONTROL_FILES = {
    "command_runner.py",
    "config_contract.py",
    "config_manager.py",
    "presets.py",
    "tessera_settings.py",
    "ui_preview.py",
    "window_picker.py",
    "shortcuts.json",
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
        - launcher is a regular stable wrapper, not a symlink and contains no checkout path
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
        self.assertEqual(get_relative_files(control_dir), EXPECTED_CONTROL_FILES)
        self.assertTrue(os.path.isfile(desktop_file))
        self.assertTrue(os.path.isfile(icon_file))
        self.assertTrue(os.path.isfile(launcher))

        # Launcher is regular file (not symlink) and has no checkout path
        self.assertFalse(os.path.islink(launcher))
        with open(launcher, "r", encoding="utf-8") as f:
            launcher_content = f.read()
        self.assertNotIn(REPO_ROOT, launcher_content)
        self.assertIn('CONTROL_DIR="$DATA_HOME/tessera/control"', launcher_content)

        # Plugin enabled
        present, val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
        self.assertTrue(present)
        self.assertEqual(val, "true")

        # All 23 active shortcuts written with defaults
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
            shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns(".git"))

            # Inject decoys into tessera-control
            os.makedirs(os.path.join(disp_repo, "tessera-control", "__pycache__"), exist_ok=True)
            with open(os.path.join(disp_repo, "tessera-control", "__pycache__", "leak.cpython-312.pyc"), "wb") as f:
                f.write(b"fake bytecode")
            with open(os.path.join(disp_repo, "tessera-control", "leak.log"), "w") as f:
                f.write("leak log")
            with open(os.path.join(disp_repo, "tessera-control", "local-config.json"), "w") as f:
                f.write("{}")
            os.makedirs(os.path.join(disp_repo, "tessera-control", "extra"), exist_ok=True)
            with open(os.path.join(disp_repo, "tessera-control", "extra", "nested.txt"), "w") as f:
                f.write("extra file")

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
            control_dir = os.path.join(self.sb.data_home, "tessera", "control")

            # Assert exact allowlists
            self.assertEqual(get_relative_files(kwin_script), EXPECTED_KWIN_FILES)
            self.assertEqual(get_relative_files(control_dir), EXPECTED_CONTROL_FILES)

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
        - seed all five installed targets with prior content
        - seed active shortcut states: customized nonempty binding and explicitly empty binding
        - update replaces intended files
        - preserves both bindings exactly
        - removes obsolete legacy action."""
        # Seed 5 targets
        kwin_script = os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")
        control_dir = os.path.join(self.sb.data_home, "tessera", "control")
        desktop_file = os.path.join(self.sb.data_home, "applications", "org.kde.tessera.desktop")
        icon_file = os.path.join(self.sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")

        os.makedirs(kwin_script, exist_ok=True)
        os.makedirs(control_dir, exist_ok=True)
        os.makedirs(os.path.dirname(desktop_file), exist_ok=True)
        os.makedirs(os.path.dirname(icon_file), exist_ok=True)

        with open(os.path.join(kwin_script, "old_file.txt"), "w") as f: f.write("old script")
        with open(os.path.join(control_dir, "old_file.txt"), "w") as f: f.write("old control")
        with open(desktop_file, "w") as f: f.write("old desktop")
        with open(icon_file, "w") as f: f.write("old icon")
        with open(launcher, "w") as f: f.write("old launcher")

        # Seed shortcuts: custom nonempty, explicit empty, and legacy action
        custom_key = "Tessera: Toggle Tiling"
        empty_key = "Tessera: Toggle Zone Overlay"
        legacy_key = "Tessera: Increase Master Ratio"

        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", custom_key, "Meta+T,Meta+T,Custom user binding")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", empty_key, "")
        self.sb.set_kconfig("kglobalshortcutsrc", "kwin", legacy_key, "Ctrl+Shift+L,Ctrl+Shift+L,Old Master")

        res = self.sb.run_installer()
        self.assertEqual(res.returncode, 0, res.stderr)

        # Targets replaced (old files gone, new files present)
        self.assertFalse(os.path.exists(os.path.join(kwin_script, "old_file.txt")))
        self.assertFalse(os.path.exists(os.path.join(control_dir, "old_file.txt")))
        self.assertTrue(os.path.exists(os.path.join(kwin_script, "metadata.json")))

        # Custom and empty bindings preserved exactly
        _, custom_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", custom_key)
        self.assertEqual(custom_val, "Meta+T,Meta+T,Custom user binding")

        has_empty, empty_val = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", empty_key)
        self.assertTrue(has_empty)
        self.assertEqual(empty_val, "")

        # Obsolete legacy action deleted
        legacy_present, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", legacy_key)
        self.assertFalse(legacy_present, f"Legacy shortcut {legacy_key} must be removed after commit")

    def test_moved_deleted_checkout_launcher_invocation(self):
        """3. Moved/deleted checkout:
        - run install from a disposable source copy
        - rename/delete that source after success
        - prove installed launcher resolves only installed control directory and invokes tessera_settings.py."""
        disposable = tempfile.mkdtemp(prefix="disposable-tessera-")
        try:
            # Copy source repo to disposable
            shutil.copytree(REPO_ROOT, os.path.join(disposable, "repo"), symlinks=True, ignore=shutil.ignore_patterns("node_modules", ".git"))
            disp_repo = os.path.join(disposable, "repo")

            res = self.sb.run_installer(cwd=disp_repo)
            self.assertEqual(res.returncode, 0, res.stderr)

            # Now delete the source checkout completely!
            shutil.rmtree(disp_repo)

            launcher = os.path.join(self.sb.bin_home, "tessera-settings")
            self.assertTrue(os.path.isfile(launcher))

            # Run launcher with a fake python probe that records invocation parameters
            probe_output = os.path.join(self.tmp.name, "probe.json")
            probe_script = os.path.join(self.sb.fake_bin, "python3")
            self.sb._write_file(
                probe_script,
                f"""
                #!/usr/bin/env bash
                export PROBE_OUT={probe_output!r}
                exec {sys.executable!r} -c '
                import sys, os, json
                data = {{
                    "argv": sys.argv[1:],
                    "pythonpath": os.environ.get("PYTHONPATH"),
                    "cwd": os.getcwd()
                }}
                with open(os.environ["PROBE_OUT"], "w") as f:
                    json.dump(data, f)
                ' "$@"
                """,
                make_executable=True
            )

            probe_res = subprocess.run([launcher, "--test-flag"], env=self.sb.env(), capture_output=True, text=True)
            self.assertEqual(probe_res.returncode, 0, probe_res.stderr)

            with open(probe_output, "r") as f:
                info = json.load(f)

            expected_control = os.path.join(self.sb.data_home, "tessera", "control")
            self.assertEqual(info["pythonpath"], expected_control)
            self.assertEqual(info["argv"][0], os.path.join(expected_control, "tessera_settings.py"))
            self.assertIn("--test-flag", info["argv"])
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
        - tests missing python3, kreadconfig6, kwriteconfig6, and PyQt5
        - asserts exact diagnostic before any mutation and zero mutation events."""
        cases = [
            ("omit_python3", "python3", "Error: required utility 'python3' was not found in PATH."),
            ("omit_kreadconfig6", "kreadconfig6", "Error: required utility 'kreadconfig6' was not found in PATH."),
            ("omit_kwriteconfig6", "kwriteconfig6", "Error: required utility 'kwriteconfig6' was not found in PATH."),
            ("missing_pyqt5", None, "Error: PyQt5 is required for the installed Tessera Control Center"),
        ]
        for name, omit, expected_diag in cases:
            with self.subTest(dependency_case=name):
                self.sb._init_state()
                self.sb.clear_logs()
                ctrl_path = self.sb.make_controlled_path(omit=omit)
                extra = {"PATH": ctrl_path}
                if name == "missing_pyqt5":
                    extra["MOCK_FAIL_PYQT5"] = "1"

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
            ("target_2_control", lambda sb: os.path.join(sb.data_home, "tessera", "control")),
            ("target_3_desktop", lambda sb: os.path.join(sb.data_home, "applications", "org.kde.tessera.desktop")),
            ("target_4_icon", lambda sb: os.path.join(sb.data_home, "icons", "hicolor", "scalable", "apps", "tessera.svg")),
            ("target_5_launcher", lambda sb: os.path.join(sb.bin_home, "tessera-settings")),
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

        target_key = "Tessera: Next Layout"
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
            ("missing_settings_py", lambda r: os.remove(os.path.join(r, "tessera-control", "tessera_settings.py")), "tessera_settings.py"),
            ("missing_config_manager_py", lambda r: os.remove(os.path.join(r, "tessera-control", "config_manager.py")), "config_manager.py"),
            ("missing_config_contract_py", lambda r: os.remove(os.path.join(r, "tessera-control", "config_contract.py")), "config_contract.py"),
            ("missing_command_runner_py", lambda r: os.remove(os.path.join(r, "tessera-control", "command_runner.py")), "command_runner.py"),
            ("missing_presets_py", lambda r: os.remove(os.path.join(r, "tessera-control", "presets.py")), "presets.py"),
            ("missing_ui_preview_py", lambda r: os.remove(os.path.join(r, "tessera-control", "ui_preview.py")), "ui_preview.py"),
            ("missing_window_picker_py", lambda r: os.remove(os.path.join(r, "tessera-control", "window_picker.py")), "window_picker.py"),
            ("missing_desktop", lambda r: os.remove(os.path.join(r, "desktop", "org.kde.tessera.desktop")), "org.kde.tessera.desktop"),
            ("missing_icon", lambda r: os.remove(os.path.join(r, "desktop", "tessera.svg")), "tessera.svg"),
            ("missing_shortcuts_json", lambda r: os.remove(os.path.join(r, "config", "shortcuts.json")), "shortcuts.json"),
        ]

        for case_name, mutate_fn, expected_diag in inventory_cases:
            with self.subTest(source_inventory_case=case_name):
                with tempfile.TemporaryDirectory(prefix=f"tessera-src-preflight-{case_name}-") as disp_tmp:
                    disp_repo = os.path.join(disp_tmp, "repo")
                    shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns("node_modules", ".git"))
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
                    shutil.copytree(REPO_ROOT, disp_repo, symlinks=True, ignore=shutil.ignore_patterns("node_modules", ".git"))

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

        # Fail during launcher replacement
        launcher = os.path.join(self.sb.bin_home, "tessera-settings")
        res_fail = self.sb.run_installer(extra_env={"MOCK_FAIL_MV_TARGET": launcher})
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

        legacy_tesserarc = os.path.join(self.sb.config_home, "tesserarc")
        legacy_backup = os.path.join(self.sb.config_home, "tessera_migration_backup.json")
        with open(legacy_tesserarc, "w") as f: f.write("saved tesserarc")
        with open(legacy_backup, "w") as f: f.write("saved backup")

        # Test unknown argument rejection
        res_unk = self.sb.run_uninstaller(args=["--unknown-flag"])
        self.assertEqual(res_unk.returncode, 2)
        self.assertTrue(os.path.exists(os.path.join(self.sb.bin_home, "tessera-settings")))

        # Run uninstall (no purge)
        res_un = self.sb.run_uninstaller()
        self.assertEqual(res_un.returncode, 0, res_un.stderr)
        self.assertIn("saved layout settings were preserved", res_un.stdout)

        # Targets removed
        self.assertFalse(os.path.exists(os.path.join(self.sb.data_home, "kwin", "scripts", "tessera")))
        self.assertFalse(os.path.exists(os.path.join(self.sb.data_home, "tessera")))
        self.assertFalse(os.path.exists(os.path.join(self.sb.bin_home, "tessera-settings")))

        # Plugin disabled
        has_plug, plug_val = self.sb.get_kconfig("kwinrc", "Plugins", "tesseraEnabled")
        self.assertTrue(has_plug)
        self.assertEqual(plug_val, "false")

        # Shortcuts removed
        first_shortcut = self.shortcuts_doc["shortcuts"][0]["name"]
        has_sc, _ = self.sb.get_kconfig("kglobalshortcutsrc", "kwin", first_shortcut)
        self.assertFalse(has_sc)

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
                    sub_sb.set_kconfig("kglobalshortcutsrc", "kwin", "Tessera: Next Layout", "Meta+N,Meta+N,Next Layout")

                    extra_env = {}
                    if fail_kind == "missing_tool":
                        ctrl_path = sub_sb.make_controlled_path(omit="kwriteconfig6")
                        extra_env["PATH"] = ctrl_path
                    elif fail_kind == "plugin_fail":
                        sub_sb.add_fail_rule("kwriteconfig6", file="kwinrc", group="Plugins", key="tesseraEnabled", mode="fail_before", exit_code=1, once=False)
                    elif fail_kind == "shortcut_fail":
                        sub_sb.add_fail_rule("kwriteconfig6", file="kglobalshortcutsrc", group="kwin", key="Tessera: Next Layout", mode="fail_before", exit_code=1, once=False)

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


if __name__ == "__main__":
    unittest.main()


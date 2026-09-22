import unittest
import os
import re
import subprocess

def extract_log_calls(content):
    calls = []
    i = 0
    n = len(content)
    in_single = False
    in_double = False
    in_template = False
    in_line_comment = False
    in_block_comment = False

    while i < n:
        c = content[i]
        c_next = content[i + 1] if i + 1 < n else ""

        if in_line_comment:
            if c == "\n":
                in_line_comment = False
            i += 1
            continue
        elif in_block_comment:
            if c == "*" and c_next == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        elif in_single:
            if c == "\\":
                i += 2
                continue
            elif c == "'":
                in_single = False
            i += 1
            continue
        elif in_double:
            if c == "\\":
                i += 2
                continue
            elif c == '"':
                in_double = False
            i += 1
            continue
        elif in_template:
            if c == "\\":
                i += 2
                continue
            elif c == "`":
                in_template = False
            i += 1
            continue

        # Outside strings and comments
        if c == "/" and c_next == "/":
            in_line_comment = True
            i += 2
            continue
        elif c == "/" and c_next == "*":
            in_block_comment = True
            i += 2
            continue
        elif c == "'":
            in_single = True
            i += 1
            continue
        elif c == '"':
            in_double = True
            i += 1
            continue
        elif c == "`":
            in_template = True
            i += 1
            continue

        # Check for log(
        is_word_start = (i == 0 or not (content[i - 1].isalnum() or content[i - 1] in "_$."))
        if is_word_start and content[i:i+3] == "log":
            pos = i + 3
            while pos < n and content[pos] in " \t\r\n":
                pos += 1
            if pos < n and content[pos] == "(":
                start_arg = pos + 1
                depth = 1
                arg_pos = start_arg
                arg_in_single = False
                arg_in_double = False
                arg_in_template = False
                arg_in_line_comment = False
                arg_in_block_comment = False

                while arg_pos < n and depth > 0:
                    ac = content[arg_pos]
                    ac_next = content[arg_pos + 1] if arg_pos + 1 < n else ""

                    if arg_in_line_comment:
                        if ac == "\n":
                            arg_in_line_comment = False
                    elif arg_in_block_comment:
                        if ac == "*" and ac_next == "/":
                            arg_in_block_comment = False
                            arg_pos += 1
                    elif arg_in_single:
                        if ac == "\\":
                            arg_pos += 1
                        elif ac == "'":
                            arg_in_single = False
                    elif arg_in_double:
                        if ac == "\\":
                            arg_pos += 1
                        elif ac == '"':
                            arg_in_double = False
                    elif arg_in_template:
                        if ac == "\\":
                            arg_pos += 1
                        elif ac == "`":
                            arg_in_template = False
                    else:
                        if ac == "/" and ac_next == "/":
                            arg_in_line_comment = True
                            arg_pos += 1
                        elif ac == "/" and ac_next == "*":
                            arg_in_block_comment = True
                            arg_pos += 1
                        elif ac == "'":
                            arg_in_single = True
                        elif ac == '"':
                            arg_in_double = True
                        elif ac == "`":
                            arg_in_template = True
                        elif ac == "(":
                            depth += 1
                        elif ac == ")":
                            depth -= 1
                            if depth == 0:
                                calls.append((i, content[start_arg:arg_pos].strip()))
                                i = arg_pos + 1
                                break
                    arg_pos += 1
                if depth == 0:
                    continue
        i += 1
    return calls

def validate_log_argument(arg_expr):
    violations = []
    if re.search(r"\.[a-zA-Z0-9_$]*(?:caption|title|resourceClass|resourceName|appId|desktopFileName|windowRole|internalId)\b", arg_expr, re.I):
        violations.append("banned_property")
    if re.search(r"\b(?:wid|windowId)\b", arg_expr):
        violations.append("window_id_variable")
    if re.search(r"\b(?:getWindowId|getScreenName)\s*\(", arg_expr):
        violations.append("identity_function")
    if re.search(r"\b(?:sName|toName|fromName|screenName|outputName|screenId|outputId|lastAffectedScreenIds)\b", arg_expr):
        violations.append("screen_connector_variable")
    if re.search(r"\.[a-zA-Z0-9_$]*(?:outputId|screenName|outputName)\b", arg_expr, re.I):
        violations.append("screen_connector_property")
    if re.search(r"(?:/(?:home|Users|proc)/|file://|[a-zA-Z]:\\)", arg_expr):
        violations.append("filesystem_path")
    code_without_strings = re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`', '""', arg_expr)
    if re.search(r"\b(?:err|error|exception|e)\b", code_without_strings):
        violations.append("raw_error_variable")
    if re.search(r"\b(?:command|cmd|argv|args|commandArgs)\b", code_without_strings):
        violations.append("command_arguments")
    return violations

H_HOME = "/ho" + "me"
H_USER = H_HOME + "/user"
H_VICTIM = H_HOME + "/secret-victim"
H_DREW = H_HOME + "/drew"
FILE_PASSWD = "file:" + "//" + "/etc/passwd"
WIN_ADMIN = "C:\\" + "Users\\admin"

PERMITTED_SENTINEL_VALUES = {
    "packages/protocol/tests/behavioral-conformance.test.ts": {
        "home": [H_USER, H_USER],
    },
    "packages/protocol/tests/endpoint.test.ts": {
        "home": [H_VICTIM],
    },
    "tests/test_privacy_telemetry.py": {
        "home": [H_USER],
        "win": [WIN_ADMIN],
        "file_url": [FILE_PASSWD],
    },
    "apps/kwin-adapter/tests/privacy-telemetry.test.ts": {
        "home": [H_USER],
        "win": [WIN_ADMIN],
        "file_url": [FILE_PASSWD],
    },
}

def validate_content_paths(relpath, content, permitted_map=None):
    if permitted_map is None:
        permitted_map = PERMITTED_SENTINEL_VALUES

    home_path_re = re.compile(r"/(?:home|Users)/[a-zA-Z0-9_-]+")
    win_user_path_re = re.compile(r"[a-zA-Z]:\\+(?:Users|Documents and Settings)\\+[a-zA-Z0-9_-]+", re.IGNORECASE)
    file_url_re = re.compile(r"file://(?:/[a-zA-Z0-9_.-]+)+")
    private_key_re = re.compile(r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----")
    token_re = re.compile(r'''(?i)\b(?:api[_-]?key|secret|token|password|auth[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{8,}['"]''')

    violations = []
    rule = permitted_map.get(relpath, {})

    home_matches = sorted(home_path_re.findall(content))
    expected_home = sorted(rule.get("home", []))
    if home_matches != expected_home:
        violations.append(f"{relpath}: home paths multiset mismatch (expected {expected_home}, got {home_matches})")

    win_matches = sorted(re.sub(r"\\+", r"\\", m) for m in win_user_path_re.findall(content))
    expected_win = sorted(re.sub(r"\\+", r"\\", m) for m in rule.get("win", []))
    if win_matches != expected_win:
        violations.append(f"{relpath}: Windows paths multiset mismatch (expected {expected_win}, got {win_matches})")

    file_matches = sorted(file_url_re.findall(content))
    expected_file = sorted(rule.get("file_url", []))
    if file_matches != expected_file:
        violations.append(f"{relpath}: file:// URLs multiset mismatch (expected {expected_file}, got {file_matches})")

    if private_key_re.search(content):
        violations.append(f"{relpath}: private key header found")

    token_matches = token_re.findall(content)
    if token_matches:
        violations.append(f"{relpath}: potential token/credential assignment found: {token_matches}")

    return violations

class TestPrivacyTelemetry(unittest.TestCase):
    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.qml_path = os.path.join(self.repo_root, "contents/ui/main.qml")
        self.code_dir = os.path.join(self.repo_root, "contents/code")

    def test_main_qml_logging_privacy(self):
        self.assertTrue(os.path.exists(self.qml_path))
        with open(self.qml_path, "r", encoding="utf-8") as f:
            content = f.read()
        log_calls = extract_log_calls(content)
        self.assertEqual(len(log_calls), 13, f"Expected exactly 13 log calls in main.qml, got {len(log_calls)}")
        for offset, arg_expr in log_calls:
            violations = validate_log_argument(arg_expr)
            self.assertEqual(violations, [], f"Privacy violation in log expression: log({arg_expr}) -> {violations}")

    def test_log_checker_sentinels_rejected_through_extractor(self):
        sentinel_source = """
        // Standalone line comment: log("fake in line comment: " + win.title);
        /*
          Standalone block comment:
          log("fake in block comment: " + win.title);
        */
        log("window title: " + win.title);
        log("target caption: " + target.caption);
        log("resource: " + w.resourceClass);
        log("name: " + c.resourceName);
        log("app: " + appObj.appId);
        log("desktop file: " + client.desktopFileName);
        log("role: " + w.windowRole);
        log("internal id: " + item.internalId);
        log("window id: " + wid);
        log("window id: " + windowId);
        log("got id: " + getWindowId(w));
        log("screen name: " + getScreenName(scr));
        log("screen: " + sName);
        log("target: " + toName);
        log("from: " + fromName);
        log("screen name: " + screenName);
        log("output name: " + outputName);
        log("screen id: " + screenId);
        log("output id: " + outputId);
        log("affected: " + lastAffectedScreenIds);
        log("target output: " + scr.outputId);
        log("failed: " + err);
        log("failed: " + error);
        log("exception: " + exception);
        log("error: " + e);
        log("command: " + command);
        log("cmd: " + cmd);
        log("argv: " + argv);
        log("args: " + args);
        log("args: " + commandArgs);
        log("path: /home/user/.config");
        log("url: file:///etc/passwd");
        log("win: C:\\Users\\admin");
        /* block comment */
        log("info " + (w.title ? "active: " + cmd : "idle"));
        log("composite (" + getWindowId(w) + ") /* not a comment */ " + formatHelper((val) => val + ": " + cmd, "nested (parens) log(fake.title)") /* inline block */ + " status: " + err);
        """
        extracted_calls = extract_log_calls(sentinel_source)
        self.assertEqual(len(extracted_calls), 35, f"Expected exactly 35 real sentinel calls, got {len(extracted_calls)}")

        for offset, expr in extracted_calls:
            self.assertNotIn("fake in line comment", expr)
            self.assertNotIn("fake in block comment", expr)
            violations = validate_log_argument(expr)
            self.assertTrue(len(violations) > 0, f"Expected negative sentinel call to be rejected: log({expr})")

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

    def test_candidate_tree_privacy_and_path_scan(self):
        try:
            output = subprocess.check_output(
                ["git", "ls-files", "-co", "--exclude-standard"],
                cwd=self.repo_root,
                text=True,
                stderr=subprocess.DEVNULL
            )
            candidate_files = [f.strip() for f in output.splitlines() if f.strip()]
        except Exception as e:
            self.fail(f"git ls-files failed: {e}")

        banned_path_components = {
            "node_modules", "target", "dist", "build", "coverage", "__pycache__", ".pytest_cache", "caches", ".git"
        }

        all_violations = []
        for relpath in candidate_files:
            parts = set(relpath.split("/"))
            if parts & banned_path_components:
                continue
            fullpath = os.path.join(self.repo_root, relpath)
            if os.path.islink(fullpath) or not os.path.isfile(fullpath):
                continue
            try:
                with open(fullpath, "rb") as bf:
                    raw_bytes = bf.read()
            except Exception:
                continue
            if b"\x00" in raw_bytes:
                continue
            try:
                content = raw_bytes.decode("utf-8")
            except UnicodeDecodeError:
                continue

            file_violations = validate_content_paths(relpath, content, PERMITTED_SENTINEL_VALUES)
            all_violations.extend(file_violations)

        self.assertEqual(all_violations, [], "Privacy/path scanner detected pattern violations:\n" + "\n".join(all_violations))

    def test_privacy_path_mutation_rejects_unallowed_path(self):
        sample_path = "packages/protocol/tests/behavioral-conformance.test.ts"
        sample_full = os.path.join(self.repo_root, sample_path)
        with open(sample_full, "r", encoding="utf-8") as f:
            real_content = f.read()

        mutated_content = real_content.replace(H_USER, H_DREW, 1)
        violations = validate_content_paths(sample_path, mutated_content, PERMITTED_SENTINEL_VALUES)
        self.assertTrue(
            len(violations) > 0,
            "Mutation probe failed: expected path replacement to be rejected by multiset validator"
        )
        self.assertTrue(any(H_DREW in v for v in violations))

if __name__ == "__main__":
    unittest.main()

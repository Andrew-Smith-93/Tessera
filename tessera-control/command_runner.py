"""
Tessera Command Runner
Provides a robust, testable interface for executing KDE system utilities (kreadconfig6, kwriteconfig6, qdbus6).
Uses dynamic PATH discovery and captures structured execution results.
"""

import shutil
import subprocess
from typing import List, Optional

class CommandResult:
    def __init__(self, returncode: int, stdout: str, stderr: str, command: List[str]):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.command = command

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    def __repr__(self) -> str:
        return f"<CommandResult ok={self.ok} returncode={self.returncode} cmd='{' '.join(self.command)}'>"

class CommandError(Exception):
    def __init__(self, message: str, result: Optional[CommandResult] = None):
        super().__init__(message)
        self.result = result

class CommandRunner:
    def __init__(self, timeout: float = 5.0):
        self.timeout = timeout

    def find_executable(self, name: str) -> Optional[str]:
        return shutil.which(name)

    def run(self, cmd: List[str], check: bool = True) -> CommandResult:
        if not cmd:
            raise CommandError("Cannot run empty command")

        exe = self.find_executable(cmd[0])
        if not exe:
            raise CommandError(f"Required utility '{cmd[0]}' not found in PATH")

        actual_cmd = [exe] + cmd[1:]
        try:
            res = subprocess.run(
                actual_cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout
            )
            result = CommandResult(
                returncode=res.returncode,
                stdout=res.stdout.strip(),
                stderr=res.stderr.strip(),
                command=actual_cmd
            )
            if check and not result.ok:
                raise CommandError(
                    f"Command '{' '.join(actual_cmd)}' failed with exit code {result.returncode}: {result.stderr}",
                    result
                )
            return result
        except subprocess.TimeoutExpired as e:
            raise CommandError(f"Command '{' '.join(actual_cmd)}' timed out after {self.timeout}s") from e
        except OSError as e:
            raise CommandError(f"Failed to execute '{' '.join(actual_cmd)}': {e}") from e

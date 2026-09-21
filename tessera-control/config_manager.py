"""
Tessera Configuration Manager
Synchronizes settings between the Control Center GUI, ~/.config/tesserarc, and KWin's kwinrc.
"""

import os
import json
import subprocess

CONFIG_FILE = os.path.expanduser("~/.config/tesserarc")
KWINRC_GROUP = "Script-tessera"

DEFAULT_CONFIG = {
    "enableTiling": True,
    "defaultLayout": "master-stack",
    "gapInner": 8,
    "gapOuter": 10,
    "masterRatio": 0.55,
    "masterCount": 1,
    "perDesktopLayout": True,
    "tileNewWindows": True,
    "showOsd": True,
    "nvidiaDebounceMs": 60,
    "smoothResize": False,
    "ignoreMinimized": True,
    "floatFilter": "tessera,tessera-settings,tessera_settings.py",
    "customRules": [],
    "desktopLayouts": {
        "1": "master-stack",
        "2": "bsp",
        "3": "columns",
        "4": "floating"
    }
}

class ConfigManager:
    def __init__(self):
        self.config = DEFAULT_CONFIG.copy()
        self.load()

    def load(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    user_cfg = json.load(f)
                    self.config.update(user_cfg)
            except Exception as e:
                print(f"[Tessera Config] Error reading {CONFIG_FILE}: {e}")
        else:
            self.save()

    def save(self):
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=4)
        except Exception as e:
            print(f"[Tessera Config] Error writing {CONFIG_FILE}: {e}")

        # Synchronize with KWin kwinrc
        self.sync_to_kwin()

    def sync_to_kwin(self):
        """Write key parameters to ~/.config/kwinrc using kwriteconfig6 and trigger reload."""
        try:
            kwrite = "/usr/bin/kwriteconfig6"
            if not os.path.exists(kwrite):
                return

            def write_val(key, val, type_arg=None):
                cmd = [kwrite, "--file", "kwinrc", "--group", KWINRC_GROUP, "--key", key]
                if type_arg:
                    cmd.extend(["--type", type_arg])
                cmd.append(str(val))
                subprocess.run(cmd, check=False)

            write_val("enableTiling", "true" if self.config.get("enableTiling") else "false", "bool")
            write_val("defaultLayout", self.config.get("defaultLayout", "master-stack"))
            write_val("gapInner", self.config.get("gapInner", 8), "int")
            write_val("gapOuter", self.config.get("gapOuter", 10), "int")
            write_val("masterRatio", self.config.get("masterRatio", 0.55))
            write_val("masterCount", self.config.get("masterCount", 1), "int")
            write_val("nvidiaDebounceMs", self.config.get("nvidiaDebounceMs", 60), "int")
            write_val("smoothResize", "true" if self.config.get("smoothResize") else "false", "bool")
            write_val("showOsd", "true" if self.config.get("showOsd") else "false", "bool")
            write_val("floatFilter", self.config.get("floatFilter", "tessera,tessera-settings,tessera_settings.py"))
            write_val("customRulesJson", json.dumps(self.config.get("customRules", [])))
            write_val("desktopLayoutsJson", json.dumps(self.config.get("desktopLayouts", {})))

            # Signal KWin to reload configuration
            subprocess.run(["qdbus6", "org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)

            # Also invoke shortcut directly to force immediate script recomputation
            subprocess.run(["qdbus6", "org.kde.kglobalaccel", "/component/kwin",
                            "org.kde.kglobalaccel.Component.invokeShortcut", "Tessera: Retile Current Workspace"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        except Exception as e:
            print(f"[Tessera Config] Error syncing to KWin: {e}")

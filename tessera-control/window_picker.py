"""
Window Inspector Helper
Queries KWin / X11 / Wayland for active window metadata (class, title)
to make custom window rule creation effortless.
"""

import subprocess
import re

def get_active_window_info():
    """Returns a dict {'class': str, 'title': str} of the currently active window."""
    info = {"class": "", "title": ""}

    # 1. Try X11 xprop
    try:
        root_out = subprocess.check_output(["xprop", "-root", "_NET_ACTIVE_WINDOW"], text=True)
        match = re.search(r"_NET_ACTIVE_WINDOW\(WINDOW\): window id # (0x[0-9a-fA-F]+)", root_out)
        if match:
            win_id = match.group(1)
            win_out = subprocess.check_output(["xprop", "-id", win_id, "WM_CLASS", "_NET_WM_NAME", "WM_NAME"], text=True)

            # Extract WM_CLASS
            class_match = re.search(r'WM_CLASS\(STRING\) = "(.*?)", "(.*?)"', win_out)
            if class_match:
                info["class"] = class_match.group(2) or class_match.group(1)

            # Extract Name
            name_match = re.search(r'(_NET_WM_NAME|WM_NAME)\(.*?\) = "(.*?)"', win_out)
            if name_match:
                info["title"] = name_match.group(2)

            if info["class"]:
                return info
    except Exception:
        pass

    # 2. Try KWin DBus queryWindowInfo fallback
    try:
        dbus_out = subprocess.check_output(["qdbus6", "org.kde.KWin", "/KWin", "queryWindowInfo"], text=True)
        for line in dbus_out.splitlines():
            if "resourceClass" in line:
                info["class"] = line.split(":", 1)[1].strip()
            elif "caption" in line:
                info["title"] = line.split(":", 1)[1].strip()
        if info["class"]:
            return info
    except Exception:
        pass

    return info

#!/usr/bin/env python3
"""
Tessera Control Center
The intuitive, modern configuration interface for Tessera Tiling Window Manager on KDE Plasma 6.
"""

import sys
import os
import subprocess
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QPushButton, QSlider, QSpinBox, QCheckBox, QTabWidget,
    QTableWidget, QTableWidgetItem, QHeaderView, QComboBox, QLineEdit,
    QMessageBox, QFrame, QScrollArea, QGroupBox, QGridLayout, QDialog
)
from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QFont, QIcon, QColor, QGuiApplication

from config_manager import ConfigManager
from ui_preview import LiveDesktopPreview
from window_picker import get_active_window_info

APP_STYLESHEET = """
QMainWindow {
    background-color: #1e222b;
}
QWidget {
    color: #eff0f1;
    font-family: 'Noto Sans', 'Segoe UI', sans-serif;
    font-size: 10pt;
}
QTabWidget::pane {
    border: 1px solid #31363b;
    background-color: #232629;
    border-radius: 8px;
    padding: 10px;
}
QTabBar::tab {
    background: #1e222b;
    color: #a0a6ad;
    padding: 10px 18px;
    border-top-left-radius: 6px;
    border-top-right-radius: 6px;
    margin-right: 4px;
    font-weight: 500;
}
QTabBar::tab:selected {
    background: #232629;
    color: #3daee9;
    border-bottom: 2px solid #3daee9;
}
QTabBar::tab:hover {
    color: #eff0f1;
}
QGroupBox {
    border: 1px solid #31363b;
    border-radius: 8px;
    margin-top: 18px;
    padding-top: 14px;
    font-weight: bold;
    color: #3daee9;
}
QGroupBox::title {
    subcontrol-origin: margin;
    subcontrol-position: top left;
    left: 12px;
    padding: 0 6px;
}
QPushButton {
    background-color: #31363b;
    border: 1px solid #474f56;
    border-radius: 6px;
    padding: 7px 16px;
    color: #eff0f1;
    font-weight: 500;
}
QPushButton:hover {
    background-color: #3daee9;
    border-color: #3daee9;
    color: #ffffff;
}
QPushButton:pressed {
    background-color: #2b84b5;
}
QPushButton#primaryBtn {
    background-color: #1b668f;
    border: 1px solid #3daee9;
    color: #ffffff;
    font-weight: bold;
}
QPushButton#primaryBtn:hover {
    background-color: #3daee9;
}
QSlider::groove:horizontal {
    height: 6px;
    background: #31363b;
    border-radius: 3px;
}
QSlider::sub-page:horizontal {
    background: #3daee9;
    border-radius: 3px;
}
QSlider::handle:horizontal {
    background: #eff0f1;
    width: 16px;
    margin-top: -5px;
    margin-bottom: -5px;
    border-radius: 8px;
}
QSlider::handle:horizontal:hover {
    background: #3daee9;
}
QTableWidget {
    background-color: #1e222b;
    border: 1px solid #31363b;
    border-radius: 6px;
    gridline-color: #31363b;
}
QTableWidget::item:selected {
    background-color: #1b668f;
}
QHeaderView::section {
    background-color: #2b2e33;
    padding: 6px;
    border: 1px solid #31363b;
    font-weight: bold;
}
QLineEdit, QComboBox, QSpinBox {
    background-color: #1e222b;
    border: 1px solid #474f56;
    border-radius: 6px;
    padding: 6px;
    color: #eff0f1;
}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus {
    border: 1px solid #3daee9;
}
"""

class LayoutCard(QFrame):
    def __init__(self, layout_id, title, desc, parent_window):
        super().__init__()
        self.layout_id = layout_id
        self.parent_window = parent_window
        self.setFrameShape(QFrame.StyledPanel)
        self.setCursor(Qt.PointingHandCursor)
        self.setStyleSheet("""
            QFrame {
                background-color: #282c34;
                border: 2px solid #3a3f4b;
                border-radius: 8px;
                padding: 10px;
            }
            QFrame:hover {
                border-color: #3daee9;
                background-color: #2c323c;
            }
        """)

        layout = QVBoxLayout(self)
        self.title_lbl = QLabel(title)
        self.title_lbl.setFont(QFont("SansSerif", 11, QFont.Bold))
        self.desc_lbl = QLabel(desc)
        self.desc_lbl.setStyleSheet("color: #a0a6ad; font-size: 9pt;")
        self.desc_lbl.setWordWrap(True)

        layout.addWidget(self.title_lbl)
        layout.addWidget(self.desc_lbl)

    def mousePressEvent(self, event):
        self.parent_window.select_default_layout(self.layout_id)

    def set_selected(self, selected):
        if selected:
            self.setStyleSheet("""
                QFrame {
                    background-color: #1e3a50;
                    border: 2px solid #3daee9;
                    border-radius: 8px;
                    padding: 10px;
                }
            """)
            self.title_lbl.setStyleSheet("color: #3daee9;")
        else:
            self.setStyleSheet("""
                QFrame {
                    background-color: #282c34;
                    border: 2px solid #3a3f4b;
                    border-radius: 8px;
                    padding: 10px;
                }
                QFrame:hover {
                    border-color: #3daee9;
                    background-color: #2c323c;
                }
            """)
            self.title_lbl.setStyleSheet("color: #eff0f1;")

class MasterScreensTestDialog(QDialog):
    def __init__(self, parent=None, cfg_mgr=None):
        super().__init__(parent)
        self.setWindowTitle("Tessera — Master Windows & Multi-Screen Testing")
        self.setFixedSize(580, 480)
        self.setStyleSheet(APP_STYLESHEET)
        self.cfg_mgr = cfg_mgr

        layout = QVBoxLayout(self)
        layout.setSpacing(14)

        header = QLabel("🖥️ Multi-Screen Master Window Configuration & Testing")
        header.setFont(QFont("SansSerif", 11, QFont.Bold))
        header.setStyleSheet("color: #3daee9;")
        layout.addWidget(header)

        # Screen Selection
        scr_grp = QGroupBox("Target Display / Monitor")
        scr_layout = QHBoxLayout(scr_grp)
        self.scr_combo = QComboBox()

        # Detect connected screens
        self.screens = []
        try:
            q_screens = QGuiApplication.screens()
            for s in q_screens:
                geo = s.geometry()
                self.screens.append({"name": s.name(), "w": geo.width(), "h": geo.height(), "x": geo.x(), "y": geo.y()})
                self.scr_combo.addItem(f"{s.name()} ({geo.width()}x{geo.height()} at +{geo.x()}+{geo.y()})")
        except Exception:
            self.screens = [{"name": "HDMI-0", "w": 1920, "h": 1080, "x": 0, "y": 0}, {"name": "DP-4", "w": 1920, "h": 1080, "x": 1920, "y": 0}]
            self.scr_combo.addItems(["HDMI-0 (1920x1080 at +0+0)", "DP-4 (1920x1080 at +1920+0)"])

        scr_layout.addWidget(QLabel("Select Monitor:"))
        scr_layout.addWidget(self.scr_combo, 1)
        layout.addWidget(scr_grp)

        # Master Windows Configuration for Selected Screen
        cfg_grp = QGroupBox("Master Windows for Selected Monitor")
        cfg_layout = QGridLayout(cfg_grp)

        cfg_layout.addWidget(QLabel("Number of Master Windows (0 = Balanced Grid):"), 0, 0)
        self.spin_masters = QSpinBox()
        self.spin_masters.setRange(0, 5)
        self.spin_masters.setValue(self.cfg_mgr.config.get("masterCount", 1) if self.cfg_mgr else 1)
        self.spin_masters.valueChanged.connect(self.update_preview)
        cfg_layout.addWidget(self.spin_masters, 0, 1)

        cfg_layout.addWidget(QLabel("Master Width Ratio (%):"), 1, 0)
        self.slider_ratio = QSlider(Qt.Horizontal)
        self.slider_ratio.setRange(20, 80)
        self.slider_ratio.setValue(int(self.cfg_mgr.config.get("masterRatio", 0.50) * 100) if self.cfg_mgr else 50)
        self.lbl_ratio = QLabel(f"{self.slider_ratio.value()}%")
        self.lbl_ratio.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.slider_ratio.valueChanged.connect(lambda v: (self.lbl_ratio.setText(f"{v}%"), self.update_preview()))
        ratio_box = QHBoxLayout()
        ratio_box.addWidget(self.lbl_ratio)
        ratio_box.addWidget(self.slider_ratio, 1)
        cfg_layout.addLayout(ratio_box, 1, 1)

        layout.addWidget(cfg_grp)

        # Live Mini Diagram
        self.preview_widget = LiveDesktopPreview()
        self.preview_widget.setFixedHeight(150)
        layout.addWidget(self.preview_widget)

        # Buttons
        btn_layout = QHBoxLayout()
        self.btn_trigger_hud = QPushButton("▶ Trigger Live On-Screen HUD Popup")
        self.btn_trigger_hud.setStyleSheet("background-color: #2b3b4c; color: #3daee9; font-weight: bold; padding: 8px; border-radius: 4px;")
        self.btn_trigger_hud.clicked.connect(self.trigger_hud)

        self.btn_apply = QPushButton("Apply to Monitor & Retile")
        self.btn_apply.setStyleSheet("background-color: #3daee9; color: #000000; font-weight: bold; padding: 8px; border-radius: 4px;")
        self.btn_apply.clicked.connect(self.apply_to_monitor)

        btn_layout.addWidget(self.btn_trigger_hud)
        btn_layout.addWidget(self.btn_apply)
        layout.addLayout(btn_layout)

        self.update_preview()

    def update_preview(self):
        m_count = self.spin_masters.value()
        m_ratio = self.slider_ratio.value() / 100.0
        gi = self.cfg_mgr.config.get("gapInner", 8) if self.cfg_mgr else 8
        go = self.cfg_mgr.config.get("gapOuter", 10) if self.cfg_mgr else 10
        self.preview_widget.update_params("master-stack", gi, go, m_ratio, m_count)

    def trigger_hud(self):
        subprocess.run(["qdbus6", "org.kde.kglobalaccel", "/component/kwin", "invokeShortcut", "Tessera: Show Master HUD"], capture_output=True)

    def apply_to_monitor(self):
        if not self.cfg_mgr:
            return
        m_count = self.spin_masters.value()
        m_ratio = self.slider_ratio.value() / 100.0
        self.cfg_mgr.config["masterCount"] = m_count
        self.cfg_mgr.config["masterRatio"] = m_ratio
        self.cfg_mgr.save()
        self.trigger_hud()
        self.accept()

class TesseraControlWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Tessera Control Center — KDE Plasma 6")
        self.resize(860, 680)
        self.setStyleSheet(APP_STYLESHEET)

        self.cfg_mgr = ConfigManager()
        self.layout_cards = {}

        self.auto_sync_timer = QTimer(self)
        self.auto_sync_timer.setSingleShot(True)
        self.auto_sync_timer.timeout.connect(self.save_and_apply)

        self.init_ui()
        self.load_settings_into_ui()

    def init_ui(self):
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        main_vbox = QVBoxLayout(central_widget)
        main_vbox.setContentsMargins(16, 16, 16, 16)
        main_vbox.setSpacing(12)

        # Header Bar
        header_hbox = QHBoxLayout()
        title_vbox = QVBoxLayout()
        app_title = QLabel("TESSERA CONTROL CENTER")
        app_title.setFont(QFont("SansSerif", 14, QFont.Bold))
        app_title.setStyleSheet("color: #3daee9; letter-spacing: 1px;")
        app_sub = QLabel("Dynamic Tiling Window Manager for KDE Plasma 6 (NVIDIA Hardware Optimized)")
        app_sub.setStyleSheet("color: #8c939d; font-size: 9pt;")
        title_vbox.addWidget(app_title)
        title_vbox.addWidget(app_sub)

        header_hbox.addLayout(title_vbox)
        header_hbox.addStretch()

        self.enable_switch = QCheckBox("Enable Tiling")
        self.enable_switch.setFont(QFont("SansSerif", 11, QFont.Bold))
        self.enable_switch.setChecked(True)
        self.enable_switch.toggled.connect(self.on_enable_toggled)
        header_hbox.addWidget(self.enable_switch)

        main_vbox.addLayout(header_hbox)

        # Tabs
        self.tabs = QTabWidget()
        self.tabs.addTab(self.create_layouts_tab(), "📐 Layouts")
        self.tabs.addTab(self.create_gaps_tab(), "📏 Gaps & Geometry")
        self.tabs.addTab(self.create_workspaces_tab(), "🖥️ Workspaces")
        self.tabs.addTab(self.create_rules_tab(), "🎯 Window Rules")
        self.tabs.addTab(self.create_nvidia_tab(), "⚡ NVIDIA & Performance")
        self.tabs.addTab(self.create_shortcuts_tab(), "⌨️ Shortcuts")

        main_vbox.addWidget(self.tabs)

        # Footer Actions
        footer_hbox = QHBoxLayout()
        self.status_lbl = QLabel("Ready")
        self.status_lbl.setStyleSheet("color: #6c757d; font-style: italic;")
        footer_hbox.addWidget(self.status_lbl)
        footer_hbox.addStretch()

        self.reload_kwin_btn = QPushButton("🔄 Retile Now")
        self.reload_kwin_btn.clicked.connect(self.retile_kwin)
        footer_hbox.addWidget(self.reload_kwin_btn)

        self.save_btn = QPushButton("💾 Save & Apply")
        self.save_btn.setObjectName("primaryBtn")
        self.save_btn.clicked.connect(self.save_and_apply)
        footer_hbox.addWidget(self.save_btn)

        main_vbox.addLayout(footer_hbox)

    # -------------------------------------------------------------
    # TAB 1: Layouts
    # -------------------------------------------------------------
    def create_layouts_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        lbl = QLabel("Select Default Tiling Layout:")
        lbl.setFont(QFont("SansSerif", 11, QFont.Bold))
        layout.addWidget(lbl)

        grid = QGridLayout()
        grid.setSpacing(12)

        card_defs = [
            ("master-stack", "Master + Stack", "Primary master pane on left; secondary windows stacked vertically on right."),
            ("bsp", "Binary Split (BSP)", "Alternates horizontal and vertical partitions recursively (Hyprland / Dwindle style)."),
            ("columns", "Columns", "Arranges all open windows into equal or weighted vertical columns."),
            ("rows", "Rows", "Arranges windows in horizontal bands across the screen."),
            ("grid", "Balanced Grid", "Optimal square tiles with no dominant master (4 quarters, 5-pane center stack)."),
            ("monocle", "Monocle (Deck)", "Full-screen working area for focused window with rapid cycle switching."),
            ("floating", "Floating Only", "Disables automatic placement; preserves manual floating window positions.")
        ]

        row = 0
        col = 0
        for lid, title, desc in card_defs:
            card = LayoutCard(lid, title, desc, self)
            self.layout_cards[lid] = card
            grid.addWidget(card, row, col)
            col += 1
            if col > 1:
                col = 0
                row += 1

        layout.addLayout(grid)

        # Behavior options
        grp = QGroupBox("Layout Behavior")
        grp_layout = QVBoxLayout(grp)
        self.tile_new_chk = QCheckBox("Automatically tile newly spawned windows")
        self.ignore_minimized_chk = QCheckBox("Ignore minimized windows during tile redistribution")
        grp_layout.addWidget(self.tile_new_chk)
        grp_layout.addWidget(self.ignore_minimized_chk)
        layout.addWidget(grp)

        layout.addStretch()
        return tab

    def select_default_layout(self, layout_id):
        self.cfg_mgr.config["defaultLayout"] = layout_id
        for lid, card in self.layout_cards.items():
            card.set_selected(lid == layout_id)
        self.refresh_preview()
        self.set_status(f"Default layout set to: {layout_id}")

    # -------------------------------------------------------------
    # TAB 2: Gaps & Geometry (With Live Preview)
    # -------------------------------------------------------------
    def create_gaps_tab(self):
        tab = QWidget()
        layout = QHBoxLayout(tab)
        layout.setSpacing(16)

        # Controls VBox
        ctrl_vbox = QVBoxLayout()

        # Inner Gap
        inner_grp = QGroupBox("Inner Gap (Spacing between windows)")
        ig_layout = QVBoxLayout(inner_grp)
        self.inner_gap_val = QLabel("8 px")
        self.inner_gap_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.inner_gap_slider = QSlider(Qt.Horizontal)
        self.inner_gap_slider.setRange(0, 40)
        self.inner_gap_slider.setValue(8)
        self.inner_gap_slider.valueChanged.connect(self.on_inner_gap_changed)
        ig_layout.addWidget(self.inner_gap_val)
        ig_layout.addWidget(self.inner_gap_slider)
        ctrl_vbox.addWidget(inner_grp)

        # Outer Gap
        outer_grp = QGroupBox("Outer Gap (Screen edge margin)")
        og_layout = QVBoxLayout(outer_grp)
        self.outer_gap_val = QLabel("10 px")
        self.outer_gap_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.outer_gap_slider = QSlider(Qt.Horizontal)
        self.outer_gap_slider.setRange(0, 60)
        self.outer_gap_slider.setValue(10)
        self.outer_gap_slider.valueChanged.connect(self.on_outer_gap_changed)
        og_layout.addWidget(self.outer_gap_val)
        og_layout.addWidget(self.outer_gap_slider)
        ctrl_vbox.addWidget(outer_grp)

        # Master Ratio
        ratio_grp = QGroupBox("Master Ratio (%)")
        rg_layout = QVBoxLayout(ratio_grp)
        self.master_ratio_val = QLabel("55%")
        self.master_ratio_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.master_ratio_slider = QSlider(Qt.Horizontal)
        self.master_ratio_slider.setRange(20, 80)
        self.master_ratio_slider.setValue(55)
        self.master_ratio_slider.valueChanged.connect(self.on_master_ratio_changed)
        rg_layout.addWidget(self.master_ratio_val)
        rg_layout.addWidget(self.master_ratio_slider)
        ctrl_vbox.addWidget(ratio_grp)

        # Master Count
        count_grp = QGroupBox("Master Windows Count (0 = Balanced Grid)")
        cg_layout = QHBoxLayout(count_grp)
        self.master_count_spin = QSpinBox()
        self.master_count_spin.setRange(0, 5)
        self.master_count_spin.setValue(1)
        self.master_count_spin.valueChanged.connect(self.on_master_count_changed)
        cg_layout.addWidget(QLabel("Active Masters:"))
        cg_layout.addWidget(self.master_count_spin)
        ctrl_vbox.addWidget(count_grp)

        btn_test_dialog = QPushButton("🗔 Test Master Windows & Screens Dialog...")
        btn_test_dialog.setStyleSheet("background-color: #2b3b4c; color: #3daee9; font-weight: bold; padding: 6px; border-radius: 4px;")
        btn_test_dialog.clicked.connect(self.open_master_test_dialog)
        ctrl_vbox.addWidget(btn_test_dialog)

        ctrl_vbox.addStretch()
        layout.addLayout(ctrl_vbox, 1)

        # Live Preview VBox
        preview_vbox = QVBoxLayout()
        p_title = QLabel("LIVE DESKTOP PREVIEW")
        p_title.setFont(QFont("SansSerif", 10, QFont.Bold))
        p_title.setStyleSheet("color: #3daee9;")
        preview_vbox.addWidget(p_title)

        self.preview_widget = LiveDesktopPreview()
        preview_vbox.addWidget(self.preview_widget, 1)

        p_hint = QLabel("Adjust sliders above to observe spacing and margins in real-time.")
        p_hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        p_hint.setWordWrap(True)
        preview_vbox.addWidget(p_hint)

        layout.addLayout(preview_vbox, 1)
        return tab

    def on_inner_gap_changed(self, val):
        self.inner_gap_val.setText(f"{val} px")
        self.cfg_mgr.config["gapInner"] = val
        self.refresh_preview()
        self.auto_sync_timer.start(120)

    def on_outer_gap_changed(self, val):
        self.outer_gap_val.setText(f"{val} px")
        self.cfg_mgr.config["gapOuter"] = val
        self.refresh_preview()
        self.auto_sync_timer.start(120)

    def on_master_ratio_changed(self, val):
        self.master_ratio_val.setText(f"{val}%")
        self.cfg_mgr.config["masterRatio"] = val / 100.0
        self.refresh_preview()
        self.auto_sync_timer.start(120)

    def on_master_count_changed(self, val):
        self.cfg_mgr.config["masterCount"] = val
        self.refresh_preview()
        self.auto_sync_timer.start(120)

    def refresh_preview(self):
        dl = self.cfg_mgr.config.get("defaultLayout", "master-stack")
        gi = self.cfg_mgr.config.get("gapInner", 8)
        go = self.cfg_mgr.config.get("gapOuter", 10)
        mr = self.cfg_mgr.config.get("masterRatio", 0.50)
        mc = self.cfg_mgr.config.get("masterCount", 1)
        self.preview_widget.update_params(dl, gi, go, mr, mc)
        if hasattr(self, 'anim_preview_widget'):
            self.anim_preview_widget.update_params(dl, gi, go, mr, mc)

    # -------------------------------------------------------------
    # TAB 3: Workspaces
    # -------------------------------------------------------------
    def create_workspaces_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        self.per_desktop_chk = QCheckBox("Enable Independent Layouts per Virtual Desktop")
        self.per_desktop_chk.setChecked(True)
        layout.addWidget(self.per_desktop_chk)

        grp = QGroupBox("Virtual Desktop Layout Assignments")
        grp_layout = QGridLayout(grp)
        grp_layout.setSpacing(12)

        self.desk_combos = {}
        layouts_list = ["master-stack", "bsp", "columns", "rows", "monocle", "floating"]

        for d in range(1, 7):
            lbl = QLabel(f"Virtual Desktop {d}:")
            lbl.setFont(QFont("SansSerif", 10, QFont.Bold))
            cb = QComboBox()
            cb.addItems(layouts_list)
            self.desk_combos[str(d)] = cb

            row = (d - 1) // 2
            col = ((d - 1) % 2) * 2
            grp_layout.addWidget(lbl, row, col)
            grp_layout.addWidget(cb, row, col + 1)

        layout.addWidget(grp)
        layout.addStretch()
        return tab

    # -------------------------------------------------------------
    # TAB 4: Window Rules (Interactive)
    # -------------------------------------------------------------
    def create_rules_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        # Picker bar
        picker_box = QGroupBox("Interactive Window Rule Creator")
        p_layout = QHBoxLayout(picker_box)

        self.capture_btn = QPushButton("🎯 Capture Active Window")
        self.capture_btn.setStyleSheet("background-color: #2e5b88; font-weight: bold;")
        self.capture_btn.clicked.connect(self.capture_active_window)
        p_layout.addWidget(self.capture_btn)

        self.rule_pattern_edit = QLineEdit()
        self.rule_pattern_edit.setPlaceholderText("Window class or title (e.g. Steam, spotify, kcalc)")
        p_layout.addWidget(self.rule_pattern_edit, 2)

        self.rule_type_combo = QComboBox()
        self.rule_type_combo.addItems(["class", "title"])
        p_layout.addWidget(self.rule_type_combo)

        self.rule_action_combo = QComboBox()
        self.rule_action_combo.addItems(["float", "tile"])
        p_layout.addWidget(self.rule_action_combo)

        add_rule_btn = QPushButton("➕ Add Rule")
        add_rule_btn.clicked.connect(self.add_custom_rule)
        p_layout.addWidget(add_rule_btn)

        layout.addWidget(picker_box)

        # Rules Table
        self.rules_table = QTableWidget(0, 3)
        self.rules_table.setHorizontalHeaderLabels(["Pattern", "Match Type", "Action"])
        self.rules_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.rules_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.rules_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        layout.addWidget(self.rules_table)

        btn_bar = QHBoxLayout()
        del_rule_btn = QPushButton("🗑️ Remove Selected Rule")
        del_rule_btn.clicked.connect(self.remove_selected_rule)
        btn_bar.addWidget(del_rule_btn)
        btn_bar.addStretch()
        layout.addLayout(btn_bar)

        return tab

    def capture_active_window(self):
        self.set_status("Inspecting active window...")
        info = get_active_window_info()
        target = info.get("class") or info.get("title")
        if target:
            self.rule_pattern_edit.setText(target)
            self.rule_type_combo.setCurrentText("class" if info.get("class") else "title")
            self.set_status(f"Captured window: {target}")
        else:
            self.set_status("Focus the desired window, then click Capture again.")

    def add_custom_rule(self):
        pat = self.rule_pattern_edit.text().strip()
        if not pat:
            return
        mtype = self.rule_type_combo.currentText()
        act = self.rule_action_combo.currentText()

        rules = self.cfg_mgr.config.get("customRules", [])
        rules.append({"pattern": pat, "matchType": mtype, "action": act})
        self.cfg_mgr.config["customRules"] = rules
        self.populate_rules_table()
        self.rule_pattern_edit.clear()
        self.set_status(f"Added rule: {pat} -> {act}")

    def remove_selected_rule(self):
        row = self.rules_table.currentRow()
        if row >= 0:
            rules = self.cfg_mgr.config.get("customRules", [])
            if row < len(rules):
                del rules[row]
                self.cfg_mgr.config["customRules"] = rules
                self.populate_rules_table()
                self.set_status("Rule removed")

    def populate_rules_table(self):
        rules = self.cfg_mgr.config.get("customRules", [])
        self.rules_table.setRowCount(len(rules))
        for r_idx, rule in enumerate(rules):
            self.rules_table.setItem(r_idx, 0, QTableWidgetItem(rule.get("pattern", "")))
            self.rules_table.setItem(r_idx, 1, QTableWidgetItem(rule.get("matchType", "class")))
            act_item = QTableWidgetItem(rule.get("action", "float"))
            if rule.get("action") == "float":
                act_item.setForeground(QColor("#f67400"))
            else:
                act_item.setForeground(QColor("#27ae60"))
            self.rules_table.setItem(r_idx, 2, act_item)

    # -------------------------------------------------------------
    # TAB 5: NVIDIA & Performance
    # -------------------------------------------------------------
    def create_nvidia_tab(self):
        tab = QWidget()
        layout = QHBoxLayout(tab)
        layout.setSpacing(16)

        left_vbox = QVBoxLayout()

        grp = QGroupBox("Performance & Hardware Tuning (NVIDIA Optimized)")
        g_layout = QVBoxLayout(grp)
        g_layout.setSpacing(12)

        lbl_desc = QLabel(
            "Tessera includes dedicated geometry pipeline tuning specifically for NVIDIA Pascal/Turing/Ampere/Ada "
            "GPUs on KDE Plasma 6 (X11 & Wayland) to eliminate resize flicker, frame drops, and latency."
        )
        lbl_desc.setWordWrap(True)
        lbl_desc.setStyleSheet("color: #a0a6ad; margin-bottom: 6px;")
        g_layout.addWidget(lbl_desc)

        # Polling rate / responsiveness slider
        resp_box = QVBoxLayout()
        r_top = QHBoxLayout()
        r_label = QLabel("Cursor Tracking & Snap Responsiveness:")
        r_label.setFont(QFont("SansSerif", 10, QFont.Bold))
        self.polling_val = QLabel("16 ms (60 FPS)")
        self.polling_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        r_top.addWidget(r_label)
        r_top.addStretch()
        r_top.addWidget(self.polling_val)
        resp_box.addLayout(r_top)

        self.polling_slider = QSlider(Qt.Horizontal)
        self.polling_slider.setRange(8, 60)
        self.polling_slider.setValue(16)
        self.polling_slider.valueChanged.connect(self.on_polling_changed)
        resp_box.addWidget(self.polling_slider)

        r_hint = QLabel("Controls overlay refresh frequency when dragging windows. Lower = smoother tracking (16 ms is optimal for 60Hz+).")
        r_hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        r_hint.setWordWrap(True)
        resp_box.addWidget(r_hint)
        g_layout.addLayout(resp_box)

        # Window Movement Animations Group
        anim_grp = QGroupBox("Window Movement Animations")
        a_layout = QVBoxLayout(anim_grp)
        a_layout.setSpacing(10)

        a_top = QHBoxLayout()
        a_lbl = QLabel("Animation Style:")
        self.anim_mode_combo = QComboBox()
        self.anim_mode_combo.addItem("Off (Instant & Tear-Free)", "off")
        self.anim_mode_combo.addItem("Smooth Slide (Linear)", "slide")
        self.anim_mode_combo.addItem("Gentle Ease-Out (Cubic)", "ease_out")
        self.anim_mode_combo.addItem("Dynamic Spring (Back-Out)", "spring")
        self.anim_mode_combo.currentIndexChanged.connect(self.on_animation_changed)
        a_top.addWidget(a_lbl)
        a_top.addWidget(self.anim_mode_combo, 1)
        a_layout.addLayout(a_top)

        d_box = QHBoxLayout()
        d_lbl = QLabel("Animation Duration:")
        self.anim_dur_val = QLabel("200 ms")
        self.anim_dur_val.setStyleSheet("color: #3daee9; font-weight: bold;")
        self.anim_dur_slider = QSlider(Qt.Horizontal)
        self.anim_dur_slider.setRange(80, 500)
        self.anim_dur_slider.setValue(200)
        self.anim_dur_slider.valueChanged.connect(self.on_animation_changed)
        d_box.addWidget(d_lbl)
        d_box.addWidget(self.anim_dur_slider, 1)
        d_box.addWidget(self.anim_dur_val)
        a_layout.addLayout(d_box)

        self.test_anim_btn = QPushButton("▶ Test Movement Animation")
        self.test_anim_btn.clicked.connect(self.test_window_animation)
        a_layout.addWidget(self.test_anim_btn)

        g_layout.addWidget(anim_grp)

        self.osd_chk = QCheckBox("Show Native Plasma OSD when changing layouts or tiling states (On by default)")
        self.osd_chk.setChecked(True)
        self.osd_chk.toggled.connect(lambda: self.auto_sync_timer.start(120))
        g_layout.addWidget(self.osd_chk)

        left_vbox.addWidget(grp)
        left_vbox.addStretch()
        layout.addLayout(left_vbox, 1)

        # Right side: Dedicated animation preview!
        right_vbox = QVBoxLayout()
        r_title = QLabel("MOTION & ANIMATION PREVIEW")
        r_title.setFont(QFont("SansSerif", 10, QFont.Bold))
        r_title.setStyleSheet("color: #3daee9;")
        right_vbox.addWidget(r_title)

        self.anim_preview_widget = LiveDesktopPreview()
        right_vbox.addWidget(self.anim_preview_widget, 1)

        anim_hint = QLabel("Select an animation curve above and click 'Test Movement Animation' to preview how windows transition.")
        anim_hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        anim_hint.setWordWrap(True)
        right_vbox.addWidget(anim_hint)

        layout.addLayout(right_vbox, 1)
        return tab

    def on_polling_changed(self, val):
        fps = round(1000 / val) if val > 0 else 60
        self.polling_val.setText(f"{val} ms ({fps} FPS)")
        self.cfg_mgr.config["overlayPollingMs"] = val
        self.auto_sync_timer.start(120)

    def on_animation_changed(self):
        mode = self.anim_mode_combo.currentData()
        dur = self.anim_dur_slider.value()
        self.anim_dur_val.setText(f"{dur} ms")
        self.cfg_mgr.config["animationMode"] = mode
        self.cfg_mgr.config["animationDurationMs"] = dur
        self.preview_widget.set_animation_settings(mode, dur)
        self.anim_preview_widget.set_animation_settings(mode, dur)
        self.auto_sync_timer.start(120)

    def test_window_animation(self):
        mode = self.anim_mode_combo.currentData()
        dur = self.anim_dur_slider.value()
        self.anim_preview_widget.set_animation_settings(mode, dur)
        self.anim_preview_widget.test_animation()
        self.preview_widget.set_animation_settings(mode, dur)
        self.preview_widget.test_animation()

    # -------------------------------------------------------------
    # TAB 6: Shortcuts Cheatsheet
    # -------------------------------------------------------------
    def create_shortcuts_tab(self):
        tab = QWidget()
        layout = QVBoxLayout(tab)

        lbl = QLabel("Native Plasma 6 Global Shortcuts (All Ctrl-Based, Left-Hand Optimized):")
        lbl.setFont(QFont("SansSerif", 11, QFont.Bold))
        layout.addWidget(lbl)

        shortcuts = [
            ("Toggle Zone Overlay (KZones-Style)", "Ctrl + Shift + C"),
            ("Cycle to Next Layout", "Ctrl + Space"),
            ("Cycle to Previous Layout", "Ctrl + Shift + Space"),
            ("Toggle Tiling Globally", "Ctrl + Shift + T"),
            ("Toggle Active Window Floating", "Ctrl + Shift + F"),
            ("Focus Left Window (WASD)", "Ctrl + Shift + A"),
            ("Focus Right Window (WASD)", "Ctrl + Shift + D"),
            ("Focus Up Window (WASD)", "Ctrl + Shift + W"),
            ("Focus Down Window (WASD)", "Ctrl + Shift + S"),
            ("Swap Window Left (Counter-Clockwise)", "Ctrl + Shift + Q"),
            ("Swap Window Right (Clockwise)", "Ctrl + Shift + E"),
            ("Focus Next Window (Vim)", "Ctrl + Shift + J"),
            ("Focus Previous Window (Vim)", "Ctrl + Shift + K"),
            ("Swap Window Forward (Vim)", "Ctrl + Alt + J"),
            ("Swap Window Backward (Vim)", "Ctrl + Alt + K"),
            ("Expand Master Ratio", "Ctrl + Shift + L"),
            ("Shrink Master Ratio", "Ctrl + Shift + H"),
            ("Increase Master Count", "Ctrl + Shift + I"),
            ("Decrease Master Count", "Ctrl + Shift + O"),
            ("Show Master HUD Dialog", "Ctrl + Shift + M"),
            ("Move Window to Next Screen", "Ctrl + Shift + Z"),
            ("Cycle Layout on Other Screen", "Ctrl + Shift + X"),
            ("Swap Screen Layouts", "Ctrl + Alt + X"),
            ("Force Retile Workspace", "Ctrl + Shift + R")
        ]

        table = QTableWidget(len(shortcuts), 2)
        table.setHorizontalHeaderLabels(["Action", "Keybinding"])
        table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)

        for idx, (act, sc) in enumerate(shortcuts):
            table.setItem(idx, 0, QTableWidgetItem(act))
            sc_item = QTableWidgetItem(sc)
            sc_item.setForeground(QColor("#3daee9"))
            table.setItem(idx, 1, sc_item)

        layout.addWidget(table)
        hint = QLabel("Shortcuts can also be customized directly in KDE System Settings -> Shortcuts -> KWin.")
        hint.setStyleSheet("color: #6c757d; font-size: 8.5pt;")
        layout.addWidget(hint)
        return tab

    # -------------------------------------------------------------
    # State Management & Actions
    # -------------------------------------------------------------
    def on_enable_toggled(self, checked):
        self.cfg_mgr.config["enableTiling"] = checked
        self.set_status("Tiling enabled" if checked else "Tiling disabled")

    def load_settings_into_ui(self):
        cfg = self.cfg_mgr.config
        self.enable_switch.setChecked(cfg.get("enableTiling", True))
        self.inner_gap_slider.setValue(cfg.get("gapInner", 8))
        self.outer_gap_slider.setValue(cfg.get("gapOuter", 10))
        self.master_ratio_slider.setValue(int(cfg.get("masterRatio", 0.50) * 100))
        self.master_count_spin.setValue(cfg.get("masterCount", 1))

        self.polling_slider.setValue(cfg.get("overlayPollingMs", 16))
        anim_mode = cfg.get("animationMode", "off")
        idx = self.anim_mode_combo.findData(anim_mode)
        if idx >= 0:
            self.anim_mode_combo.setCurrentIndex(idx)
        anim_dur = cfg.get("animationDurationMs", 200)
        self.anim_dur_slider.setValue(anim_dur)

        self.anim_preview_widget.set_animation_settings(anim_mode, anim_dur)
        self.preview_widget.set_animation_settings(anim_mode, anim_dur)

        self.osd_chk.setChecked(cfg.get("showOsd", True))
        self.tile_new_chk.setChecked(cfg.get("tileNewWindows", True))
        self.ignore_minimized_chk.setChecked(cfg.get("ignoreMinimized", True))
        self.per_desktop_chk.setChecked(cfg.get("perDesktopLayout", True))

        dl = cfg.get("defaultLayout", "master-stack")
        for lid, card in self.layout_cards.items():
            card.set_selected(lid == dl)

        desk_map = cfg.get("desktopLayouts", {})
        for d, combo in self.desk_combos.items():
            if d in desk_map:
                combo.setCurrentText(desk_map[d])

        self.populate_rules_table()
        self.refresh_preview()

    def open_master_test_dialog(self):
        dlg = MasterScreensTestDialog(self, self.cfg_mgr)
        dlg.exec_()
        self.load_settings_into_ui()

    def save_and_apply(self):
        cfg = self.cfg_mgr.config
        cfg["enableTiling"] = self.enable_switch.isChecked()
        cfg["gapInner"] = self.inner_gap_slider.value()
        cfg["gapOuter"] = self.outer_gap_slider.value()
        cfg["masterRatio"] = self.master_ratio_slider.value() / 100.0
        cfg["masterCount"] = self.master_count_spin.value()
        cfg["overlayPollingMs"] = self.polling_slider.value()
        cfg["animationMode"] = self.anim_mode_combo.currentData()
        cfg["animationDurationMs"] = self.anim_dur_slider.value()
        cfg["showOsd"] = self.osd_chk.isChecked()
        cfg["tileNewWindows"] = self.tile_new_chk.isChecked()
        cfg["ignoreMinimized"] = self.ignore_minimized_chk.isChecked()
        cfg["perDesktopLayout"] = self.per_desktop_chk.isChecked()

        desk_map = {}
        for d, combo in self.desk_combos.items():
            desk_map[d] = combo.currentText()
        cfg["desktopLayouts"] = desk_map

        self.cfg_mgr.save()
        self.set_status("✓ Settings saved and synced with KWin!")

    def retile_kwin(self):
        self.save_and_apply()
        try:
            subprocess.run(["qdbus6", "org.kde.KWin", "/KWin", "org.kde.KWin.reconfigure"], check=False)
            subprocess.run(["qdbus6", "org.kde.kglobalaccel", "/component/kwin",
                            "org.kde.kglobalaccel.Component.invokeShortcut", "Tessera: Retile Current Workspace"], check=False)
            self.set_status("✓ Retile command sent to KWin.")
        except Exception as e:
            self.set_status(f"Error communicating with KWin: {e}")

    def set_status(self, msg):
        self.status_lbl.setText(msg)
        self.status_lbl.setStyleSheet("color: #3daee9; font-weight: bold;")
        QTimer.singleShot(4000, lambda: self.status_lbl.setStyleSheet("color: #6c757d; font-style: italic;"))

def main():
    app = QApplication(sys.argv)
    window = TesseraControlWindow()
    window.show()
    sys.exit(app.exec_())

if __name__ == "__main__":
    main()

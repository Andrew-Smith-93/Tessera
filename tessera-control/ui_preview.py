"""
Live Desktop Preview Widget
Renders an interactive miniature desktop preview reflecting the chosen layout,
inner gaps, outer gaps, master ratios, and animated window movements in real time.
"""

from PyQt5.QtWidgets import QWidget
from PyQt5.QtGui import QPainter, QColor, QPen, QBrush, QFont
from PyQt5.QtCore import Qt, QRect, QVariantAnimation, QEasingCurve

class LiveDesktopPreview(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(280, 180)
        self.layout_type = "master-stack"
        self.gap_inner = 8
        self.gap_outer = 10
        self.master_ratio = 0.50
        self.master_count = 1
        self.window_count = 3

        self.animation_mode = "off"
        self.animation_duration = 200

        self.current_rects = []
        self.start_rects = []
        self.target_rects = []

        self.anim = QVariantAnimation(self)
        self.anim.setStartValue(0.0)
        self.anim.setEndValue(1.0)
        self.anim.valueChanged.connect(self.on_anim_step)

    def set_animation_settings(self, mode, duration_ms):
        self.animation_mode = mode or "off"
        self.animation_duration = max(50, min(600, duration_ms or 200))
        self.anim.setDuration(self.animation_duration)

        if self.animation_mode == "slide":
            self.anim.setEasingCurve(QEasingCurve.Linear)
        elif self.animation_mode == "ease_out":
            self.anim.setEasingCurve(QEasingCurve.OutCubic)
        elif self.animation_mode == "spring":
            self.anim.setEasingCurve(QEasingCurve.OutBack)
        else:
            self.anim.setEasingCurve(QEasingCurve.Linear)

    def update_params(self, layout_type, gap_inner, gap_outer, master_ratio, master_count, window_count=3):
        self.layout_type = layout_type
        self.gap_inner = gap_inner
        self.gap_outer = gap_outer
        self.master_ratio = master_ratio
        self.master_count = master_count
        self.window_count = window_count

        new_rects = self.compute_rects()

        if self.animation_mode == "off" or not self.current_rects:
            self.current_rects = [QRect(r) for r in new_rects]
            self.target_rects = [QRect(r) for r in new_rects]
            self.update()
        else:
            self.start_rects = [QRect(r) for r in self.current_rects]
            self.target_rects = [QRect(r) for r in new_rects]

            # Match lengths if counts changed
            while len(self.start_rects) < len(self.target_rects):
                self.start_rects.append(QRect(self.target_rects[len(self.start_rects)]))
            while len(self.start_rects) > len(self.target_rects):
                self.start_rects.pop()

            self.anim.stop()
            self.anim.setDuration(self.animation_duration)
            self.anim.start()

    def on_anim_step(self, val):
        progress = float(val)
        interpolated = []
        for i in range(min(len(self.start_rects), len(self.target_rects))):
            s = self.start_rects[i]
            t = self.target_rects[i]
            x = int(s.x() + (t.x() - s.x()) * progress)
            y = int(s.y() + (t.y() - s.y()) * progress)
            w = int(s.width() + (t.width() - s.width()) * progress)
            h = int(s.height() + (t.height() - s.height()) * progress)
            interpolated.append(QRect(x, y, max(10, w), max(10, h)))
        self.current_rects = interpolated
        self.update()

    def test_animation(self):
        """Simulates window movement to preview the selected animation mode."""
        if not self.target_rects:
            self.compute_rects()

        # Swap window positions temporarily to trigger motion animation
        if len(self.target_rects) >= 2:
            swapped = list(self.target_rects)
            swapped[0], swapped[1] = swapped[1], swapped[0]
            self.start_rects = [QRect(r) for r in self.current_rects]
            self.target_rects = swapped
            self.anim.stop()
            self.anim.setDuration(self.animation_duration)
            self.anim.start()

    def compute_rects(self):
        w = self.width() if self.width() > 50 else 280
        h = self.height() if self.height() > 50 else 180
        panel_h = 14

        screen_x = 10
        screen_y = 10
        screen_w = w - 20
        screen_h = h - panel_h - 22

        scale_x = screen_w / 1920.0
        scaled_outer = max(2, int(self.gap_outer * scale_x * 2.5))
        scaled_inner = max(2, int(self.gap_inner * scale_x * 2.5))

        client_x = screen_x + scaled_outer
        client_y = screen_y + scaled_outer
        client_w = screen_w - (scaled_outer * 2)
        client_h = screen_h - (scaled_outer * 2)

        if client_w <= 10 or client_h <= 10:
            return []

        rects = []
        count = self.window_count

        if self.layout_type == "grid" or (self.layout_type == "master-stack" and self.master_count == 0):
            if count == 1:
                rects.append(QRect(client_x, client_y, client_w, client_h))
            elif count == 2:
                half_w = (client_w - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, client_w - half_w - scaled_inner, client_h))
            elif count == 3:
                col_w = (client_w - (scaled_inner * 2)) // 3
                for i in range(3):
                    cw = client_w - (col_w + scaled_inner) * 2 if i == 2 else col_w
                    rects.append(QRect(client_x + i * (col_w + scaled_inner), client_y, cw, client_h))
            elif count == 4:
                half_w = (client_w - scaled_inner) // 2
                half_h = (client_h - scaled_inner) // 2
                w1 = client_w - half_w - scaled_inner
                h1 = client_h - half_h - scaled_inner
                rects.append(QRect(client_x, client_y, half_w, half_h))
                rects.append(QRect(client_x, client_y + half_h + scaled_inner, half_w, h1))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, w1, half_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y + half_h + scaled_inner, w1, h1))
            elif count == 5:
                # 2 horizontal splits on left, 1 stack/column in middle, 2 horizontal splits on right
                col_w = (client_w - (scaled_inner * 2)) // 3
                half_h = (client_h - scaled_inner) // 2
                h1 = client_h - half_h - scaled_inner
                rects.append(QRect(client_x, client_y, col_w, half_h))
                rects.append(QRect(client_x, client_y + half_h + scaled_inner, col_w, h1))
                rects.append(QRect(client_x + col_w + scaled_inner, client_y, col_w, client_h))
                rx = client_x + (col_w + scaled_inner) * 2
                rw = client_w - rx + client_x
                rects.append(QRect(rx, client_y, rw, half_h))
                rects.append(QRect(rx, client_y + half_h + scaled_inner, rw, h1))
            else:
                col_w = (client_w - (scaled_inner * 2)) // 3
                row_h = (client_h - scaled_inner) // 2
                for c in range(3):
                    cx = client_x + c * (col_w + scaled_inner)
                    cw = client_w - (col_w + scaled_inner) * 2 if c == 2 else col_w
                    for r in range(2):
                        if len(rects) >= count:
                            break
                        ry = client_y + r * (row_h + scaled_inner)
                        rh = client_h - row_h - scaled_inner if r == 1 else row_h
                        rects.append(QRect(cx, ry, cw, rh))

        elif self.layout_type == "master-stack":
            if count == 1:
                rects.append(QRect(client_x, client_y, client_w, client_h))
            elif count == 2:
                half_w = (client_w - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, client_w - half_w - scaled_inner, client_h))
            elif self.master_count >= count:
                col_w = (client_w - (scaled_inner * (count - 1))) // count
                for i in range(count):
                    cw = client_w - (col_w + scaled_inner) * (count - 1) if i == count - 1 else col_w
                    rects.append(QRect(client_x + i * (col_w + scaled_inner), client_y, cw, client_h))
            else:
                m_w = int(client_w * self.master_ratio) - (scaled_inner // 2)
                s_w = client_w - m_w - scaled_inner
                act_masters = max(1, min(count, self.master_count))
                stack_count = count - act_masters

                m_h = (client_h - (scaled_inner * (act_masters - 1))) // act_masters
                for m in range(act_masters):
                    my = client_y + m * (m_h + scaled_inner)
                    mh = client_h - (m_h + scaled_inner) * (act_masters - 1) if m == act_masters - 1 else m_h
                    rects.append(QRect(client_x, my, m_w, mh))

                if stack_count > 0:
                    stack_h = (client_h - (scaled_inner * (stack_count - 1))) // stack_count
                    for s in range(stack_count):
                        sy = client_y + s * (stack_h + scaled_inner)
                        sh = client_h - (stack_h + scaled_inner) * (stack_count - 1) if s == stack_count - 1 else stack_h
                        rects.append(QRect(client_x + m_w + scaled_inner, sy, s_w, sh))

        elif self.layout_type == "bsp":
            if count == 1:
                rects.append(QRect(client_x, client_y, client_w, client_h))
            elif count == 2:
                half_w = (client_w - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, half_w, client_h))
            else:
                half_w = (client_w - scaled_inner) // 2
                half_h = (client_h - scaled_inner) // 2
                rects.append(QRect(client_x, client_y, half_w, client_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y, half_w, half_h))
                rects.append(QRect(client_x + half_w + scaled_inner, client_y + half_h + scaled_inner, half_w, half_h))

        elif self.layout_type == "columns":
            col_w = (client_w - (scaled_inner * (count - 1))) // count
            for i in range(count):
                rects.append(QRect(client_x + i * (col_w + scaled_inner), client_y, col_w, client_h))

        elif self.layout_type == "rows":
            row_h = (client_h - (scaled_inner * (count - 1))) // count
            for i in range(count):
                rects.append(QRect(client_x, client_y + i * (row_h + scaled_inner), client_w, row_h))

        elif self.layout_type == "monocle":
            rects.append(QRect(client_x, client_y, client_w, client_h))

        else: # Floating
            rects.append(QRect(client_x + 10, client_y + 10, int(client_w * 0.55), int(client_h * 0.6)))
            rects.append(QRect(client_x + 35, client_y + 35, int(client_w * 0.55), int(client_h * 0.6)))

        return rects

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)

        w = self.width()
        h = self.height()

        # Monitor bezel
        painter.setBrush(QBrush(QColor(24, 28, 36)))
        painter.setPen(QPen(QColor(50, 56, 68), 2))
        painter.drawRoundedRect(4, 4, w - 8, h - 8, 8, 8)

        # Miniature panel at bottom
        panel_h = 14
        painter.setBrush(QBrush(QColor(18, 20, 26, 220)))
        painter.setPen(Qt.NoPen)
        painter.drawRect(6, h - panel_h - 6, w - 12, panel_h)

        # Draw windows (use current_rects if populated, else compute)
        rects = self.current_rects if self.current_rects else self.compute_rects()

        window_colors = [
            QColor(60, 110, 210, 190),  # Master / active
            QColor(42, 54, 75, 170),
            QColor(38, 48, 66, 170),
            QColor(34, 44, 60, 170)
        ]

        font = QFont("SansSerif", 8, QFont.Bold)
        painter.setFont(font)

        for idx, r in enumerate(rects):
            col = window_colors[idx % len(window_colors)]
            painter.setBrush(QBrush(col))
            painter.setPen(QPen(QColor(80, 140, 240) if idx == 0 else QColor(70, 85, 115), 1.5))
            painter.drawRoundedRect(r, 4, 4)

            # Miniature titlebar
            tb_h = max(6, int(r.height() * 0.15))
            painter.setBrush(QBrush(QColor(0, 0, 0, 40)))
            painter.setPen(Qt.NoPen)
            painter.drawRoundedRect(r.x(), r.y(), r.width(), tb_h, 4, 4)

            # Label index
            painter.setPen(QColor(220, 230, 255))
            painter.drawText(r, Qt.AlignCenter, str(idx + 1))

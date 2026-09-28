import type { Rect, Point } from "@tessera/protocol";

export type SnapZoneType = "maximize" | "half" | "quarter" | "pillar";

export type SnapZoneId =
  | "maximize"
  | "left-half"
  | "right-half"
  | "top-left"
  | "bottom-left"
  | "top-right"
  | "bottom-right"
  | "left-pillar"
  | "center-pillar"
  | "center-top"
  | "center-bottom"
  | "right-pillar";

export interface SnapZoneTarget {
  type: SnapZoneType;
  id: SnapZoneId;
  title: string;
  badge: string;
  desc: string;
  slotIndex: number;
  rect: Rect;
  targetRect: Rect;
  triggerX: number;
  triggerY: number;
  triggerW: number;
  triggerH: number;
}

/**
 * Computes visual snap overlay zones and prospective layout targets
 * using the given working area and inner/outer gaps.
 * Includes Top Maximize, Left/Right Halves, 4 Quadrants, and 3 Pillars (Left, Center Full/Split, Right).
 */
export function computeSnapZones(
  area: Rect,
  gapOuter: number,
  gapInner: number
): SnapZoneTarget[] {
  const go = gapOuter;
  const gi = gapInner;
  const uw = area.width - (go * 2);
  const uh = area.height - (go * 2);
  const hw = Math.floor((uw - gi) / 2);
  const hh = Math.floor((uh - gi) / 2);

  // 3 Equal-width pillars: distribute remainder so max(width) - min(width) <= 1
  const totalColW = Math.max(0, uw - 2 * gi), baseW = Math.floor(totalColW / 3), rem = totalColW % 3;
  const colW0 = baseW + (rem === 2 ? 1 : 0);
  const colW1 = baseW + (rem === 1 ? 1 : 0);
  const colW2 = baseW + (rem === 2 ? 1 : 0);
  const cx0 = area.x + go;
  const cx1 = cx0 + colW0 + gi;
  const cx2 = cx1 + colW1 + gi;

  const zones: SnapZoneTarget[] = [];

  // 1. Top Maximize Bar Card (Index 0)
  const barW = Math.min(800, Math.floor(uw * 0.6));
  const barX = area.x + Math.floor((area.width - barW) / 2);
  zones.push({
    type: "maximize",
    id: "maximize",
    title: "Full Screen / Maximize",
    badge: "🗖 Maximize",
    desc: "Full Working Area",
    slotIndex: -1,
    rect: { x: barX, y: area.y + 10, width: barW, height: 56 },
    targetRect: { x: area.x + go, y: area.y + go, width: uw, height: uh },
    triggerX: barX - 10,
    triggerY: area.y,
    triggerW: barW + 20,
    triggerH: 66
  });

  // 2. Left Half (Primary Slot) (Index 1)
  zones.push({
    type: "half",
    id: "left-half",
    title: "Left Half (Primary)",
    badge: "⊞ Left Split",
    desc: "50% Primary Pane",
    slotIndex: 0,
    rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: uh - 70 },
    targetRect: { x: area.x + go, y: area.y + go, width: hw, height: uh },
    triggerX: area.x + Math.floor(area.width * 0.16),
    triggerY: area.y + 80,
    triggerW: Math.floor(area.width * 0.18),
    triggerH: area.height - 80
  });

  // 3. Right Half (Stack Slot) (Index 2)
  zones.push({
    type: "half",
    id: "right-half",
    title: "Right Half (Stack)",
    badge: "▥ Right Split",
    desc: "50% Secondary Pane",
    slotIndex: 1,
    rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: uh - 70 },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: uh },
    triggerX: area.x + Math.floor(area.width * 0.66),
    triggerY: area.y + 80,
    triggerW: Math.floor(area.width * 0.18),
    triggerH: area.height - 80
  });

  // 4. Top-Left Quarter (Index 3)
  zones.push({
    type: "quarter",
    id: "top-left",
    title: "Top-Left Quarter",
    badge: "◤ Top-Left",
    desc: "25% Quadrant",
    slotIndex: 0,
    rect: { x: area.x + go, y: area.y + go + 70, width: hw, height: Math.max(60, hh - 70) },
    targetRect: { x: area.x + go, y: area.y + go, width: hw, height: hh },
    triggerX: area.x,
    triggerY: area.y,
    triggerW: Math.floor(area.width * 0.22),
    triggerH: Math.floor(area.height * 0.32)
  });

  // 5. Bottom-Left Quarter (Index 4)
  const blTriggerY = area.y + Math.floor(area.height * 0.68);
  zones.push({
    type: "quarter",
    id: "bottom-left",
    title: "Bottom-Left Quarter",
    badge: "◣ Bottom-Left",
    desc: "25% Quadrant",
    slotIndex: 3,
    rect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
    targetRect: { x: area.x + go, y: area.y + go + hh + gi, width: hw, height: uh - hh - gi },
    triggerX: area.x,
    triggerY: blTriggerY,
    triggerW: Math.floor(area.width * 0.22),
    triggerH: (area.y + area.height) - blTriggerY
  });

  // 6. Top-Right Quarter (Index 5)
  const trTriggerX = area.x + Math.floor(area.width * 0.78);
  zones.push({
    type: "quarter",
    id: "top-right",
    title: "Top-Right Quarter",
    badge: "◥ Top-Right",
    desc: "25% Quadrant",
    slotIndex: 1,
    rect: { x: area.x + go + hw + gi, y: area.y + go + 70, width: uw - hw - gi, height: Math.max(60, hh - 70) },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go, width: uw - hw - gi, height: hh },
    triggerX: trTriggerX,
    triggerY: area.y,
    triggerW: (area.x + area.width) - trTriggerX,
    triggerH: Math.floor(area.height * 0.32)
  });

  // 7. Bottom-Right Quarter (Index 6)
  const brTriggerX = area.x + Math.floor(area.width * 0.78);
  const brTriggerY = area.y + Math.floor(area.height * 0.68);
  zones.push({
    type: "quarter",
    id: "bottom-right",
    title: "Bottom-Right Quarter",
    badge: "◢ Bottom-Right",
    desc: "25% Quadrant",
    slotIndex: 2,
    rect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
    targetRect: { x: area.x + go + hw + gi, y: area.y + go + hh + gi, width: uw - hw - gi, height: uh - hh - gi },
    triggerX: brTriggerX,
    triggerY: brTriggerY,
    triggerW: (area.x + area.width) - brTriggerX,
    triggerH: (area.y + area.height) - brTriggerY
  });

  // 8. Left Pillar (Index 7)
  zones.push({
    type: "pillar",
    id: "left-pillar",
    title: "Left Pillar",
    badge: "▎ Left Pillar",
    desc: "1/3 Left Column",
    slotIndex: 0,
    rect: { x: cx0, y: area.y + go + 70, width: colW0, height: uh - 70 },
    targetRect: { x: cx0, y: area.y + go, width: colW0, height: uh },
    triggerX: area.x,
    triggerY: area.y + Math.floor(area.height * 0.32),
    triggerW: Math.floor(area.width * 0.16),
    triggerH: Math.floor(area.height * 0.36)
  });

  // 9. Center Pillar (Index 8)
  zones.push({
    type: "pillar",
    id: "center-pillar",
    title: "Center Pillar",
    badge: "▍ Center Pillar",
    desc: "1/3 Center Column (Full)",
    slotIndex: 1,
    rect: { x: cx1, y: area.y + go + 70, width: colW1, height: uh - 70 },
    targetRect: { x: cx1, y: area.y + go, width: colW1, height: uh },
    triggerX: cx1,
    triggerY: area.y + Math.floor(area.height * 0.35),
    triggerW: colW1,
    triggerH: Math.floor(area.height * 0.30)
  });

  // 10. Center Top (Index 9)
  zones.push({
    type: "pillar",
    id: "center-top",
    title: "Center Top",
    badge: "⬒ Center Top",
    desc: "1/3 Center Column (Top)",
    slotIndex: 1,
    rect: { x: cx1, y: area.y + go + 70, width: colW1, height: Math.max(60, hh - 70) },
    targetRect: { x: cx1, y: area.y + go, width: colW1, height: hh },
    triggerX: cx1,
    triggerY: area.y + 66,
    triggerW: colW1,
    triggerH: Math.floor(area.height * 0.28)
  });

  // 11. Center Bottom (Index 10)
  zones.push({
    type: "pillar",
    id: "center-bottom",
    title: "Center Bottom",
    badge: "⬓ Center Bottom",
    desc: "1/3 Center Column (Bottom)",
    slotIndex: 2,
    rect: { x: cx1, y: area.y + go + hh + gi, width: colW1, height: uh - hh - gi },
    targetRect: { x: cx1, y: area.y + go + hh + gi, width: colW1, height: uh - hh - gi },
    triggerX: cx1,
    triggerY: area.y + Math.floor(area.height * 0.65),
    triggerW: colW1,
    triggerH: Math.floor(area.height * 0.35)
  });

  // 12. Right Pillar (Index 11)
  zones.push({
    type: "pillar",
    id: "right-pillar",
    title: "Right Pillar",
    badge: "▕ Right Pillar",
    desc: "1/3 Right Column",
    slotIndex: 2,
    rect: { x: cx2, y: area.y + go + 70, width: colW2, height: uh - 70 },
    targetRect: { x: cx2, y: area.y + go, width: colW2, height: uh },
    triggerX: area.x + Math.floor(area.width * 0.84),
    triggerY: area.y + Math.floor(area.height * 0.32),
    triggerW: Math.floor(area.width * 0.16),
    triggerH: Math.floor(area.height * 0.36)
  });

  return zones;
}

/**
 * Matches a cursor position against calculated snap zones.
 * Checks corner quarters first, then top maximize bar, then center splits/pillar,
 * then outer pillars and halves.
 * Returns the matching zone index, or -1 if no zone matches.
 */
export function matchSnapZoneHover(
  zones: readonly SnapZoneTarget[],
  cursorPos: Point
): number {
  if (!cursorPos || zones.length === 0) return -1;

  // 1. Check corner quarters first (indices 3, 4, 5, 6)
  for (let i = 3; i <= 6 && i < zones.length; i++) {
    const qz = zones[i];
    if (
      cursorPos.x >= qz.triggerX &&
      cursorPos.x < qz.triggerX + qz.triggerW &&
      cursorPos.y >= qz.triggerY &&
      cursorPos.y < qz.triggerY + qz.triggerH
    ) {
      return i;
    }
  }

  // 2. Check top maximize bar (index 0)
  if (zones.length > 0) {
    const mz = zones[0];
    if (
      cursorPos.x >= mz.triggerX &&
      cursorPos.x < mz.triggerX + mz.triggerW &&
      cursorPos.y >= mz.triggerY &&
      cursorPos.y < mz.triggerY + mz.triggerH
    ) {
      return 0;
    }
  }

  // 3. Check Center Pillar / Center Top / Center Bottom (indices 8, 9, 10)
  if (zones.length >= 11) {
    // Check Center Top (index 9)
    const ct = zones[9];
    if (
      cursorPos.x >= ct.triggerX &&
      cursorPos.x < ct.triggerX + ct.triggerW &&
      cursorPos.y >= ct.triggerY &&
      cursorPos.y < ct.triggerY + ct.triggerH
    ) {
      return 9;
    }

    // Check Center Bottom (index 10)
    const cb = zones[10];
    if (
      cursorPos.x >= cb.triggerX &&
      cursorPos.x < cb.triggerX + cb.triggerW &&
      cursorPos.y >= cb.triggerY &&
      cursorPos.y < cb.triggerY + cb.triggerH
    ) {
      return 10;
    }

    // Check Center Pillar (index 8)
    const cp = zones[8];
    if (
      cursorPos.x >= cp.triggerX &&
      cursorPos.x < cp.triggerX + cp.triggerW &&
      cursorPos.y >= cp.triggerY &&
      cursorPos.y < cp.triggerY + cp.triggerH
    ) {
      return 8;
    }
  }

  // 4. Check Left / Right Halves (indices 1, 2)
  if (zones.length > 1) {
    const lz = zones[1];
    if (
      cursorPos.x >= lz.triggerX &&
      cursorPos.x < lz.triggerX + lz.triggerW &&
      cursorPos.y >= lz.triggerY &&
      cursorPos.y < lz.triggerY + lz.triggerH
    ) {
      return 1;
    }
  }

  if (zones.length > 2) {
    const rz = zones[2];
    if (
      cursorPos.x >= rz.triggerX &&
      cursorPos.x < rz.triggerX + rz.triggerW &&
      cursorPos.y >= rz.triggerY &&
      cursorPos.y < rz.triggerY + rz.triggerH
    ) {
      return 2;
    }
  }

  // 5. Check Left Pillar (index 7) & Right Pillar (index 11)
  if (zones.length > 7) {
    const lp = zones[7];
    if (
      cursorPos.x >= lp.triggerX &&
      cursorPos.x < lp.triggerX + lp.triggerW &&
      cursorPos.y >= lp.triggerY &&
      cursorPos.y < lp.triggerY + lp.triggerH
    ) {
      return 7;
    }
  }

  if (zones.length > 11) {
    const rp = zones[11];
    if (
      cursorPos.x >= rp.triggerX &&
      cursorPos.x < rp.triggerX + rp.triggerW &&
      cursorPos.y >= rp.triggerY &&
      cursorPos.y < rp.triggerY + rp.triggerH
    ) {
      return 11;
    }
  }

  return -1;
}

export type RegionDirection = "left" | "right" | "up" | "down";

/**
 * Deterministic spatial navigation across visual snap zones / regions.
 * Preserves columns during vertical navigation, prevents horizontal column jumps
 * on repeated edge inputs, and enables direct access between full pillars and splits.
 */
export function resolveRegionTransition(
  currentRegion: SnapZoneId | string,
  direction: RegionDirection
): SnapZoneId {
  switch (direction) {
    case "left": {
      switch (currentRegion) {
        case "right-half": return "left-half";
        case "top-right": return "top-left";
        case "bottom-right": return "bottom-left";
        case "right-pillar": return "center-pillar";
        case "center-pillar": return "left-pillar";
        case "center-top": return "top-left";
        case "center-bottom": return "bottom-left";
        // Left boundary edge repeated: remain at current left position
        case "left-half": return "left-half";
        case "left-pillar": return "left-pillar";
        case "top-left": return "top-left";
        case "bottom-left": return "bottom-left";
        default: return "left-half";
      }
    }
    case "right": {
      switch (currentRegion) {
        case "left-half": return "right-half";
        case "top-left": return "top-right";
        case "bottom-left": return "bottom-right";
        case "left-pillar": return "center-pillar";
        case "center-pillar": return "right-pillar";
        case "center-top": return "top-right";
        case "center-bottom": return "bottom-right";
        // Right boundary edge repeated: remain at current right position
        case "right-half": return "right-half";
        case "right-pillar": return "right-pillar";
        case "top-right": return "top-right";
        case "bottom-right": return "bottom-right";
        default: return "right-half";
      }
    }
    case "up": {
      switch (currentRegion) {
        // Vertical transitions within respective column:
        case "bottom-left": return "top-left";
        case "bottom-right": return "top-right";
        case "center-bottom": return "center-top";
        case "center-pillar": return "center-top"; // center-full accesses center-top
        case "left-half": return "top-left";
        case "right-half": return "top-right";
        case "left-pillar": return "top-left";
        case "right-pillar": return "top-right";
        // Top boundary edge repeated: NEVER jump columns horizontally
        case "top-left": return "top-left";
        case "top-right": return "top-right";
        case "center-top": return "center-top";
        case "maximize": return "maximize";
        default: return "top-left";
      }
    }
    case "down": {
      switch (currentRegion) {
        // Vertical transitions within respective column:
        case "top-left": return "bottom-left";
        case "top-right": return "bottom-right";
        case "center-top": return "center-bottom";
        case "center-pillar": return "center-bottom"; // center-full accesses center-bottom
        case "left-half": return "bottom-left";
        case "right-half": return "bottom-right";
        case "left-pillar": return "bottom-left";
        case "right-pillar": return "bottom-right";
        // Bottom boundary edge repeated: NEVER jump columns horizontally
        case "bottom-left": return "bottom-left";
        case "bottom-right": return "bottom-right";
        case "center-bottom": return "center-bottom";
        case "maximize": return "maximize";
        default: return "bottom-left";
      }
    }
  }
}

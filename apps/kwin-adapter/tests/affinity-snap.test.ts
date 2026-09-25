import { describe, it, expect } from "vitest";
import { RuntimeCoordinator } from "../src/runtime-coordinator.js";
import {
  resolveScreenAffinity,
  resolveCursorTargetScreen,
  pointToRectDistance,
  rectIntersectionArea,
  rectContainsPoint
} from "../src/screen-affinity.js";
import {
  computeSnapZones,
  matchSnapZoneHover,
  type SnapZoneTarget
} from "../src/snap-zones.js";
import type { NormalizedScreenInput, NormalizedWindowInput } from "../src/coordinator-types.js";
import type { Rect, Point } from "@tessera/protocol";

const SCREEN_PRIMARY: NormalizedScreenInput = {
  outputId: "HDMI-A-1",
  name: "HDMI-A-1",
  geometry: { x: 0, y: 0, width: 1920, height: 1080 },
  usableArea: { x: 0, y: 32, width: 1920, height: 1048 },
  activeDesktopId: "1"
};

const SCREEN_SECONDARY: NormalizedScreenInput = {
  outputId: "DP-1",
  name: "DP-1",
  geometry: { x: 1920, y: 0, width: 2560, height: 1440 },
  usableArea: { x: 1920, y: 0, width: 2560, height: 1440 },
  activeDesktopId: "1"
};

const SCREEN_LEFT_NEGATIVE: NormalizedScreenInput = {
  outputId: "DP-2",
  name: "DP-2",
  geometry: { x: -1920, y: 0, width: 1920, height: 1080 },
  usableArea: { x: -1920, y: 0, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

const SCREEN_TOP_STACKED: NormalizedScreenInput = {
  outputId: "DP-3",
  name: "DP-3",
  geometry: { x: 0, y: -1080, width: 1920, height: 1080 },
  usableArea: { x: 0, y: -1080, width: 1920, height: 1080 },
  activeDesktopId: "1"
};

describe("Phase 2B Screen Affinity, Snap Zones & Geometry Cache Invariants", () => {
  // 1. Affinity Step 1
  it("Affinity Step 1: Explicit valid KWin output identity selects specified screen", () => {
    const affinity = resolveScreenAffinity({
      explicitOutputId: "DP-1",
      frameGeometry: { x: 100, y: 100, width: 800, height: 600 },
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("DP-1");
  });

  // 2. Affinity Step 2
  it("Affinity Step 2: Output containing window center point is selected", () => {
    // Center of (2000, 100, 400, 400) is (2200, 300) -> inside SCREEN_SECONDARY
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: 2000, y: 100, width: 400, height: 400 },
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("DP-1");
  });

  // 3. Affinity Step 3
  it("Affinity Step 3: Output with greatest window intersection area is selected", () => {
    // Window spanning boundary: x: 1800, y: 100, width: 500, height: 400
    // Overlap with SCREEN_PRIMARY [0..1920]: width 120 (1800 to 1920) * 400 = 48,000
    // Overlap with SCREEN_SECONDARY [1920..4480]: width 380 (1920 to 2300) * 400 = 152,000
    // Center is 1800 + 250 = 2050 (in secondary). Let's craft center right on boundary:
    // Window: x: 1420, width: 1000 -> center is 1920.
    // Overlap with PRIMARY: 1420..1920 = 500 * 400 = 200,000.
    // Overlap with SECONDARY: 1920..2420 = 500 * 400 = 200,000.
    // If we make PRIMARY overlap 600 px and SECONDARY 400 px:
    const geom: Rect = { x: 1320, y: 100, width: 1000, height: 400 }; // 1320 to 2320. Primary: 600, Secondary: 400. Center: 1820 (in Primary).
    const affinity = resolveScreenAffinity({
      frameGeometry: geom,
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("HDMI-A-1");
  });

  // 4. Affinity Step 4
  it("Affinity Step 4: Previous valid retained output affinity is respected when window has no geometry", () => {
    const affinity = resolveScreenAffinity({
      previousOutputId: "DP-1",
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("DP-1");
  });

  // 5. Affinity Step 5
  it("Affinity Step 5: Output containing cursor point is selected when no center/intersection matches", () => {
    const affinity = resolveScreenAffinity({
      cursorPoint: { x: 2100, y: 500 },
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("DP-1");
  });

  // 6. Affinity Step 6
  it("Affinity Step 6: Deterministic nearest-output fallback (Euclidean distance to rect)", () => {
    // Window placed far out to the right: x: 5000, y: 100, width: 200, height: 200
    // Nearest screen is SCREEN_SECONDARY (ends at x: 4480), distance ~520 px.
    // Distance to SCREEN_PRIMARY (ends at 1920) is >3000 px.
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: 5000, y: 100, width: 200, height: 200 },
      screens: [SCREEN_PRIMARY, SCREEN_SECONDARY]
    });
    expect(affinity).toBe("DP-1");
  });

  // 7. Affinity Step 7
  it("Affinity Step 7: Stable lexical outputId tie-breaker when multiple outputs are equidistant", () => {
    // Two synthetic screens equidistant from point (0, 0)
    const scrA: NormalizedScreenInput = {
      outputId: "Screen-B",
      geometry: { x: 100, y: 0, width: 100, height: 100 },
      usableArea: { x: 100, y: 0, width: 100, height: 100 }
    };
    const scrB: NormalizedScreenInput = {
      outputId: "Screen-A",
      geometry: { x: -200, y: 0, width: 100, height: 100 }, // right edge at -100, distance = 100
      usableArea: { x: -200, y: 0, width: 100, height: 100 }
    };
    const affinity = resolveScreenAffinity({
      cursorPoint: { x: 0, y: 50 },
      screens: [scrA, scrB]
    });
    expect(affinity).toBe("Screen-A"); // Lexically earlier
  });

  // 8. Affinity Edge Case: Negative coordinates
  it("Affinity Edge Case: Negative screen coordinates (multi-monitor left layout)", () => {
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: -1000, y: 200, width: 800, height: 600 },
      screens: [SCREEN_LEFT_NEGATIVE, SCREEN_PRIMARY]
    });
    expect(affinity).toBe("DP-2");
  });

  // 9. Affinity Edge Case: Stacked monitors
  it("Affinity Edge Case: Stacked monitors (vertical multi-monitor layout)", () => {
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: 100, y: -800, width: 800, height: 600 },
      screens: [SCREEN_TOP_STACKED, SCREEN_PRIMARY]
    });
    expect(affinity).toBe("DP-3");
  });

  // 10. Affinity Edge Case: Boundary ties
  it("Affinity Edge Case: Boundary ties between screens resolved by lexical tie-breaker", () => {
    const s1: NormalizedScreenInput = {
      outputId: "Z-Screen",
      geometry: { x: 0, y: 0, width: 1000, height: 1000 },
      usableArea: { x: 0, y: 0, width: 1000, height: 1000 }
    };
    const s2: NormalizedScreenInput = {
      outputId: "A-Screen",
      geometry: { x: 1000, y: 0, width: 1000, height: 1000 },
      usableArea: { x: 1000, y: 0, width: 1000, height: 1000 }
    };
    // Window perfectly centered on x = 1000
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: 800, y: 200, width: 400, height: 400 },
      screens: [s1, s2]
    });
    expect(affinity).toBe("A-Screen");
  });

  // 11. Affinity Edge Case: Gaps between monitors
  it("Affinity Edge Case: Gaps between monitors fallback to nearest screen", () => {
    const s1: NormalizedScreenInput = {
      outputId: "Left-Mon",
      geometry: { x: 0, y: 0, width: 1000, height: 1000 },
      usableArea: { x: 0, y: 0, width: 1000, height: 1000 }
    };
    const s2: NormalizedScreenInput = {
      outputId: "Right-Mon",
      geometry: { x: 1200, y: 0, width: 1000, height: 1000 }, // 200px gap
      usableArea: { x: 1200, y: 0, width: 1000, height: 1000 }
    };
    // Window at gap: x = 1020 (distance to Left-Mon is 20, distance to Right-Mon is 180)
    const affinity = resolveScreenAffinity({
      frameGeometry: { x: 1020, y: 200, width: 50, height: 50 },
      screens: [s1, s2]
    });
    expect(affinity).toBe("Left-Mon");
  });

  // 12. Affinity Edge Case: Disconnected screen affinity
  it("Affinity Edge Case: Disconnected screen affinity falls back gracefully", () => {
    const affinity = resolveScreenAffinity({
      previousOutputId: "UNPLUGGED-PORT",
      frameGeometry: { x: 100, y: 100, width: 400, height: 300 },
      screens: [SCREEN_PRIMARY]
    });
    expect(affinity).toBe("HDMI-A-1");
  });

  // 13. Cursor Target Screen: Direct containment
  it("Cursor Target: Direct containment selects correct screen", () => {
    const target = resolveCursorTargetScreen(
      [SCREEN_PRIMARY, SCREEN_SECONDARY],
      { x: 2500, y: 500 }
    );
    expect(target.outputId).toBe("DP-1");
  });

  // 14. Cursor Target Screen: Nearest fallback
  it("Cursor Target: Nearest screen fallback when cursor is in dead space/bezel", () => {
    const target = resolveCursorTargetScreen(
      [SCREEN_PRIMARY, SCREEN_SECONDARY],
      { x: -500, y: 500 }
    );
    expect(target.outputId).toBe("HDMI-A-1");
  });

  // 15. Cursor Target Screen: Lexical tie-breaker on boundary
  it("Cursor Target: Lexical tie-breaker on ambiguous screen boundary", () => {
    const s1: NormalizedScreenInput = {
      outputId: "Output-B",
      geometry: { x: 0, y: 0, width: 1000, height: 1000 },
      usableArea: { x: 0, y: 0, width: 1000, height: 1000 }
    };
    const s2: NormalizedScreenInput = {
      outputId: "Output-A",
      geometry: { x: 1000, y: 0, width: 1000, height: 1000 },
      usableArea: { x: 1000, y: 0, width: 1000, height: 1000 }
    };
    const target = resolveCursorTargetScreen([s1, s2], { x: 1000, y: 500 });
    expect(target.outputId).toBe("Output-A");
  });

  // 16. Snap Zones: Exactly 12 zones (Maximize, 2 Halves, 4 Quadrants, 5 Pillar regions)
  it("Snap Zones: Computes exactly 12 zones with correct IDs and types", () => {
    const area: Rect = { x: 0, y: 32, width: 1920, height: 1048 };
    const zones = computeSnapZones(area, 10, 8);
    expect(zones.length).toBe(12);

    const ids = zones.map(z => z.id);
    expect(ids).toEqual([
      "maximize",
      "left-half",
      "right-half",
      "top-left",
      "bottom-left",
      "top-right",
      "bottom-right",
      "left-pillar",
      "center-pillar",
      "center-top",
      "center-bottom",
      "right-pillar"
    ]);

    expect(zones[0].type).toBe("maximize");
    expect(zones[1].type).toBe("half");
    expect(zones[2].type).toBe("half");
    expect(zones[3].type).toBe("quarter");
    expect(zones[4].type).toBe("quarter");
    expect(zones[5].type).toBe("quarter");
    expect(zones[6].type).toBe("quarter");
    expect(zones[7].type).toBe("pillar");
    expect(zones[8].type).toBe("pillar");
    expect(zones[9].type).toBe("pillar");
    expect(zones[10].type).toBe("pillar");
    expect(zones[11].type).toBe("pillar");
  });

  // 17. Snap Zones: Maximize top bar card geometry
  it("Snap Zones: Maximize top bar card geometry and trigger boundaries", () => {
    const area: Rect = { x: 0, y: 32, width: 1920, height: 1048 };
    const zones = computeSnapZones(area, 10, 8);
    const mz = zones[0];

    const uw = 1920 - 20; // 1900
    const uh = 1048 - 20; // 1028
    const expectedBarW = Math.min(800, Math.floor(uw * 0.6)); // 800
    const expectedBarX = Math.floor((1920 - 800) / 2); // 560

    expect(mz.rect.x).toBe(expectedBarX);
    expect(mz.rect.y).toBe(32 + 10);
    expect(mz.rect.width).toBe(800);
    expect(mz.rect.height).toBe(56);

    expect(mz.targetRect).toEqual({ x: 10, y: 42, width: 1900, height: 1028 });
    expect(mz.triggerX).toBe(expectedBarX - 10);
    expect(mz.triggerY).toBe(32);
    expect(mz.triggerW).toBe(820);
    expect(mz.triggerH).toBe(66);
  });

  // 18. Snap Zones: Left and right half targets account for inner and outer gaps
  it("Snap Zones: Left and right half targets account for inner and outer gaps", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const go = 12;
    const gi = 10;
    const zones = computeSnapZones(area, go, gi);
    const left = zones[1];
    const right = zones[2];

    const uw = 1920 - 24; // 1896
    const uh = 1080 - 24; // 1056
    const hw = Math.floor((1896 - 10) / 2); // 943

    expect(left.targetRect).toEqual({ x: 12, y: 12, width: 943, height: 1056 });
    expect(right.targetRect).toEqual({
      x: 12 + 943 + 10, // 965
      y: 12,
      width: 1896 - 943 - 10, // 943
      height: 1056
    });
  });

  // 19. Snap Zones: 4 corner quadrant targets and trigger boundaries
  it("Snap Zones: 4 corner quadrant targets and trigger boundaries", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    const tl = zones[3];
    const bl = zones[4];
    const tr = zones[5];
    const br = zones[6];

    // Trigger bounds check
    expect(tl.triggerX).toBe(0);
    expect(tl.triggerY).toBe(0);
    expect(tl.triggerW).toBe(Math.floor(1920 * 0.22));
    expect(tl.triggerH).toBe(Math.floor(1080 * 0.32));

    expect(tr.triggerX).toBe(Math.floor(1920 * 0.78));
    expect(tr.triggerY).toBe(0);

    expect(bl.triggerX).toBe(0);
    expect(bl.triggerY).toBe(Math.floor(1080 * 0.68));

    expect(br.triggerX).toBe(Math.floor(1920 * 0.78));
    expect(br.triggerY).toBe(Math.floor(1080 * 0.68));
  });

  // 20. Snap Zones Hover: Corners take priority
  it("Snap Zones Hover: Corners take priority over halves and maximize bar", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    // Position in top-left corner trigger area: (50, 50)
    const match = matchSnapZoneHover(zones, { x: 50, y: 50 });
    expect(match).toBe(3); // top-left
    expect(zones[match].id).toBe("top-left");
  });

  // 21. Snap Zones Hover: Maximize bar takes priority over left/right halves
  it("Snap Zones Hover: Maximize bar takes priority over left/right halves", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    // Center of top maximize card: x = 960, y = 30
    const match = matchSnapZoneHover(zones, { x: 960, y: 30 });
    expect(match).toBe(0);
    expect(zones[match].id).toBe("maximize");
  });

  // 22. Snap Zones Hover: Left and right half hover detection
  it("Snap Zones Hover: Left and right half hover detection", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    // Left center: x = 400, y = 500 (below corner quarter triggers)
    const leftMatch = matchSnapZoneHover(zones, { x: 400, y: 500 });
    expect(leftMatch).toBe(1);
    expect(zones[leftMatch].id).toBe("left-half");

    // Right center: x = 1500, y = 500
    const rightMatch = matchSnapZoneHover(zones, { x: 1500, y: 500 });
    expect(rightMatch).toBe(2);
    expect(zones[rightMatch].id).toBe("right-half");
  });

  // 23. Snap Zones Hover: Returns -1 when cursor outside
  it("Snap Zones Hover: Returns -1 when cursor is outside any trigger area", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    // Off-screen or null
    expect(matchSnapZoneHover(zones, { x: -100, y: -100 })).toBe(-1);
    expect(matchSnapZoneHover([], { x: 100, y: 100 })).toBe(-1);
  });

  // 24. Snap Zones Geometry: Parameterized across all modulo-3 residues, nonzero/negative origins, and stacked center height equality
  it("Snap Zones Geometry: Parameterized across all modulo-3 residues, nonzero/negative origins, and stacked center height equality", () => {
    interface GeometryTestCase {
      area: Rect;
      gapOuter: number;
      gapInner: number;
      label: string;
    }

    const testCases: GeometryTestCase[] = [
      // Modulo-3 Residue 0: totalColW = (1920 - 20) - 16 = 1884, 1884 % 3 === 0
      { area: { x: 0, y: 0, width: 1920, height: 1080 }, gapOuter: 10, gapInner: 8, label: "Residue 0 (standard 1080p, origin 0,0)" },
      // Modulo-3 Residue 1: totalColW = (1921 - 20) - 16 = 1885, 1885 % 3 === 1, negative screen origin
      { area: { x: -1920, y: -1080, width: 1921, height: 1080 }, gapOuter: 10, gapInner: 8, label: "Residue 1 (negative origin x:-1920, y:-1080)" },
      // Modulo-3 Residue 2: totalColW = (1922 - 20) - 16 = 1886, 1886 % 3 === 2, nonzero positive screen origin
      { area: { x: 2560, y: 144, width: 1922, height: 1080 }, gapOuter: 10, gapInner: 8, label: "Residue 2 (nonzero origin x:2560, y:144)" },
      // Ultrawide with Residue 1: totalColW = (3440 - 24) - 20 = 3396 (rem 0) vs width 3441 (rem 1) vs 3442 (rem 2)
      { area: { x: 0, y: 0, width: 3440, height: 1440 }, gapOuter: 12, gapInner: 10, label: "Residue 0 ultrawide (3440x1440)" },
      { area: { x: -3440, y: 0, width: 3441, height: 1440 }, gapOuter: 12, gapInner: 10, label: "Residue 1 ultrawide negative origin (3441x1440)" },
      { area: { x: 3840, y: -200, width: 3442, height: 1440 }, gapOuter: 12, gapInner: 10, label: "Residue 2 ultrawide positive/negative origin (3442x1440)" },
      // Diverse resolutions and gap configurations
      { area: { x: -2560, y: -1440, width: 2560, height: 1440 }, gapOuter: 15, gapInner: 12, label: "2560x1440 with custom gaps go:15 gi:12" },
      { area: { x: 100, y: 50, width: 1366, height: 768 }, gapOuter: 0, gapInner: 0, label: "1366x768 zero-gap boundary" },
      { area: { x: 0, y: 0, width: 3840, height: 2160 }, gapOuter: 16, gapInner: 10, label: "4K UHD 3840x2160" }
    ];

    for (const tc of testCases) {
      const { area, gapOuter: go, gapInner: gi } = tc;
      const zones = computeSnapZones(area, go, gi);

      const leftPillar = zones[7];
      const centerPillar = zones[8];
      const centerTop = zones[9];
      const centerBottom = zones[10];
      const rightPillar = zones[11];

      const uw = area.width - (go * 2);
      const uh = area.height - (go * 2);
      const totalColW = Math.max(0, uw - (2 * gi));

      const wLeft = leftPillar.targetRect.width;
      const wCenter = centerPillar.targetRect.width;
      const wRight = rightPillar.targetRect.width;

      // 1. Equal-width contract: max(width) - min(width) <= 1 for all residues
      const maxColW = Math.max(wLeft, wCenter, wRight);
      const minColW = Math.min(wLeft, wCenter, wRight);
      expect(maxColW - minColW, `${tc.label}: width difference must be <= 1`).toBeLessThanOrEqual(1);

      // 2. Outer pillars must be exactly equal in width
      expect(wLeft, `${tc.label}: outer pillars must have identical width`).toBe(wRight);

      // 3. Sum of all three pillar widths exactly partitions totalColW
      expect(wLeft + wCenter + wRight, `${tc.label}: column widths must partition totalColW`).toBe(totalColW);

      // 4. Exact X offsets respect screen origin, outer gaps, and inner gaps
      expect(leftPillar.targetRect.x, `${tc.label}: left pillar x offset`).toBe(area.x + go);
      expect(centerPillar.targetRect.x, `${tc.label}: center pillar x offset`).toBe(leftPillar.targetRect.x + wLeft + gi);
      expect(rightPillar.targetRect.x, `${tc.label}: right pillar x offset`).toBe(centerPillar.targetRect.x + wCenter + gi);

      // 5. Right edge of right pillar touches right outer margin exactly
      expect(rightPillar.targetRect.x + wRight, `${tc.label}: right pillar outer boundary`).toBe(area.x + area.width - go);

      // 6. Outer and center full pillars span full usable height
      expect(leftPillar.targetRect.height, `${tc.label}: left pillar height`).toBe(uh);
      expect(rightPillar.targetRect.height, `${tc.label}: right pillar height`).toBe(uh);
      expect(centerPillar.targetRect.height, `${tc.label}: center pillar full height`).toBe(uh);

      // 7. Stacked center top + gap + bottom exactly equals full center height
      expect(centerTop.targetRect.height + gi + centerBottom.targetRect.height,
        `${tc.label}: stacked center heights + gap must equal full center height`).toBe(centerPillar.targetRect.height);

      // 8. Stacked center top and bottom alignment with center pillar
      expect(centerTop.targetRect.x, `${tc.label}: center top x`).toBe(centerPillar.targetRect.x);
      expect(centerBottom.targetRect.x, `${tc.label}: center bottom x`).toBe(centerPillar.targetRect.x);
      expect(centerTop.targetRect.width, `${tc.label}: center top width`).toBe(centerPillar.targetRect.width);
      expect(centerBottom.targetRect.width, `${tc.label}: center bottom width`).toBe(centerPillar.targetRect.width);
      expect(centerTop.targetRect.y, `${tc.label}: center top y`).toBe(centerPillar.targetRect.y);
      expect(centerTop.targetRect.y + centerTop.targetRect.height + gi, `${tc.label}: center bottom y`).toBe(centerBottom.targetRect.y);
      expect(centerBottom.targetRect.y + centerBottom.targetRect.height, `${tc.label}: center bottom bottom edge`)
        .toBe(centerPillar.targetRect.y + centerPillar.targetRect.height);
    }
  });

  // 25. Snap Zones Hover: 3-Pillar zones 7-11 hover detection and quadrant priority preservation
  it("Snap Zones Hover: 3-Pillar zones 7-11 hover detection and quadrant priority preservation", () => {
    const area: Rect = { x: 0, y: 0, width: 1920, height: 1080 };
    const zones = computeSnapZones(area, 10, 8);

    // Quarters take priority in all 4 corners
    expect(matchSnapZoneHover(zones, { x: 50, y: 50 })).toBe(3); // top-left
    expect(zones[matchSnapZoneHover(zones, { x: 50, y: 50 })].id).toBe("top-left");

    expect(matchSnapZoneHover(zones, { x: 50, y: 1000 })).toBe(4); // bottom-left
    expect(zones[matchSnapZoneHover(zones, { x: 50, y: 1000 })].id).toBe("bottom-left");

    expect(matchSnapZoneHover(zones, { x: 1850, y: 50 })).toBe(5); // top-right
    expect(zones[matchSnapZoneHover(zones, { x: 1850, y: 50 })].id).toBe("top-right");

    expect(matchSnapZoneHover(zones, { x: 1850, y: 1000 })).toBe(6); // bottom-right
    expect(zones[matchSnapZoneHover(zones, { x: 1850, y: 1000 })].id).toBe("bottom-right");

    // Left Pillar at mid-height left edge (x: 50, y: 500)
    const leftPillarMatch = matchSnapZoneHover(zones, { x: 50, y: 500 });
    expect(leftPillarMatch).toBe(7);
    expect(zones[leftPillarMatch].id).toBe("left-pillar");

    // Right Pillar at mid-height right edge (x: 1850, y: 500)
    const rightPillarMatch = matchSnapZoneHover(zones, { x: 1850, y: 500 });
    expect(rightPillarMatch).toBe(11);
    expect(zones[rightPillarMatch].id).toBe("right-pillar");

    // Center Top at upper center (x: 960, y: 200)
    const centerTopMatch = matchSnapZoneHover(zones, { x: 960, y: 200 });
    expect(centerTopMatch).toBe(9);
    expect(zones[centerTopMatch].id).toBe("center-top");

    // Center Bottom at lower center (x: 960, y: 800)
    const centerBottomMatch = matchSnapZoneHover(zones, { x: 960, y: 800 });
    expect(centerBottomMatch).toBe(10);
    expect(zones[centerBottomMatch].id).toBe("center-bottom");

    // Center Pillar at mid-height center (x: 960, y: 500)
    const centerPillarMatch = matchSnapZoneHover(zones, { x: 960, y: 500 });
    expect(centerPillarMatch).toBe(8);
    expect(zones[centerPillarMatch].id).toBe("center-pillar");
  });

  // 26. Geometry Cache: RetainedWindowState stores currentDesiredTiledGeometry upon reconcile
  it("Geometry Cache: RetainedWindowState stores currentDesiredTiledGeometry upon reconcile", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-cache-1",
        outputId: "HDMI-A-1",
        resourceClass: "terminal",
        frameGeometry: { x: 100, y: 100, width: 500, height: 400 }
      }
    });

    const winBefore = coordinator.getRetainedWindow("win-cache-1");
    expect(winBefore?.currentDesiredTiledGeometry).toBeNull();

    coordinator.reconcile();

    const winAfter = coordinator.getRetainedWindow("win-cache-1");
    expect(winAfter?.currentDesiredTiledGeometry).not.toBeNull();
    expect(winAfter?.currentDesiredTiledGeometry?.width).toBeGreaterThan(100);
  });

  // 27. Geometry Cache: getSavedTiledGeometry and setSavedTiledGeometry accessors
  it("Geometry Cache: getSavedTiledGeometry and setSavedTiledGeometry accessors", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-cache-2",
        outputId: "HDMI-A-1",
        resourceClass: "editor"
      }
    });

    expect(coordinator.getSavedTiledGeometry("win-cache-2")).toBeNull();

    const testRect: Rect = { x: 50, y: 50, width: 900, height: 700 };
    coordinator.setSavedTiledGeometry("win-cache-2", testRect);

    expect(coordinator.getSavedTiledGeometry("win-cache-2")).toEqual(testRect);
  });

  // 28. Geometry Cache: preMinimizeGeometry saved on minimize
  it("Geometry Cache: preMinimizeGeometry saved when window is minimized", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-minim-1",
        outputId: "HDMI-A-1",
        frameGeometry: { x: 200, y: 150, width: 800, height: 600 }
      }
    });

    // Minimize via handleMinimize
    coordinator.handleMinimize("win-minim-1", true);

    const win = coordinator.getRetainedWindow("win-minim-1");
    expect(win?.minimized).toBe(true);
    expect(win?.preMinimizeGeometry).toEqual({ x: 200, y: 150, width: 800, height: 600 });
  });

  // 29. Geometry Cache: getPreMinimizeGeometry and setPreMinimizeGeometry accessors
  it("Geometry Cache: getPreMinimizeGeometry and setPreMinimizeGeometry accessors", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: { id: "win-minim-2", outputId: "HDMI-A-1" }
    });

    expect(coordinator.getPreMinimizeGeometry("win-minim-2")).toBeNull();

    const customMinim: Rect = { x: 300, y: 200, width: 640, height: 480 };
    coordinator.setPreMinimizeGeometry("win-minim-2", customMinim);

    expect(coordinator.getPreMinimizeGeometry("win-minim-2")).toEqual(customMinim);
  });

  // 30. Geometry Cache: isPreTiled tracking and accessors
  it("Geometry Cache: isPreTiled tracking and accessors", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: { id: "win-pretiled-1", outputId: "HDMI-A-1", isPreTiled: true }
    });

    expect(coordinator.isPreTiled("win-pretiled-1")).toBe(true);

    coordinator.setPreTiled("win-pretiled-1", false);
    expect(coordinator.isPreTiled("win-pretiled-1")).toBe(false);
  });

  // 31. Geometry Cache: Unmaximizing window restores saved tiled geometry
  it("Geometry Cache: Unmaximizing window restores saved tiled geometry", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);

    // Discovered window tiled initially
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-max-1",
        outputId: "HDMI-A-1",
        resourceClass: "browser"
      }
    });
    coordinator.reconcile();

    const saved = coordinator.getSavedTiledGeometry("win-max-1");
    expect(saved).not.toBeNull();

    // Maximize window
    coordinator.ingestEvent({
      type: "WindowStateChanged",
      windowId: "win-max-1",
      updates: { maximizeMode: 3 }
    });
    coordinator.reconcile();

    // Verify saved tiled geometry was preserved
    expect(coordinator.getSavedTiledGeometry("win-max-1")).toEqual(saved);
  });

  // 32. Topology Change & Exclusivity
  it("Topology Change & Exclusivity: handleTopologyChange relocates windows and reconciles without legacy fallback", () => {
    const coordinator = new RuntimeCoordinator();
    coordinator.getOrCreateScreen(SCREEN_PRIMARY);
    coordinator.getOrCreateScreen(SCREEN_SECONDARY);

    // Place window on SCREEN_SECONDARY
    coordinator.ingestEvent({
      type: "WindowDiscovered",
      window: {
        id: "win-topo-1",
        outputId: "DP-1",
        resourceClass: "editor",
        frameGeometry: { x: 2000, y: 100, width: 800, height: 600 }
      }
    });
    coordinator.reconcile();

    expect(coordinator.getRetainedWindow("win-topo-1")?.outputId).toBe("DP-1");

    // Secondary screen is unplugged! Remaining screen is only SCREEN_PRIMARY
    const topoTx = coordinator.handleTopologyChange([SCREEN_PRIMARY]);
    expect(topoTx).not.toBeNull();

    // Window must be automatically relocated to SCREEN_PRIMARY
    const win = coordinator.getRetainedWindow("win-topo-1");
    expect(win?.outputId).toBe("HDMI-A-1");
    expect(win?.outputAffinity).toBe("HDMI-A-1");

    // Persistent order on primary screen contains the relocated window
    const primaryScreen = coordinator.getRetainedScreen("HDMI-A-1");
    expect(primaryScreen?.persistentOrder).toContain("win-topo-1");
  });
});

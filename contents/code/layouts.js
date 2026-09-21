/**
 * Tessera Tiling Window Manager - Layout Calculation Engine
 * Pure mathematical layout geometry functions for KWin 6.
 */

var Layouts = (function () {
    "use strict";

    function applyGaps(rect, gapInner, gapOuter, isLeft, isRight, isTop, isBottom) {
        var x = rect.x + (isLeft ? gapOuter : Math.floor(gapInner / 2));
        var y = rect.y + (isTop ? gapOuter : Math.floor(gapInner / 2));
        var r = (rect.x + rect.width) - (isRight ? gapOuter : Math.ceil(gapInner / 2));
        var b = (rect.y + rect.height) - (isBottom ? gapOuter : Math.ceil(gapInner / 2));
        return {
            x: x,
            y: y,
            width: Math.max(100, r - x),
            height: Math.max(80, b - y)
        };
    }

    /**
     * Master-Stack Layout:
     * One or more Master windows on left/primary pane, remaining windows vertically stacked on secondary pane.
     */
    function masterStack(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
        var masterRatio = options.masterRatio !== undefined ? options.masterRatio : 0.50;
        var masterCount = Math.max(0, options.masterCount !== undefined ? options.masterCount : 1);

        if (count === 1) {
            results.push(applyGaps(area, gapInner, gapOuter, true, true, true, true));
            return results;
        }

        // When 0 masters are configured, arrange windows in an optimal balanced square grid
        // instead of maximizing or creating a single huge master!
        if (masterCount === 0) {
            return balancedGrid(area, count, options);
        }

        // When there are only 2 windows on the screen (e.g. 1 master + 1 stack, or 2 masters),
        // default to an exact 50/50 side-by-side split!
        if (count === 2) {
            var halfW = Math.floor(area.width / 2);
            results.push(applyGaps({ x: area.x, y: area.y, width: halfW, height: area.height }, gapInner, gapOuter, true, false, true, true));
            results.push(applyGaps({ x: area.x + halfW, y: area.y, width: area.width - halfW, height: area.height }, gapInner, gapOuter, false, true, true, true));
            return results;
        }

        var actualMasters = Math.min(count, masterCount);
        var stackCount = count - actualMasters;

        // When all windows are master windows (e.g. masterCount >= count),
        // arrange them as side-by-side columns rather than vertical horizontal slivers!
        if (stackCount === 0) {
            var colWidth = Math.floor(area.width / actualMasters);
            for (var c = 0; c < actualMasters; c++) {
                var cx = area.x + (c * colWidth);
                var cw = (c === actualMasters - 1) ? (area.width - (c * colWidth)) : colWidth;
                var colRect = {
                    x: cx,
                    y: area.y,
                    width: cw,
                    height: area.height
                };
                results.push(applyGaps(
                    colRect,
                    gapInner,
                    gapOuter,
                    c === 0,
                    c === actualMasters - 1,
                    true,
                    true
                ));
            }
            return results;
        }

        var masterWidth = Math.floor(area.width * masterRatio);
        var stackWidth = area.width - masterWidth;

        // Calculate Master Column
        var masterHeight = Math.floor(area.height / actualMasters);
        for (var m = 0; m < actualMasters; m++) {
            var my = area.y + (m * masterHeight);
            var mh = (m === actualMasters - 1) ? (area.height - (m * masterHeight)) : masterHeight;
            var rect = {
                x: area.x,
                y: my,
                width: masterWidth,
                height: mh
            };
            results.push(applyGaps(
                rect,
                gapInner,
                gapOuter,
                true,
                false,
                m === 0,
                m === actualMasters - 1
            ));
        }

        // Calculate Stack Column
        if (stackCount > 0) {
            var stackHeight = Math.floor(area.height / stackCount);
            for (var s = 0; s < stackCount; s++) {
                var sy = area.y + (s * stackHeight);
                var sh = (s === stackCount - 1) ? (area.height - (s * stackHeight)) : stackHeight;
                var sRect = {
                    x: area.x + masterWidth,
                    y: sy,
                    width: stackWidth,
                    height: sh
                };
                results.push(applyGaps(
                    sRect,
                    gapInner,
                    gapOuter,
                    false,
                    true,
                    s === 0,
                    s === stackCount - 1
                ));
            }
        }

        return results;
    }

    /**
     * Binary Space Partitioning (BSP / Dwindle Spiral)
     * Recursively splits alternating between horizontal and vertical partitions.
     */
    function binarySplit(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;

        if (count === 1) {
            results.push(applyGaps(area, gapInner, gapOuter, true, true, true, true));
            return results;
        }

        var currentArea = { x: area.x, y: area.y, width: area.width, height: area.height };
        var isHorizontal = true; // start with vertical split line (left/right)

        for (var i = 0; i < count; i++) {
            if (i === count - 1) {
                // Last window takes the remaining box
                results.push(applyGaps(currentArea, gapInner, gapOuter, true, true, true, true));
                break;
            }

            var nextArea = {};
            var windowArea = {};

            if (isHorizontal) {
                var w = Math.floor(currentArea.width / 2);
                windowArea = { x: currentArea.x, y: currentArea.y, width: w, height: currentArea.height };
                nextArea = { x: currentArea.x + w, y: currentArea.y, width: currentArea.width - w, height: currentArea.height };
            } else {
                var h = Math.floor(currentArea.height / 2);
                windowArea = { x: currentArea.x, y: currentArea.y, width: currentArea.width, height: h };
                nextArea = { x: currentArea.x, y: currentArea.y + h, width: currentArea.width, height: currentArea.height - h };
            }

            results.push(applyGaps(windowArea, gapInner, gapOuter, true, true, true, true));
            currentArea = nextArea;
            isHorizontal = !isHorizontal;
        }

        return results;
    }

    /**
     * Columns Layout:
     * Windows arranged side-by-side in equal vertical columns.
     */
    function columns(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;

        var colWidth = Math.floor(area.width / count);
        for (var i = 0; i < count; i++) {
            var w = (i === count - 1) ? (area.width - (i * colWidth)) : colWidth;
            var rect = {
                x: area.x + (i * colWidth),
                y: area.y,
                width: w,
                height: area.height
            };
            results.push(applyGaps(rect, gapInner, gapOuter, i === 0, i === count - 1, true, true));
        }
        return results;
    }

    /**
     * Rows Layout:
     * Windows arranged horizontally stacked in equal rows.
     */
    function rows(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;

        var rowHeight = Math.floor(area.height / count);
        for (var i = 0; i < count; i++) {
            var h = (i === count - 1) ? (area.height - (i * rowHeight)) : rowHeight;
            var rect = {
                x: area.x,
                y: area.y + (i * rowHeight),
                width: area.width,
                height: h
            };
            results.push(applyGaps(rect, gapInner, gapOuter, true, true, i === 0, i === count - 1));
        }
        return results;
    }

    /**
     * Monocle / Fullscreen Deck:
     * Each window receives the full workspace area.
     */
    function monocle(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;
        var rect = applyGaps(area, 0, gapOuter, true, true, true, true);

        for (var i = 0; i < count; i++) {
            results.push({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });
        }
        return results;
    }

    /**
     * Balanced Square Grid Layout:
     * Arranges windows into an optimal balanced, square-like grid with no single dominant master.
     * Special cases:
     * - 4 windows: 4 equal quarters (2x2)
     * - 5 windows: two horizontal split sides on each end (2 windows on left, 2 windows on right)
     *   and a stack (1 full-height window) in the middle!
     * - N >= 6: symmetrical column/row partitioning.
     */
    function balancedGrid(area, count, options) {
        var results = [];
        if (count <= 0) return results;

        var gapInner = options.gapInner !== undefined ? options.gapInner : 8;
        var gapOuter = options.gapOuter !== undefined ? options.gapOuter : 10;

        if (count === 1) {
            results.push(applyGaps(area, gapInner, gapOuter, true, true, true, true));
            return results;
        }

        if (count === 2) {
            var w0 = Math.floor(area.width / 2);
            var w1 = area.width - w0;
            results.push(applyGaps({ x: area.x, y: area.y, width: w0, height: area.height }, gapInner, gapOuter, true, false, true, true));
            results.push(applyGaps({ x: area.x + w0, y: area.y, width: w1, height: area.height }, gapInner, gapOuter, false, true, true, true));
            return results;
        }

        if (count === 3) {
            var colW = Math.floor(area.width / 3);
            for (var c = 0; c < 3; c++) {
                var cx = area.x + (c * colW);
                var cw = (c === 2) ? (area.width - (2 * colW)) : colW;
                results.push(applyGaps({ x: cx, y: area.y, width: cw, height: area.height }, gapInner, gapOuter, c === 0, c === 2, true, true));
            }
            return results;
        }

        if (count === 4) {
            // 4 quarters (2 columns x 2 rows)
            var colW = Math.floor(area.width / 2);
            var rowH = Math.floor(area.height / 2);
            for (var col = 0; col < 2; col++) {
                var cx = area.x + (col * colW);
                var cw = (col === 1) ? (area.width - colW) : colW;
                for (var row = 0; row < 2; row++) {
                    var ry = area.y + (row * rowH);
                    var rh = (row === 1) ? (area.height - rowH) : rowH;
                    results.push(applyGaps({ x: cx, y: ry, width: cw, height: rh }, gapInner, gapOuter, col === 0, col === 1, row === 0, row === 1));
                }
            }
            return results;
        }

        if (count === 5) {
            // 5 windows: two horizontal split sides on each end and a stack in the middle
            var colW = Math.floor(area.width / 3);
            var colW0 = colW;
            var colW1 = colW;
            var colW2 = area.width - (colW0 + colW1);
            var rowH = Math.floor(area.height / 2);

            // Left end: 2 windows (top, bottom)
            results.push(applyGaps({ x: area.x, y: area.y, width: colW0, height: rowH }, gapInner, gapOuter, true, false, true, false));
            results.push(applyGaps({ x: area.x, y: area.y + rowH, width: colW0, height: area.height - rowH }, gapInner, gapOuter, true, false, false, true));

            // Middle: 1 window full height
            results.push(applyGaps({ x: area.x + colW0, y: area.y, width: colW1, height: area.height }, gapInner, gapOuter, false, false, true, true));

            // Right end: 2 windows (top, bottom)
            var rightX = area.x + colW0 + colW1;
            results.push(applyGaps({ x: rightX, y: area.y, width: colW2, height: rowH }, gapInner, gapOuter, false, true, true, false));
            results.push(applyGaps({ x: rightX, y: area.y + rowH, width: colW2, height: area.height - rowH }, gapInner, gapOuter, false, true, false, true));

            return results;
        }

        // N >= 6: Symmetrical balanced square grid
        var numCols = 3;
        if (count >= 8 && count <= 10) {
            numCols = (count === 9) ? 3 : 4;
        } else if (count > 10) {
            numCols = Math.ceil(Math.sqrt(count * (area.width / area.height)));
        }

        var countsPerCol = [];
        var base = Math.floor(count / numCols);
        var rem = count % numCols;
        for (var i = 0; i < numCols; i++) {
            countsPerCol.push(base);
        }
        if (rem === 1) {
            var mid = Math.floor(numCols / 2);
            countsPerCol[mid]++;
        } else if (rem === 2 && numCols === 3) {
            countsPerCol[0]++;
            countsPerCol[2]++;
        } else if (rem > 0) {
            var left = 0;
            var right = numCols - 1;
            while (rem > 0) {
                countsPerCol[left]++;
                rem--;
                if (rem > 0 && left !== right) {
                    countsPerCol[right]++;
                    rem--;
                }
                left++;
                right--;
                if (left > right) {
                    left = 0;
                    right = numCols - 1;
                }
            }
        }

        var colW = Math.floor(area.width / numCols);
        var currentX = area.x;

        for (var c = 0; c < numCols; c++) {
            var cw = (c === numCols - 1) ? (area.x + area.width - currentX) : colW;
            var numRows = countsPerCol[c];
            var rowH = Math.floor(area.height / numRows);
            var currentY = area.y;

            for (var r = 0; r < numRows; r++) {
                var rh = (r === numRows - 1) ? (area.y + area.height - currentY) : rowH;
                results.push(applyGaps(
                    { x: currentX, y: currentY, width: cw, height: rh },
                    gapInner,
                    gapOuter,
                    c === 0,
                    c === numCols - 1,
                    r === 0,
                    r === numRows - 1
                ));
                currentY += rh;
            }
            currentX += cw;
        }

        return results;
    }

    return {
        masterStack: masterStack,
        balancedGrid: balancedGrid,
        grid: balancedGrid,
        binarySplit: binarySplit,
        columns: columns,
        rows: rows,
        monocle: monocle,
        supportedLayouts: ["master-stack", "bsp", "columns", "rows", "grid", "monocle", "floating"]
    };
})();

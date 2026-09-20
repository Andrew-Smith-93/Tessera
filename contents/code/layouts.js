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
        var masterRatio = options.masterRatio !== undefined ? options.masterRatio : 0.55;
        var masterCount = Math.max(1, options.masterCount !== undefined ? options.masterCount : 1);

        if (count === 1) {
            results.push(applyGaps(area, gapInner, gapOuter, true, true, true, true));
            return results;
        }

        var actualMasters = Math.min(count, masterCount);
        var stackCount = count - actualMasters;

        var masterWidth = (stackCount > 0) ? Math.floor(area.width * masterRatio) : area.width;
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
                stackCount === 0,
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

    return {
        masterStack: masterStack,
        binarySplit: binarySplit,
        columns: columns,
        rows: rows,
        monocle: monocle,
        supportedLayouts: ["master-stack", "bsp", "columns", "rows", "monocle", "floating"]
    };
})();

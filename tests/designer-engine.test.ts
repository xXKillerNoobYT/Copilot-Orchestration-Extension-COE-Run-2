import { DesignerEngine } from "../src/core/designer-engine";

describe("DesignerEngine", () => {
    let engine: DesignerEngine;

    beforeEach(() => {
        engine = new DesignerEngine();
    });

    // ==================== SNAP GRID TESTS ====================

    describe("Snap Grid", () => {
        test("snaps to grid at default size (8px)", () => {
            const result = engine.snapToGrid(13, 19);
            expect(result.x).toBe(16);
            expect(result.y).toBe(16);
        });

        test("snaps to grid at custom size", () => {
            engine.setGridSize(10);
            const result = engine.snapToGrid(13, 27);
            expect(result.x).toBe(10);
            expect(result.y).toBe(30);
        });

        test("snap handles zero", () => {
            const result = engine.snapToGrid(0, 0);
            expect(result.x).toBe(0);
            expect(result.y).toBe(0);
        });

        test("snap handles negative coordinates", () => {
            const result = engine.snapToGrid(-13, -19);
            expect(result.x).toBe(-16);
            expect(result.y).toBe(-16);
        });

        test("set grid size enforces minimum of 1", () => {
            engine.setGridSize(0);
            expect(engine.getGridSize()).toBe(1);
            engine.setGridSize(-5);
            expect(engine.getGridSize()).toBe(1);
        });

        test("toggle grid visibility", () => {
            expect(engine.isGridVisible()).toBe(true);
            engine.toggleGrid(false);
            expect(engine.isGridVisible()).toBe(false);
            engine.toggleGrid(true);
            expect(engine.isGridVisible()).toBe(true);
        });

        test("toggle guides visibility", () => {
            expect(engine.isGuidesVisible()).toBe(true);
            engine.toggleGuides(false);
            expect(engine.isGuidesVisible()).toBe(false);
        });

        test("get and set snap threshold", () => {
            expect(engine.getSnapThreshold()).toBe(5);
            engine.setSnapThreshold(10);
            expect(engine.getSnapThreshold()).toBe(10);
        });

        test("snap threshold enforces minimum of 1", () => {
            engine.setSnapThreshold(0);
            expect(engine.getSnapThreshold()).toBe(1);
            engine.setSnapThreshold(-3);
            expect(engine.getSnapThreshold()).toBe(1);
        });

        test("snap rounds to nearest grid line", () => {
            const r1 = engine.snapToGrid(3, 3);
            expect(r1.x).toBe(0);
            expect(r1.y).toBe(0);
            const r2 = engine.snapToGrid(5, 5);
            expect(r2.x).toBe(8);
            expect(r2.y).toBe(8);
        });
    });

    // ==================== ALIGNMENT GUIDES TESTS ====================

    describe("Alignment Guides", () => {
        const otherRects = [
            { id: "a", x: 100, y: 100, width: 50, height: 50 },
            { id: "b", x: 300, y: 200, width: 80, height: 60 },
        ];

        test("left edge alignment", () => {
            const dragged = { x: 102, y: 50, width: 200, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(true);
            expect(result.x).toBe(100);
            expect(result.guides.some(g => g.type === "vertical" && g.position === 100)).toBe(true);
        });

        test("right edge alignment", () => {
            const dragged = { x: -48, y: 50, width: 200, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(true);
            expect(result.x).toBe(-50);
        });

        test("center X alignment", () => {
            const dragged = { x: 98, y: 50, width: 50, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(true);
        });

        test("top edge alignment", () => {
            const dragged = { x: 50, y: 102, width: 40, height: 200 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedY).toBe(true);
            expect(result.y).toBe(100);
        });

        test("bottom edge alignment", () => {
            const dragged = { x: 50, y: 112, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedY).toBe(true);
            expect(result.y).toBe(110);
        });

        test("center Y alignment", () => {
            const dragged = { x: 50, y: 98, width: 40, height: 50 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedY).toBe(true);
        });

        test("left-to-right edge snap", () => {
            const dragged = { x: 148, y: 50, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(true);
            expect(result.x).toBe(150);
        });

        test("right-to-left edge snap", () => {
            const dragged = { x: 62, y: 50, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(true);
            expect(result.x).toBe(60);
        });

        test("top-to-bottom snap", () => {
            const dragged = { x: 50, y: 148, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedY).toBe(true);
            expect(result.y).toBe(150);
        });

        test("bottom-to-top snap", () => {
            const dragged = { x: 50, y: 62, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedY).toBe(true);
            expect(result.y).toBe(60);
        });

        test("no snap when outside threshold", () => {
            const dragged = { x: 200, y: 500, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(false);
            expect(result.snappedY).toBe(false);
            expect(result.guides).toHaveLength(0);
        });

        test("multiple guides from multiple elements", () => {
            const rects = [
                { id: "a", x: 100, y: 100, width: 50, height: 50 },
                { id: "b", x: 100, y: 200, width: 80, height: 60 },
            ];
            const dragged = { x: 102, y: 50, width: 40, height: 40 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", rects);
            expect(result.guides.filter(g => g.type === "vertical").length).toBeGreaterThanOrEqual(2);
        });

        test("skip self when calculating guides", () => {
            const rects = [
                { id: "drag", x: 100, y: 100, width: 50, height: 50 },
                { id: "other", x: 300, y: 300, width: 50, height: 50 },
            ];
            const dragged = { x: 100, y: 100, width: 50, height: 50 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", rects);
            expect(result.guides.every(g => g.targetId !== "drag")).toBe(true);
        });

        test("custom snap threshold", () => {
            engine.setSnapThreshold(2);
            const dragged = { x: 200, y: 500, width: 30, height: 30 };
            const result = engine.calculateAlignmentGuides(dragged, "drag", otherRects);
            expect(result.snappedX).toBe(false);
        });
    });

    // ==================== MULTI-SELECT TESTS ====================

    describe("Multi-Select", () => {
        const elements = [
            { id: "a", x: 10, y: 10, width: 50, height: 50 },
            { id: "b", x: 100, y: 100, width: 80, height: 60 },
            { id: "c", x: 200, y: 200, width: 40, height: 40 },
        ];

        test("select elements in rectangle", () => {
            const sel = { x: 0, y: 0, width: 120, height: 120 };
            const ids = engine.selectByRect(sel, elements);
            expect(ids).toContain("a");
            expect(ids).toContain("b");
            expect(ids).not.toContain("c");
        });

        test("empty selection when no overlap", () => {
            const sel = { x: 500, y: 500, width: 10, height: 10 };
            const ids = engine.selectByRect(sel, elements);
            expect(ids).toHaveLength(0);
        });

        test("partial overlap counts", () => {
            const sel = { x: 50, y: 50, width: 60, height: 60 };
            const ids = engine.selectByRect(sel, elements);
            expect(ids).toContain("a");
            expect(ids).toContain("b");
        });

        test("selection bounds calculation", () => {
            const bounds = engine.getSelectionBounds(["a", "b"], elements);
            expect(bounds).not.toBeNull();
            expect(bounds?.x).toBe(10);
            expect(bounds?.y).toBe(10);
            expect(bounds?.width).toBe(170);
            expect(bounds?.height).toBe(150);
            expect(bounds?.selectedIds).toEqual(["a", "b"]);
        });

        test("null bounds when empty selection", () => {
            const bounds = engine.getSelectionBounds([], elements);
            expect(bounds).toBeNull();
        });

        test("null bounds when no matching ids", () => {
            const bounds = engine.getSelectionBounds(["nonexistent"], elements);
            expect(bounds).toBeNull();
        });

        test("move selection applies delta", () => {
            const moved = engine.moveSelection(["a", "b"], elements, 10, 20);
            expect(moved).toHaveLength(2);
            const a = moved.find(m => m.id === "a");
            expect(a?.x).toBe(20);
            expect(a?.y).toBe(30);
            const b = moved.find(m => m.id === "b");
            expect(b?.x).toBe(110);
            expect(b?.y).toBe(120);
        });

        test("resize selection from anchor point", () => {
            const resized = engine.resizeSelection(["a"], elements, 2, 2, { x: 0, y: 0 });
            expect(resized).toHaveLength(1);
            expect(resized[0].x).toBe(20);
            expect(resized[0].y).toBe(20);
            expect(resized[0].width).toBe(100);
            expect(resized[0].height).toBe(100);
        });
    });

    // ==================== LAYOUT OPERATIONS TESTS ====================

    describe("Layout Operations", () => {
        const elements = [
            { id: "a", x: 10, y: 20, width: 50, height: 30 },
            { id: "b", x: 100, y: 50, width: 80, height: 60 },
            { id: "c", x: 200, y: 10, width: 40, height: 40 },
        ];
        const allIds = ["a", "b", "c"];

        test("align left", () => {
            const op = engine.alignElements(allIds, elements, "align-left");
            expect(op.type).toBe("align-left");
            expect(op.results.every(r => r.x === 10)).toBe(true);
        });

        test("align right", () => {
            const op = engine.alignElements(allIds, elements, "align-right");
            expect(op.type).toBe("align-right");
            // maxRight = 200 + 40 = 240
            const aResult = op.results.find(r => r.id === "a");
            expect(aResult?.x).toBe(190); // 240 - 50
            const cResult = op.results.find(r => r.id === "c");
            expect(cResult?.x).toBe(200); // 240 - 40
        });

        test("align center", () => {
            const op = engine.alignElements(allIds, elements, "align-center");
            expect(op.type).toBe("align-center");
            expect(op.results).toHaveLength(3);
        });

        test("align top", () => {
            const op = engine.alignElements(allIds, elements, "align-top");
            expect(op.results.every(r => r.y === 10)).toBe(true);
        });

        test("align bottom", () => {
            const op = engine.alignElements(allIds, elements, "align-bottom");
            // maxBottom = max(50, 110, 50) = 110
            const aResult = op.results.find(r => r.id === "a");
            expect(aResult?.y).toBe(80); // 110 - 30
        });

        test("align middle", () => {
            const op = engine.alignElements(allIds, elements, "align-middle");
            expect(op.type).toBe("align-middle");
            expect(op.results).toHaveLength(3);
        });

        test("distribute horizontally", () => {
            const op = engine.alignElements(allIds, elements, "distribute-h");
            expect(op.type).toBe("distribute-h");
            expect(op.results).toHaveLength(3);
            // Elements should be sorted by x and evenly spaced
            const sorted = [...op.results].sort((a, b) => a.x - b.x);
            expect(sorted[0].x).toBeLessThan(sorted[1].x);
            expect(sorted[1].x).toBeLessThan(sorted[2].x);
        });

        test("distribute vertically", () => {
            const op = engine.alignElements(allIds, elements, "distribute-v");
            expect(op.type).toBe("distribute-v");
            expect(op.results).toHaveLength(3);
        });

        test("auto-arrange in grid", () => {
            const op = engine.alignElements(allIds, elements, "auto-arrange");
            expect(op.type).toBe("auto-arrange");
            expect(op.results).toHaveLength(3);
            // With 3 elements, cols = ceil(sqrt(3)) = 2
            expect(op.results[0].x).toBe(0);
            expect(op.results[0].y).toBe(0);
        });

        test("single element alignment returns unchanged", () => {
            const op = engine.alignElements(["a"], elements, "align-left");
            expect(op.results).toHaveLength(1);
            expect(op.results[0].x).toBe(10);
            expect(op.results[0].y).toBe(20);
        });
    });

    // ==================== CODE EXPORT TESTS ====================

    describe("Code Export", () => {
        const components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }> = [
            {
                id: "btn1", type: "button", name: "Submit Button",
                x: 10, y: 20, width: 120, height: 40,
                styles: { backgroundColor: "#007bff", color: "white" },
                content: "Submit",
            },
            {
                id: "txt1", type: "text", name: "Title Text",
                x: 10, y: 80, width: 200, height: 30,
                styles: { fontSize: "24px" },
                content: "Hello World",
            },
            {
                id: "div1", type: "container", name: "Main Container",
                x: 0, y: 0, width: 400, height: 300,
                styles: {},
                content: "",
            },
        ];

        test("export React component", () => {
            const result = engine.exportToCode(components, { format: "react" });
            expect(result.language).toBe("tsx");
            expect(result.code).toContain("import React");
            expect(result.code).toContain("function");
            expect(result.files.length).toBeGreaterThanOrEqual(1);
        });

        test("export HTML page", () => {
            const result = engine.exportToCode(components, { format: "html" });
            expect(result.language).toBe("html");
            expect(result.code).toContain("<!DOCTYPE html>");
            expect(result.files[0].name).toBe("index.html");
        });

        test("export CSS only", () => {
            const result = engine.exportToCode(components, { format: "css" });
            expect(result.language).toBe("css");
            expect(result.code).toContain(".design-container");
            expect(result.code).toContain("position: absolute");
            expect(result.files[0].name).toBe("styles.css");
        });

        test("export JSON", () => {
            const result = engine.exportToCode(components, { format: "json" });
            expect(result.language).toBe("json");
            const parsed = JSON.parse(result.code);
            expect(parsed).toHaveLength(3);
            expect(result.files[0].name).toBe("design.json");
        });

        test("export with custom prefix", () => {
            const result = engine.exportToCode(components, { format: "react", componentPrefix: "My" });
            expect(result.code).toContain("MyPage");
        });

        test("export with styles included", () => {
            const result = engine.exportToCode(components, { format: "react", includeStyles: true });
            expect(result.files.length).toBe(2);
            expect(result.files.some(f => f.name === "styles.css")).toBe(true);
        });

        test("export with no styles", () => {
            const result = engine.exportToCode(components, { format: "react", includeStyles: false });
            expect(result.files.length).toBe(1);
            expect(result.files.every(f => f.name !== "styles.css")).toBe(true);
        });

        test("React export has import statement", () => {
            const result = engine.exportToCode(components, { format: "react" });
            expect(result.code).toContain("import React");
            expect(result.code).toContain("import");
        });

        test("HTML export has DOCTYPE", () => {
            const result = engine.exportToCode(components, { format: "html" });
            expect(result.code.startsWith("<!DOCTYPE html>")).toBe(true);
        });

        test("CSS uses kebab-case properties", () => {
            const result = engine.exportToCode(components, { format: "css" });
            expect(result.code).toContain("background-color");
            expect(result.code).toContain("font-size");
        });

        test("multiple files in export result", () => {
            const result = engine.exportToCode(components, { format: "react", includeStyles: true });
            expect(result.files.length).toBeGreaterThan(1);
            result.files.forEach(f => {
                expect(f.name).toBeTruthy();
                expect(f.content).toBeTruthy();
            });
        });
    });

    // ==================== COLLISION DETECTION TESTS ====================

    describe("Collision Detection", () => {
        test("detect overlapping elements", () => {
            const elements = [
                { id: "a", x: 0, y: 0, width: 100, height: 100 },
                { id: "b", x: 50, y: 50, width: 100, height: 100 },
            ];
            const collisions = engine.detectCollisions(elements);
            expect(collisions).toHaveLength(1);
            expect(collisions[0].id1).toBe("a");
            expect(collisions[0].id2).toBe("b");
        });

        test("no collision for separated elements", () => {
            const elements = [
                { id: "a", x: 0, y: 0, width: 50, height: 50 },
                { id: "b", x: 200, y: 200, width: 50, height: 50 },
            ];
            const collisions = engine.detectCollisions(elements);
            expect(collisions).toHaveLength(0);
        });

        test("calculate overlap rectangle", () => {
            const elements = [
                { id: "a", x: 0, y: 0, width: 100, height: 100 },
                { id: "b", x: 60, y: 70, width: 100, height: 100 },
            ];
            const collisions = engine.detectCollisions(elements);
            expect(collisions[0].overlap.x).toBe(60);
            expect(collisions[0].overlap.y).toBe(70);
            expect(collisions[0].overlap.width).toBe(40);
            expect(collisions[0].overlap.height).toBe(30);
        });

        test("multiple collisions", () => {
            const elements = [
                { id: "a", x: 0, y: 0, width: 100, height: 100 },
                { id: "b", x: 50, y: 50, width: 100, height: 100 },
                { id: "c", x: 80, y: 80, width: 100, height: 100 },
            ];
            const collisions = engine.detectCollisions(elements);
            expect(collisions.length).toBeGreaterThanOrEqual(2);
        });

        test("touching edges are not collisions", () => {
            const elements = [
                { id: "a", x: 0, y: 0, width: 50, height: 50 },
                { id: "b", x: 50, y: 0, width: 50, height: 50 },
            ];
            const collisions = engine.detectCollisions(elements);
            expect(collisions).toHaveLength(0);
        });
    });

    // ==================== HELPER TESTS ====================

    describe("Helpers", () => {
        test("toPascalCase converts hyphenated", () => {
            expect(engine.toPascalCase("my-component")).toBe("MyComponent");
        });

        test("toPascalCase converts underscored", () => {
            expect(engine.toPascalCase("my_component")).toBe("MyComponent");
        });

        test("toPascalCase converts spaced", () => {
            expect(engine.toPascalCase("my component")).toBe("MyComponent");
        });

        test("toCamelCase converts hyphenated", () => {
            expect(engine.toCamelCase("submit-button")).toBe("submitButton");
        });

        test("toCamelCase converts underscored", () => {
            expect(engine.toCamelCase("submit_button")).toBe("submitButton");
        });

        test("toKebabCase converts camelCase", () => {
            expect(engine.toKebabCase("backgroundColor")).toBe("background-color");
        });

        test("toKebabCase converts PascalCase", () => {
            expect(engine.toKebabCase("FontSize")).toBe("font-size");
        });

        test("getReactTag returns correct tags", () => {
            expect(engine.getReactTag("container")).toBe("div");
            expect(engine.getReactTag("text")).toBe("p");
            expect(engine.getReactTag("button")).toBe("button");
            expect(engine.getReactTag("input")).toBe("input");
            expect(engine.getReactTag("image")).toBe("img");
            expect(engine.getReactTag("nav")).toBe("nav");
            expect(engine.getReactTag("modal")).toBe("dialog");
            expect(engine.getReactTag("sidebar")).toBe("aside");
            expect(engine.getReactTag("header")).toBe("header");
            expect(engine.getReactTag("footer")).toBe("footer");
            expect(engine.getReactTag("list")).toBe("ul");
            expect(engine.getReactTag("table")).toBe("table");
            expect(engine.getReactTag("form")).toBe("form");
            expect(engine.getReactTag("divider")).toBe("hr");
            expect(engine.getReactTag("icon")).toBe("span");
        });

        test("getReactTag returns div for unknown type", () => {
            expect(engine.getReactTag("unknown")).toBe("div");
        });

        test("getHtmlTag delegates to getReactTag", () => {
            expect(engine.getHtmlTag("button")).toBe("button");
            expect(engine.getHtmlTag("text")).toBe("p");
            expect(engine.getHtmlTag("unknown")).toBe("div");
        });

        test("rectsOverlap detects overlap", () => {
            const a = { x: 0, y: 0, width: 100, height: 100 };
            const b = { x: 50, y: 50, width: 100, height: 100 };
            expect(engine.rectsOverlap(a, b)).toBe(true);
        });

        test("rectsOverlap returns false for non-overlapping", () => {
            const a = { x: 0, y: 0, width: 50, height: 50 };
            const b = { x: 100, y: 100, width: 50, height: 50 };
            expect(engine.rectsOverlap(a, b)).toBe(false);
        });

        test("getOverlapRect returns correct overlap", () => {
            const a = { x: 0, y: 0, width: 100, height: 100 };
            const b = { x: 60, y: 70, width: 100, height: 100 };
            const overlap = engine.getOverlapRect(a, b);
            expect(overlap).toEqual({ x: 60, y: 70, width: 40, height: 30 });
        });

        test("getOverlapRect returns null for no overlap", () => {
            const a = { x: 0, y: 0, width: 50, height: 50 };
            const b = { x: 100, y: 100, width: 50, height: 50 };
            expect(engine.getOverlapRect(a, b)).toBeNull();
        });
    });

    // ==================== CONSTRUCTOR TESTS ====================

    describe("Constructor", () => {
        test("default values", () => {
            const e = new DesignerEngine();
            expect(e.getGridSize()).toBe(8);
            expect(e.getSnapThreshold()).toBe(5);
            expect(e.isGridVisible()).toBe(true);
            expect(e.isGuidesVisible()).toBe(true);
        });

        test("custom grid size", () => {
            const e = new DesignerEngine(16, 10);
            expect(e.getGridSize()).toBe(16);
            expect(e.getSnapThreshold()).toBe(10);
        });
    });
});


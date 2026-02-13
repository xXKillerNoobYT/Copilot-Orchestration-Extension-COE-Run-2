/**
 * DesignerEngine - Advanced visual designer computation engine
 *
 * - Snap grid (configurable grid size)
 * - Alignment guides (snap to other elements)
 * - Multi-select with group operations
 * - Code export (React, HTML, CSS)
 * - Layout engine (auto-arrange, distribute)
 * - Collision detection
 */

export interface Point { x: number; y: number; }
export interface Rect { x: number; y: number; width: number; height: number; }
export interface AlignmentGuide { type: "horizontal" | "vertical"; position: number; sourceId: string; targetId: string; }

export interface SnapResult {
    x: number;
    y: number;
    snappedX: boolean;
    snappedY: boolean;
    guides: AlignmentGuide[];
}

export interface SelectionBounds {
    x: number;
    y: number;
    width: number;
    height: number;
    selectedIds: string[];
}

export interface ExportOptions {
    format: "react" | "html" | "css" | "json";
    includeStyles: boolean;
    componentPrefix: string;
    indent: number;
    useTailwind: boolean;
}

export interface ExportResult {
    code: string;
    language: string;
    files: Array<{ name: string; content: string }>;
}

export interface LayoutOperation {
    type: "align-left" | "align-center" | "align-right" | "align-top" | "align-middle" | "align-bottom" | "distribute-h" | "distribute-v" | "auto-arrange";
    results: Array<{ id: string; x: number; y: number }>;
}

export class DesignerEngine {
    private gridSize: number;
    private snapThreshold: number;
    private showGrid: boolean;
    private showGuides: boolean;

    constructor(gridSize: number = 8, snapThreshold: number = 5) {
        this.gridSize = gridSize;
        this.snapThreshold = snapThreshold;
        this.showGrid = true;
        this.showGuides = true;
    }

    // ==================== SNAP GRID ====================

    snapToGrid(x: number, y: number): Point {
        return {
            x: Math.round(x / this.gridSize) * this.gridSize,
            y: Math.round(y / this.gridSize) * this.gridSize,
        };
    }

    setGridSize(size: number): void {
        this.gridSize = Math.max(1, size);
    }

    getGridSize(): number {
        return this.gridSize;
    }

    setSnapThreshold(threshold: number): void {
        this.snapThreshold = Math.max(1, threshold);
    }

    getSnapThreshold(): number {
        return this.snapThreshold;
    }

    toggleGrid(show: boolean): void { this.showGrid = show; }
    toggleGuides(show: boolean): void { this.showGuides = show; }
    isGridVisible(): boolean { return this.showGrid; }
    isGuidesVisible(): boolean { return this.showGuides; }

    // ==================== ALIGNMENT GUIDES ====================

    calculateAlignmentGuides(
        draggedRect: Rect,
        draggedId: string,
        otherRects: Array<Rect & { id: string }>
    ): SnapResult {
        let resultX = draggedRect.x;
        let resultY = draggedRect.y;
        let snappedX = false;
        let snappedY = false;
        const guides: AlignmentGuide[] = [];

        const dragCenterX = draggedRect.x + draggedRect.width / 2;
        const dragCenterY = draggedRect.y + draggedRect.height / 2;
        const dragRight = draggedRect.x + draggedRect.width;
        const dragBottom = draggedRect.y + draggedRect.height;

        for (const other of otherRects) {
            if (other.id === draggedId) continue;

            const otherCenterX = other.x + other.width / 2;
            const otherCenterY = other.y + other.height / 2;
            const otherRight = other.x + other.width;
            const otherBottom = other.y + other.height;

            // Left edge alignment
            if (Math.abs(draggedRect.x - other.x) <= this.snapThreshold) {
                resultX = other.x;
                snappedX = true;
                guides.push({ type: "vertical", position: other.x, sourceId: draggedId, targetId: other.id });
            }
            // Right edge alignment
            if (Math.abs(dragRight - otherRight) <= this.snapThreshold) {
                resultX = otherRight - draggedRect.width;
                snappedX = true;
                guides.push({ type: "vertical", position: otherRight, sourceId: draggedId, targetId: other.id });
            }
            // Center X alignment
            if (Math.abs(dragCenterX - otherCenterX) <= this.snapThreshold) {
                resultX = otherCenterX - draggedRect.width / 2;
                snappedX = true;
                guides.push({ type: "vertical", position: otherCenterX, sourceId: draggedId, targetId: other.id });
            }
            // Left to right edge
            if (Math.abs(draggedRect.x - otherRight) <= this.snapThreshold) {
                resultX = otherRight;
                snappedX = true;
                guides.push({ type: "vertical", position: otherRight, sourceId: draggedId, targetId: other.id });
            }
            // Right to left edge
            if (Math.abs(dragRight - other.x) <= this.snapThreshold) {
                resultX = other.x - draggedRect.width;
                snappedX = true;
                guides.push({ type: "vertical", position: other.x, sourceId: draggedId, targetId: other.id });
            }

            // Top edge alignment
            if (Math.abs(draggedRect.y - other.y) <= this.snapThreshold) {
                resultY = other.y;
                snappedY = true;
                guides.push({ type: "horizontal", position: other.y, sourceId: draggedId, targetId: other.id });
            }
            // Bottom edge alignment
            if (Math.abs(dragBottom - otherBottom) <= this.snapThreshold) {
                resultY = otherBottom - draggedRect.height;
                snappedY = true;
                guides.push({ type: "horizontal", position: otherBottom, sourceId: draggedId, targetId: other.id });
            }
            // Center Y alignment
            if (Math.abs(dragCenterY - otherCenterY) <= this.snapThreshold) {
                resultY = otherCenterY - draggedRect.height / 2;
                snappedY = true;
                guides.push({ type: "horizontal", position: otherCenterY, sourceId: draggedId, targetId: other.id });
            }
            // Top to bottom
            if (Math.abs(draggedRect.y - otherBottom) <= this.snapThreshold) {
                resultY = otherBottom;
                snappedY = true;
                guides.push({ type: "horizontal", position: otherBottom, sourceId: draggedId, targetId: other.id });
            }
            // Bottom to top
            if (Math.abs(dragBottom - other.y) <= this.snapThreshold) {
                resultY = other.y - draggedRect.height;
                snappedY = true;
                guides.push({ type: "horizontal", position: other.y, sourceId: draggedId, targetId: other.id });
            }
        }

        return { x: resultX, y: resultY, snappedX, snappedY, guides };
    }

    // ==================== MULTI-SELECT ====================

    selectByRect(selectionRect: Rect, elements: Array<Rect & { id: string }>): string[] {
        return elements
            .filter(el => this.rectsOverlap(selectionRect, el))
            .map(el => el.id);
    }

    getSelectionBounds(selectedIds: string[], elements: Array<Rect & { id: string }>): SelectionBounds | null {
        const selected = elements.filter(el => selectedIds.includes(el.id));
        if (selected.length === 0) return null;

        const minX = Math.min(...selected.map(el => el.x));
        const minY = Math.min(...selected.map(el => el.y));
        const maxX = Math.max(...selected.map(el => el.x + el.width));
        const maxY = Math.max(...selected.map(el => el.y + el.height));

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            selectedIds,
        };
    }

    moveSelection(selectedIds: string[], elements: Array<Rect & { id: string }>, dx: number, dy: number): Array<{ id: string; x: number; y: number }> {
        return elements
            .filter(el => selectedIds.includes(el.id))
            .map(el => ({
                id: el.id,
                x: el.x + dx,
                y: el.y + dy,
            }));
    }

    resizeSelection(selectedIds: string[], elements: Array<Rect & { id: string }>, scaleX: number, scaleY: number, anchor: Point): Array<{ id: string; x: number; y: number; width: number; height: number }> {
        return elements
            .filter(el => selectedIds.includes(el.id))
            .map(el => ({
                id: el.id,
                x: anchor.x + (el.x - anchor.x) * scaleX,
                y: anchor.y + (el.y - anchor.y) * scaleY,
                width: el.width * scaleX,
                height: el.height * scaleY,
            }));
    }

    // ==================== LAYOUT OPERATIONS ====================

    alignElements(selectedIds: string[], elements: Array<Rect & { id: string }>, alignment: LayoutOperation["type"]): LayoutOperation {
        const selected = elements.filter(el => selectedIds.includes(el.id));
        if (selected.length < 2 && !alignment.startsWith("auto")) {
            return { type: alignment, results: selected.map(el => ({ id: el.id, x: el.x, y: el.y })) };
        }

        const results: Array<{ id: string; x: number; y: number }> = [];

        switch (alignment) {
            case "align-left": {
                const minX = Math.min(...selected.map(el => el.x));
                selected.forEach(el => results.push({ id: el.id, x: minX, y: el.y }));
                break;
            }
            case "align-right": {
                const maxRight = Math.max(...selected.map(el => el.x + el.width));
                selected.forEach(el => results.push({ id: el.id, x: maxRight - el.width, y: el.y }));
                break;
            }
            case "align-center": {
                const avgX = selected.reduce((s, el) => s + el.x + el.width / 2, 0) / selected.length;
                selected.forEach(el => results.push({ id: el.id, x: avgX - el.width / 2, y: el.y }));
                break;
            }
            case "align-top": {
                const minY = Math.min(...selected.map(el => el.y));
                selected.forEach(el => results.push({ id: el.id, x: el.x, y: minY }));
                break;
            }
            case "align-bottom": {
                const maxBottom = Math.max(...selected.map(el => el.y + el.height));
                selected.forEach(el => results.push({ id: el.id, x: el.x, y: maxBottom - el.height }));
                break;
            }
            case "align-middle": {
                const avgY = selected.reduce((s, el) => s + el.y + el.height / 2, 0) / selected.length;
                selected.forEach(el => results.push({ id: el.id, x: el.x, y: avgY - el.height / 2 }));
                break;
            }
            case "distribute-h": {
                const sorted = [...selected].sort((a, b) => a.x - b.x);
                const totalWidth = sorted.reduce((s, el) => s + el.width, 0);
                const totalSpace = (sorted[sorted.length - 1].x + sorted[sorted.length - 1].width) - sorted[0].x;
                const gap = (totalSpace - totalWidth) / Math.max(1, sorted.length - 1);
                let currentX = sorted[0].x;
                sorted.forEach(el => {
                    results.push({ id: el.id, x: currentX, y: el.y });
                    currentX += el.width + gap;
                });
                break;
            }
            case "distribute-v": {
                const sorted = [...selected].sort((a, b) => a.y - b.y);
                const totalHeight = sorted.reduce((s, el) => s + el.height, 0);
                const totalSpace = (sorted[sorted.length - 1].y + sorted[sorted.length - 1].height) - sorted[0].y;
                const gap = (totalSpace - totalHeight) / Math.max(1, sorted.length - 1);
                let currentY = sorted[0].y;
                sorted.forEach(el => {
                    results.push({ id: el.id, x: el.x, y: currentY });
                    currentY += el.height + gap;
                });
                break;
            }
            case "auto-arrange": {
                const cols = Math.ceil(Math.sqrt(selected.length));
                const padding = this.gridSize * 2;
                const maxWidth = Math.max(...selected.map(el => el.width));
                const maxHeight = Math.max(...selected.map(el => el.height));
                selected.forEach((el, i) => {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    results.push({
                        id: el.id,
                        x: col * (maxWidth + padding),
                        y: row * (maxHeight + padding),
                    });
                });
                break;
            }
        }

        return { type: alignment, results };
    }

    // ==================== CODE EXPORT ====================

    exportToCode(
        components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }>,
        options: Partial<ExportOptions> = {}
    ): ExportResult {
        const opts: ExportOptions = {
            format: "react",
            includeStyles: true,
            componentPrefix: "",
            indent: 2,
            useTailwind: false,
            ...options,
        };

        switch (opts.format) {
            case "react": return this.exportReact(components, opts);
            case "html": return this.exportHtml(components, opts);
            case "css": return this.exportCss(components, opts);
            case "json": return this.exportJson(components, opts);
            default: return this.exportHtml(components, opts);
        }
    }


    private exportReact(components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }>, opts: ExportOptions): ExportResult {
        const indent = " ".repeat(opts.indent);
        const prefix = opts.componentPrefix;

        let jsx = "";
        let css = "";

        for (const comp of components) {
            const tag = this.getReactTag(comp.type);
            const cls = this.toCamelCase(comp.name || comp.id);

            jsx += `${indent}<${tag} className="${cls}"`;
            if (comp.content && ["text", "button"].includes(comp.type)) {
                jsx += `>${comp.content}</${tag}>
`;
            } else {
                jsx += ` />
`;
            }

            if (opts.includeStyles) {
                css += `.${cls} {
`;
                css += `  position: absolute;
`;
                css += `  left: ${comp.x}px;
`;
                css += `  top: ${comp.y}px;
`;
                css += `  width: ${comp.width}px;
`;
                css += `  height: ${comp.height}px;
`;
                for (const [key, value] of Object.entries(comp.styles || {})) {
                    if (value) css += `  ${this.toKebabCase(key)}: ${value};
`;
                }
                css += `}

`;
            }
        }

        const componentName = `${prefix || "Design"}Page`;
        const componentCode = `import React from 'react';
import './styles.css';

export function ${componentName}() {
  return (
    <div className="design-container">
${jsx}    </div>
  );
}
`;

        return {
            code: componentCode,
            language: "tsx",
            files: [
                { name: `${componentName}.tsx`, content: componentCode },
                ...(opts.includeStyles ? [{ name: "styles.css", content: css }] : []),
            ],
        };
    }

    private exportHtml(components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }>, opts: ExportOptions): ExportResult {
        const indent = " ".repeat(opts.indent);
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
${indent}<meta charset="UTF-8">
${indent}<title>Design Export</title>
`;

        if (opts.includeStyles) {
            html += `${indent}<style>
`;
            html += `${indent}${indent}.design-container { position: relative; width: 100%; min-height: 100vh; }
`;
            for (const comp of components) {
                const cls = this.toCamelCase(comp.name || comp.id);
                html += `${indent}${indent}.${cls} { position: absolute; left: ${comp.x}px; top: ${comp.y}px; width: ${comp.width}px; height: ${comp.height}px;`;
                for (const [key, value] of Object.entries(comp.styles || {})) {
                    if (value) html += ` ${this.toKebabCase(key)}: ${value};`;
                }
                html += ` }
`;
            }
            html += `${indent}</style>
`;
        }

        html += `</head>
<body>
${indent}<div class="design-container">
`;

        for (const comp of components) {
            const cls = this.toCamelCase(comp.name || comp.id);
            const tag = this.getHtmlTag(comp.type);
            const content = comp.content || "";
            html += `${indent}${indent}<${tag} class="${cls}">${content}</${tag}>
`;
        }

        html += `${indent}</div>
</body>
</html>
`;

        return {
            code: html,
            language: "html",
            files: [{ name: "index.html", content: html }],
        };
    }

    private exportCss(components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }>, _opts: ExportOptions): ExportResult {
        let css = `.design-container {
  position: relative;
  width: 100%;
  min-height: 100vh;
}

`;

        for (const comp of components) {
            const cls = this.toCamelCase(comp.name || comp.id);
            css += `.${cls} {
`;
            css += `  position: absolute;
`;
            css += `  left: ${comp.x}px;
`;
            css += `  top: ${comp.y}px;
`;
            css += `  width: ${comp.width}px;
`;
            css += `  height: ${comp.height}px;
`;
            for (const [key, value] of Object.entries(comp.styles || {})) {
                if (value) css += `  ${this.toKebabCase(key)}: ${value};
`;
            }
            css += `}

`;
        }

        return { code: css, language: "css", files: [{ name: "styles.css", content: css }] };
    }

    private exportJson(components: Array<{ id: string; type: string; name: string; x: number; y: number; width: number; height: number; styles: Record<string, string>; content: string; children?: string[]; }>, _opts: ExportOptions): ExportResult {
        const json = JSON.stringify(components, null, 2);
        return { code: json, language: "json", files: [{ name: "design.json", content: json }] };
    }

    // ==================== COLLISION DETECTION ====================

    detectCollisions(elements: Array<Rect & { id: string }>): Array<{ id1: string; id2: string; overlap: Rect }> {
        const collisions: Array<{ id1: string; id2: string; overlap: Rect }> = [];

        for (let i = 0; i < elements.length; i++) {
            for (let j = i + 1; j < elements.length; j++) {
                const overlap = this.getOverlapRect(elements[i], elements[j]);
                if (overlap) {
                    collisions.push({ id1: elements[i].id, id2: elements[j].id, overlap });
                }
            }
        }

        return collisions;
    }

    // ==================== HELPERS ====================

    rectsOverlap(a: Rect, b: Rect): boolean {
        return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
    }

    getOverlapRect(a: Rect, b: Rect): Rect | null {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const right = Math.min(a.x + a.width, b.x + b.width);
        const bottom = Math.min(a.y + a.height, b.y + b.height);

        if (right > x && bottom > y) {
            return { x, y, width: right - x, height: bottom - y };
        }
        return null;
    }

    toPascalCase(s: string): string {
        return s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase());
    }

    toCamelCase(s: string): string {
        return s.replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toLowerCase());
    }

    toKebabCase(s: string): string {
        return s.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    }

    getReactTag(type: string): string {
        const map: Record<string, string> = {
            container: "div", text: "p", button: "button", input: "input",
            image: "img", card: "div", nav: "nav", modal: "dialog",
            sidebar: "aside", header: "header", footer: "footer",
            list: "ul", table: "table", form: "form", divider: "hr", icon: "span",
        };
        return map[type] || "div";
    }

    getHtmlTag(type: string): string {
        return this.getReactTag(type);
    }
}

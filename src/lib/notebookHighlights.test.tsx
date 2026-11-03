import { render } from "@testing-library/react";
import MarkdownReader from "../components/MarkdownReader";
import { notebookHighlights } from "./notebookHighlights";
import { parseFileHighlights, sourceSelections } from "./fileHighlights";
import { normalizeNotebookSource, parseNotebook, notebookOutline } from "./notebook";

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
const source = "# 第一节\n\n重复正文。\n\n$$\\begin{aligned}\na &= b\\\\\nc &= d\n\\end{aligned}$$\n\n公式后的 **加粗文字** 和普通正文。\n";
const fixture = '{\n  "nbformat": 4, "metadata": {"large": 900719925474099312345, "escaped":"\\u4e2d"},\n  "cells": [\n' +
  JSON.stringify({ cell_type: "markdown", id: "first", metadata: { tags: ["keep"] }, source: source.split(/(?<=\n)/), attachments: { "a.png": { "image/png": "unchanged" } } }) + ',\n' +
  JSON.stringify({ cell_type: "code", source: "print('重复正文')", execution_count: 1, outputs: [{ output_type: "stream", text: "重复正文" }] }) + ',\n' +
  JSON.stringify({ cell_type: "markdown", id: "last", source: "# 第二节\n\n重复正文。" }) + '\n  ]\n}\n';
const renderNotebook = (content: string) => render(<MarkdownReader document={{ path: "highlights.ipynb", name: "highlights.ipynb", content, size: content.length, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);

describe("notebook Markdown highlights", () => {
  it("maps selections after display math to original source and preserves all other JSON bytes", () => {
    const model = notebookHighlights(fixture);
    const view = renderNotebook(fixture);
    const span = [...view.container.querySelectorAll<HTMLElement>("[data-source-start]")].find(s => s.textContent?.includes("公式后的"))!;
    expect(span).toBeTruthy();
    expect(Number(span.dataset.sourceStart)).toBe(source.indexOf("公式后的"));
    const selection = window.getSelection()!;
    const range = document.createRange(); range.setStart(span.firstChild!, 0); range.setEnd(span.firstChild!, 4);
    selection.removeAllRanges(); selection.addRange(range);
    const parts = sourceSelections(view.container, selection);
    expect(parts).toEqual([{ start: source.indexOf("公式后的"), end: source.indexOf("公式后的") + 4 }]);
    const updated = model.serialize([{ id: -100, ...parts[0], color: "yellow" }]);
    const before = JSON.parse(fixture), after = JSON.parse(updated);
    expect(after.cells[0].source.join("")).toContain("==🟡公式后的==");
    expect(parseFileHighlights(after.cells[0].source.join(""), normalizeNotebookSource).clean).toBe(source);
    expect(after.cells.slice(1)).toEqual(before.cells.slice(1));
    expect(after.cells[0].attachments).toEqual(before.cells[0].attachments);
    expect(updated.replace(JSON.stringify(after.cells[0].source), () => JSON.stringify(before.cells[0].source))).toBe(fixture);
    expect(updated).toContain('900719925474099312345');
    expect(renderNotebook(updated).container.querySelector(".katex-error")).toBeNull();
  });
  it("supports separate identical passages, recolor, delete and reload with unique IDs", () => {
    const model = notebookHighlights(fixture);
    const first = model.cells[0]!, last = model.cells[2]!;
    const ranges = [first, last].map((cell, index) => ({ id: -100 - index, start: cell.offset + cell.clean.indexOf("重复正文"), end: cell.offset + cell.clean.indexOf("重复正文") + 4, color: "green" as const }));
    const saved = model.serialize(ranges);
    const loaded = notebookHighlights(saved);
    expect(loaded.records.map(r => r.quote)).toEqual(["重复正文", "重复正文"]);
    expect(new Set(loaded.records.map(r => r.id)).size).toBe(2);
    const view = renderNotebook(saved);
    for (const record of loaded.records) expect(view.container.querySelector(`[data-file-highlight="${record.id}"]`)).not.toBeNull();
    loaded.ranges[1].color = "blue";
    const changed = loaded.serialize(loaded.ranges);
    expect(JSON.parse(changed).cells[0]).toEqual(JSON.parse(saved).cells[0]);
    expect(JSON.parse(changed).cells[2].source).toContain("==🔵重复正文==");
    const reloaded = notebookHighlights(changed);
    const deleted = reloaded.serialize(reloaded.ranges.slice(1));
    expect(notebookHighlights(deleted).records).toHaveLength(1);
    expect(JSON.parse(deleted).cells[0].source.join("")).toBe(source);
    expect(notebookOutline(parseNotebook(changed))).toEqual(notebookOutline(parseNotebook(fixture)));
  });
  it("never maps code, raw cells, outputs or formulas to editable source", () => {
    const view = renderNotebook(fixture);
    expect(view.container.querySelectorAll(".notebook-code-cell [data-source-start]")).toHaveLength(0);
    expect(view.container.querySelectorAll(".lazy-math [data-source-start]")).toHaveLength(0);
    const model = notebookHighlights(fixture);
    expect(model.serialize(model.ranges)).toBe(fixture);
    const content = JSON.stringify({ nbformat: 4, cells: [{ cell_type: "markdown", source: "==== ==🟡一==" }, { cell_type: "markdown", source: "==🔵二==" }] });
    expect(new Set(notebookHighlights(content).ranges.map(r => r.id)).size).toBe(2);
  });
});

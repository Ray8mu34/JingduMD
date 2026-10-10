import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import { fileHighlightRecords, migrateLegacyHighlights, parseFileHighlights, prepareFileHighlights, serializeFileHighlights, sourceSelection, coalesceFileHighlights, matchingFileHighlight } from "./fileHighlights";
import MarkdownReader from "../components/MarkdownReader";
import type { TextHighlight } from "../types";

const legacy = (quote: string, id = 1): TextHighlight => ({ id, quote, prefix: "", suffix: "", path: "a.md", root: "", color: "green", startOffset: 0, endOffset: quote.length, headingId: null, createdMs: 0, updatedMs: 0 });
describe("Markdown source highlights", () => {
  it("parses nested colors and restores the outer layer after deleting the inner", () => {
    const source = "==🟡ab==🔵cd==ef==";
    const parsed = parseFileHighlights(source);
    expect(parsed.clean).toBe("abcdef");
    expect(parsed.ranges.map((r) => [r.start, r.end, r.color])).toEqual([[0, 6, "yellow"], [2, 4, "blue"]]);
    expect(serializeFileHighlights(parsed.clean, parsed.ranges.slice(0, 1))).toBe("==🟡abcdef==");
  });
  it("splits crossings while retaining both layers", () => {
    const result = serializeFileHighlights("abcdef", [{ id: 1, start: 0, end: 4, color: "yellow" }, { id: 2, start: 2, end: 6, color: "blue" }]);
    expect(result).toBe("==🟡ab==🔵cd==== ==🔵ef==".replace(" ", ""));
    const parsed = parseFileHighlights(result);
    expect(parsed.clean).toBe("abcdef");
    expect(parsed.ranges.map((r) => [r.start, r.end, r.color])).toEqual([[0, 4, "yellow"], [2, 4, "blue"], [4, 6, "blue"]]);
  });
  it("never parses markers in code, math, frontmatter or link destinations", () => {
    const source = '---\ntitle: ==🟡metadata==\n---\n`==🔵code==`\n\n```js\n==🟣code==\n```\n\n$==🟢math==$ [link](https://x/==abc==)';
    expect(parseFileHighlights(source)).toEqual({ clean: source, ranges: [] });
  });
  it("preserves literal unbalanced and escaped markers", () => {
    for (const source of ["==🟡unfinished", "\\==text\\=="]) expect(parseFileHighlights(source).clean).toBe(source);
  });
  it("keeps inline Markdown in one highlight and splits paragraphs and formulas", () => {
    const clean = "first **bold** [link](https://x)\r\n\r\nlast \\(x\\)";
    const output = serializeFileHighlights(clean, [{ id: 1, start: 0, end: clean.length, color: "pink" }]);
    expect(parseFileHighlights(output).clean).toBe(clean);
    expect(output).toContain("==🟣first **bold** [link](https://x)==\r\n\r\n");
    expect(output).toContain("\\(x\\)");
  });
  it("merges adjacent old fragments across bold, italic and link wrappers", () => {
    const source = "==🟡普通==**==🟡粗体==**==🟡和==*==🟡斜体==*==🟡及==[==🟡链接==](https://example.com)";
    const parsed = parseFileHighlights(source);
    const result = serializeFileHighlights(parsed.clean, parsed.ranges);
    expect(result).toBe("==🟡普通**粗体**和*斜体*及[链接](https://example.com)==");
    expect(parseFileHighlights(result).ranges).toHaveLength(1);
    expect(serializeFileHighlights(parsed.clean, parseFileHighlights(result).ranges)).toBe(result);
  });
  it("does not merge across gaps, formulas, paragraphs, cells or another layer", () => {
    for (const source of ["==🟡a== ==🟡b==", "==🟡a==$x$==🟡b==", "==🟡a==\n\n==🟡b==", "| ==🟡a== | ==🟡b== |\n| --- | --- |\n| c | d |", "==🟡ab==🔵cd==== ==🟡ef=="]) {
      const parsed = parseFileHighlights(source);
      expect(coalesceFileHighlights(parsed.clean, parsed.ranges)).toHaveLength(parsed.ranges.length);
    }
  });
  it("keeps outer highlights intact around formatted nested highlights", () => {
    const clean = "普通**加粗文字**结尾";
    const output = serializeFileHighlights(clean, [{ id: -1, start: 0, end: clean.length, color: "yellow" }, { id: -2, start: clean.indexOf("粗"), end: clean.indexOf("字"), color: "blue" }]);
    expect(output).toBe("==🟡普通**加==🔵粗文==字**结尾==");
    expect(parseFileHighlights(output).clean).toBe(clean);
  });
  it("splits only at partially selected inline wrappers", () => {
    const clean = "**abcdef** ghij";
    const output = serializeFileHighlights(clean, [{ id: -1, start: 4, end: clean.length, color: "green" }]);
    expect(output).toBe("**ab==🟢cdef==**==🟢 ghij==");
    expect(parseFileHighlights(output).clean).toBe(clean);
  });
  it("recognizes full formatted selections for recoloring rather than nesting", () => {
    const source = "==🟡**bold**==";
    const { clean, ranges } = parseFileHighlights(source);
    expect(matchingFileHighlight(clean, ranges, { start: 2, end: 6 })?.id).toBe(-1);
    expect(serializeFileHighlights(clean, [{ ...ranges[0], color: "pink" }])).toBe("==🟣**bold**==");
  });
  it("keeps heading and table prefixes outside highlight markers", () => {
    const clean = "# Heading\n\n| left | right |\n| --- | --- |\n| a | b |";
    const result = serializeFileHighlights(clean, [{ id: -1, start: 0, end: clean.length, color: "green" }]);
    expect(result).toContain("# ==🟢Heading==");
    expect(result).toContain("| ==🟢left== | ==🟢right== |");
    expect(parseFileHighlights(result).clean).toBe(clean);
  });
  it("migrates formatted text but skips ambiguous and unmapped excerpts", () => {
    const source = "before **重点** after\n\nrepeat repeat\n\n`code`";
    const result = migrateLegacyHighlights(source, [legacy("before 重点 after"), legacy("repeat", 2), legacy("code", 3)]);
    expect(result.migratedIds).toEqual([1]);
    expect(result.skippedIds).toEqual([2, 3]);
    expect(parseFileHighlights(result.content).clean).toBe(source);
  });
  it("does not mistake an unsupported code occurrence for a unique prose match", () => {
    expect(migrateLegacyHighlights("`same`\n\nsame", [legacy("same")]).skippedIds).toEqual([1]);
  });
  it("renders source spans and the inner color through the actual reader sanitizer", () => {
    const source = "---\ntitle: hi\n---\n# Head\n\n==🟡ab==🔵cd==ef==";
    const view = render(<MarkdownReader document={{ path: "a.md", content: source, name: "a.md", modifiedMs: 0, size: 0 }} night={false} onOpenDocument={() => {}} />);
    expect(view.container.querySelector(".file-highlight-blue")?.textContent).toBe("cd");
    expect(view.container.querySelector(".file-highlight-blue")?.getAttribute("data-file-highlight")).toBe("-1 -2");
    const span = view.container.querySelector(".file-highlight-blue")!;
    const selection = window.getSelection()!;
    const range = document.createRange(); range.selectNodeContents(span);
    range.setStart(span.firstChild!, 0); range.setEnd(span.firstChild!, 2);
    selection.removeAllRanges(); selection.addRange(range);
    const parsed = parseFileHighlights(source);
    const start = parsed.clean.indexOf("cd");
    expect(sourceSelection(view.container, selection)).toEqual({ start, end: start + 2 });
    selection.removeAllRanges();
  });
  it("keeps source offsets accurate after normalized TeX", () => {
    const source = "Equation \\(x\\) then ==🟢中文😀==.";
    const prepared = prepareFileHighlights(source);
    const view = render(<ReactMarkdown remarkPlugins={[remarkMath, prepared.plugin]}>{prepared.body}</ReactMarkdown>);
    const span = view.container.querySelector(".file-highlight-green")!;
    expect(Number(span.getAttribute("data-source-start"))).toBe(prepared.clean.indexOf("中文"));
    expect(fileHighlightRecords(source, "a.md", "")[0].quote).toBe("中文😀");
  });
  it("rejects forged source offsets in raw HTML", () => {
    const view = render(<MarkdownReader document={{ path: "a.md", content: '<span data-source-start="100" data-source-end="106" data-file-highlight="-1">forged</span>', name: "a.md", modifiedMs: 0, size: 0 }} night={false} onOpenDocument={() => {}} />);
    expect(view.container.querySelector('[data-source-start="100"]')).toBeNull();
    expect(view.container.querySelector('[data-file-highlight="-1"]')).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { articleTextMap, highlightAtPoint, rangeForOffsets, resolveHighlight, resolveHighlights, selectionToHighlight, highlightMutationsMatter } from "./highlights";
import type { TextHighlight } from "../types";

function stored(overrides: Partial<TextHighlight> = {}): TextHighlight {
  return {
    id: 1, path: "C:\\notes\\a.md", root: "C:\\notes", quote: "重点内容", prefix: "第一段 ", suffix: " 结尾",
    startOffset: 4, endOffset: 8, headingId: "chapter", color: "yellow", createdMs: 1, updatedMs: 1, ...overrides
  };
}

describe("text highlight anchoring", () => {
  it("does not traverse article text for empty or file-native highlights", () => {
    const root = document.createElement("article");
    root.innerHTML = '<p><span data-file-highlight="-1 -2">重点内容</span></p>';
    const walker = vi.spyOn(document, "createTreeWalker");
    try {
      expect(resolveHighlights(root, [])).toEqual([]);
      const resolved = resolveHighlights(root, [stored({ id: -1 }), stored({ id: -2 })]);
      expect(resolved.map(item => item.range?.toString())).toEqual(["重点内容", "重点内容"]);
      expect(walker).not.toHaveBeenCalled();
    } finally { walker.mockRestore(); }
  });

  it("ignores hidden formula repainting but observes prose changes for legacy marks", () => {
    const root = document.createElement("article");
    root.innerHTML = '<p>正文</p><span aria-hidden="true"><span>公式字形</span></span>';
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    root.querySelector('[aria-hidden="true"] span')!.textContent = "更新字形";
    expect(highlightMutationsMatter(observer.takeRecords(), true)).toBe(false);
    root.querySelector("p")!.textContent = "更新正文";
    const changes = observer.takeRecords();
    expect(highlightMutationsMatter(changes, true)).toBe(true);
    expect(highlightMutationsMatter(changes, false)).toBe(false);
    observer.disconnect();
  });

  it("rebuilds native ranges when highlighted content is removed or replaced", () => {
    const root = document.createElement("article");
    root.innerHTML = '<p><span data-file-highlight="-1">重点内容</span></p>';
    const observer = new MutationObserver(() => {});
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    root.querySelector("span")!.textContent = "新内容";
    expect(highlightMutationsMatter(observer.takeRecords(), false)).toBe(true);
    root.querySelector("p")!.remove();
    expect(highlightMutationsMatter(observer.takeRecords(), false)).toBe(true);
    observer.disconnect();
  });
  it("creates an anchor from a rendered selection and ignores toolbar text", () => {
    const root = document.createElement("article");
    root.innerHTML = '<h2 id="chapter"><button class="section-fold-button">折叠</button>章节</h2><p>第一段 重点内容 结尾</p>';
    document.body.append(root);
    const node = root.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(node, 4); range.setEnd(node, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    const result = selectionToHighlight(root, selection, "C:\\notes\\a.md", "green");
    expect(result?.quote).toBe("重点内容");
    expect(result?.headingId).toBe("chapter");
    expect(articleTextMap(root).text).not.toContain("折叠");
    root.remove();
  });

  it("reanchors the quote after text is inserted before it", () => {
    const root = document.createElement("article");
    root.innerHTML = '<h2 id="chapter">章节</h2><p>新增说明。第一段 重点内容 结尾</p>';
    const result = resolveHighlight(root, stored());
    expect(result.orphaned).toBe(false);
    expect(result.range?.toString()).toBe("重点内容");
  });

  it("marks changed or removed quotes as orphaned", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>这段话已经彻底改写</p>";
    expect(resolveHighlight(root, stored()).orphaned).toBe(true);
  });

  it("uses the stored heading to disambiguate repeated quotes", () => {
    const root = document.createElement("article");
    root.innerHTML = '<h2 id="other">其他</h2><p>重点内容</p><h2 id="chapter">目标</h2><p>重点内容</p>';
    const result = resolveHighlight(root, stored({ prefix: "", suffix: "", startOffset: 0 }));
    expect(result.range?.startContainer.parentElement?.previousElementSibling?.id).toBe("chapter");
  });

  it("maps ranges across adjacent text nodes", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>前半<strong>后半</strong></p>";
    const range = rangeForOffsets(articleTextMap(root), 1, 4);
    expect(range?.toString()).toBe("半后半");
  });

  it("keeps an ambiguous repeated quote orphaned instead of guessing by distance", () => {
    const root = document.createElement("article");
    root.innerHTML = "<p>重点内容</p><p>重点内容</p>";
    expect(resolveHighlight(root, stored({ prefix: "", suffix: "", headingId: null, startOffset: 0 })).orphaned).toBe(true);
  });

  it("hits the actual text rectangles, including wrapped lines, not the empty gap", () => {
    const range = document.createRange();
    Object.assign(range, { getClientRects: () => [{ left: 20, right: 60, top: 10, bottom: 25, width: 40, height: 15 }, { left: 0, right: 20, top: 30, bottom: 45, width: 20, height: 15 }] });
    const item = { ...stored(), range, orphaned: false };
    expect(highlightAtPoint([item], 10, 35)?.id).toBe(1);
    expect(highlightAtPoint([item], 30, 35)).toBeUndefined();
    expect(highlightAtPoint([item], 30, 27)).toBeUndefined();
  });
});

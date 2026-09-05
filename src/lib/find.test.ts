import { clearFindHighlights, findTextRanges, updateFindHighlights } from "./find";

describe("document find", () => {
  it("finds every visible occurrence and ignores hidden math accessibility text", () => {
    document.body.innerHTML = `<article><p>中文内容，中文再次出现。</p><span class="katex-mathml">中文</span><code>中文</code></article>`;
    const ranges = findTextRanges(document.querySelector("article")!, "中文");
    expect(ranges.map((range) => range.toString())).toEqual(["中文", "中文", "中文"]);
  });

  it("matches Latin text without case sensitivity", () => {
    document.body.innerHTML = "<article><p>Markdown MARKDOWN</p></article>";
    expect(findTextRanges(document.querySelector("article")!, "markdown")).toHaveLength(2);
  });

  it("falls back cleanly when CSS Highlights are unavailable", () => {
    expect(updateFindHighlights([], 0)).toBe(false);
    expect(() => clearFindHighlights()).not.toThrow();
  });
});

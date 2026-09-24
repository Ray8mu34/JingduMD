import { extractOutline, normalizeTexDelimiters, slugify, splitFrontmatter } from "./markdown";

describe("markdown helpers", () => {
  it("extracts headings but ignores fenced code", () => {
    expect(extractOutline("# 标题\n```md\n# fake\n```\n## 第二节")).toEqual([
      { level: 1, text: "标题", id: "user-content-标题" }, { level: 2, text: "第二节", id: "user-content-第二节" }
    ]);
  });
  it("deduplicates slugs", () => {
    const used = new Map<string, number>();
    expect([slugify("Same", used), slugify("Same", used)]).toEqual(["same", "same-1"]);
  });
  it("uses the rendered heading tree for links, math, duplicates and Setext", () => {
    expect(extractOutline("# [Linked](https://example.com) *title*\n## Math $x^2$\n## Again\n## Again\nSetext **title**\n---")).toEqual([
      { level: 1, text: "Linked title", id: "user-content-linked-title" },
      { level: 2, text: "Math x^2", id: "user-content-math-x-2" },
      { level: 2, text: "Again", id: "user-content-again" },
      { level: 2, text: "Again", id: "user-content-again-1" },
      { level: 2, text: "Setext title", id: "user-content-setext-title" }
    ]);
  });
  it("splits yaml frontmatter", () => {
    expect(splitFrontmatter("---\ntitle: Test\n---\n# Body")).toEqual({ frontmatter: ["title: Test"], body: "# Body" });
  });
  it("supports TeX parenthesis and bracket delimiters without changing code", () => {
    const source = "行内 \\(a^2+b^2=c^2\\)。\n\n\\[\nE=mc^2\n\\]\n\n`\\(code\\)`\n```tex\n\\(also code\\)\n```";
    expect(normalizeTexDelimiters(source)).toBe("行内 $a^2+b^2=c^2$。\n\n$$\nE=mc^2\n$$\n\n`\\(code\\)`\n```tex\n\\(also code\\)\n```");
  });
});

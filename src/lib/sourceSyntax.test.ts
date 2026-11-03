import { describe, expect, it } from "vitest";
import { sourceSyntax } from "./sourceSyntax";

describe("source syntax colors", () => {
  it("colors common Markdown without changing a single source character", () => {
    const source = "# 中文标题\n\n- [x] **粗体** *斜体* ~~删除~~ `code` [链接](https://example.com)\n> 引用\n\t正文😀\n";
    const tokens = sourceSyntax(source);
    expect(tokens.map((t) => t.text).join("")).toBe(source);
    for (const kind of ["heading", "marker", "emphasis", "code", "link"]) expect(tokens.some((t) => t.kind === kind)).toBe(true);
  });
  it("keeps fence bodies literal until the matching fence closes", () => {
    const source = "````js\n# code\n```\n**literal**\n````\n# title\n~~~\n[unfinished](\n";
    expect(sourceSyntax(source)).toEqual([
      { text: "````js\n# code\n```\n**literal**\n````\n", kind: "code" },
      { text: "# title\n", kind: "heading" },
      { text: "~~~\n[unfinished](\n", kind: "code" },
    ]);
  });
  it("retains literal HTML, escaped markers, incomplete syntax and CRLF", () => {
    for (const source of ["", "\n\n", "<script>alert('x')</script>\r\n\\*literal*", "[link](\n**unfinished", "a_b_c _word_", "😀\t\n"]) {
      expect(sourceSyntax(source).map((t) => t.text).join("")).toBe(source);
    }
    expect(sourceSyntax("\\*literal* a_b_c").every((t) => !t.kind)).toBe(true);
  });
  it("bounds work on large documents and pathological long lines", () => {
    for (const source of ["*".repeat(10_000), "[".repeat(7900), "# title\n".repeat(70_000)]) {
      expect(sourceSyntax(source)).toEqual([{ text: source }]);
    }
  });
});

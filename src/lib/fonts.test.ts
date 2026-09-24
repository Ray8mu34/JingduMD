import { filterSystemFonts, nextRecentFonts, readerFontCss } from "./fonts";

describe("system font CSS", () => {
  it("separates CJK glyphs from the Latin family", () => {
    const css = readerFontCss("Microsoft YaHei UI", "Georgia", "Segoe UI", "Cascadia Code");
    expect(css).toContain('local("Microsoft YaHei UI")');
    expect(css).toContain("unicode-range:U+2E80-2EFF");
    expect(css).toContain("U+FF00-FFEF");
    expect(css).toContain('local("Georgia")');
    expect(css).toContain('font-family:"JingReader Heading"');
    expect(css).toContain('local("Cascadia Code")');
  });

  it("does not create aliases for system defaults", () => {
    expect(readerFontCss("", "")).toBe("");
  });

  it("filters CJK and Latin families by measured glyph coverage", () => {
    const fonts = [
      { family: "中文宋体", supportsCjk: true, supportsLatin: true },
      { family: "Latin Display", supportsCjk: false, supportsLatin: true },
      { family: "Icon Font", supportsCjk: false, supportsLatin: false }
    ];
    expect(filterSystemFonts(fonts, "cjk", false).map((font) => font.family)).toEqual(["中文宋体"]);
    expect(filterSystemFonts(fonts, "latin", false, "latin").map((font) => font.family)).toEqual(["Latin Display"]);
    expect(filterSystemFonts(fonts, "cjk", true)).toHaveLength(3);
  });

  it("keeps a deduplicated most-recently-used font list", () => {
    expect(nextRecentFonts(["Georgia", "Consolas"], "consolas")).toEqual(["consolas", "Georgia"]);
  });
});

import { filterSystemFonts, nextRecentFonts, readerFontCss } from "./fonts";

describe("system font CSS", () => {
  it("separates CJK glyphs from the Latin family", () => {
    const css = readerFontCss({ chineseFont: "Microsoft YaHei UI", latinFont: "Georgia", chineseHeadingFont: "SimSun", latinHeadingFont: "Segoe UI", headingFont: "", codeFont: "Cascadia Code" });
    expect(css).toContain('local("Microsoft YaHei UI")');
    expect(css).toContain("unicode-range:U+2E80-2EFF");
    expect(css).toContain("U+FF00-FFEF");
    expect(css).toContain('local("Georgia")');
    expect(css).toContain('font-family:"JingReader Heading CJK"');
    expect(css).toContain('font-family:"JingReader Heading Latin"');
    expect(css).toContain('local("Cascadia Code")');
    expect(css).toContain("font-weight:400;font-style:normal");
    expect(css).not.toContain("font-weight:100 900");
  });

  it("does not create aliases for system defaults", () => {
    expect(readerFontCss({ chineseFont: "", latinFont: "", chineseHeadingFont: "", latinHeadingFont: "", headingFont: "", codeFont: "" })).toBe("");
  });

  it("registers actual regular, bold and italic faces when Windows reports them", () => {
    const css = readerFontCss({ chineseFont: "", latinFont: "", chineseHeadingFont: "", latinHeadingFont: "Arial", headingFont: "", codeFont: "" }, [
      { family: "Arial", supportsCjk: false, supportsLatin: true, faces: { regular: "Arial", bold: "Arial Bold", italic: "Arial Italic", boldItalic: "Arial Bold Italic" } }
    ]);
    expect(css).toContain('src:local("Arial Bold");font-weight:700;font-style:normal');
    expect(css).toContain('src:local("Arial Italic");font-weight:400;font-style:italic');
    expect(css).toContain('src:local("Arial Bold Italic");font-weight:700;font-style:italic');
    expect(css).toContain("unicode-range:U+0000-02FF");
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

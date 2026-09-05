import { describe, expect, it } from "vitest";
import { dirname, resolveLocalPath } from "./paths";

describe("native local paths", () => {
  it.each([
    ["/Users/me/资料/文章.md", "../图片/a%20b.svg#figure", "/Users/me/图片/a b.svg"],
    ["/Users/me/文章.md", "/图片/a.svg", "/图片/a.svg"],
    ["/文章.md", "a.svg", "/a.svg"],
    ["/Users/me/a\\b/文章.md", "a.svg", "/Users/me/a\\b/a.svg"],
    ["C:\\notes\\a.md", "../images/a.svg", "C:\\images\\a.svg"],
    ["C:\\notes\\a.md", "/images/a.svg", "C:\\images\\a.svg"],
    ["C:\\notes\\a.md", "D:/images/a.svg", "D:\\images\\a.svg"],
    ["\\\\server\\share\\notes\\a.md", "../a.svg", "\\\\server\\share\\a.svg"],
    ["\\\\server\\share\\a.md", "../../a.svg", "\\\\server\\share\\a.svg"],
  ])("resolves %s + %s", (doc, source, expected) => {
    expect(resolveLocalPath(doc, source)).toBe(expected);
  });
  it("preserves the POSIX root", () => { expect(dirname("/a.md")).toBe("/"); });
});

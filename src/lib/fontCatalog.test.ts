import { describe, expect, it } from "vitest";
import { canonicalFontFamily, matchingFonts } from "./fontCatalog";
import type { SystemFont } from "../types";

const fonts: SystemFont[] = [
  { family: "Arial", displayName: "Arial（本地化）", aliases: ["ArialMT"], supportsCjk: false, supportsLatin: true },
  { family: "Noto Serif SC", displayName: "思源宋体", aliases: ["NotoSerifSC-Regular"], supportsCjk: true, supportsLatin: true }
];

describe("font family identity", () => {
  it("resolves a localized label or an old face name to one stored family", () => {
    expect(canonicalFontFamily(fonts, "ArialMT")).toBe("Arial");
    expect(canonicalFontFamily(fonts, "思源宋体")).toBe("Noto Serif SC");
    expect(canonicalFontFamily(fonts, "Missing Font")).toBe("Missing Font");
  });
  it("searches labels and aliases without changing the full catalog", () => {
    expect(matchingFonts(fonts, "思源").map((font) => font.family)).toEqual(["Noto Serif SC"]);
    expect(matchingFonts(fonts, "arialmt").map((font) => font.family)).toEqual(["Arial"]);
    expect(matchingFonts(fonts, "")).toHaveLength(2);
  });
});

import type { SystemFont } from "../types";

const CJK_UNICODE_RANGES = [
  "U+2E80-2EFF", "U+3000-303F", "U+3040-30FF", "U+3100-312F",
  "U+31A0-31BF", "U+31C0-31EF", "U+3400-4DBF", "U+4E00-9FFF",
  "U+F900-FAFF", "U+20000-2FA1F", "U+FF00-FFEF"
].join(",");

export function readerFontCss(chineseFont: string, latinFont: string, headingFont = "", codeFont = ""): string {
  const rules: string[] = [];
  if (chineseFont) rules.push(`@font-face{font-family:"JingReader CJK";src:local(${JSON.stringify(chineseFont)});unicode-range:${CJK_UNICODE_RANGES};font-display:swap;}`);
  if (latinFont) rules.push(`@font-face{font-family:"JingReader Latin";src:local(${JSON.stringify(latinFont)});font-display:swap;}`);
  if (headingFont) rules.push(`@font-face{font-family:"JingReader Heading";src:local(${JSON.stringify(headingFont)});font-display:swap;}`);
  if (codeFont) rules.push(`@font-face{font-family:"JingReader Code";src:local(${JSON.stringify(codeFont)});font-display:swap;}`);
  return rules.join("\n");
}

export function filterSystemFonts(fonts: SystemFont[], kind: "cjk" | "latin", showAll: boolean, query = ""): SystemFont[] {
  const needle = query.trim().toLocaleLowerCase();
  return fonts.filter((font) => {
    const covered = kind === "cjk" ? font.supportsCjk : font.supportsLatin;
    return (showAll || covered) && (!needle || font.family.toLocaleLowerCase().includes(needle));
  });
}

export function nextRecentFonts(current: string[], family: string, limit = 8): string[] {
  const value = family.trim();
  if (!value) return current;
  return [value, ...current.filter((item) => item.toLocaleLowerCase() !== value.toLocaleLowerCase())].slice(0, limit);
}

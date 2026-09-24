import type { SystemFont } from "../types";

const CJK_UNICODE_RANGES = [
  "U+2E80-2EFF", "U+3000-303F", "U+3040-30FF", "U+3100-312F",
  "U+31A0-31BF", "U+31C0-31EF", "U+3400-4DBF", "U+4E00-9FFF",
  "U+F900-FAFF", "U+20000-2FA1F", "U+FF00-FFEF"
].join(",");
const LATIN_UNICODE_RANGES = "U+0000-02FF,U+0370-03FF,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F";

export type ReaderFontChoices = { chineseFont: string; latinFont: string; chineseHeadingFont: string; latinHeadingFont: string; headingFont: string; codeFont: string };

export function readerFontCss(choices: ReaderFontChoices, fonts: SystemFont[] = []): string {
  const rules: string[] = [];
  const catalog = new Map(fonts.map((font) => [font.family.toLocaleLowerCase(), font]));
  const add = (alias: string, family: string, coverage: "cjk" | "latin" | "all" = "all") => {
    if (!family) return;
    const range = coverage === "all" ? "" : `unicode-range:${coverage === "cjk" ? CJK_UNICODE_RANGES : LATIN_UNICODE_RANGES};`;
    const faces = catalog.get(family.toLocaleLowerCase())?.faces;
    const choices = faces ? [
      [faces.regular ?? family, 400, "normal"], [faces.bold, 700, "normal"],
      [faces.italic, 400, "italic"], [faces.boldItalic, 700, "italic"]
    ] as const : [[family, 400, "normal"]] as const;
    for (const [face, weight, style] of choices) if (face) {
      rules.push(`@font-face{font-family:${JSON.stringify(alias)};src:local(${JSON.stringify(face)});font-weight:${weight};font-style:${style};${range}font-display:swap;}`);
    }
  };
  add("JingReader CJK", choices.chineseFont, "cjk");
  add("JingReader Latin", choices.latinFont, "latin");
  add("JingReader Heading CJK", choices.chineseHeadingFont, "cjk");
  add("JingReader Heading Latin", choices.latinHeadingFont, "latin");
  add("JingReader Heading", choices.headingFont);
  add("JingReader Code", choices.codeFont);
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

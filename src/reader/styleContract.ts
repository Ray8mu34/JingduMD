import type { AppearanceId, ReaderPreferences, ReaderThemeId } from "../types";
import { isDarkTheme, resolveReadingStyle } from "../lib/readerPreferences";

export type ReaderTypography = Pick<ReaderPreferences,
  "fontSize" | "lineHeight" | "contentWidth" | "paragraphSpacing" | "fontFamily" |
  "chineseFont" | "latinFont" | "chineseHeadingFont" | "latinHeadingFont" | "headingFont" | "codeFont" |
  "headingScale" | "headingDensity" | "paragraphStyle" | "firstLineIndent" | "textAlign" |
  "letterSpacing" | "quoteStyle" | "tableStyle" | "codeWrap" | "codeScale" | "formulaScale" | "imageStyle"
>;

export type ReaderAppearance = {
  id: AppearanceId | null;
  theme: ReaderThemeId;
  night: boolean;
  warmth: number;
  contrast: number;
  imageBrightness: number;
};

// ReaderPreferences remains the disk format. Only these effective values cross into rendering.
export function resolveReaderStyle(preferences: ReaderPreferences): { typography: ReaderTypography; appearance: ReaderAppearance; readingFocus: ReaderPreferences["readingFocus"] } {
  const value = resolveReadingStyle(preferences);
  const typography: ReaderTypography = {
    fontSize: value.fontSize, lineHeight: value.lineHeight, contentWidth: value.contentWidth,
    paragraphSpacing: value.paragraphSpacing, fontFamily: value.fontFamily,
    chineseFont: value.chineseFont, latinFont: value.latinFont,
    chineseHeadingFont: value.chineseHeadingFont, latinHeadingFont: value.latinHeadingFont,
    headingFont: value.headingFont, codeFont: value.codeFont,
    headingScale: value.headingScale, headingDensity: value.headingDensity,
    paragraphStyle: value.paragraphStyle, firstLineIndent: value.firstLineIndent,
    textAlign: value.textAlign, letterSpacing: value.letterSpacing,
    quoteStyle: value.quoteStyle, tableStyle: value.tableStyle, codeWrap: value.codeWrap,
    codeScale: value.codeScale, formulaScale: value.formulaScale, imageStyle: value.imageStyle
  };
  const id = preferences.styleMode === "legacy" ? preferences.legacyAppearance : preferences.appearance;
  return { typography, appearance: {
    id, theme: value.theme, night: id ? id === "night" || id === "nord" : isDarkTheme(value.theme),
    warmth: value.backgroundWarmth, contrast: value.textContrast, imageBrightness: value.imageBrightness
  }, readingFocus: value.readingFocus };
}

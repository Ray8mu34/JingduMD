import type { CSSProperties } from "react";
import type { ReaderPreferences, SystemFont } from "../types";
import { readerFontCss } from "./fonts";
import { isDarkTheme, resolveReadingStyle } from "./readerPreferences";

export function readerPresentation(preferences: ReaderPreferences, fonts: SystemFont[] = []) {
  const effective = resolveReadingStyle(preferences);
  const legacy = preferences.styleMode === "legacy";
  const serif = effective.fontFamily === "serif";
  const bodyFallback = serif
    ? legacy ? '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif' : 'Georgia, "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif'
    : legacy ? '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif' : '"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
  const headingFallback = serif
    ? legacy ? 'Georgia, "Noto Serif CJK SC", "Songti SC", serif'
      : preferences.typographyProfile === "study" ? '"Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
        : 'Georgia, "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", serif'
    : legacy ? 'Inter, "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif' : 'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';
  const style = {
    "--reader-size": `${effective.fontSize}px`, "--reader-leading": effective.lineHeight,
    "--reader-width": `${effective.contentWidth}px`, "--paragraph-space": `${effective.paragraphSpacing}em`,
    "--reader-font": [effective.chineseFont && '"JingReader CJK"', effective.latinFont && '"JingReader Latin"', bodyFallback].filter(Boolean).join(", "),
    "--heading-font": [effective.chineseHeadingFont && '"JingReader Heading CJK"', effective.latinHeadingFont && '"JingReader Heading Latin"', effective.headingFont && '"JingReader Heading"', headingFallback].filter(Boolean).join(", "),
    "--code-font": [effective.codeFont && '"JingReader Code"', '"Cascadia Code", "JetBrains Mono", Consolas, Menlo, monospace'].filter(Boolean).join(", "),
    "--heading-scale": effective.headingScale,
    "--heading-space": effective.headingDensity === "compact" ? .78 : effective.headingDensity === "airy" ? 1.2 : 1,
    "--first-line-indent": `${effective.firstLineIndent}em`, "--reader-align": effective.textAlign,
    "--reader-tracking": `${effective.letterSpacing}em`, "--reader-warmth": `${effective.backgroundWarmth}%`,
    "--text-contrast": `${effective.textContrast}%`, "--code-scale": `${effective.codeScale}em`,
    "--formula-scale": `${effective.formulaScale}em`, "--image-brightness": `${effective.imageBrightness}%`
  } as CSSProperties;
  const appearance = legacy ? preferences.legacyAppearance : preferences.appearance;
  const classes = [
    `theme-${effective.theme}`, `font-${effective.fontFamily}`,
    legacy ? "style-legacy" : `style-canonical profile-${preferences.typographyProfile}`,
    appearance ? `appearance-${appearance}` : "",
    `paragraph-${effective.paragraphStyle}`, `quote-${effective.quoteStyle}`,
    `table-${effective.tableStyle}`, `image-${effective.imageStyle}`,
    `reading-focus-${effective.readingFocus}`, effective.codeWrap ? "code-wrap" : ""
  ].filter(Boolean).join(" ");
  return {
    effective, style, classes,
    fontCss: readerFontCss(effective, fonts),
    night: appearance ? appearance === "night" || appearance === "nord" : isDarkTheme(effective.theme)
  };
}

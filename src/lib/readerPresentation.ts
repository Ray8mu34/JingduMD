import type { CSSProperties } from "react";
import type { ReaderPreferences, SystemFont } from "../types";
import { readerFontCss } from "./fonts";
import { resolveReaderStyle } from "../reader/styleContract";

export function readerPresentation(preferences: ReaderPreferences, fonts: SystemFont[] = []) {
  const { typography, appearance, readingFocus } = resolveReaderStyle(preferences);
  const legacy = preferences.styleMode === "legacy";
  const profileOverrides = preferences.typographyOverrides?.[preferences.typographyProfile] ?? {};
  const inheritedHeading = {
    cjk: !!typography.headingFont && (legacy ? !typography.chineseHeadingFont : profileOverrides.chineseHeadingFont === undefined),
    latin: !!typography.headingFont && (legacy ? !typography.latinHeadingFont : profileOverrides.latinHeadingFont === undefined),
    full: !!typography.headingFont && (legacy ? !typography.chineseHeadingFont && !typography.latinHeadingFont : profileOverrides.chineseHeadingFont === undefined && profileOverrides.latinHeadingFont === undefined)
  };
  const serif = typography.fontFamily === "serif";
  const bodyFallback = serif
    ? legacy ? '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif' : 'Georgia, "Noto Serif SC", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif'
    : legacy ? '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif' : '"Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
  const headingFallback = serif
    ? legacy ? 'Georgia, "Noto Serif CJK SC", "Songti SC", serif'
      : preferences.typographyProfile === "study" ? '"Segoe UI", "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif'
        : 'Georgia, "Noto Serif SC", "Noto Serif CJK SC", "Songti SC", serif'
    : legacy ? 'Inter, "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif' : 'Inter, "Noto Sans SC", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';
  const style = {
    "--reader-size": `${typography.fontSize}px`, "--reader-leading": typography.lineHeight,
    "--reader-width": `${typography.contentWidth}px`, "--paragraph-space": `${typography.paragraphSpacing}em`,
    "--reader-font": [typography.chineseFont && '"JingReader CJK"', typography.latinFont && '"JingReader Latin"', bodyFallback].filter(Boolean).join(", "),
    "--heading-font": [typography.chineseHeadingFont && '"JingReader Heading CJK"', typography.latinHeadingFont && '"JingReader Heading Latin"', inheritedHeading.full && '"JingReader Heading"', !inheritedHeading.full && inheritedHeading.cjk && '"JingReader Heading Legacy CJK"', !inheritedHeading.full && inheritedHeading.latin && '"JingReader Heading Legacy Latin"', headingFallback].filter(Boolean).join(", "),
    "--code-font": [typography.codeFont && '"JingReader Code"', '"Cascadia Code", "JetBrains Mono", Consolas, Menlo, monospace'].filter(Boolean).join(", "),
    "--heading-scale": typography.headingScale,
    "--heading-space": typography.headingDensity === "compact" ? .78 : typography.headingDensity === "airy" ? 1.2 : 1,
    "--first-line-indent": `${typography.firstLineIndent}em`, "--reader-align": typography.textAlign,
    "--reader-tracking": `${typography.letterSpacing}em`, "--reader-warmth": `${appearance.warmth}%`,
    "--text-contrast": `${appearance.contrast}%`, "--code-scale": `${typography.codeScale}em`,
    "--formula-scale": `${typography.formulaScale}em`, "--image-brightness": `${appearance.imageBrightness}%`
  } as CSSProperties;
  const classes = [
    `theme-${appearance.theme}`, `font-${typography.fontFamily}`,
    legacy ? "style-legacy" : `style-canonical profile-${preferences.typographyProfile}`,
    appearance.id ? `appearance-${appearance.id}` : "",
    `paragraph-${typography.paragraphStyle}`, `quote-${typography.quoteStyle}`,
    `table-${typography.tableStyle}`, `image-${typography.imageStyle}`,
    `reading-focus-${readingFocus}`, typography.codeWrap ? "code-wrap" : ""
  ].filter(Boolean).join(" ");
  return {
    typography, appearance, style, classes,
    fontCss: readerFontCss(typography, fonts, inheritedHeading),
    night: appearance.night
  };
}

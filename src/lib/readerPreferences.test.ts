import { DEFAULT_PREFERENCES } from "../types";
import {
  applyPreset, chooseAppearance, chooseTypographyProfile, findPreset, isDarkTheme, isPresetModified, matchingCustomProfile, migratePreferences, resolveReadingStyle, setTypographyOverride,
  READER_PRESETS, recipeFromPreferences
} from "./readerPreferences";

describe("reader presets", () => {
  it("applies a complete preset without losing privacy or font-library state", () => {
    const current = { ...DEFAULT_PREFERENCES, allowedRemoteHosts: ["images.example"], chineseFont: "SimSun" };
    const next = applyPreset(current, "chinese");
    expect(next.paragraphStyle).toBe("indent");
    expect(next.textAlign).toBe("justify");
    expect(next.allowedRemoteHosts).toEqual(["images.example"]);
    expect(next.chineseFont).toBe("SimSun");
  });

  it("detects preset customization and dark variants", () => {
    const preset = applyPreset(DEFAULT_PREFERENCES, "nord");
    expect(isPresetModified(preset)).toBe(false);
    expect(isPresetModified({ ...preset, lineHeight: 2 })).toBe(true);
    expect(isDarkTheme("nord")).toBe(true);
    expect(isDarkTheme("paper")).toBe(false);
  });

  it("registers the modern textbook preset with a unique stable id", () => {
    const ids = READER_PRESETS.map((preset) => preset.id);
    expect(ids).toContain("modern-textbook");
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPreset("modern-textbook")).toMatchObject({
      id: "modern-textbook", name: "现代教材", dark: false, category: "技术"
    });
  });

  it("applies modern textbook defaults and still allows user overrides", () => {
    const preset = applyPreset(DEFAULT_PREFERENCES, "modern-textbook");
    expect(preset).toMatchObject({
      theme: "modern-textbook", fontSize: 19.5, lineHeight: 1.78, contentWidth: 780,
      paragraphSpacing: 1.05, fontFamily: "sans", headingScale: 0.98,
      headingDensity: "airy", quoteStyle: "bar", tableStyle: "plain",
      formulaScale: 1.05, imageStyle: "plain", backgroundWarmth: 0
    });

    const customized = { ...preset, lineHeight: 2.03, letterSpacing: 0.012 };
    expect(isPresetModified(customized)).toBe(true);
    expect(customized.lineHeight).toBe(2.03);
    expect(customized.letterSpacing).toBe(0.012);
  });

  it("switches away from modern textbook without changing existing preset recipes", () => {
    const textbook = applyPreset(DEFAULT_PREFERENCES, "modern-textbook");
    const technical = applyPreset(textbook, "technical");
    expect(technical).toMatchObject({
      theme: "technical", fontSize: 18, lineHeight: 1.72, contentWidth: 920,
      headingDensity: "compact", tableStyle: "compact", imageStyle: "bordered"
    });
    expect(isPresetModified(technical)).toBe(false);
  });

  it("migrates the old reading ruler setting", () => {
    const migrated = migratePreferences({ ...DEFAULT_PREFERENCES, readingRuler: true, readingFocus: "off" });
    expect(migrated.readingFocus).toBe("ruler");
  });

  it("gives older settings a stable white-paper PDF default", () => {
    const migrated = migratePreferences({ theme: "night" });
    expect(migrated.pdfStyle).toBe("paper");
    expect(migrated.pdfIncludeHighlights).toBe(true);
  });

  it("matches locally stored custom profiles", () => {
    const recipe = recipeFromPreferences(DEFAULT_PREFERENCES);
    const value = { ...DEFAULT_PREFERENCES, customProfiles: [{ id: "mine", name: "我的样式", recipe }] };
    expect(matchingCustomProfile(value)?.id).toBe("mine");
  });
  it("keeps old styles through idempotent migration", () => {
    const old = { theme: "nord" as const, chineseFont: "SimSun", customProfiles: [{ id: "old", name: "旧样式", recipe: recipeFromPreferences(DEFAULT_PREFERENCES) }] };
    const first = migratePreferences(old);
    expect(first).toMatchObject({ styleMode: "legacy", theme: "nord", chineseFont: "SimSun", showTree: true, showOutline: true });
    expect(migratePreferences(first)).toEqual(first);
  });
  it("separates canonical appearance, typography and reading behavior", () => {
    const original = resolveReadingStyle(DEFAULT_PREFERENCES);
    const night = resolveReadingStyle(chooseAppearance(DEFAULT_PREFERENCES, "night"));
    expect(night.lineHeight).toBe(original.lineHeight);
    expect(night.contentWidth).toBe(original.contentWidth);
    const changed = setTypographyOverride(DEFAULT_PREFERENCES, "chineseFont", "SimSun");
    expect(resolveReadingStyle(changed).chineseFont).toBe("SimSun");
    expect(resolveReadingStyle(chooseTypographyProfile(changed, "study")).chineseFont).toBe("");
    expect(resolveReadingStyle(chooseTypographyProfile(chooseTypographyProfile(changed, "study"), "reading")).chineseFont).toBe("SimSun");
    expect(changed.remoteImagePolicy).toBe("ask");
  });
});

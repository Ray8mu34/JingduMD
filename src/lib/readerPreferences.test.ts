import { DEFAULT_PREFERENCES } from "../types";
import {
  applyPreset, isDarkTheme, isPresetModified, matchingCustomProfile, migratePreferences,
  recipeFromPreferences
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
});

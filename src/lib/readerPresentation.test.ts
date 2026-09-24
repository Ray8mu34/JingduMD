import { DEFAULT_PREFERENCES } from "../types";
import { readerPresentation } from "./readerPresentation";
const variable = (value: ReturnType<typeof readerPresentation>, name: string) => (value.style as Record<string, unknown>)[name];

describe("canonical typography roles", () => {
  it("keeps the body family while giving study a sans heading role", () => {
    const reading = readerPresentation(DEFAULT_PREFERENCES);
    const study = readerPresentation({ ...DEFAULT_PREFERENCES, typographyProfile: "study" });
    expect(variable(reading, "--reader-font")).toBe(variable(study, "--reader-font"));
    expect(String(variable(reading, "--heading-font"))).toContain("Georgia");
    expect(String(variable(study, "--heading-font"))).toContain("Segoe UI");
    expect(reading.classes).toContain("profile-reading");
    expect(study.classes).toContain("profile-study");
  });

  it("honors explicit heading font overrides in either profile", () => {
    const value = { ...DEFAULT_PREFERENCES, typographyOverrides: { reading: { headingFont: "My Serif" }, study: { headingFont: "My Sans" } } };
    expect(String(variable(readerPresentation(value), "--heading-font"))).toContain('"JingReader Heading"');
    expect(readerPresentation({ ...value, typographyProfile: "study" }).fontCss).toContain('local("My Sans")');
    const resetChinese = { ...value, typographyOverrides: { ...value.typographyOverrides, reading: { headingFont: "My Serif", chineseHeadingFont: "" } } };
    const resetStack = String(variable(readerPresentation(resetChinese), "--heading-font"));
    expect(resetStack).not.toContain("JingReader Heading Legacy CJK");
    expect(resetStack).toContain("JingReader Heading Legacy Latin");
  });

  it("keeps CJK and Latin heading choices separate across profiles", () => {
    const reading = { ...DEFAULT_PREFERENCES, typographyOverrides: { reading: { chineseHeadingFont: "Noto Serif SC", latinHeadingFont: "Georgia" }, study: { chineseHeadingFont: "Noto Sans SC", latinHeadingFont: "Segoe UI" } } };
    const first = readerPresentation(reading);
    const second = readerPresentation({ ...reading, typographyProfile: "study" });
    expect(first.fontCss).toContain('font-family:"JingReader Heading CJK";src:local("Noto Serif SC")');
    expect(first.fontCss).toContain('font-family:"JingReader Heading Latin";src:local("Georgia")');
    expect(second.fontCss).toContain('font-family:"JingReader Heading CJK";src:local("Noto Sans SC")');
    expect(second.fontCss).toContain('font-family:"JingReader Heading Latin";src:local("Segoe UI")');
    expect(variable(first, "--reader-font")).toBe(variable(second, "--reader-font"));
    expect(variable(first, "--code-font")).toBe(variable(second, "--code-font"));
  });
});

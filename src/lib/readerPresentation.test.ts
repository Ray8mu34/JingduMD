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
  });
});

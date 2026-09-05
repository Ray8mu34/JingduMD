import { formatModifiedTime, readingMetrics } from "./reading";

describe("reading metrics", () => {
  it("counts readable Chinese and Latin content without Markdown decoration", () => {
    const result = readingMetrics("# 标题\n\n这是中文。 [OpenAI](https://openai.com) reads well.");
    expect(result.cjkCharacters).toBeGreaterThanOrEqual(6);
    expect(result.latinWords).toBe(3);
    expect(result.characters).toBeGreaterThan(8);
    expect(result.minutes).toBe(1);
  });

  it("always gives a useful minimum reading time", () => {
    expect(readingMetrics("").minutes).toBe(1);
  });

  it("formats valid modification times and ignores missing ones", () => {
    expect(formatModifiedTime(0)).toBe("");
    expect(formatModifiedTime(Date.UTC(2026, 0, 2, 3, 4))).toContain("2026");
  });
});

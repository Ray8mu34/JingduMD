import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { documentRenderTier } from "../components/MarkdownReader";

describe("reading fixture gallery", () => {
  it("keeps representative Markdown features in the fixed showcase", () => {
    const source = readFileSync(resolve("fixtures/reader-showcase.md"), "utf8");
    expect(source).toContain("> [!NOTE]");
    expect(source).toContain("```typescript");
    expect(source).toContain("\\[");
    expect(source).toContain("![本地阅读网格]");
  });

  it("uses a stricter render tier for extreme documents", () => {
    expect(documentRenderTier("正文".repeat(40_000))).toBe("long");
    expect(documentRenderTier("正文".repeat(500_000))).toBe("extreme");
  });
});


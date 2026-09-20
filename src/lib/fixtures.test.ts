import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { documentRenderTier } from "../components/MarkdownReader";

describe("reading fixture gallery", () => {
  it("keeps representative Markdown features in the fixed showcase", () => {
    const source = readFileSync(resolve("fixtures/reader-showcase.md"), "utf8");
    expect(source).toContain("> [!NOTE]");
    expect(source).toContain("> 普通引用");
    expect(source).toContain("### 从行内记号到展示公式");
    expect(source).toContain("```typescript");
    expect(source).toContain("\\[");
    expect(source).toContain("\\mathcal{L}(\\theta)");
    expect(source).toContain("- 行内元素应当保持自然 baseline");
    expect(source).toContain("1. 先确认正文");
    expect(source).toContain("Modern technical prose");
    expect(source).toContain("**粗体术语**");
    expect(source).toContain("| 项目 | 目标 |");
    expect(source).toContain("![本地阅读网格]");
    expect(source).toContain("[^reader]");
  });

  it("uses a stricter render tier for extreme documents", () => {
    expect(documentRenderTier("正文".repeat(40_000))).toBe("long");
    expect(documentRenderTier("正文".repeat(500_000))).toBe("extreme");
  });
});

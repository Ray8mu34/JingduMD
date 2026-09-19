import { fireEvent, render, waitFor } from "@testing-library/react";
import MarkdownReader, { isLongDocument, mermaidViewBoxWidth, sanitizeMermaidSvg } from "./MarkdownReader";
import type { DocumentPayload } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => command === "read_remote_image"
    ? Promise.resolve({ mime: "image/png", data: [137, 80, 78, 71, 13, 10, 26, 10] })
    : Promise.reject(new Error("unexpected invoke")))
}));

describe("MarkdownReader mathematics", () => {
  it("renders dollar and TeX delimiters while preserving code", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\math.md",
      name: "math.md",
      modifiedMs: 0,
      size: 0,
      content: [
        "行内 \\(a+b\\) 与 $c+d$。",
        "",
        "\\[",
        "e^{i\\pi}+1=0",
        "\\]",
        "",
        "$$",
        "x^2",
        "$$",
        "",
        "`\\(code\\)`"
      ].join("\n")
    };

    const { container, getByText } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelectorAll("span.lazy-math.math-inline")).toHaveLength(2);
    expect(container.querySelectorAll("span.lazy-math.math-display")).toHaveLength(2);
    expect(container.querySelector("span.lazy-math.math-display")?.closest("pre")).toBeNull();
    expect(container.querySelector("span.lazy-math.math-display")).toHaveAttribute("aria-label", "数学公式，可横向滚动");
    expect(getByText("\\(code\\)")).toBeInTheDocument();
  });

  it("does not request a remote image before the user allows its host", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\privacy.md", name: "privacy.md", modifiedMs: 0, size: 0,
      content: "![tracking pixel](https://images.example.test/pixel.png)"
    };
    const { container, getByText } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("images.example.test")).toBeInTheDocument();
  });

  it("sanitizes active content and outbound links from Mermaid SVG", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><a href="https://tracker.test"><text onload="alert(2)">safe</text></a><path d="M0 0L1 1" /></svg>';
    const sanitized = sanitizeMermaidSvg(source);
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("foreignObject");
    expect(sanitized).not.toContain("tracker.test");
    expect(sanitized).not.toContain("onload");
    expect(sanitized).toContain("safe");
    expect(sanitized).toContain("<path");
  });

  it("keeps Mermaid diagrams in their own render boundary", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\diagram.md", name: "diagram.md", modifiedMs: 0, size: 0,
      content: "```mermaid\nflowchart LR\n  A --> B\n```"
    };
    const { container, getByRole } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    const region = getByRole("region", { name: "Mermaid 图表，可横向滚动" });
    expect(region).toHaveClass("mermaid-block");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(container.querySelector(".mermaid-block")?.closest("pre")).toBeNull();
    expect(mermaidViewBoxWidth('<svg viewBox="0 0 1849.5 400"></svg>')).toBe(1849.5);
    expect(mermaidViewBoxWidth("<svg></svg>")).toBeNull();
  });

  it("enables browser-native rendering containment for very long documents", () => {
    expect(isLongDocument("段落\n".repeat(4_001))).toBe(true);
    expect(isLongDocument("普通短文")).toBe(false);
    const document: DocumentPayload = {
      path: "C:\\notes\\long.md", name: "long.md", modifiedMs: 0, size: 100_000,
      content: `# 长文\n\n${"正文".repeat(40_000)}`
    };
    const { container } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelector("article")).toHaveClass("long-document");
  });

  it("can hide frontmatter without changing the Markdown body", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\frontmatter.md", name: "frontmatter.md", modifiedMs: 0, size: 0,
      content: "---\ntitle: 私有属性\n---\n# 可见正文"
    };
    const { container, getByText } = render(<MarkdownReader document={document} night={false} showFrontmatter={false} onOpenDocument={() => {}} />);
    expect(container.querySelector(".frontmatter")).toBeNull();
    expect(getByText("可见正文")).toBeInTheDocument();
  });

  it("keeps wide tables inside a dedicated horizontal scroll region", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\table.md", name: "table.md", modifiedMs: 0, size: 0,
      content: "| 时期 | 篇幅与频率 | 主题 | 人物 | 备注 |\n| --- | --- | --- | --- | --- |\n| 2021-08 | 高频、中长篇 | 写作变化 | 示例人物 | 很长的补充说明 |"
    };
    const { container, getByRole } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    const region = getByRole("region", { name: "表格，可横向滚动" });
    expect(region).toHaveClass("table-scroll");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.querySelector("table")).toBe(container.querySelector("table"));
  });

  it("folds and expands fenced code blocks", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\code.md", name: "code.md", modifiedMs: 0, size: 0,
      content: "```ts\nconst answer = 42;\nconsole.log(answer);\n```"
    };
    const { container, getByRole } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelector("pre")).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "折叠" }));
    expect(container.querySelector("pre")).not.toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "展开" }));
    expect(container.querySelector("pre")).toBeInTheDocument();
  });

  it("renders collapsible Callouts and heading sections", () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\sections.md", name: "sections.md", modifiedMs: 0, size: 0,
      content: "# 第一节\n\n正文一\n\n> [!TIP]\n> 可以折叠的提示\n\n## 子节\n\n子节正文\n\n# 第二节\n\n正文二"
    };
    const { container, getAllByRole, getByRole, getByText, queryByText } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelector(".callout-tip")).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "提示" }));
    expect(queryByText("可以折叠的提示")).not.toBeInTheDocument();
    fireEvent.click(getAllByRole("button", { name: "折叠本节" })[0]);
    expect(getByText("正文一").closest("p")).toHaveAttribute("data-section-hidden");
    expect(getByText("正文二").closest("p")).not.toHaveAttribute("data-section-hidden");
  });

  it("folds images and opens the existing image preview", async () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\image.md", name: "image.md", modifiedMs: 0, size: 0,
      content: "![示例图](https://images.example.test/preview.png)"
    };
    const { getByRole, queryByRole } = render(<MarkdownReader document={document} night={false} remoteImagePolicy="allow" onOpenDocument={() => {}} />);
    await waitFor(() => expect(getByRole("button", { name: "放大" })).toBeInTheDocument());
    fireEvent.click(getByRole("button", { name: "折叠" }));
    expect(getByRole("button", { name: "展开图片" })).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "展开图片" }));
    fireEvent.click(getByRole("button", { name: "放大" }));
    expect(getByRole("dialog", { name: "示例图" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(queryByRole("dialog", { name: "示例图" })).not.toBeInTheDocument();
  });
});

import { fireEvent, render, waitFor } from "@testing-library/react";
import MarkdownReader, { isLongDocument, mermaidViewBoxWidth, sanitizeMermaidSvg } from "./MarkdownReader";
import type { DocumentPayload } from "../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { imageSizeKey, readImageWidth } from "../lib/imageSizing";
import { TabContext } from "../lib/tabContext";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => command === "read_remote_image"
    ? Promise.resolve({ mime: "image/png", data: [137, 80, 78, 71, 13, 10, 26, 10] })
    : Promise.reject(new Error("unexpected invoke")))
}));

describe("MarkdownReader mathematics", () => {
  it("loads an image two directories above the document using its tab and document context", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ mime: "image/png", data: [137, 80, 78, 71, 13, 10, 26, 10] });
    const document: DocumentPayload = {
      path: "D:\\资料\\天文学\\course\\01-solar-system\\slides.md", name: "slides.md", modifiedMs: 0, size: 0,
      content: "![太阳、地球与月球](../../assets/01/relations.png){height=3.8in}"
    };
    const { findByAltText } = render(<TabContext.Provider value="tab-images">
      <MarkdownReader document={document} night={false} onOpenDocument={() => {}} />
    </TabContext.Provider>);
    expect(await findByAltText("太阳、地球与月球")).toHaveAttribute("src", "blob:jingreader-test");
    expect(invoke).toHaveBeenCalledWith("read_asset", {
      documentPath: document.path, path: "D:\\资料\\天文学\\assets\\01\\relations.png", tabId: "tab-images"
    }, undefined);
  });

  it("renders fenced math as a display equation without a code toolbar", () => {
    const document: DocumentPayload = { path: "math.md", name: "math.md", modifiedMs: 0, size: 0, content: "```math\nx^2 + y^2 = 1\n```\n\nInline $x$." };
    const { container } = render(<MarkdownReader document={document} night={false} onOpenDocument={() => {}} />);
    expect(container.querySelectorAll(".math-display")).toHaveLength(1);
    expect(container.querySelectorAll(".math-inline")).toHaveLength(1);
    expect(container.querySelector(".code-block")).toBeNull();
  });
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
    await waitFor(() => expect(getByRole("img", { name: "示例图" })).toBeInTheDocument());
    fireEvent.click(getByRole("button", { name: "折叠" }));
    expect(getByRole("button", { name: "展开图片" })).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "展开图片" }));
    fireEvent.click(getByRole("img", { name: "示例图" }));
    expect(getByRole("dialog", { name: "示例图" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(queryByRole("dialog", { name: "示例图" })).not.toBeInTheDocument();
  });
  it("preserves the destination of a linked README badge", async () => {
    const document: DocumentPayload = {
      path: "C:\\notes\\README.md", name: "README.md", modifiedMs: 0, size: 0,
      content: "[![build](https://images.example.test/badge.png)](https://example.test/build)"
    };
    const { getByAltText, queryByRole } = render(<MarkdownReader document={document} night={false} remoteImagePolicy="allow" onOpenDocument={() => {}} />);
    const badge = await waitFor(() => getByAltText("build"));
    fireEvent.click(badge);
    expect(openUrl).toHaveBeenCalledWith("https://example.test/build");
    expect(queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("remembers inline display width per document and keeps preview zoom independent", async () => {
    const source = "https://images.example.test/sizing.png";
    const document: DocumentPayload = {
      path: "C:\\notes\\sizing.md", name: "sizing.md", modifiedMs: 0, size: 0,
      content: `![尺寸示例](${source})`
    };
    const props = { document, night: false, remoteImagePolicy: "allow" as const, onOpenDocument: () => {} };
    const view = render(<MarkdownReader {...props} />);
    const img = await view.findByAltText("尺寸示例");
    Object.defineProperty(img, "naturalWidth", { value: 800 });
    fireEvent.load(img);
    fireEvent.click(view.getByTitle("调整显示大小"));
    fireEvent.change(view.getByRole("spinbutton", { name: "原图缩放百分比" }), { target: { value: "40" } });
    expect(view.getByAltText("尺寸示例").parentElement).toHaveStyle({ width: "320px" });
    expect(readImageWidth(imageSizeKey(document.path, source))).toBe(40);
    fireEvent.keyDown(view.getByRole("spinbutton"), { key: "Escape" });
    expect(view.queryByRole("spinbutton")).toBeNull();
    expect(view.getByTitle("调整显示大小")).toHaveFocus();
    fireEvent.click(view.getByAltText("尺寸示例"));
    expect(view.getByRole("dialog").querySelector("img")?.style.width).toBe("");
    fireEvent.keyDown(window, { key: "Escape" });
    view.rerender(<MarkdownReader {...props} document={{ ...document, path: "C:\\notes\\other.md" }} />);
    expect((await view.findByAltText("尺寸示例")).parentElement).toHaveStyle({ maxWidth: "100%" });
    view.rerender(<MarkdownReader {...props} />);
    const restored = await view.findByAltText("尺寸示例");
    Object.defineProperty(restored, "naturalWidth", { value: 800 }); fireEvent.load(restored);
    expect(restored.parentElement).toHaveStyle({ width: "320px" });
    fireEvent.click(view.getByTitle("调整显示大小"));
    fireEvent.click(view.getByRole("button", { name: "适应正文" }));
    expect(view.getByAltText("尺寸示例").style.width).toBe("");
    expect(readImageWidth(imageSizeKey(document.path, source))).toBeNull();
  });

  it("ignores invalid saved sizes and still resizes when storage is unavailable", async () => {
    const key = imageSizeKey("test", "test");
    for (const value of ["NaN", "0", "-10", "401"]) {
      localStorage.setItem(key, value);
      expect(readImageWidth(key)).toBeNull();
    }
    localStorage.removeItem(key);
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    try {
      const document: DocumentPayload = { path: "no-storage.md", name: "no-storage.md", size: 0, modifiedMs: 0, content: "![图](https://images.example.test/unavailable.png)" };
      const view = render(<MarkdownReader document={document} night={false} remoteImagePolicy="allow" onOpenDocument={() => {}} />);
      const img = await view.findByAltText("图"); Object.defineProperty(img, "naturalWidth", { value: 800 }); fireEvent.load(img);
      fireEvent.click(view.getByTitle("调整显示大小"));
      fireEvent.change(view.getByRole("spinbutton"), { target: { value: "60" } });
      expect(view.getByAltText("图").parentElement).toHaveStyle({ width: "480px" });
    } finally { storage.mockRestore(); }
  });
});

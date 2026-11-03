import { render, fireEvent } from "@testing-library/react";
import { notebookBody, notebookOutline, notebookOutput, parseNotebook, sanitizeNotebookTable, normalizeNotebookMarkdown } from "./notebook";
import MarkdownReader from "../components/MarkdownReader";
import { findTextRanges } from "./find";

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const fixture = JSON.stringify({ nbformat: 4, metadata: { language_info: { name: "python" }, secret: "excluded" }, cells: [
  { cell_type: "markdown", source: ["# 中文\n\n", "公式 $x^2$。![附件](attachment:图.png)"], attachments: { "图.png": { "image/png": png } } },
  { cell_type: "code", source: "print('代码搜索')", outputs: [{ output_type: "stream", text: ["输出专用\n"] }, { data: { "text/html": "<table><tr><td>表格</td></tr></table>", "text/plain": "重复备选" } }] },
  { cell_type: "markdown", source: "# 中文\n\n后续正文" },
  { cell_type: "raw", source: "<script>纯文本</script>" },
  { cell_type: "code", source: "empty()", outputs: [] },
  { cell_type: "code", source: "unknown()", outputs: [null, { data: { "application/widget": {} } }] }
] });

describe("static notebooks", () => {
  it("renders Jupyter display equations like Markdown display fences without swallowing prose", () => {
    const source = "# 解析解\n\n行内 $w$。\n\n$$L(w)=\\frac{1}{n}\\sum_i l_i$$\n\n$$\\begin{aligned}\n w &= x \\\\\n b &= y\n\\end{aligned}$$\n\n## 小批量随机梯度下降\n\n公式之后的正文。";
    const content = JSON.stringify({ nbformat: 4, cells: [{ cell_type: "markdown", source }] });
    const view = render(<MarkdownReader document={{ path: "math.ipynb", name: "math.ipynb", content, size: content.length, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);
    expect(view.container.querySelector(".katex-error")).toBeNull();
    expect(view.container.querySelectorAll(".math-display .katex-display")).toHaveLength(2);
    expect(view.container.querySelectorAll(".math-inline .katex")).toHaveLength(1);
    expect(view.getByRole("heading", { name: /小批量随机梯度下降/ })).toBeTruthy();
    expect(view.getByText("公式之后的正文。").closest(".lazy-math")).toBeNull();
    expect(notebookOutline(parseNotebook(content))).toHaveLength(2);
    const markdown = render(<MarkdownReader document={{ path: "math.md", name: "math.md", content: normalizeNotebookMarkdown(source), size: 0, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);
    expect([...view.container.querySelectorAll(".lazy-math")].map(el => el.innerHTML)).toEqual([...markdown.container.querySelectorAll(".lazy-math")].map(el => el.innerHTML));
  });
  it("keeps code and escaped dollars literal and contains an unclosed display delimiter", () => {
    const code = "```python\nprint('$$not math$$')\n```\n\n`$$literal$$` and \\$\\$escaped\n";
    expect(normalizeNotebookMarkdown(code)).toBe(code);
    const content = JSON.stringify({ nbformat: 4, cells: [{ cell_type: "markdown", source: "$$unclosed\n\n## 正常标题\n\n正常正文" }] });
    const view = render(<MarkdownReader document={{ path: "unclosed.ipynb", name: "unclosed.ipynb", content, size: 0, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);
    expect(view.getByRole("heading", { name: /正常标题/ })).toBeTruthy();
    expect(view.container.querySelector(".katex-error")).toBeNull();
  });
  it("renders a clear error for broken JSON", () => {
    const view = render(<MarkdownReader document={{ path: "broken.ipynb", name: "broken.ipynb", content: "{", size: 1, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);
    expect(view.getByRole("alert").textContent).toContain("JSON 已损坏");
  });
  it("validates the container and joins source arrays without indexing metadata", () => {
    const notebook = parseNotebook(fixture);
    expect(notebookBody(notebook)).toContain("后续正文");
    expect(notebookBody(notebook)).not.toMatch(/excluded|输出专用|代码搜索/);
    expect(() => parseNotebook("{")).toThrow(/JSON/);
    expect(() => parseNotebook('{"nbformat":3}')).toThrow(/主版本/);
    expect(() => parseNotebook('{"nbformat":4}')).toThrow(/cells/);
  });
  it("selects one supported representation and degrades damaged outputs locally", () => {
    expect(notebookOutput({ data: { "image/png": png, "text/plain": "fallback" } }).kind).toBe("image");
    expect(notebookOutput({ data: { "image/png": "broken", "text/plain": ["safe"] } })).toEqual({ kind: "text", value: "safe" });
    expect(notebookOutput({ data: { "image/svg+xml": "<svg/>" } }).value).toBe("此输出暂不支持");
    expect(notebookOutput({ output_type: "stream", text: [] }).value).toBe("未保存输出");
    expect(notebookOutput({ output_type: "error", ename: "ValueError", evalue: "错误" }).value).toBe("ValueError: 错误");
    expect(notebookOutput({ output_type: "error", traceback: ["\u001b[31m错误\u001b[0m"] }).value).toBe("错误");
  });
  it("allows only inert table markup", () => {
    const result = sanitizeNotebookTable('<script>alert(1)</script><table id="bad" style="color:red" onclick="alert(1)"><tr><td><a href="javascript:alert(1)">safe</a><img src="https://tracker"><svg onload="bad()"/><iframe srcdoc="bad"/>text</td></tr></table>');
    expect(result).toContain("<table>");
    expect(result).toContain("safe");
    expect(result).not.toMatch(/script|onclick|style|href|img|svg|iframe|id=/);
    expect(sanitizeNotebookTable("<div>not a table</div>")).toBe("");
  });
  it("reuses formulas and images, has unique outline targets, excludes outputs from find", () => {
    const notebook = parseNotebook(fixture);
    const view = render(<MarkdownReader document={{ path: "test.ipynb", name: "test.ipynb", content: fixture, size: fixture.length, modifiedMs: 0 }} night={false} onOpenDocument={() => {}} />);
    const article = view.container.querySelector<HTMLElement>("article")!;
    for (const item of notebookOutline(notebook)) expect(article.querySelector(`[id="${item.id}"]`)).not.toBeNull();
    expect(new Set(notebookOutline(notebook).map(h => h.id)).size).toBe(2);
    expect(article.querySelector(".katex")).not.toBeNull();
    expect(article.querySelector('img[src^="data:image/png"]')).not.toBeNull();
    expect(article.querySelector(".table-scroll table")).not.toBeNull();
    expect(article.textContent).not.toContain("重复备选");
    expect(findTextRanges(article, "代码搜索")).toHaveLength(1);
    expect(findTextRanges(article, "输出专用")).toHaveLength(0);
    expect(view.getAllByText("未保存输出").length).toBeGreaterThan(0);
    expect(view.getByText("此输出暂不支持")).toBeTruthy();
    fireEvent.click(view.getAllByTitle("折叠代码块")[0]);
    expect(view.getByTitle("展开代码块")).toBeTruthy();
  });
});

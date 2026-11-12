import hljs from "highlight.js";
import { enrichCodeColors } from "./codeColor";

function render(source: string, language = "python") {
  const root = document.createElement("div");
  root.innerHTML = enrichCodeColors(hljs.highlight(source, { language }).value, language);
  expect(root.textContent).toBe(source);
  return root;
}

describe("reading code colors", () => {
  it("colors method calls, operators and nested matching brackets across grammar tokens", () => {
    const root = render('Z = torch.zeros_like(Y)\nprint("id(Z):", id(Z))\nx = torch.tensor([[1, 2], [3, 4]])\nx += 1\nx == 2');
    expect(root.querySelector(".code-call")?.textContent).toBe("zeros_like");
    expect([...root.querySelectorAll(".code-operator")].map(e => e.textContent)).toEqual(["=", "=", "+=", "=="]);
    expect([...root.querySelectorAll(".code-bracket-2")].map(e => e.textContent)).toEqual(["[", "]", "[", "]"]);
    expect(root.querySelector(".hljs-string span")).toBeNull();
  });
  it("leaves comments, escaped strings, triple quotes and HTML-looking text untouched", () => {
    const root = render('# fake(call()) + []\ns = "escaped \\" (call())"\nt = """<img src=x onerror=alert(1)> [()]"""\nreal()');
    expect(root.querySelectorAll(".code-call")).toHaveLength(1);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".hljs-comment span, .hljs-string span")).toBeNull();
  });
  it("keeps unmatched brackets neutral and resets matching after malformed pairs", () => {
    const root = render('([)]\nvalid([])\nunfinished(');
    expect([...root.querySelectorAll('[class^="code-bracket-"]')].map(e => e.textContent).join("")).toBe("([])");
  });
  it("preserves JavaScript regex and template string contents", () => {
    const root = render('const re = /[()]+/g;\nconst s = `call([])`;\nrun([1, 2]);', "javascript");
    expect(root.querySelector(".hljs-regexp span, .hljs-string span")).toBeNull();
    expect(root.querySelector(".hljs-title.function_, .code-call")?.textContent).toBe("run");
    expect(root.querySelectorAll(".code-bracket-1")).toHaveLength(2);
  });
  it("does not reinterpret unsupported languages or excessively large blocks", () => {
    const html = '<span class="hljs-string">text()</span>';
    expect(enrichCodeColors(html, "xml")).toBe(html);
    expect(enrichCodeColors("(".repeat(500_001), "python")).toBe("(".repeat(500_001));
  });
});

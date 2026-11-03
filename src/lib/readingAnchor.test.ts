import { captureTextAnchor, restoreTextAnchor } from "./readingAnchor";

describe("reading text anchor", () => {
  it("falls back to the paragraph offset when a surviving text node changes during highlighting", () => {
    const container = document.createElement("div");
    container.innerHTML = '<article class="markdown-body"><p>Earlier text reading here</p></article>';
    document.body.append(container);
    const node = container.querySelector("p")!.firstChild as Text;
    const original = node.data;
    node.data = "Earlier text ";
    const mark = document.createElement("span");
    mark.textContent = "reading here";
    node.after(mark);
    const range = document.createRange();
    range.getBoundingClientRect = () => ({ top: 180, height: 20, width: 0 } as DOMRect);
    const start = vi.spyOn(range, "setStart");
    const create = vi.spyOn(document, "createRange").mockReturnValue(range);
    try {
      restoreTextAnchor(container, { blockIndex: 0, text: original, textOffset: 16,
        context: original, viewportTop: 180, node, nodeOffset: 16, nodeText: original });
      expect(start).toHaveBeenCalledWith(mark.firstChild, 3);
    } finally { create.mockRestore(); container.remove(); }
  });
  it("restores the caret geometry at offset zero after highlight spans replace text", () => {
    const container = document.createElement("div");
    container.innerHTML = '<article class="markdown-body"><p><span>Paragraph start</span></p></article>';
    container.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
    container.querySelector("p")!.getBoundingClientRect = () => ({ top: 140 } as DOMRect);
    const range = document.createRange();
    range.getBoundingClientRect = () => ({ top: 150, height: 20, width: 0 } as DOMRect);
    const start = vi.spyOn(range, "setStart");
    const create = vi.spyOn(document, "createRange").mockReturnValue(range);
    try {
      restoreTextAnchor(container, { blockIndex: 0, text: "Paragraph start", textOffset: 0,
        context: "Paragraph start", viewportTop: 150, caret: true });
      expect(start).toHaveBeenCalledWith(container.querySelector("span")!.firstChild, 0);
      expect(container.scrollTop).toBe(0);
    } finally { create.mockRestore(); }
  });
  it("keeps a prose caret when preceding inline math replaces its text", () => {
    const container = document.createElement("div");
    container.innerHTML = '<article class="markdown-body"><p>Before <span class="lazy-math">x</span> keep reading here</p></article>';
    document.body.append(container);
    const node = container.querySelector("p")!.lastChild as Text;
    const range = document.createRange();
    range.getBoundingClientRect = () => ({ top: 210, height: 20, width: 0 } as DOMRect);
    const start = vi.spyOn(range, "setStart");
    const create = vi.spyOn(document, "createRange").mockReturnValue(range);
    container.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
    try {
      container.querySelector(".lazy-math")!.innerHTML = "<span>xx</span><span>xx</span>";
      restoreTextAnchor(container, { blockIndex: 0, text: "Before x keep reading here", textOffset: 13,
        context: "Before x keep reading here", viewportTop: 180, node, nodeOffset: 5 });
      expect(start).toHaveBeenCalledWith(node, 5);
      expect(container.scrollTop).toBe(30);
    } finally { create.mockRestore(); container.remove(); }
  });
  it("keeps the original offset when a paragraph repeats the same phrase", () => {
    const container = document.createElement("div");
    const text = "重复句子用于验证阅读位置。".repeat(30);
    container.innerHTML = `<article class="markdown-body"><p>${text}</p></article>`;
    const offset = 160;
    const range = document.createRange();
    range.getBoundingClientRect = () => ({ top: 180, height: 20, width: 0 } as DOMRect);
    const start = vi.spyOn(range, "setStart");
    const create = vi.spyOn(document, "createRange").mockReturnValue(range);
    try {
      restoreTextAnchor(container, { blockIndex: 0, text: text.slice(0, 120), textOffset: offset, context: text.slice(offset - 20, offset + 20), viewportTop: 180 });
      expect(start).toHaveBeenCalledWith(container.querySelector("p")!.firstChild, offset);
    } finally { create.mockRestore(); }
  });
  it("keeps the same visible paragraph when preceding content grows", () => {
    const container = document.createElement("div");
    container.innerHTML = '<article class="markdown-body"><p>Earlier content</p><p>Stay at this sentence</p></article>';
    const paragraphs = container.querySelectorAll("p");
    let secondTop = 150;
    container.getBoundingClientRect = () => ({ top: 0, bottom: 900, left: 0, right: 760, width: 760, height: 900 } as DOMRect);
    paragraphs[0].getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 600, width: 600, height: 100 } as DOMRect);
    paragraphs[1].getBoundingClientRect = () => ({ top: secondTop, bottom: secondTop + 200, left: 0, right: 600, width: 600, height: 200 } as DOMRect);
    const anchor = captureTextAnchor(container)!;
    expect(anchor.blockIndex).toBe(1);
    secondTop += 52;
    expect(restoreTextAnchor(container, anchor)).toBe(true);
    expect(container.scrollTop).toBe(52);
  });
});

import { captureTextAnchor, restoreTextAnchor } from "./readingAnchor";

describe("reading text anchor", () => {
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

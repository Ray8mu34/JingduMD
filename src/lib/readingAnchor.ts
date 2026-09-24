export type TextAnchor = { blockIndex: number; text: string; textOffset: number; context: string; viewportTop: number };

const blockSelector = "p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,.math-display,.image-frame";

export function captureTextAnchor(container: HTMLElement): TextAnchor | null {
  const article = container.querySelector<HTMLElement>(".markdown-body");
  if (!article) return null;
  const blocks = [...article.querySelectorAll<HTMLElement>(blockSelector)]
    .filter((block) => !block.hasAttribute("data-section-hidden"));
  const viewport = container.getBoundingClientRect();
  const targetY = viewport.top + Math.min(viewport.height * .28, 180);
  const blockIndex = blocks.findIndex((block) => block.getBoundingClientRect().bottom > targetY);
  if (blockIndex < 0) return null;
  const block = blocks[blockIndex];
  const x = Math.min(viewport.right - 20, Math.max(viewport.left + 20, article.getBoundingClientRect().left + 50));
  const caret = document.caretRangeFromPoint?.(x, Math.min(targetY, block.getBoundingClientRect().bottom - 2));
  let textOffset = 0;
  let viewportTop = block.getBoundingClientRect().top - viewport.top;
  if (caret && block.contains(caret.startContainer)) {
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(caret.startContainer, caret.startOffset);
    textOffset = before.toString().length;
    viewportTop = caret.getBoundingClientRect().top - viewport.top;
  }
  const text = block.textContent ?? "";
  return { blockIndex, text: text.slice(0, 120), textOffset,
    context: text.slice(Math.max(0, textOffset - 20), textOffset + 20), viewportTop };
}

export function restoreTextAnchor(container: HTMLElement, anchor: TextAnchor): boolean {
  const article = container.querySelector<HTMLElement>(".markdown-body");
  if (!article) return false;
  const blocks = [...article.querySelectorAll<HTMLElement>(blockSelector)]
    .filter((block) => !block.hasAttribute("data-section-hidden"));
  let target: HTMLElement | undefined = blocks[anchor.blockIndex];
  if (!target || target.textContent?.slice(0, 120) !== anchor.text) {
    target = blocks.find((block) => block.textContent?.slice(0, 120) === anchor.text) ?? target;
  }
  if (!target) return false;
  const text = target.textContent ?? "";
  const offset = anchor.context && text.includes(anchor.context)
    ? text.indexOf(anchor.context) + Math.min(20, anchor.textOffset)
    : Math.min(text.length, anchor.textOffset);
  let currentTop = target.getBoundingClientRect().top;
  if (offset > 0) {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        const rect = range.getBoundingClientRect();
        if (rect.height || rect.width) currentTop = rect.top;
        break;
      }
      remaining -= length;
    }
  }
  const delta = currentTop - container.getBoundingClientRect().top - anchor.viewportTop;
  if (Math.abs(delta) > .5) container.scrollTop += delta;
  return true;
}

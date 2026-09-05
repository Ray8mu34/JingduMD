const SKIP_SELECTOR = "script, style, noscript, .katex-mathml, [aria-hidden='true']";

export function findTextRanges(root: HTMLElement, rawQuery: string): Range[] {
  const query = rawQuery.trim();
  if (!query) return [];

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const needle = query.toLocaleLowerCase();

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = node.data;
    const haystack = text.toLocaleLowerCase();
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      ranges.push(range);
      from = index + Math.max(needle.length, 1);
    }
  }
  return ranges;
}

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
};

export function updateFindHighlights(ranges: Range[], activeIndex: number): boolean {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  const HighlightConstructor = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightConstructor) return false;

  registry.delete("jingreader-find");
  registry.delete("jingreader-find-active");
  if (ranges.length) registry.set("jingreader-find", new HighlightConstructor(...ranges));
  const active = ranges[activeIndex];
  if (active) registry.set("jingreader-find-active", new HighlightConstructor(active));
  return true;
}

export function clearFindHighlights(): void {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  registry?.delete("jingreader-find");
  registry?.delete("jingreader-find-active");
}

export function scrollToRange(range: Range | undefined): void {
  if (!range) return;
  const element = range.startContainer.parentElement;
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
}

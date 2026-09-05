import type { HighlightColor, NewTextHighlight, ResolvedHighlight, TextHighlight } from "../types";

const SKIP_SELECTOR = [
  "script", "style", "noscript", ".katex-mathml", "[aria-hidden='true']", "[data-highlight-ignore]",
  ".code-block-toolbar", ".image-actions", ".collapsed-media", ".section-fold-button"
].join(",");
const COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

type TextSegment = { node: Text; start: number; end: number };
export type ArticleTextMap = { text: string; segments: TextSegment[] };

function acceptedTextNodes(root: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return (node as Text).data.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

export function articleTextMap(root: HTMLElement): ArticleTextMap {
  let text = "";
  const segments = acceptedTextNodes(root).map((node) => {
    const start = text.length;
    text += node.data;
    return { node, start, end: text.length };
  });
  return { text, segments };
}

function boundaryOffset(map: ArticleTextMap, container: Node, offset: number): number | null {
  if (container.nodeType !== Node.TEXT_NODE) return null;
  const segment = map.segments.find((item) => item.node === container);
  if (!segment || offset < 0 || offset > segment.node.data.length) return null;
  return segment.start + offset;
}

function headingForNode(root: HTMLElement, node: Node): string | null {
  const parent = node.parentElement;
  const own = parent?.closest<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]");
  if (own?.id) return own.id;
  let heading: HTMLElement | null = null;
  for (const candidate of root.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")) {
    const relation = candidate.compareDocumentPosition(node);
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) heading = candidate;
    else if (!(relation & Node.DOCUMENT_POSITION_CONTAINED_BY)) break;
  }
  return heading?.id ?? null;
}

export function selectionToHighlight(
  root: HTMLElement,
  selection: Selection,
  path: string,
  color: HighlightColor
): NewTextHighlight | null {
  if (selection.rangeCount !== 1 || selection.isCollapsed || !COLORS.includes(color)) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const map = articleTextMap(root);
  const startOffset = boundaryOffset(map, range.startContainer, range.startOffset);
  const endOffset = boundaryOffset(map, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null || endOffset <= startOffset) return null;
  const quote = map.text.slice(startOffset, endOffset);
  if (!quote.trim() || [...quote].length > 5_000) return null;
  return {
    path,
    quote,
    prefix: map.text.slice(Math.max(0, startOffset - 96), startOffset),
    suffix: map.text.slice(endOffset, endOffset + 96),
    startOffset,
    endOffset,
    headingId: headingForNode(root, range.startContainer),
    color
  };
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function contextScore(root: HTMLElement, map: ArticleTextMap, index: number, highlight: TextHighlight): number {
  const text = map.text;
  const before = text.slice(Math.max(0, index - highlight.prefix.length), index);
  const after = text.slice(index + highlight.quote.length, index + highlight.quote.length + highlight.suffix.length);
  const prefixScore = commonPrefixLength([...before].reverse().join(""), [...highlight.prefix].reverse().join(""));
  const suffixScore = commonPrefixLength(after, highlight.suffix);
  const distance = Math.abs(index - highlight.startOffset) / Math.max(1, text.length);
  const segment = map.segments.find((item) => index >= item.start && index < item.end);
  const headingScore = highlight.headingId && segment && headingForNode(root, segment.node) === highlight.headingId ? 48 : 0;
  return prefixScore * 2 + suffixScore * 2 + headingScore - distance;
}

export function rangeForOffsets(map: ArticleTextMap, start: number, end: number): Range | null {
  if (start < 0 || end <= start || end > map.text.length) return null;
  const first = map.segments.find((segment) => start >= segment.start && start < segment.end);
  const last = [...map.segments].reverse().find((segment) => end > segment.start && end <= segment.end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function resolveWithMap(root: HTMLElement, map: ArticleTextMap, highlight: TextHighlight): ResolvedHighlight {
  const candidates: number[] = [];
  let from = 0;
  while (from <= map.text.length - highlight.quote.length) {
    const index = map.text.indexOf(highlight.quote, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, highlight.quote.length);
  }
  const start = candidates.sort((left, right) => contextScore(root, map, right, highlight) - contextScore(root, map, left, highlight))[0];
  const range = start === undefined ? null : rangeForOffsets(map, start, start + highlight.quote.length);
  return { ...highlight, range, orphaned: !range };
}

export function resolveHighlight(root: HTMLElement, highlight: TextHighlight): ResolvedHighlight {
  return resolveWithMap(root, articleTextMap(root), highlight);
}

export function resolveHighlights(root: HTMLElement, highlights: TextHighlight[]): ResolvedHighlight[] {
  const map = articleTextMap(root);
  return highlights.map((highlight) => resolveWithMap(root, map, highlight));
}

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): boolean };

export function paintHighlights(items: ResolvedHighlight[]): boolean {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  const HighlightConstructor = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightConstructor) return false;
  for (const color of COLORS) {
    const name = `jingreader-highlight-${color}`;
    registry.delete(name);
    const ranges = items.filter((item) => item.color === color && item.range).map((item) => item.range!);
    if (ranges.length) registry.set(name, new HighlightConstructor(...ranges));
  }
  return true;
}

export function clearTextHighlights(): void {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  for (const color of COLORS) registry?.delete(`jingreader-highlight-${color}`);
}

export function scrollToHighlight(item: ResolvedHighlight | undefined): boolean {
  const element = item?.range?.startContainer.parentElement;
  if (!element) return false;
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

export const HIGHLIGHT_COLORS = COLORS;

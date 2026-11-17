import type { HighlightColor, NewTextHighlight, ResolvedHighlight, TextHighlight } from "../types";
import { selectedTextOffsets, sourceSelections } from "./fileHighlights";

const SKIP_SELECTOR = [
  "script", "style", "noscript", ".katex-mathml", "[aria-hidden='true']", "[data-highlight-ignore]",
  ".code-block-toolbar", ".image-actions", ".collapsed-media", ".section-fold-button"
].join(",");
const COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

type TextSegment = { node: Text; start: number; end: number };
export type ArticleTextMap = { text: string; segments: TextSegment[] };

function acceptedTextNodes(root: HTMLElement): Text[] {
  if (root.closest(SKIP_SELECTOR)) return [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Reject an entire visual/hidden subtree instead of visiting every glyph.
      if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).matches(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
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
  const selected = map.segments.flatMap((segment) => {
    const clipped = selectedTextOffsets(range, segment.node);
    return clipped ? [{ start: segment.start + clipped.start, end: segment.start + clipped.end }] : [];
  });
  const startOffset = selected[0]?.start;
  const endOffset = selected.at(-1)?.end;
  if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) return null;
  const quote = map.text.slice(startOffset, endOffset);
  if (!quote.trim() || [...quote].length > 5_000) return null;
  const sourceRanges = sourceSelections(root, selection);
  return {
    path,
    quote,
    prefix: map.text.slice(Math.max(0, startOffset - 96), startOffset),
    suffix: map.text.slice(endOffset, endOffset + 96),
    startOffset,
    endOffset,
    headingId: headingForNode(root, range.startContainer),
    color,
    sourceRange: sourceRanges.length ? { start: sourceRanges[0].start, end: sourceRanges.at(-1)!.end } : undefined,
    sourceRanges
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
  const segment = segmentAt(map, index);
  const headingScore = highlight.headingId && segment && headingForNode(root, segment.node) === highlight.headingId ? 48 : 0;
  return prefixScore * 2 + suffixScore * 2 + headingScore - distance;
}

export function rangeForOffsets(map: ArticleTextMap, start: number, end: number): Range | null {
  if (start < 0 || end <= start || end > map.text.length) return null;
  const first = segmentAt(map, start);
  const last = segmentAt(map, end - 1);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function segmentAt(map: ArticleTextMap, offset: number): TextSegment | undefined {
  let left = 0, right = map.segments.length - 1;
  while (left <= right) {
    const middle = (left + right) >>> 1;
    const segment = map.segments[middle];
    if (offset < segment.start) right = middle - 1;
    else if (offset >= segment.end) left = middle + 1;
    else return segment;
  }
  return undefined;
}

const FILE_MARK_SELECTOR = '[data-file-highlight]:not([data-file-highlight=""])';
function fileSpanIndex(root: HTMLElement): Map<string, HTMLElement[]> {
  const index = new Map<string, HTMLElement[]>();
  for (const span of root.querySelectorAll<HTMLElement>(FILE_MARK_SELECTOR)) {
    for (const id of new Set(span.dataset.fileHighlight!.split(/\s+/).filter(Boolean))) {
      const spans = index.get(id);
      if (spans) spans.push(span); else index.set(id, [span]);
    }
  }
  return index;
}

function resolveWithMap(root: HTMLElement, map: ArticleTextMap | undefined, highlight: TextHighlight, spansById?: Map<string, HTMLElement[]>): ResolvedHighlight {
  if (highlight.id < 0) {
    const spans = (spansById ?? fileSpanIndex(root)).get(String(highlight.id)) ?? [];
    const first = spans[0]?.firstChild, last = spans.at(-1)?.lastChild;
    const range = first && last ? document.createRange() : null;
    if (range) { range.setStart(first!, 0); range.setEnd(last!, last!.textContent?.length ?? 0); }
    return { ...highlight, range, orphaned: !range };
  }
  map ??= articleTextMap(root);
  const candidates: number[] = [];
  let from = 0;
  while (from <= map.text.length - highlight.quote.length) {
    const index = map.text.indexOf(highlight.quote, from);
    if (index < 0) break;
    candidates.push(index);
    from = index + Math.max(1, highlight.quote.length);
  }
  const scored = candidates.map(start => ({ start, score: contextScore(root, map!, start, highlight) })).sort((left, right) => right.score - left.score);
  // Distance alone is not enough evidence when the same quote occurs twice.
  const ambiguous = scored.length > 1 && scored[0].score - scored[1].score < 1;
  const start = ambiguous ? undefined : scored[0]?.start;
  const range = start === undefined ? null : rangeForOffsets(map, start, start + highlight.quote.length);
  return { ...highlight, range, orphaned: !range };
}

export function resolveHighlight(root: HTMLElement, highlight: TextHighlight): ResolvedHighlight {
  return resolveWithMap(root, undefined, highlight);
}

export function resolveHighlights(root: HTMLElement, highlights: TextHighlight[]): ResolvedHighlight[] {
  if (!highlights.length) return [];
  const map = highlights.some(highlight => highlight.id >= 0) ? articleTextMap(root) : undefined;
  const spans = highlights.some(highlight => highlight.id < 0) ? fileSpanIndex(root) : undefined;
  return highlights.map((highlight) => resolveWithMap(root, map, highlight, spans));
}

/** Widget rendering cannot change file-mark spans. Legacy quotes additionally
 * depend on eligible prose text, but never on hidden formula glyphs/toolbars. */
export function highlightMutationsMatter(records: MutationRecord[], legacy: boolean): boolean {
  const hasMark = (node: Node) => node.nodeType === Node.ELEMENT_NODE &&
    ((node as Element).matches(FILE_MARK_SELECTOR) || !!(node as Element).querySelector(FILE_MARK_SELECTOR));
  const hasText = (node: Node): boolean => node.nodeType === Node.TEXT_NODE ? !!node.textContent?.length :
    node.nodeType === Node.ELEMENT_NODE && acceptedTextNodes(node as HTMLElement).length > 0;
  return records.some(record => {
    const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target as Element : record.target.parentElement;
    if (!target || target.closest(SKIP_SELECTOR)) return false;
    if (target.closest(FILE_MARK_SELECTOR)) return true;
    if (record.type === "characterData") return legacy || !!target.closest(FILE_MARK_SELECTOR);
    const changed = [...record.addedNodes, ...record.removedNodes];
    return changed.some(hasMark) || legacy && changed.some(hasText);
  });
}

type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): boolean };

export function paintHighlights(items: ResolvedHighlight[]): boolean {
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  const HighlightConstructor = (globalThis as typeof globalThis & { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightConstructor) return false;
  for (const color of COLORS) {
    const name = `jingreader-highlight-${color}`;
    registry.delete(name);
    const ranges = items.filter((item) => item.id > 0 && item.color === color && item.range).map((item) => item.range!);
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
  window.dispatchEvent(new CustomEvent("jingreader:reveal-heading", { detail: element }));
  requestAnimationFrame(() => requestAnimationFrame(() => element.scrollIntoView({ behavior: "smooth", block: "center" })));
  return true;
}

export const HIGHLIGHT_COLORS = COLORS;
export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = { yellow: "黄色", green: "绿色", blue: "蓝色", pink: "粉色" };

export function highlightAtPoint(items: ResolvedHighlight[], x: number, y: number): ResolvedHighlight | undefined {
  return items.filter((item) => item.range && [...item.range.getClientRects()].some((rect) =>
    rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  )).sort((a, b) => a.quote.length - b.quote.length || b.updatedMs - a.updatedMs)[0];
}

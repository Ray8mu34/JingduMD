import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import { visit } from "unist-util-visit";
import type { Root, Text, Nodes } from "mdast";
import type { HighlightColor, TextHighlight } from "../types";
import { normalizeTexDelimiters, splitFrontmatter } from "./markdown";

export type FileHighlight = { id: number; start: number; end: number; color: HighlightColor };
const EMOJI: Record<HighlightColor, string> = { yellow: "🟡", green: "🟢", blue: "🔵", pink: "🟣" };
const COLORS: Record<string, HighlightColor> = { "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "pink", "🔴": "pink", "🟠": "yellow" };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkFrontmatter);

// The renderer normalizes only TeX delimiters. Map its offsets back to the
// unchanged source; never write normalized formulas back into the document.
function normalized(source: string) {
  const text = normalizeTexDelimiters(source);
  const offsets: number[] = [];
  let raw = 0;
  for (let i = 0; i < text.length;) {
    if (source[raw] !== text[i] && source[raw] === "\\" && "()[]".includes(source[raw + 1] ?? "") && text[i] === "$") {
      const count = "[]".includes(source[raw + 1]) ? 2 : 1;
      for (let j = 0; j < count; j++) offsets[i++] = raw;
      raw += 2;
    } else { offsets[i++] = raw++; }
  }
  offsets[text.length] = source.length;
  return { text, offsets };
}

function textLeaves(source: string, includeUnsupported = false) {
  const n = normalized(source);
  const leaves: { start: number; end: number; value: string; exact: boolean }[] = [];
  visit(parser.parse(n.text), (node) => {
    if (!(node.type === "text" || includeUnsupported && ["inlineCode", "code", "inlineMath", "math", "html", "yaml"].includes(node.type)) || !("value" in node)) return;
    const start = n.offsets[node.position!.start.offset!];
    const end = n.offsets[node.position!.end.offset!];
    leaves.push({ start, end, value: String(node.value), exact: node.type === "text" && source.slice(start, end) === node.value });
  });
  return leaves;
}

export function parseFileHighlights(source: string): { clean: string; ranges: FileHighlight[] } {
  const tokens: { start: number; end: number; color?: HighlightColor }[] = [];
  for (const leaf of textLeaves(source)) {
    if (!leaf.exact) continue;
    for (const match of source.slice(leaf.start, leaf.end).matchAll(/==([🔴🟠🟡🟢🔵🟣])?/gu)) {
      const start = leaf.start + match.index!;
      tokens.push({ start, end: start + match[0].length, color: match[1] ? COLORS[match[1]] : undefined });
    }
  }
  const stack: typeof tokens = [];
  const pairs: { open: typeof tokens[number]; close: typeof tokens[number] }[] = [];
  for (const token of tokens) {
    if (token.color || !stack.length) stack.push(token);
    else pairs.push({ open: stack.pop()!, close: token });
  }
  // Unmatched tokens stay literal. Only remove successfully paired delimiters.
  const removed = pairs.flatMap((p) => [p.open, p.close]).sort((a, b) => a.start - b.start);
  const cleanOffset = (offset: number) => offset - removed.reduce((sum, t) => sum + (t.end <= offset ? t.end - t.start : 0), 0);
  let clean = "", cursor = 0;
  for (const token of removed) { clean += source.slice(cursor, token.start); cursor = token.end; }
  clean += source.slice(cursor);
  const ranges = pairs.sort((a, b) => a.open.start - b.open.start).map((p, i) => ({
    id: -(i + 1), start: cleanOffset(p.open.end), end: cleanOffset(p.close.start), color: p.open.color ?? "yellow"
  })).filter((r) => r.end > r.start);
  return { clean, ranges };
}

type SourceRegion = { start: number; end: number; first: number; last: number; type: string };
function sourceStructure(source: string) {
  const n = normalized(source);
  const blocks: SourceRegion[] = [], inline: SourceRegion[] = [], protectedRegions: SourceRegion[] = [];
  const bounds = (node: Nodes): [number, number] => [n.offsets[node.position!.start.offset!], n.offsets[node.position!.end.offset!]];
  visit(parser.parse(n.text), (node) => {
    if (!node.position) return;
    const [start, end] = bounds(node);
    const region = { start, end, first: start, last: end, type: node.type };
    if (["paragraph", "heading", "tableCell"].includes(node.type) && "children" in node && node.children.length) {
      const first = node.children[0], last = node.children.at(-1)!;
      if (first.position && last.position) blocks.push({ ...region, start: bounds(first)[0], end: bounds(last)[1] });
    }
    if (["code", "inlineCode", "math", "inlineMath", "html", "yaml"].includes(node.type)) protectedRegions.push(region);
    if (["strong", "emphasis", "delete", "link", "linkReference"].includes(node.type)) {
      const leaves: SourceRegion[] = [];
      visit(node, "text", (text: Text) => { const [a, b] = bounds(text); leaves.push({ start: a, end: b, first: a, last: b, type: "text" }); });
      if (leaves.length) inline.push({ ...region, first: leaves[0].start, last: leaves.at(-1)!.end });
    }
  });
  return { blocks, inline, protectedRegions };
}

export function coalesceFileHighlights(clean: string, ranges: FileHighlight[]): FileHighlight[] {
  const structure = sourceStructure(clean);
  const leaves = textLeaves(clean);
  const result = ranges.map((r) => ({ ...r })).sort((a, b) => a.start - b.start || b.end - a.end);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i], b = result[i + 1];
      if (a.color !== b.color || a.end > b.start) continue;
      if (!structure.blocks.some((block) => block.start <= a.start && block.end >= b.end)) continue;
      if (result.some((r) => r !== a && r !== b && r.start < b.end && r.end > a.start)) continue;
      if (a.end < b.start && leaves.some((leaf) => leaf.start < b.start && leaf.end > a.end)) continue;
      if (structure.protectedRegions.some((r) => r.start < b.start && r.end > a.end)) continue;
      // Only bridge actual inline delimiters, never unhighlighted prose,
      // whitespace, formulas, or paragraph/cell boundaries.
      const syntax = structure.inline.flatMap((r) => [[r.start, r.first], [r.last, r.end]]);
      let cursor = a.end;
      while (cursor < b.start) {
        const covering = syntax.filter(([start, end]) => start <= cursor && end > cursor);
        if (!covering.length) break;
        cursor = Math.max(...covering.map(([, end]) => end));
      }
      if (cursor < b.start) continue;
      a.end = b.end;
      result.splice(i + 1, 1);
      changed = true;
      break;
    }
  }
  return result;
}

function safeFileRanges(clean: string, ranges: FileHighlight[]): FileHighlight[] {
  const { blocks, inline, protectedRegions } = sourceStructure(clean);
  return ranges.flatMap((range) => blocks.flatMap((block) => {
    let parts = [{ ...range, start: Math.max(range.start, block.start), end: Math.min(range.end, block.end) }].filter((p) => p.start < p.end);
    for (const barrier of protectedRegions) {
      parts = parts.flatMap((part) => barrier.start < part.end && barrier.end > part.start
        ? [{ ...part, end: Math.min(part.end, barrier.start) }, { ...part, start: Math.max(part.start, barrier.end) }].filter((p) => p.start < p.end) : [part]);
    }
    // Fully selected inline elements live inside one highlight. Partial
    // selections crossing their wrapper boundary are the exceptional split.
    for (const node of inline.sort((a, b) => b.end - b.start - (a.end - a.start))) {
      parts = parts.flatMap((part) => {
        if (part.start >= node.end || part.end <= node.start) return [part];
        if (part.start <= node.first && part.end >= node.last) return [{ ...part, start: Math.min(part.start, node.start), end: Math.max(part.end, node.end) }];
        if (part.start < node.start && part.end > node.first && part.end < node.last) return [{ ...part, end: node.start }, { ...part, start: node.first }];
        if (part.start > node.first && part.start < node.last && part.end > node.end) return [{ ...part, end: node.last }, { ...part, start: node.end }];
        return [part];
      }).filter((p) => p.start < p.end);
    }
    return parts;
  }));
}

export function matchingFileHighlight(clean: string, ranges: FileHighlight[], selection: { start: number; end: number }) {
  const leaves = textLeaves(clean);
  return ranges.find((r) => {
    const included = leaves.filter((l) => l.start < r.end && l.end > r.start);
    return included.length && Math.max(r.start, included[0].start) === selection.start && Math.min(r.end, included.at(-1)!.end) === selection.end;
  });
}

// Write paragraph-level ranges rather than text-leaf ranges. Nested highlights
// stay intact; crossing ranges close and reopen only where necessary.
export function serializeFileHighlights(clean: string, ranges: FileHighlight[]): string {
  const safe = safeFileRanges(clean, coalesceFileHighlights(clean, ranges));
  const points = [...new Set([0, clean.length, ...safe.flatMap((r) => [r.start, r.end])])].sort((a, b) => a - b);
  let output = "";
  let active: FileHighlight[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const next = safe.filter((r) => r.start <= a && r.end >= b).sort((x, y) => x.start - y.start || y.end - x.end || y.id - x.id);
    let shared = 0;
    while (shared < active.length && shared < next.length && active[shared] === next[shared]) shared++;
    output += "==".repeat(active.length - shared);
    output += next.slice(shared).map((r) => `==${EMOJI[r.color]}`).join("");
    output += clean.slice(a, b);
    active = next;
  }
  const serialized = output + "==".repeat(active.length);
  if (parseFileHighlights(serialized).clean !== clean) throw new Error("选区附近存在无法安全配对的高亮标记，未修改原文。");
  return serialized;
}

export function prepareFileHighlights(source: string) {
  const parsed = parseFileHighlights(source);
  const n = normalized(parsed.clean);
  const split = splitFrontmatter(n.text);
  const bodyOffset = n.text.length - split.body.length;
  function plugin() {
    return (tree: Root) => {
      visit(tree, "text", (node: Text, index, parent) => {
        if (index == null || !parent || !node.position) return;
        const start = n.offsets[bodyOffset + node.position.start.offset!];
        const end = n.offsets[bodyOffset + node.position.end.offset!];
        if (parsed.clean.slice(start, end) !== node.value) return;
        const relevant = parsed.ranges.filter((r) => r.start < end && r.end > start);
        const points = [...new Set([start, end, ...relevant.flatMap((r) => [Math.max(start, r.start), Math.min(end, r.end)])])].sort((a, b) => a - b);
        const children = points.slice(0, -1).map((a, i): Text => {
          const b = points[i + 1];
          const active = relevant.filter((r) => r.start <= a && r.end >= b).sort((x, y) => x.start - y.start || y.end - x.end || y.id - x.id);
          return { type: "text", value: parsed.clean.slice(a, b), data: {
            hName: "span", hProperties: { "data-source-start": a, "data-source-end": b,
              "data-file-highlight": active.map((r) => r.id).join(" "),
              ...(active.length ? { className: [`file-highlight-${active.at(-1)!.color}`] } : {}) }
          } };
        });
        parent.children.splice(index, 1, ...children);
        return index + children.length;
      });
    };
  }
  return { ...parsed, ...split, plugin };
}

export function sourceSelection(root: HTMLElement, selection: Selection): { start: number; end: number } | null {
  if (selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const boundary = (node: Node, offset: number) => {
    const span = node.parentElement?.closest<HTMLElement>("[data-source-start]");
    if (!span || node.nodeType !== Node.TEXT_NODE || span.firstChild !== node || span.childNodes.length !== 1) return null;
    return Number(span.dataset.sourceStart) + offset;
  };
  const start = boundary(range.startContainer, range.startOffset), end = boundary(range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;
  // Unsupported generated text (formulas, code, HTML, wikilinks) must not be
  // silently included in a source rewrite.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (range.intersectsNode(node) && node.textContent?.trim() && !node.parentElement?.closest("[data-source-start]")) return null;
  }
  return { start, end };
}

export function fileHighlightRecords(source: string, path: string, root: string): TextHighlight[] {
  const { clean, ranges } = parseFileHighlights(source);
  const leaves = textLeaves(clean);
  return ranges.map((r) => ({ id: r.id, path, root, color: r.color,
    quote: leaves.map((l) => clean.slice(Math.max(r.start, l.start), Math.min(r.end, l.end))).filter((_, i) => leaves[i].start < r.end && leaves[i].end > r.start).join(""),
    prefix: "", suffix: "", startOffset: r.start, endOffset: r.end, headingId: null, createdMs: 0, updatedMs: 0 }));
}

export function migrateLegacyHighlights(source: string, records: TextHighlight[]) {
  const { clean, ranges } = parseFileHighlights(source);
  const leaves = textLeaves(clean, true);
  let text = "";
  const offsets: number[] = [];
  for (const leaf of leaves) {
    for (let i = 0; i < leaf.value.length; i++) offsets.push(leaf.exact ? leaf.start + i : -1);
    text += leaf.value;
  }
  const migratedIds: number[] = [], skippedIds: number[] = [];
  for (const record of records) {
    const candidates: number[] = [];
    for (let i = text.indexOf(record.quote); i >= 0; i = text.indexOf(record.quote, i + 1)) candidates.push(i);
    const exact = candidates.filter((i) => (!record.prefix || text.slice(Math.max(0, i - record.prefix.length), i) === record.prefix)
      && (!record.suffix || text.slice(i + record.quote.length, i + record.quote.length + record.suffix.length) === record.suffix));
    const candidatesToUse = exact.length === 1 ? exact : candidates.length === 1 ? candidates : [];
    const at = candidatesToUse[0];
    if (at === undefined || offsets.slice(at, at + record.quote.length).some((offset) => offset < 0)) { skippedIds.push(record.id); continue; }
    const start = offsets[at], end = offsets[at + record.quote.length - 1] + 1;
    const covered = leaves.filter((l) => l.exact && l.start < end && l.end > start).every((l) => {
      const a = Math.max(start, l.start), b = Math.min(end, l.end);
      return ranges.some((r) => r.start <= a && r.end >= b && r.color === record.color);
    });
    if (!covered) ranges.push({ id: record.id, start, end, color: record.color });
    migratedIds.push(record.id);
  }
  return { content: serializeFileHighlights(clean, ranges), migratedIds, skippedIds };
}

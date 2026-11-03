import { fileHighlightRecords, matchingFileHighlight, parseFileHighlights, prepareFileHighlights, serializeFileHighlights, type FileHighlight } from "./fileHighlights";
import { isNotebook, normalizeNotebookSource, notebookString, type NotebookCell } from "./notebook";

/** Session-local offsets/IDs only. Persistent marks live in each cell's source. */
export function notebookHighlightCells(cells: NotebookCell[]) {
  let offset = 0, idOffset = 0;
  return cells.map((cell, index) => {
    if (cell.type !== "markdown") return null;
    const parsed = parseFileHighlights(cell.source, normalizeNotebookSource);
    const entry = { ...parsed, index, source: cell.source, offset, idOffset };
    offset += parsed.clean.length + 2;
    idOffset += parsed.ranges.reduce((max, range) => Math.max(max, -range.id), 0);
    return entry;
  });
}

// Locate JSON value spans without reserializing metadata, large numbers, outputs,
// attachment encodings or whitespace. JSON.parse validates before this scanner.
function sourceSpans(content: string): Map<number, { start: number; end: number }> {
  let cursor = 0;
  const result = new Map<number, { start: number; end: number }>();
  const whitespace = () => { while (/\s/.test(content[cursor] ?? "") && cursor < content.length) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < content.length) {
      if (content[cursor++] === '"') break;
      if (content[cursor - 1] === "\\") cursor++;
    }
    return JSON.parse(content.slice(start, cursor)) as string;
  };
  const value = (path: (string | number)[]) => {
    whitespace();
    const start = cursor;
    if (content[cursor] === '"') string();
    else if (content[cursor] === "{") {
      cursor++; whitespace();
      while (content[cursor] !== "}") {
        const key = string(); whitespace(); cursor++;
        value([...path, key]); whitespace();
        if (content[cursor] !== ",") break;
        cursor++; whitespace();
      }
      cursor++;
    } else if (content[cursor] === "[") {
      cursor++; whitespace(); let index = 0;
      while (content[cursor] !== "]") {
        value([...path, index++]); whitespace();
        if (content[cursor] !== ",") break;
        cursor++; whitespace();
      }
      cursor++;
    } else { while (cursor < content.length && !/[\s,}\]]/.test(content[cursor])) cursor++; }
    if (path.length === 3 && path[0] === "cells" && typeof path[1] === "number" && path[2] === "source") result.set(path[1], { start, end: cursor });
  };
  value([]);
  return result;
}

export function notebookHighlights(content: string, path = "", root = "") {
  const raw = JSON.parse(content);
  if (raw.nbformat !== 4 || !Array.isArray(raw.cells)) throw new Error("Notebook 格式无效。");
  const cells = notebookHighlightCells(raw.cells.map((cell: { cell_type?: string; source?: unknown }) => ({ type: cell.cell_type ?? "", source: notebookString(cell.source), attachments: {}, outputs: [] })));
  const entries = cells.filter(cell => cell !== null);
  const ranges = entries.flatMap(cell => cell.ranges.map(r => ({ ...r, id: r.id - cell.idOffset, start: r.start + cell.offset, end: r.end + cell.offset })));
  return {
    cells, ranges,
    records: entries.flatMap(cell => fileHighlightRecords(cell.source, path, root, normalizeNotebookSource).map(r => ({ ...r, id: r.id - cell.idOffset, startOffset: r.startOffset + cell.offset, endOffset: r.endOffset + cell.offset }))),
    matching(selection: { start: number; end: number }) {
      const cell = entries.find(c => selection.start >= c.offset && selection.end <= c.offset + c.clean.length);
      if (!cell) return undefined;
      const local = matchingFileHighlight(cell.clean, cell.ranges, { start: selection.start - cell.offset, end: selection.end - cell.offset }, normalizeNotebookSource);
      return local ? ranges.find(r => r.id === local.id - cell.idOffset) : undefined;
    },
    serialize(next: FileHighlight[]) {
      const spans = sourceSpans(content);
      const edits = entries.flatMap(cell => {
        const local = next.filter(r => r.start >= cell.offset && r.end <= cell.offset + cell.clean.length).map(r => ({ ...r, start: r.start - cell.offset, end: r.end - cell.offset }));
        const original = cell.ranges.map(r => ({ ...r, id: r.id - cell.idOffset, start: r.start + cell.offset, end: r.end + cell.offset }));
        if (JSON.stringify(next.filter(r => r.start >= cell.offset && r.end <= cell.offset + cell.clean.length)) === JSON.stringify(original)) return [];
        const updated = serializeFileHighlights(cell.clean, local, normalizeNotebookSource);
        const span = spans.get(cell.index);
        if (!span) throw new Error("无法定位 Markdown 单元格的 source，未修改文件。");
        const value = Array.isArray(raw.cells[cell.index].source) ? updated.split(/(?<=\n)/) : updated;
        return [{ ...span, value: JSON.stringify(value) }];
      });
      let result = content;
      for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
      return result;
    }
  };
}

export function prepareNotebookCell(cell: NonNullable<ReturnType<typeof notebookHighlightCells>[number]>) {
  return prepareFileHighlights(cell.source, normalizeNotebookSource, cell.offset, cell.idOffset);
}

export function documentHighlights(content: string, path: string, root = "") {
  if (isNotebook(path)) return notebookHighlights(content, path, root);
  const { clean, ranges } = parseFileHighlights(content);
  return { ranges, records: fileHighlightRecords(content, path, root),
    matching: (selection: { start: number; end: number }) => matchingFileHighlight(clean, ranges, selection),
    serialize: (next: FileHighlight[]) => serializeFileHighlights(clean, next) };
}

export function documentHighlightRecords(content: string, path: string, root: string) {
  try { return documentHighlights(content, path, root).records; } catch { return []; }
}

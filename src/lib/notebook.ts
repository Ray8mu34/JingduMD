import DOMPurify from "dompurify";
import { extractOutline } from "./markdown";
import { normalized, parseFileHighlights } from "./fileHighlights";

export const isNotebook = (path: string) => /\.ipynb$/i.test(path);
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
export function notebookString(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value) && value.every(v => typeof v === "string") ? value.join("") : "";
}
export type NotebookOutput = { kind: "text" | "image" | "html" | "notice"; value: string };
export type NotebookCell = { type: string; source: string; attachments: RecordValue; outputs: NotebookOutput[] };
export type Notebook = { cells: NotebookCell[]; language: string };

/** Jupyter accepts $$ with TeX on the opening/closing line. remark-math
 * interprets opening-line TeX as fence metadata and requires a closing fence
 * on its own line. Adapt delimiters, never the formula, before parsing a cell.
 * Code and escaped dollars must remain literal. No source file is rewritten.
 */
export function normalizeNotebookMarkdown(source: string): string {
  return normalizeNotebookSource(source).text;
}

export function normalizeNotebookSource(source: string): { text: string; offsets: number[] } {
  const base = normalized(source);
  const text = base.text;
  const tokens = /(^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n|$))|(`+)|(?<!\\)(\$\$)(?!\$)/gm;
  let fence = "";
  let inline = "";
  const delimiters: number[] = [];
  for (const match of text.matchAll(tokens)) {
    if (match[1]) {
      const run = match[2];
      if (!fence && !inline) fence = run;
      else if (fence && run[0] === fence[0] && run.length >= fence.length && !match[1].trim().slice(run.length).trim()) fence = "";
      continue;
    }
    if (fence) continue;
    if (match[3]) {
      if (!inline) inline = match[3];
      else if (inline === match[3]) inline = "";
      continue;
    }
    if (!inline && match[4]) delimiters.push(match.index!);
  }
  let result = "", cursor = 0;
  const offsets: number[] = [];
  const copy = (start: number, end: number) => {
    result += text.slice(start, end);
    for (let i = start; i < end; i++) offsets.push(base.offsets[i]);
  };
  const insert = (value: string, at: number) => {
    result += value;
    for (let i = 0; i < value.length; i++) offsets.push(base.offsets[at]);
  };
  for (let i = 0; i < delimiters.length; i += 2) {
    const start = delimiters[i], end = delimiters[i + 1];
    copy(cursor, start);
    if (end === undefined) {
      // An unclosed display delimiter must not consume subsequent prose.
      insert("\\$\\$", start);
      cursor = start + 2;
    } else {
      insert("\n\n$$\n", start);
      copy(start + 2, end);
      insert("\n$$\n\n", end);
      cursor = end + 2;
    }
  }
  copy(cursor, text.length);
  offsets.push(source.length);
  return { text: result, offsets };
}

export function notebookImage(bundle: unknown): string {
  const data = record(bundle);
  for (const mime of ["image/png", "image/jpeg"]) {
    const value = notebookString(data[mime]).replace(/\s/g, "");
    if (!value || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) continue;
    try {
      const bytes = atob(value);
      if (mime === "image/png" ? bytes.startsWith("\x89PNG\r\n\x1a\n") : bytes.startsWith("\xff\xd8\xff")) return `data:${mime};base64,${value}`;
    } catch { /* Try the next supported representation. */ }
  }
  return "";
}

export function sanitizeNotebookTable(value: string): string {
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "b", "strong", "i", "em", "br", "code", "span"],
    ALLOWED_ATTR: ["colspan", "rowspan", "scope"], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  return [...template.content.querySelectorAll("table")].filter(table => !table.parentElement?.closest("table")).map(table => table.outerHTML).join("");
}

export function notebookOutput(value: unknown): NotebookOutput {
  const output = record(value);
  let text = "";
  if (output.output_type === "stream") text = notebookString(output.text);
  else if (output.output_type === "error") text = Array.isArray(output.traceback)
    ? output.traceback.filter(v => typeof v === "string").join("\n") : "";
  if (output.output_type === "error" && !text) text = [notebookString(output.ename), notebookString(output.evalue)].filter(Boolean).join(": ");
  if (text) return { kind: "text", value: text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") };
  const data = record(output.data);
  const image = notebookImage(data);
  if (image) return { kind: "image", value: image };
  const table = sanitizeNotebookTable(notebookString(data["text/html"]));
  if (table) return { kind: "html", value: table };
  text = notebookString(data["text/plain"]) || notebookString(output.text);
  if (text) return { kind: "text", value: text };
  const empty = Object.values(data).every(v => v === "" || Array.isArray(v) && v.length === 0) && (!Object.keys(output).length || ["stream", "error", "display_data", "execute_result"].includes(String(output.output_type)));
  return { kind: "notice", value: empty ? "未保存输出" : "此输出暂不支持" };
}

export function parseNotebook(content: string): Notebook {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Notebook JSON 已损坏，无法读取。"); }
  const notebook = record(value);
  if (notebook.nbformat !== 4) throw new Error("不支持此 Notebook 主版本；目前仅支持 nbformat 4。");
  if (!Array.isArray(notebook.cells)) throw new Error("Notebook 缺少有效的 cells 数组。");
  return {
    language: notebookString(record(record(notebook.metadata).language_info).name).replace(/[^\w+-]/g, ""),
    cells: notebook.cells.map(value => {
      const cell = record(value);
      return { type: notebookString(cell.cell_type), source: notebookString(cell.source), attachments: record(cell.attachments),
        outputs: Array.isArray(cell.outputs) ? cell.outputs.map(notebookOutput) : [] };
    })
  };
}

export function notebookOutline(notebook: Notebook) {
  return notebook.cells.flatMap((cell, index) => cell.type === "markdown" ? extractOutline(normalizeNotebookMarkdown(parseFileHighlights(cell.source, normalizeNotebookSource).clean), `nb-${index}-`) : []);
}
export function notebookBody(notebook: Notebook): string {
  return notebook.cells.filter(cell => cell.type === "markdown").map(cell => parseFileHighlights(cell.source, normalizeNotebookSource).clean).join("\n\n");
}

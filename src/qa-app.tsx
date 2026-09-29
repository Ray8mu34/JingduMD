import React from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PREFERENCES, type DocumentPayload, type ReaderPreferences, type TextHighlight } from "./types";
import { applyPreset } from "./lib/readerPreferences";
import "katex/dist/katex.min.css";
import "./styles.css";

const names = ["reader-showcase.md", "plain-article.md", "anonymous-timeline.md", "readme-sample.md", "delayed-long.md", "navigation-links.md", "typography-proof.md", "chinese-longform.md", "english-longform.md"];
const root = "C:\\qa-fixtures";
const paths = names.map((name) => `${root}\\${name}`);
const params = new URLSearchParams(location.search);
const stored = localStorage.getItem("jingreader-qa-preferences");
const initial = stored ? JSON.parse(stored) as ReaderPreferences : params.get("legacy") ? applyPreset(DEFAULT_PREFERENCES, params.get("legacy") as ReaderPreferences["theme"]) : { ...DEFAULT_PREFERENCES, typographyOverrides: { reading: params.get("selectedFont") ? { chineseFont: params.get("selectedFont")! } : {}, study: {} } };
const documents = new Map<string, DocumentPayload>();
for (const [index, name] of names.entries()) {
  const content = await fetch(`/fixtures/${name}`).then((response) => response.text());
  documents.set(paths[index], { path: paths[index], name, content, modifiedMs: 0, size: content.length });
}

const requested = params.get("sample");
const listeners = new Map<string, Set<number>>();
const positions = new Map<string, { path: string; headingId: string | null; headingRatio: number; documentRatio: number }>();
const positionWrites: string[] = [];
const positionReadFailures = new Set<string>();
const positionReadDelays = new Map<string, number>();
const documentReadDelays = new Map<string, number>();
const highlights: (TextHighlight & { deleted?: boolean })[] = [];
const tabPositions = new Map<string, Map<string, unknown>>();
const windowRequests: (string | null)[] = [];
const qaFonts = [{ family: "Arial", displayName: "Arial（本地化）", aliases: ["ArialMT"], faces: { regular: "Arial", bold: "Arial Bold", italic: "Arial Italic", boldItalic: "Arial Bold Italic" }, supportsCjk: false, supportsLatin: true },
  { family: "Noto Serif SC", displayName: "思源宋体", aliases: ["NotoSerifSC-Regular"], supportsCjk: true, supportsLatin: true },
  ...Array.from({ length: 54 }, (_, index) => index === 0
    ? { family: "SimSun", displayName: "宋体", aliases: [], supportsCjk: true, supportsLatin: true }
    : index === 1
      ? { family: "Microsoft YaHei", displayName: "微软雅黑", aliases: [], supportsCjk: true, supportsLatin: true }
      : { family: `Sample Font ${String(index + 1).padStart(2, "0")}`, displayName: `样张字体 ${index + 1}`, aliases: [], supportsCjk: index % 2 === 0, supportsLatin: true })];
const state = { basePreferences: initial, saves: [] as ReaderPreferences[], calls: [] as string[], scopedCalls: [] as { command: string; tabId: unknown; path: unknown }[], windowRequests, fontCalls: 0, fonts: qaFonts, fontFailures: 0, positions, positionWrites, positionReadFailures, positionReadDelays, documentReadDelays, highlights, selected: paths[names.indexOf(requested ?? "")] ?? paths[0],
  emitPreferences(preferences: ReaderPreferences) {
    for (const handler of listeners.get("preferences-updated") ?? []) callbacks.get(handler)?.({ payload: { source: "other-window", preferences } });
  },
  emitMenu(action: string) {
    for (const handler of listeners.get("reader-menu-action") ?? []) callbacks.get(handler)?.({ payload: action });
  }
};
Object.assign(window, { __JINGREADER_QA__: state, isTauri: true });
const callbacks = new Map<number, (...args: unknown[]) => void>();
function highlightsChanged() {
  for (const handler of listeners.get("highlights-updated") ?? []) callbacks.get(handler)?.({ payload: { source: "annotation-library", path: "*" } });
}
Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener(event: string, id: number) { listeners.get(event)?.delete(id); callbacks.delete(id); } } });
let nextCallback = 1;
const internals = {
  metadata: { currentWindow: { label: "main" } },
  transformCallback(callback: (...args: unknown[]) => void) { const id = nextCallback++; callbacks.set(id, callback); return id; },
  unregisterCallback(id: number) { callbacks.delete(id); },
  convertFileSrc(path: string) { return path; },
  async invoke(command: string, args: Record<string, unknown> = {}) {
    state.calls.push(command);
    state.scopedCalls.push({ command, tabId: args.tabId, path: args.path });
    switch (command) {
      case "load_preferences": return initial;
      case "save_preferences": state.saves.push(structuredClone(args.preferences as ReaderPreferences)); localStorage.setItem("jingreader-qa-preferences", JSON.stringify(args.preferences)); return null;
      case "consume_window_target": return params.has("noTarget") ? null : { root, selectedFile: params.has("folderOnly") ? null : state.selected };
      case "consume_startup_target": return params.has("noTarget") || (args.tabId && args.tabId !== "primary") ? null : params.has("folderOnly") ? root : state.selected;
      case "list_recent_roots": return [];
      case "read_document": {
        const path = String(args.path);
        await new Promise((resolve) => setTimeout(resolve, documentReadDelays.get(path) ?? 0));
        return documents.get(path) ?? Promise.reject(new Error(`Unknown QA document: ${path}`));
      }
      case "open_target": return { root, selectedFile: args.path === root ? null : String(args.path) };
      case "list_directory": return names.map((name, index) => ({ path: paths[index], name, kind: "markdown" }));
      case "load_expanded_paths": case "list_text_highlights": return [];
      case "list_document_highlights": return highlights.filter((item) => !item.deleted && item.path === args.path).map((item) => ({ ...item }));
      case "list_recent_highlights": return highlights.filter((item) => !item.deleted).map((item) => ({ ...item }));
      case "create_text_highlight": {
        const item = { ...(args.highlight as TextHighlight), id: highlights.length + 1, root, createdMs: Date.now(), updatedMs: Date.now() };
        highlights.push(item); return { ...item };
      }
      case "update_text_highlight_color": { const item = highlights.find((h) => h.id === args.id)!; item.color = args.color as TextHighlight["color"]; return null; }
      case "delete_text_highlight": highlights.find((h) => h.id === args.id)!.deleted = true; return null;
      case "restore_highlight": highlights.find((h) => h.id === args.id)!.deleted = false; highlightsChanged(); return null;
      case "recover_highlights": return { recovered: 0, pending: 0, skippedFiles: 0 };
      case "annotation_library": return [...new Set(highlights.map((h) => h.path))].map((path) => ({ id: path, path, missing: false, hasFingerprint: true, active: highlights.filter((h) => h.path === path && !h.deleted).length, deleted: highlights.filter((h) => h.path === path && h.deleted).length, preview: highlights.find((h) => h.path === path)?.quote }));
      case "managed_highlights": return highlights.filter((h) => h.path === args.documentId && !!h.deleted === args.deleted).map((h) => ({ ...h }));
      case "manage_annotation_document": {
        for (const h of highlights.filter((h) => h.path === args.documentId)) h.deleted = args.action === "trash";
        highlightsChanged();
        return null;
      }
      case "import_annotations": case "export_annotations": return null;
      case "get_reading_position": {
        const path = String(args.path);
        await new Promise((resolve) => setTimeout(resolve, positionReadDelays.get(path) ?? 0));
        if (positionReadFailures.has(path)) throw new Error("QA position read failed");
        return tabPositions.get(String(args.tabId))?.get(path) ?? positions.get(path) ?? null;
      }
      case "save_reading_position": {
        const position = args.position as { path: string; headingId: string | null; headingRatio: number; documentRatio: number };
        positions.set(position.path, structuredClone(position));
        const saved = tabPositions.get(String(args.tabId)) ?? new Map();
        saved.set(position.path, structuredClone(position));
        tabPositions.set(String(args.tabId), saved);
        positionWrites.push(position.path);
        return null;
      }
      case "get_index_diagnostics": return { documentCount: 3, indexedCount: 3, databaseBytes: 0 };
      case "list_system_fonts": state.fontCalls++; if (state.fontFailures > 0) { state.fontFailures--; throw new Error("QA font enumeration failed"); } return structuredClone(state.fonts);
      case "plugin:window|is_maximized": return false;
      case "plugin:event|listen": {
        const name = String(args.event); const handlers = listeners.get(name) ?? new Set<number>();
        handlers.add(Number(args.handler)); listeners.set(name, handlers); return Number(args.handler);
      }
      case "plugin:event|unlisten": return null;
      case "plugin:dialog|open": return params.get("dialogFile") ?? paths[0];
      case "open_in_new_window": windowRequests.push(args.path as string | null); return null;
      case "start_watch": case "index_root": case "set_path_expanded": case "close_tab": return null;
      case "read_asset": if (params.has("imageResize")) return { mime: "image/svg+xml", data: Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#608b9f"/></svg>')) }; throw new Error("Asset unavailable in this fixture");
      default: throw new Error(`Unexpected QA invoke: ${command}`);
    }
  }
};
Object.assign(window, { __TAURI_INTERNALS__: internals });
const { default: App } = params.has("tabs") ? await import("./ReaderWorkspace") : await import("./App");
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

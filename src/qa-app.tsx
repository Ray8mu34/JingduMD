import React from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_PREFERENCES, type DocumentPayload, type ReaderPreferences } from "./types";
import { applyPreset } from "./lib/readerPreferences";
import "katex/dist/katex.min.css";
import "./styles.css";

const names = ["reader-showcase.md", "plain-article.md", "anonymous-timeline.md"];
const root = "C:\\qa-fixtures";
const paths = names.map((name) => `${root}\\${name}`);
const params = new URLSearchParams(location.search);
const initial = params.get("legacy") ? applyPreset(DEFAULT_PREFERENCES, params.get("legacy") as ReaderPreferences["theme"]) : DEFAULT_PREFERENCES;
const documents = new Map<string, DocumentPayload>();
for (const [index, name] of names.entries()) {
  const content = await fetch(`/fixtures/${name}`).then((response) => response.text());
  documents.set(paths[index], { path: paths[index], name, content, modifiedMs: 0, size: content.length });
}

const state = { saves: [] as ReaderPreferences[], calls: [] as string[], fontCalls: 0, selected: paths[0] };
Object.assign(window, { __JINGREADER_QA__: state, isTauri: true });
const callbacks = new Map<number, (...args: unknown[]) => void>();
let nextCallback = 1;
const internals = {
  metadata: { currentWindow: { label: "main" } },
  transformCallback(callback: (...args: unknown[]) => void) { const id = nextCallback++; callbacks.set(id, callback); return id; },
  unregisterCallback(id: number) { callbacks.delete(id); },
  convertFileSrc(path: string) { return path; },
  async invoke(command: string, args: Record<string, unknown> = {}) {
    state.calls.push(command);
    switch (command) {
      case "load_preferences": return initial;
      case "save_preferences": state.saves.push(structuredClone(args.preferences as ReaderPreferences)); return null;
      case "consume_window_target": return { root, selectedFile: state.selected };
      case "consume_startup_target": return null;
      case "list_recent_roots": return [];
      case "read_document": return documents.get(String(args.path)) ?? Promise.reject(new Error(`Unknown QA document: ${args.path}`));
      case "open_target": return { root, selectedFile: String(args.path) };
      case "list_directory": return names.map((name, index) => ({ path: paths[index], name, kind: "markdown" }));
      case "load_expanded_paths": case "list_text_highlights": case "list_recent_highlights": return [];
      case "get_reading_position": return null;
      case "get_index_diagnostics": return { documentCount: 3, indexedCount: 3, databaseBytes: 0 };
      case "list_system_fonts": state.fontCalls++; return [];
      case "plugin:window|is_maximized": return false;
      case "plugin:event|listen": return 1;
      case "plugin:event|unlisten": return null;
      case "plugin:dialog|open": return params.get("dialogFile") ?? paths[0];
      case "start_watch": case "index_root": case "save_reading_position": case "set_path_expanded": return null;
      default: throw new Error(`Unexpected QA invoke: ${command}`);
    }
  }
};
Object.assign(window, { __TAURI_INTERNALS__: internals });
const { default: App } = await import("./App");
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);

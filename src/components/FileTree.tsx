import { primaryModifier, shortcutLabel } from "../lib/platform";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppWindow, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search } from "lucide-react";
import type { DirectoryEntry } from "../types";

type Props = { root: string; selected: string | null; onOpen: (path: string) => void; onOpenNew: (path: string) => void; onSearch?: () => void; onChooseFolder?: () => void };

function TreeNode({ entry, selected, onOpen, onOpenNew, expandedPaths }: { entry: DirectoryEntry; selected: string | null; onOpen: (path: string) => void; onOpenNew: (path: string) => void; expandedPaths: Set<string> }) {
  const [expanded, setExpanded] = useState(expandedPaths.has(entry.path));
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  async function loadChildren() {
    if (children.length || loading) return;
    setLoading(true);
    try { setChildren(await invoke("list_directory", { path: entry.path })); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (expanded && entry.kind === "directory") void loadChildren(); }, []);

  async function toggle(controlKey = false) {
    if (entry.kind === "markdown") { if (!controlKey) onOpen(entry.path); return; }
    const next = !expanded;
    setExpanded(next);
    void invoke("set_path_expanded", { path: entry.path, expanded: next });
    if (next) await loadChildren();
  }

  return <div className="tree-node">
    <button className={`tree-row ${selected === entry.path ? "selected" : ""}`} onClick={(event) => void toggle(primaryModifier(event))} onDoubleClick={(event) => { if (entry.kind === "markdown" && primaryModifier(event)) onOpenNew(entry.path); }} onKeyDown={(event) => { if (entry.kind === "markdown" && primaryModifier(event) && event.key === "Enter") { event.preventDefault(); onOpenNew(entry.path); } }} onContextMenu={(event) => { if (entry.kind !== "markdown") return; event.preventDefault(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 90) }); }} title={entry.kind === "markdown" ? `${entry.path}\n${shortcutLabel("Ctrl+双击或 Ctrl+Enter：在新窗口打开")}` : entry.path}>
      <span className="tree-chevron">{entry.kind === "directory" ? (expanded ? <ChevronDown /> : <ChevronRight />) : null}</span>
      {entry.kind === "directory" ? (expanded ? <FolderOpen /> : <Folder />) : <FileText />}
      <span>{entry.name}</span>
    </button>
    {menu && createPortal(<div className="tree-context-layer" onMouseDown={() => setMenu(null)} onContextMenu={(event) => event.preventDefault()}><div className="tree-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}><button role="menuitem" onClick={() => { onOpen(entry.path); setMenu(null); }}><FileText />在当前窗口打开</button><button role="menuitem" onClick={() => { onOpenNew(entry.path); setMenu(null); }}><AppWindow />在新窗口打开</button></div></div>, document.querySelector(".app") ?? document.body)}
    {expanded && <div className="tree-children">
      {loading && <div className="tree-loading">读取中…</div>}
      {children.map((child) => <TreeNode key={child.path} entry={child} selected={selected} onOpen={onOpen} onOpenNew={onOpenNew} expandedPaths={expandedPaths} />)}
      {!loading && !children.length && <div className="tree-empty">没有 Markdown 文件</div>}
    </div>}
  </div>;
}

export default function FileTree({ root, selected, onOpen, onOpenNew, onSearch, onChooseFolder }: Props) {
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    Promise.all([
      invoke<DirectoryEntry[]>("list_directory", { path: root }),
      invoke<string[]>("load_expanded_paths", { root })
    ]).then(([items, expanded]) => { setEntries(items); setExpandedPaths(new Set(expanded)); }).catch((e) => setError(String(e)));
  }, [root]);
  return <nav className="file-tree" aria-label="文件树">
    <div className="sidebar-heading"><FolderOpen /> <span className="folder-name" title={root}>{root.split(/[\\/]/).pop()}</span>
      {onSearch && <button className="folder-search-button" onClick={onSearch} title="搜索文件夹 (Ctrl+P)" aria-label="搜索文件夹"><Search /></button>}
      {onChooseFolder && <button onClick={onChooseFolder} title="更换文件夹" aria-label="更换文件夹"><FolderOpen /></button>}
    </div>
    {error && <div className="error-card">{error}</div>}
    {entries.map((entry) => <TreeNode key={entry.path} entry={entry} selected={selected} onOpen={onOpen} onOpenNew={onOpenNew} expandedPaths={expandedPaths} />)}
  </nav>;
}

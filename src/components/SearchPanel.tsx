import { primaryModifier, shortcutLabel } from "../lib/platform";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileSearch, LoaderCircle, Search, X } from "lucide-react";
import type { SearchResponse, SearchResult } from "../types";
import { trapTab } from "../lib/focus";

type Props = { root: string; onOpen: (path: string, query: string) => void; onOpenNew: (path: string) => void; onClose: () => void };

export default function SearchPanel({ root, onOpen, onOpenNew, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [partial, setPartial] = useState(false);
  const [mode, setMode] = useState<"index" | "scan" | "empty">("empty");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const id = ++requestId.current;
    if (!query.trim()) { setResults([]); setPartial(false); setMode("empty"); setLoading(false); return; }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await invoke<SearchResponse>("search_documents", { root, query, limit: 50 });
        if (requestId.current !== id) return;
        setResults(response.results);
        setPartial(response.partial);
        setMode(response.mode);
      } catch (reason) { if (requestId.current === id) { setError(String(reason)); setResults([]); } }
      finally { if (requestId.current === id) setLoading(false); }
    }, 180);
    return () => clearTimeout(timer);
  }, [query, root]);

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="search-panel" onMouseDown={(e) => e.stopPropagation()} onKeyDown={trapTab} role="dialog" aria-modal="true" aria-label="全文搜索">
      <div className="search-input-row"><Search /><input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索文件名与全文…" /><button onClick={onClose}><X /></button></div>
      <div className="search-results">
        {!loading && query && <div className="search-meta"><span>{mode === "scan" ? "短词逐文件扫描" : "中文子串索引"}</span>{partial && <strong>索引尚未完成，结果可能不完整</strong>}</div>}
        {loading && <div className="search-state"><LoaderCircle className="spin" />正在搜索</div>}
        {!loading && error && <div className="search-state"><FileSearch />搜索失败：{error}</div>}
        {!loading && !error && query && !results.length && <div className="search-state"><FileSearch />没有匹配结果</div>}
        {results.map((result) => <button key={result.path} className="search-result" title={shortcutLabel("Ctrl+单击或 Ctrl+Enter：在新窗口打开")} onClick={(event) => { if (primaryModifier(event)) onOpenNew(result.path); else onOpen(result.path, query); onClose(); }} onKeyDown={(event) => { if (primaryModifier(event) && event.key === "Enter") { event.preventDefault(); onOpenNew(result.path); onClose(); } }}>
          <strong>{result.name}</strong><small>{result.path}</small><span>{result.snippet}</span>
        </button>)}
      </div>
    </section>
  </div>;
}

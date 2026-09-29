import { useCallback, useEffect, useRef, useState } from "react";
import { useTabInvoke } from "../lib/tabContext";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Download, Upload, Search, X, FolderOpen, Trash2, RotateCcw } from "lucide-react";
import { trapTab } from "../lib/focus";
import type { TextHighlight } from "../types";

type Entry = { id: string; path: string; missing: boolean; hasFingerprint: boolean; active: number; deleted: number; preview: string };
export type RecoveryReport = { recovered: number; pending: number; skippedFiles: number };
const filename = (path: string) => path.split(/[\\/]/).pop() || path;

export default function AnnotationManager({ root, onClose, onChooseFolder }: {
  root: string; onClose: () => void; onChooseFolder: () => void;
}) {
  const invoke = useTabInvoke();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [tab, setTab] = useState<"all" | "missing" | "trash">("all");
  const [selected, setSelected] = useState("");
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const entry = entries.find((item) => item.id === selected);
  const visible = entries.filter((item) => tab === "trash" ? item.deleted > 0 : item.active > 0 && (tab !== "missing" || item.missing));
  const refresh = useCallback(async () => setEntries(await invoke<Entry[]>("annotation_library")), []);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !busy) { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [busy, onClose]);
  useEffect(() => {
    if (!busy && !panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
  }, [busy, entries]);
  useEffect(() => {
    void refresh().catch((error) => setStatus(String(error)));
    const unlisten = listen("highlights-updated", () => { void refresh().catch((error) => setStatus(String(error))); });
    return () => { void unlisten.then((stop) => stop()); };
  }, [refresh]);
  useEffect(() => {
    if (!visible.some((item) => item.id === selected)) setSelected(visible[0]?.id ?? "");
  }, [entries, tab, selected]); // visible is derived from these values
  useEffect(() => { setTarget(""); setPurgeConfirm(false); }, [selected, tab, root]);
  useEffect(() => {
    let cancelled = false;
    setHighlights([]);
    if (selected) void invoke<TextHighlight[]>("managed_highlights", { documentId: selected, deleted: tab === "trash" })
      .then((items) => { if (!cancelled) setHighlights(items); }).catch((error) => { if (!cancelled) setStatus(String(error)); });
    return () => { cancelled = true; };
  }, [selected, tab, entries]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setStatus("");
    try { await action(); await refresh(); } catch (error) { setStatus(String(error)); }
    finally { setBusy(false); }
  }
  async function scan() {
    const result = await invoke<RecoveryReport>("recover_highlights");
    setStatus(`已找回 ${result.recovered} 篇文档的标注，${result.pending} 篇待关联。${result.skippedFiles ? ` ${result.skippedFiles} 个文件无法读取或过大，已跳过。` : ""}`);
  }
  async function manage(action: string) {
    await invoke("manage_annotation_document", { documentId: selected, action });
    setPurgeConfirm(false);
    setStatus(action === "trash" ? "已移入回收站，可以随时恢复。" : action === "restore" ? "已恢复标注。" : "已永久删除这些标注。");
  }
  return <div className="modal-backdrop annotation-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={panelRef} className="annotation-manager" role="dialog" aria-modal="true" aria-label="标注管理与备份" onKeyDown={(event) => {
      trapTab(event);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
    }}>
      <div className="settings-title"><h2>标注管理与备份</h2><button ref={closeRef} disabled={busy} aria-label="关闭标注管理" onClick={onClose}><X /></button></div>
      <p className="annotation-help">标注保存在静读中，不会改写 Markdown。搬家后打开新文件夹，内容相同且匹配唯一的文档会自动找回；其余记录可以手动关联。</p>
      <div className="annotation-tools">
        <button disabled={busy} onClick={onChooseFolder}><FolderOpen />打开文件夹</button>
        <button disabled={busy || !root} onClick={() => void run(scan)}><Search />扫描找回</button>
        <button disabled={busy} onClick={() => void run(async () => { const path = await invoke<string | null>("export_annotations"); if (path) setStatus(`备份已保存：${path}`); })}><Download />导出备份</button>
        <button disabled={busy} onClick={() => void run(async () => {
          const count = await invoke<number | null>("import_annotations");
          if (count !== null) setStatus(`已导入 ${count} 条新标注，重复记录已跳过。${root ? "点击“扫描找回”关联本地文件。" : "打开文件夹后可扫描找回。"}`);
        })}><Upload />导入备份</button>
      </div>
      <div className="annotation-root" title={root}>{root ? `扫描范围：${root}` : "尚未打开文件夹。你仍可以查看旧标注、导入和导出备份。"}</div>
      <div className="sidebar-tabs annotation-tabs" role="tablist" aria-label="标注分类">
        {([["all", "全部标注"], ["missing", "待关联"], ["trash", "回收站"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? "active" : ""} disabled={busy} onClick={() => setTab(value)}>{label} <span>{entries.reduce((sum, item) => sum + (value === "trash" ? item.deleted : value === "missing" ? (item.missing ? item.active : 0) : item.active), 0)}</span></button>)}
      </div>
      <div className="annotation-content">
        <nav className="annotation-documents" aria-label="有标注的文档">{visible.map((item) => <button key={item.id} disabled={busy} className={selected === item.id ? "active" : ""} aria-current={selected === item.id ? "true" : undefined} onClick={() => setSelected(item.id)}>
          <strong>{filename(item.path)}</strong><small>{item.missing ? "待关联 · " : ""}{tab === "trash" ? item.deleted : item.active} 条</small><span>{item.preview}</span>
        </button>)}{!visible.length && <p className="annotation-empty">{tab === "trash" ? "回收站为空。删除的高亮会先保留在这里。" : tab === "missing" ? "没有待关联的标注。" : "还没有高亮。选中正文后选择颜色，就能保存第一条。"}</p>}</nav>
        <div className="annotation-detail">{entry && visible.some((item) => item.id === entry.id) ? <>
          <h3>{filename(entry.path)}</h3><p className="annotation-path">{entry.path}</p>
          {entry.missing && <p className="annotation-help">{entry.hasFingerprint ? "尚未找到唯一匹配。可扫描当前文件夹，或手动指定对应文章。" : "旧记录没有内容指纹，无法自动判断新位置。摘录还在，请选择它对应的文章。"}</p>}
          <div className="annotation-tools">
            {tab === "trash" ? <><button disabled={busy} onClick={() => void run(() => manage("restore"))}><RotateCcw />恢复此文档标注</button><button disabled={busy} onClick={() => setPurgeConfirm(true)}><Trash2 />永久删除</button></>
              : <><button disabled={busy || !root} onClick={() => void run(async () => {
                const path = await open({ directory: false, multiple: false, defaultPath: root, filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] }] });
                if (typeof path === "string") setTarget(path);
              })}><FolderOpen />{entry.missing ? "选择对应文件" : "重新关联文件"}</button><button disabled={busy} onClick={() => void run(() => manage("trash"))}><Trash2 />移入回收站</button></>}
          </div>
          {target && <div className="annotation-confirm"><p>关联到：{target}</p><p>请确认这是同一篇文章。将保留两边已有的标注，原文已改写的摘录可能无法定位。</p><button className="primary" disabled={busy} onClick={() => void run(async () => { await invoke("relink_highlights", { documentId: selected, path: target }); setTarget(""); setStatus("关联完成。打开该文章即可查看高亮；无法定位的摘录仍会保留。"); })}>确认关联</button><button disabled={busy} onClick={() => setTarget("")}>取消</button></div>}
          {purgeConfirm && <div className="annotation-confirm"><p>永久删除这篇文档回收站内的 {entry.deleted} 条标注？此操作无法撤销，可先导出备份。</p><button disabled={busy} onClick={() => void run(() => manage("purge"))}>确认永久删除</button><button disabled={busy} onClick={() => setPurgeConfirm(false)}>取消</button></div>}
          <div className="annotation-quotes">{highlights.map((item) => <div key={item.id} className={`highlight-card color-${item.color}`}><p>{item.quote}</p>{tab === "trash" && <button disabled={busy} onClick={() => void run(async () => { await invoke("restore_highlight", { id: item.id }); setStatus("已恢复这条高亮。"); })}>恢复这一条</button>}</div>)}</div>
        </> : <p className="annotation-empty">摘录和颜色会保留在这里。导出备份后，换电脑也能导入找回。</p>}</div>
      </div>
      <div className="annotation-status" role="status">{busy ? "正在处理，请稍候…" : status || "备份包含全部文档的标注和回收站。不会打包 Markdown 原文，请另行保存原文件。"}</div>
    </section>
  </div>;
}

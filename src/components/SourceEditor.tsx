import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Save, Search, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTabInvoke } from "../lib/tabContext";
import { primaryModifier, shortcutLabel } from "../lib/platform";
import { findSource, sourceText } from "../lib/sourceEditing";
import { sourceSyntax } from "../lib/sourceSyntax";

export type SourceEditorHandle = { find: () => void };
type Props = {
  path: string; initialContent: string; dirty: boolean; busy: boolean; error: string; external: boolean;
  onChange: (text: string) => void; onSave: () => void; onExit: () => void;
  onBusy: (busy: boolean) => void; onError: (error: string) => void;
};

// Keep this textarea uncontrolled and mounted throughout the edit session: native
// typing, IME, cut/paste and inserted images share the same undo/redo history.
export default forwardRef<SourceEditorHandle, Props>(function SourceEditor(props, ref) {
  const { path, initialContent, dirty, busy, error, external, onChange, onSave, onExit, onBusy, onError } = props;
  const invoke = useTabInvoke();
  const editor = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLPreElement>(null);
  const [coloredSource, setColoredSource] = useState(() => sourceText(initialContent));
  const tokens = useMemo(() => sourceSyntax(coloredSource), [coloredSource]);
  const search = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findStatus, setFindStatus] = useState("");
  const composing = useRef(false);
  const importing = useRef(false);
  const [compositionActive, setCompositionActive] = useState(false);
  function syncScroll() {
    if (!editor.current || !mirror.current) return;
    // Match the actual text viewport, excluding native scrollbar tracks.
    mirror.current.style.width = `${editor.current.offsetWidth}px`;
    mirror.current.style.height = `${editor.current.clientHeight}px`;
    mirror.current.scrollTop = editor.current.scrollTop;
    mirror.current.scrollLeft = editor.current.scrollLeft;
  }
  function changed(text: string) { setColoredSource(text); onChange(text); }
  useLayoutEffect(syncScroll, [coloredSource, compositionActive]);
  useEffect(() => {
    if (!editor.current) return;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(editor.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { editor.current?.focus(); }, []);
  const showFind = () => { setFindOpen(true); requestAnimationFrame(() => search.current?.focus()); };
  useImperativeHandle(ref, () => ({ find: showFind }));

  function find(direction: number) {
    const area = editor.current;
    if (!area || !query || composing.current) return;
    const match = findSource(area.value, query, area.selectionStart, area.selectionEnd, direction);
    if (!match) { setFindStatus("未找到匹配内容"); return; }
    area.focus();
    area.setSelectionRange(match.start, match.end);
    // Select the actual source, including syntax. Scroll without changing value or undo history.
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight);
    const line = area.value.slice(0, match.start).split("\n").length - 1;
    area.scrollTop = Math.max(0, line * lineHeight - area.clientHeight / 2);
    syncScroll();
    setFindStatus(`已找到“${query}”`);
  }

  async function insertImage() {
    const area = editor.current;
    if (!area || busy || composing.current || importing.current) return;
    importing.current = true;
    const start = area.selectionStart, end = area.selectionEnd;
    onBusy(true); onError("");
    let imported: { reference: string; receipt: string } | undefined;
    try {
      const selected = await open({ directory: false, multiple: false, title: "插入图片", filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"] }] });
      if (typeof selected !== "string") return;
      imported = await invoke("import_document_image", { documentPath: path, sourcePath: selected });
      // execCommand inserts into the browser's native undo stack. A failed
      // insertion never falls back to assigning value (which would erase it).
      area.readOnly = false;
      area.focus(); area.setSelectionRange(start, end);
      const before = area.value;
      document.execCommand("insertText", false, imported!.reference);
      if (area.value !== before.slice(0, start) + imported!.reference + before.slice(end)) throw new Error("无法在光标处插入图片，已保留原有输入。请重试。");
      changed(area.value);
      const receipt = imported!.receipt;
      // The reference is now in the native undo history. Never delete its
      // asset, even when acknowledgement fails or the user undoes the text.
      imported = undefined;
      area.readOnly = true;
      await invoke("finish_document_image", { receipt, keep: true });
    } catch (error) {
      let message = String(error);
      if (imported) {
        try { await invoke("finish_document_image", { receipt: imported.receipt, keep: false }); }
        catch (cleanupError) { message += ` 图片副本未能清理：${String(cleanupError)}`; }
      }
      onError(message);
    } finally { importing.current = false; onBusy(false); editor.current?.focus(); }
  }

  return <section className="source-editor" aria-label="源码编辑" aria-busy={busy} onKeyDown={(event) => {
    if (event.key === "Escape" && findOpen && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault(); event.stopPropagation(); setFindOpen(false); editor.current?.focus();
    }
  }}>
    <div className="source-toolbar">
      <div className="source-mode"><strong>源码</strong><span role="status">{busy ? "处理中…" : dirty ? "未保存" : "已保存"}</span></div>
      <div className="source-actions">
        <button onClick={showFind} title={shortcutLabel("查找源码 (Ctrl+F)")} aria-label="查找源码"><Search /></button>
        <button disabled={busy || compositionActive} onClick={() => void insertImage()}><ImagePlus /><span>插入图片</span></button>
        <button disabled={busy || compositionActive || !dirty} onClick={onSave} title={shortcutLabel("保存 (Ctrl+S)")}><Save /><span>保存</span></button>
        <button disabled={busy || compositionActive} onClick={onExit}>返回阅读</button>
      </div>
    </div>
    {findOpen && <div className="source-find">
      <input ref={search} aria-label="查找源码内容" placeholder="查找源码" value={query} onChange={(event) => { setQuery(event.target.value); setFindStatus(""); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") { event.preventDefault(); find(event.shiftKey ? -1 : 1); }
      }} />
      {query && <button aria-label="清空源码查找" onClick={() => { setQuery(""); setFindStatus(""); search.current?.focus(); }}><X /></button>}
      <button aria-label="上一个源码匹配" disabled={!query} onClick={() => find(-1)}><ChevronUp /></button>
      <button aria-label="下一个源码匹配" disabled={!query} onClick={() => find(1)}><ChevronDown /></button>
      <button aria-label="关闭源码查找" onClick={() => { setFindOpen(false); editor.current?.focus(); }}><X /></button>
      <span className="source-find-status" role="status">{findStatus}</span>
    </div>}
    {external && <div className="source-error" role="alert">文件可能已在外部修改。当前输入已保留；保存时会核对磁盘内容，冲突时不会覆盖。</div>}
    {error && <div className="source-error" role="alert">{error}</div>}
    <div className={`source-surface${compositionActive ? " is-composing" : ""}`}>
    <pre ref={mirror} className="source-colors" aria-hidden="true">{tokens.map((token, index) => <span key={index} className={token.kind ? `source-token-${token.kind}` : undefined}>{token.text}</span>)}<span>{"\u200b"}</span></pre>
    <textarea ref={editor} className="source-input resize-none" aria-label="Markdown 源码" aria-describedby="source-editor-help" defaultValue={sourceText(initialContent)} readOnly={busy} wrap="off" spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" onScroll={syncScroll} onChange={(event) => changed(event.target.value)} onCompositionStart={() => { composing.current = true; setCompositionActive(true); }} onCompositionEnd={(event) => { composing.current = false; setCompositionActive(false); changed(event.currentTarget.value); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (primaryModifier(event) && event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); showFind(); }
      if (primaryModifier(event) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); if (!busy) onSave(); }
      if (event.key === "Escape" && findOpen) { event.preventDefault(); event.stopPropagation(); setFindOpen(false); }
    }} />
    </div>
    <div id="source-editor-help" className="source-editor-help">{shortcutLabel("Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+Shift+Z / Ctrl+Y 重做")}<span>图片保存到当前文档的 images 文件夹</span></div>
  </section>;
});

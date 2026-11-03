import { useEffect, useRef } from "react";
import { trapTab } from "../lib/focus";

export default function UnsavedChangesDialog({ name, busy, error, onSave, onDiscard, onCancel }: {
  name: string; busy: boolean; error: string;
  onSave: () => void; onDiscard: () => void; onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const caller = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // StrictMode replays effects: retain the real caller instead of capturing
    // our own cancel button on the second setup, and restore only on unmount.
    caller.current ??= document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => { requestAnimationFrame(() => { if (!panel.current?.isConnected && caller.current?.isConnected) caller.current.focus(); }); };
  }, []);
  return <div className="modal-backdrop source-leave-backdrop">
    <section ref={panel} className="source-leave-dialog" role="alertdialog" aria-modal="true" aria-labelledby="source-leave-title" aria-describedby="source-leave-description" aria-busy={busy} onKeyDown={(event) => {
      trapTab(event);
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel(); }
    }}>
      <h2 id="source-leave-title">保存源码修改？</h2>
      <p id="source-leave-description">“{name}”有未保存的修改。保存后继续，或放弃本次修改。</p>
      {error && <p className="source-error" role="alert">{error}</p>}
      <div className="source-leave-actions">
        <button ref={cancel} disabled={busy} onClick={onCancel}>继续编辑</button>
        <button disabled={busy} onClick={onDiscard}>放弃修改</button>
        <button className="primary" disabled={busy} onClick={onSave}>{busy ? "正在保存…" : "保存并继续"}</button>
      </div>
    </section>
  </div>;
}

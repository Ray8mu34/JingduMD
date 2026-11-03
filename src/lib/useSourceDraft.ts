import { useCallback, useEffect, useRef, useState } from "react";
import type { invoke as TauriInvoke } from "@tauri-apps/api/core";
import type { DocumentPayload } from "../types";
import { sourceForSave, sourceText } from "./sourceEditing";

type Draft = {
  original: DocumentPayload; baseline: DocumentPayload; text: string;
  busy: boolean; error: string; external: boolean;
};

export function useSourceDraft(invoke: typeof TauriInvoke, onSaved: (doc: DocumentPayload) => void) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef(draft);
  const [asking, setAsking] = useState(false);
  const pending = useRef<{ resolve: (value: boolean) => void }>();
  const saved = useRef(onSaved); saved.current = onSaved;
  const update = useCallback((next: Draft | null) => { current.current = next; setDraft(next); }, []);
  const patch = useCallback((next: Partial<Draft>) => { if (current.current) update({ ...current.current, ...next }); }, [update]);
  const dirty = !!draft && draft.text !== sourceText(draft.baseline.content);

  const save = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot || snapshot.busy) return false;
    if (snapshot.text === sourceText(snapshot.baseline.content)) return true;
    patch({ busy: true, error: "" });
    try {
      const result = await invoke<DocumentPayload>("save_document", {
        path: snapshot.baseline.path, expected: snapshot.baseline.content,
        revision: snapshot.baseline.revision,
        content: sourceForSave(snapshot.text, snapshot.baseline.content)
      });
      // Navigation is blocked while saving. Keep the native textarea mounted,
      // including its undo history, and only move the saved baseline forward.
      patch({ baseline: result, busy: false, external: false, error: "" });
      saved.current(result);
      return true;
    } catch (error) {
      patch({ busy: false, error: `未能保存，输入已保留。${String(error)}` });
      return false;
    }
  }, [invoke, patch]);

  const leave = useCallback((): Promise<boolean> => {
    // Only the first navigation owns the decision. A second caller must not
    // receive the same approval and execute another, competing navigation.
    if (pending.current) return Promise.resolve(false);
    const value = current.current;
    if (!value) return Promise.resolve(true);
    if (value.busy) { patch({ error: "正在处理当前操作，请完成后再离开源码。" }); return Promise.resolve(false); }
    if (value.text === sourceText(value.baseline.content)) { update(null); return Promise.resolve(true); }
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((done) => { resolve = done; });
    pending.current = { resolve };
    setAsking(true);
    return promise;
  }, [patch, update]);

  const answer = useCallback((value: boolean) => {
    if (value) update(null);
    setAsking(false);
    const request = pending.current;
    pending.current = undefined;
    request?.resolve(value);
  }, [update]);

  const checkExternal = useCallback(async () => {
    const snapshot = current.current;
    if (!snapshot) return;
    try {
      const disk = await invoke<DocumentPayload>("read_document", { path: snapshot.baseline.path });
      const active = current.current;
      if (!active || active.baseline !== snapshot.baseline || active.baseline.path !== disk.path || active.busy) return;
      patch({ external: disk.content !== active.baseline.content || disk.revision !== active.baseline.revision });
    } catch {
      if (current.current?.baseline === snapshot.baseline && !current.current.busy) patch({ external: true });
    }
  }, [invoke, patch]);

  // Watch events can arrive before a save returns. Re-read after every busy
  // operation so an event skipped during saving/importing cannot be lost.
  useEffect(() => { if (draft && !draft.busy) void checkExternal(); }, [draft?.busy, draft?.baseline, checkExternal]);
  useEffect(() => () => { pending.current?.resolve(false); pending.current = undefined; }, []);

  return {
    draft, current, dirty, asking, leave, save, checkExternal,
    begin: (document: DocumentPayload) => update({ original: document, baseline: document, text: sourceText(document.content), busy: false, error: "", external: false }),
    change: (text: string) => patch({ text }),
    setBusy: (busy: boolean) => patch({ busy }),
    setError: (error: string) => patch({ error }),
    cancel: () => answer(false), discard: () => answer(true),
    saveAndLeave: async () => { if (await save()) answer(true); }
  };
}

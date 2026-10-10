import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react";
import { handleMenuKeys } from "../lib/focus";
import { isMac } from "../lib/platform";
import { registerDismissPortal } from "../lib/useOutsideDismiss";

export type FileMenuTarget = { path: string; x: number; y: number; trigger: HTMLElement };
type Action = { label: string; icon: ReactNode; run: () => void | Promise<unknown> };

export default function FileContextMenu({ target, actions, onClose }: {
  target: FileMenuTarget; actions: Action[]; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useLayoutEffect(() => {
    const menu = menuRef.current!;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - rect.height - 8))}px`;
    if (!error) menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return registerDismissPortal(menu, target.trigger);
  }, [target, error]);
  const close = (restoreFocus = true) => {
    onClose();
    if (restoreFocus) target.trigger.focus({ preventScroll: true });
  };
  const run = async (action: Action) => {
    setBusy(true);
    setError("");
    try { await action.run(); close(); }
    catch (reason) { setError(`无法完成操作：${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { setBusy(false); }
  };
  const reveal: Action = { label: isMac ? "在 Finder 中显示" : "在文件资源管理器中显示", icon: <FolderOpen />, run: () => revealItemInDir(target.path) };
  return createPortal(<div className="tree-context-layer" onMouseDown={() => close(false)} onContextMenu={(event) => { event.preventDefault(); close(false); }}>
    <div ref={menuRef} className="tree-context-menu" role="menu" aria-label="文章操作" aria-busy={busy} style={{ left: target.x, top: target.y }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => handleMenuKeys(event, (reason) => close(reason === "escape"))}>
      {[...actions, reveal].map((action) => <button key={action.label} type="button" role="menuitem" disabled={busy} onClick={() => void run(action)}>{action.icon}{action.label}</button>)}
      {error && <div className="file-menu-error" role="alert">{error}</div>}
    </div>
  </div>, document.querySelector(".app") ?? document.body);
}

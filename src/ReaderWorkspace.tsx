import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, ExternalLink } from "lucide-react";
import App, { type ReaderSession } from "./App";
import { TabContext } from "./lib/tabContext";
import { isMac, primaryModifier, shortcutLabel } from "./lib/platform";
import { useNativeMenu } from "./lib/nativeMenu";

type Tab = { id: string; session?: ReaderSession; initialPath?: string };
const title = (tab: Tab) => (tab.session?.path || tab.initialPath || tab.session?.root)?.split(/[\\/]/).pop() || "新标签页";

export default function ReaderWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "primary" }]);
  const [active, setActive] = useState("primary");
  const [error, setError] = useState("");
  const latest = useRef(tabs);
  latest.current = tabs;
  const report = useCallback((id: string, session: ReaderSession) => {
    setTabs((items) => items.map((tab) => tab.id === id ? { ...tab, session, initialPath: undefined } : tab));
  }, []);
  const newTab = useCallback((path?: string, root?: string) => {
    const existing = path && latest.current.find((tab) => tab.session?.path === path || tab.initialPath === path);
    if (existing) { setActive(existing.id); return; }
    const id = crypto.randomUUID();
    setTabs((items) => [...items, { id, initialPath: path, session: root && path ? { root, path, back: [], forward: [] } : undefined }]);
    setActive(id);
  }, []);
  const closeTab = useCallback((id: string) => {
    const items = latest.current;
    const index = items.findIndex((tab) => tab.id === id);
    const remaining = items.filter((tab) => tab.id !== id);
    if (!remaining.length) {
      const next = { id: crypto.randomUUID() };
      setTabs([next]); setActive(next.id);
    } else {
      setTabs(remaining);
      if (active === id) setActive(remaining[Math.min(index, remaining.length - 1)].id);
    }
    // React runs the old reader's layout cleanup (saving its position) first.
    window.setTimeout(() => void invoke("close_tab", { tabId: id }).catch(() => undefined), 0);
  }, [active]);
  const cycleTab = (backward: boolean) => {
    const index = latest.current.findIndex((tab) => tab.id === active);
    setActive(latest.current[(index + (backward ? -1 : 1) + latest.current.length) % latest.current.length].id);
  };
  useNativeMenu((action) => {
    if (action === "reader-new-tab") newTab();
    else if (action === "reader-close-tab") closeTab(active);
    else if (action === "reader-next-tab") cycleTab(false);
    else if (action === "reader-previous-tab") cycleTab(true);
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isMac) return;
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
        event.preventDefault(); cycleTab(event.shiftKey); return;
      }
      // Native macOS menu accelerators own Cmd shortcuts; never execute them twice.
      if (!primaryModifier(event) || event.altKey) return;
      if (event.key.toLowerCase() === "t") { event.preventDefault(); newTab(); }
      else if (event.key.toLowerCase() === "w" && !event.shiftKey) { event.preventDefault(); closeTab(active); }
      else if (event.key.toLowerCase() === "n" && !event.shiftKey) { event.preventDefault(); void invoke("open_in_new_window", { path: null }).catch((error) => setError(String(error))); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, closeTab, newTab]);
  const tab = tabs.find((item) => item.id === active)!;
  const bar = <div className="document-tabs">
    <div role="tablist" aria-label="文档标签页" className="document-tab-list">
      {tabs.map((item) => <div key={item.id} className={`document-tab ${item.id === active ? "active" : ""}`}>
        <button role="tab" id={`tab-${item.id}`} aria-controls="reader-tab-panel" aria-selected={item.id === active} tabIndex={item.id === active ? 0 : -1} title={item.session?.path || item.initialPath || title(item)} onClick={() => setActive(item.id)} onAuxClick={(event) => { if (event.button === 1) closeTab(item.id); }} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = tabs.findIndex((tab) => tab.id === item.id);
          const next = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1)! : tabs[(index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length];
          setActive(next.id);
          requestAnimationFrame(() => document.getElementById(`tab-${next.id}`)?.focus());
        }}>{title(item)}</button>
        <button className="close-tab" aria-label={`关闭标签页 ${title(item)}`} onClick={() => closeTab(item.id)}><X /></button>
      </div>)}
    </div>
    <button className="tab-action" title={shortcutLabel("新建标签页 (Ctrl+T)")} aria-label="新建标签页" onClick={() => newTab()}><Plus /></button>
    <button className="tab-action" title="在新窗口打开当前文章" aria-label="在新窗口打开当前标签页" disabled={!tab.session?.path} onClick={() => void invoke("open_in_new_window", { path: tab.session?.path }).catch((error) => setError(String(error)))}><ExternalLink /></button>
    {error && <button className="tab-error" onClick={() => setError("")}>{error}</button>}
  </div>;
  return <TabContext.Provider value={active}>
    <App key={active} session={tab.session} initialPath={tab.initialPath} onSessionChange={(session) => report(active, session)} onNewTab={newTab} tabBar={bar} tabId={active} />
  </TabContext.Provider>;
}

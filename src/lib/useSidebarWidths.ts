import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { sidebarWidth } from "./sidebarSizing";

const key = "jingreader:sidebar-widths:v1";
type Widths = { treeWidth: number; outlineWidth: number };
function read(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? localStorage.getItem("jingreader:window:main") ?? "{}");
    const widths = { treeWidth: sidebarWidth(saved.treeWidth, "left"), outlineWidth: sidebarWidth(saved.outlineWidth, "right") };
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(widths));
    return widths;
  } catch { return { treeWidth: sidebarWidth(undefined, "left"), outlineWidth: sidebarWidth(undefined, "right") }; }
}

export function useSidebarWidths() {
  const [widths, setWidths] = useState(read);
  useEffect(() => {
    const refresh = () => setWidths(read());
    window.addEventListener("storage", refresh);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) void listen<Widths>("sidebar-widths-changed", ({ payload }) => setWidths({ treeWidth: sidebarWidth(payload.treeWidth, "left"), outlineWidth: sidebarWidth(payload.outlineWidth, "right") })).then((stop) => { if (disposed) stop(); else { unlisten = stop; refresh(); } }).catch(() => {});
    return () => { disposed = true; unlisten?.(); window.removeEventListener("storage", refresh); };
  }, []);
  const update = (field: keyof Widths, value: number) => {
    const next = { ...read(), [field]: value };
    setWidths(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Session state remains usable. */ }
    if (isTauri()) void emit("sidebar-widths-changed", next).catch(() => {});
  };
  return { ...widths, setTreeWidth: (value: number) => update("treeWidth", value), setOutlineWidth: (value: number) => update("outlineWidth", value) };
}

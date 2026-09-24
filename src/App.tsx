import { isMac, primaryModifier, shortcutLabel } from "./lib/platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AppWindow, ArrowLeft, ArrowRight, Ban, ChevronDown, ChevronRight,
  ChevronUp, Copy, ExternalLink, Focus, FolderClock, FolderOpen, Maximize2, Minus,
  Highlighter, PanelLeftClose, PanelRightClose, Printer, Search, Settings, Square, TerminalSquare,
  Trash2, X, MoreHorizontal, FileText, Database
} from "lucide-react";
import FileTree from "./components/FileTree";
import MarkdownReader from "./components/MarkdownReader";
import SearchPanel from "./components/SearchPanel";
import SettingsPanel from "./components/SettingsPanel";
import { clearFindHighlights, findTextRanges, scrollToRange, updateFindHighlights } from "./lib/find";
import {
  clearTextHighlights, HIGHLIGHT_COLORS, paintHighlights, resolveHighlights,
  scrollToHighlight, selectionToHighlight
} from "./lib/highlights";
import { readerPresentation } from "./lib/readerPresentation";
import { extractOutline } from "./lib/markdown";
import { migratePreferences } from "./lib/readerPreferences";
import { formatModifiedTime, readingMetrics } from "./lib/reading";
import { captureTextAnchor, restoreTextAnchor, type TextAnchor } from "./lib/readingAnchor";
import { handleMenuKeys, trapTab } from "./lib/focus";
import { useOutsideDismiss } from "./lib/useOutsideDismiss";
import type {
  DocumentPayload, ExternalChangeEvent, HighlightColor, IndexStatus, NewTextHighlight, OpenTarget,
  ReaderPreferences, ReadingPosition, RecentRoot, ResolvedHighlight, TextHighlight
} from "./types";
import { DEFAULT_PREFERENCES } from "./types";

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function rootName(path: string): string { return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path; }
function sourceHeadings(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")]
    .filter((heading) => heading.id !== "user-content-footnote-label");
}
type PreferencesChanged = { source: string; preferences: ReaderPreferences };
type HighlightsChanged = { path: string; source: string };
type HighlightPopover = { x: number; y: number; draft: NewTextHighlight };

export default function App() {
  const windowLabel = isTauri() ? getCurrentWindow().label : "main";
  const isMainWindow = windowLabel === "main";
  const windowStateKey = `jingreader:window:${windowLabel}`;
  const savedWindowState = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(windowStateKey) ?? "null") as { showTree?: boolean; showOutline?: boolean } | null; }
    catch { return null; }
  }, [windowStateKey]);
  const [root, setRoot] = useState("");
  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_PREFERENCES);
  const [showTree, setShowTree] = useState(savedWindowState?.showTree ?? DEFAULT_PREFERENCES.showTree);
  const [showOutline, setShowOutline] = useState(savedWindowState?.showOutline ?? DEFAULT_PREFERENCES.showOutline);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  const [narrowTreeOpen, setNarrowTreeOpen] = useState(false);
  const [narrowOutlineOpen, setNarrowOutlineOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(!isTauri());
  const [preferenceCommitVersion, setPreferenceCommitVersion] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"reading" | "system">("reading");
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<Range[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [focusMode, setFocusMode] = useState(false);
  const [message, setMessage] = useState("");
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [activeHeading, setActiveHeading] = useState("");
  const [readingProgress, setReadingProgress] = useState(0);
  const [recentRoots, setRecentRoots] = useState<RecentRoot[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [resolvedHighlights, setResolvedHighlights] = useState<ResolvedHighlight[]>([]);
  const [recentHighlights, setRecentHighlights] = useState<TextHighlight[]>([]);
  const [rightTab, setRightTab] = useState<"outline" | "highlights">("outline");
  const [highlightPopover, setHighlightPopover] = useState<HighlightPopover | null>(null);
  const selectionDraft = useRef<HighlightPopover | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const openMenuTrigger = useRef<HTMLButtonElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const treeTrigger = useRef<HTMLButtonElement>(null);
  const outlineTrigger = useRef<HTMLButtonElement>(null);
  const treeSidebar = useRef<HTMLElement>(null);
  const outlineSidebar = useRef<HTMLElement>(null);
  const openMenu = useRef<HTMLDivElement>(null);
  const moreMenu = useRef<HTMLDivElement>(null);
  const settingsLayer = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<number>();
  const telemetryFrame = useRef<number>();
  const initialized = useRef(false);
  const startupConsumed = useRef(false);
  const skipPreferenceSave = useRef(false);
  const previewingPreferences = useRef(false);
  const documentRef = useRef<DocumentPayload | null>(null);
  const rootRef = useRef("");
  const backHistory = useRef<string[]>([]);
  const forwardHistory = useRef<string[]>([]);
  const pendingHighlightId = useRef<number | null>(null);
  const pendingSearch = useRef("");
  const searchCaller = useRef<HTMLElement | null>(null);
  const documentGeneration = useRef(0);
  const userScrollGeneration = useRef(0);
  const pendingAnchor = useRef<{ path: string; anchor: TextAnchor } | null>(null);
  const liveAnchor = useRef<{ path: string; generation: number; anchor: TextAnchor } | null>(null);
  const outline = useMemo(() => doc ? extractOutline(doc.content) : [], [doc]);
  const metrics = useMemo(() => doc ? readingMetrics(doc.content) : null, [doc]);

  const preserveAnchor = useCallback(() => {
    const path = documentRef.current?.path;
    const anchor = scrollRef.current && captureTextAnchor(scrollRef.current);
    if (path && anchor) pendingAnchor.current = { path, anchor };
  }, []);

  const endPreferencesPreview = useCallback(() => {
    if (!previewingPreferences.current) return;
    previewingPreferences.current = false;
    setPreferenceCommitVersion((value) => value + 1);
  }, []);
  const closeSettings = useCallback((reason: "escape" | "button" | "toggle" | "outside" | "tab" | "switch") => {
    endPreferencesPreview();
    setSettingsOpen(false);
    if (reason === "escape" || reason === "button" || reason === "toggle") {
      requestAnimationFrame(() => (settingsSection === "system" ? moreTrigger : settingsTrigger).current?.focus());
    }
  }, [endPreferencesPreview, settingsSection]);
  const toggleTree = useCallback(() => {
    preserveAnchor();
    if (narrow) { setNarrowTreeOpen((open) => !open); setNarrowOutlineOpen(false); }
    else setShowTree((open) => !open);
  }, [narrow, preserveAnchor]);
  const toggleOutline = useCallback(() => {
    preserveAnchor(); setRightTab("outline");
    if (narrow) { setNarrowOutlineOpen((open) => !open); setNarrowTreeOpen(false); }
    else setShowOutline((open) => !open);
  }, [narrow, preserveAnchor]);
  const openFolderSearch = useCallback(() => {
    searchCaller.current = document.activeElement as HTMLElement;
    if (settingsOpen) closeSettings("switch");
    setOpenMenuOpen(false); setMoreOpen(false); setSearchOpen(true);
  }, [closeSettings, settingsOpen]);
  const closeFolderSearch = useCallback(() => {
    setSearchOpen(false);
    requestAnimationFrame(() => searchCaller.current?.isConnected && searchCaller.current.focus());
  }, []);
  useEffect(() => {
    const update = () => { const next = window.innerWidth < 900; if (next !== narrow) { preserveAnchor(); setNarrow(next); setNarrowTreeOpen(false); setNarrowOutlineOpen(false); } };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [narrow, preserveAnchor]);
  useOutsideDismiss(openMenuOpen, [openMenuTrigger, openMenu], () => setOpenMenuOpen(false), true);
  useOutsideDismiss(moreOpen, [moreTrigger, moreMenu], () => setMoreOpen(false), true);
  useOutsideDismiss(settingsOpen, [settingsTrigger, settingsLayer], () => closeSettings("outside"));
  useOutsideDismiss(narrow && narrowTreeOpen, [treeTrigger, treeSidebar], () => setNarrowTreeOpen(false));
  useOutsideDismiss(narrow && narrowOutlineOpen, [outlineTrigger, outlineSidebar], () => setNarrowOutlineOpen(false));
  useEffect(() => {
    if (openMenuOpen) openMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [openMenuOpen]);
  useEffect(() => {
    if (moreOpen) moreMenu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [moreOpen]);
  useEffect(() => {
    if (!settingsOpen) return;
    window.addEventListener("pointerup", endPreferencesPreview, true);
    window.addEventListener("pointercancel", endPreferencesPreview, true);
    window.addEventListener("blur", endPreferencesPreview);
    return () => {
      window.removeEventListener("pointerup", endPreferencesPreview, true);
      window.removeEventListener("pointercancel", endPreferencesPreview, true);
      window.removeEventListener("blur", endPreferencesPreview);
    };
  }, [endPreferencesPreview, settingsOpen]);

  const notify = useCallback((value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(""), 3500);
  }, []);

  const allowRemoteHost = useCallback((host: string) => {
    if (!host) return;
    setPreferences((current) => current.allowedRemoteHosts.includes(host) ? current : {
      ...current,
      allowedRemoteHosts: [...current.allowedRemoteHosts, host]
    });
  }, []);

  const refreshHighlights = useCallback(async (path?: string) => {
    if (!isTauri()) return;
    try {
      const [current, recent] = await Promise.all([
        path ? invoke<TextHighlight[]>("list_document_highlights", { path }) : Promise.resolve([]),
        rootRef.current ? invoke<TextHighlight[]>("list_recent_highlights", { limit: 80 }) : Promise.resolve([])
      ]);
      if (!path || documentRef.current?.path === path) setHighlights(current);
      setRecentHighlights(recent);
    } catch (error) { notify(`无法读取高亮：${errorText(error)}`); }
  }, [notify]);

  const createHighlight = useCallback(async (draft: NewTextHighlight, color: HighlightColor) => {
    try {
      await invoke<TextHighlight>("create_text_highlight", { highlight: { ...draft, color } });
      globalThis.getSelection()?.removeAllRanges();
      setHighlightPopover(null);
      await refreshHighlights(draft.path);
    } catch (error) { notify(`无法保存高亮：${errorText(error)}`); }
  }, [notify, refreshHighlights]);

  const changeHighlightColor = useCallback(async (id: number, color: HighlightColor, path: string) => {
    try {
      await invoke("update_text_highlight_color", { id, color });
      await refreshHighlights(documentRef.current?.path ?? path);
    } catch (error) { notify(`无法修改高亮：${errorText(error)}`); }
  }, [notify, refreshHighlights]);

  const deleteHighlight = useCallback(async (id: number, path: string) => {
    try {
      await invoke("delete_text_highlight", { id });
      await refreshHighlights(documentRef.current?.path ?? path);
    } catch (error) { notify(`无法删除高亮：${errorText(error)}`); }
  }, [notify, refreshHighlights]);

  const exportPdf = useCallback(async () => {
    if (!documentRef.current) return;
    preserveAnchor();
    const folds = [...document.querySelectorAll<HTMLButtonElement>(".section-fold-button,.code-block-toolbar button,.callout-heading,.image-actions button[title='折叠图片']")]
      .filter((button) => button.getAttribute("aria-expanded") === "false");
    window.dispatchEvent(new Event("jingreader:expand-for-print"));
    notify(`${isMac ? "请在系统打印窗口的 PDF 菜单选择“存储为 PDF”" : preferences.pdfStyle === "current"
      ? "将沿用当前阅读预设；请在打印窗口选择 Microsoft Print to PDF，必要时开启“背景图形”"
      : "请在系统打印窗口选择 Microsoft Print to PDF 并指定保存位置"}${preferences.pdfIncludeHighlights ? "；将保留文本高亮" : "；不包含文本高亮"}`);
    const previousTitle = document.title;
    document.title = documentRef.current.name.replace(/\.(md|markdown)$/i, "") || "静读文档";
    const restore = () => { document.title = previousTitle; for (const button of folds) { if (button.isConnected && button.getAttribute("aria-expanded") === "true") button.click(); } window.dispatchEvent(new Event("jingreader:restore-after-print")); const pending = pendingAnchor.current; if (pending && scrollRef.current && pending.path === documentRef.current?.path) restoreTextAnchor(scrollRef.current, pending.anchor); pendingAnchor.current = null; };
    window.addEventListener("afterprint", restore, { once: true });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      const pending = document.querySelector(
        ".image-placeholder:not(.remote-image-consent), .lazy-math:not(:has(.katex)), .mermaid-block:not(:has(svg)):not(:has(.diagram-error))"
      );
      if (!pending) break;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    try {
      if (isMac && isTauri()) await invoke("print_document");
      else window.print();
    } catch (error) { notify(`无法打开打印窗口：${errorText(error)}`); }
    finally { restore(); }
  }, [notify, preferences.pdfIncludeHighlights, preferences.pdfStyle, preserveAnchor]);

  const refreshRecentRoots = useCallback(() => {
    if (!isTauri()) return;
    void invoke<RecentRoot[]>("list_recent_roots").then(setRecentRoots).catch(() => undefined);
  }, []);

  const updateReadingTelemetry = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const maximum = Math.max(1, container.scrollHeight - container.clientHeight);
    setReadingProgress(Math.max(0, Math.min(1, container.scrollTop / maximum)));
    const headings = sourceHeadings(container);
    const top = container.scrollTop + Math.min(120, container.clientHeight * 0.18);
    let active = headings[0];
    for (const heading of headings) { if (heading.offsetTop <= top) active = heading; else break; }
    setActiveHeading(active?.id ?? "");
  }, []);

  const scheduleReadingTelemetry = useCallback(() => {
    if (telemetryFrame.current !== undefined) return;
    telemetryFrame.current = window.requestAnimationFrame(() => {
      telemetryFrame.current = undefined;
      updateReadingTelemetry();
    });
  }, [updateReadingTelemetry]);

  useLayoutEffect(() => {
    const pending = pendingAnchor.current;
    if (pending && pending.path === doc?.path && scrollRef.current) {
      restoreTextAnchor(scrollRef.current, pending.anchor);
      const anchor = captureTextAnchor(scrollRef.current);
      if (anchor) liveAnchor.current = { path: pending.path, generation: userScrollGeneration.current, anchor };
      pendingAnchor.current = null;
    }
  });

  useEffect(() => {
    const container = scrollRef.current;
    const article = container?.querySelector<HTMLElement>(".markdown-body");
    if (!container || !article || !doc || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const live = liveAnchor.current;
      if (!live || live.path !== doc.path || live.generation !== userScrollGeneration.current) return;
      if (restoreTextAnchor(container, live.anchor)) {
        const next = captureTextAnchor(container);
        if (next) liveAnchor.current = { ...live, anchor: next };
      }
    });
    observer.observe(article);
    return () => observer.disconnect();
  }, [doc]);

  const navigateHeading = useCallback((id: string) => {
    const target = document.getElementById(id) ?? document.getElementById(id.startsWith("user-content-") ? id.slice(13) : `user-content-${id}`);
    if (!target) return;
    window.dispatchEvent(new CustomEvent("jingreader:reveal-heading", { detail: target }));
    requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth" })));
  }, []);

  const persistPosition = useCallback((path: string) => {
    const container = scrollRef.current;
    if (!container || documentRef.current?.path !== path) return;
    const headings = sourceHeadings(container);
    const top = container.scrollTop + 24;
    let active: HTMLElement | undefined;
    for (const heading of headings) { if (heading.offsetTop <= top) active = heading; else break; }
    const index = active ? headings.indexOf(active) : -1;
    const nextTop = headings[index + 1]?.offsetTop ?? container.scrollHeight;
    const headingRatio = active ? Math.max(0, Math.min(1, (top - active.offsetTop) / Math.max(1, nextTop - active.offsetTop))) : 0;
    const documentRatio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
    void invoke("save_reading_position", { position: { path, headingId: active?.id ?? null, headingRatio, documentRatio } });
  }, []);

  const restorePosition = useCallback(async (path: string, generation: number, hash?: string) => {
    const userGeneration = userScrollGeneration.current;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const container = scrollRef.current;
    if (!container || generation !== documentGeneration.current || userGeneration !== userScrollGeneration.current) return;
    if (hash) {
      navigateHeading(decodeURIComponent(hash));
      updateReadingTelemetry();
      return;
    }
    const saved = await invoke<ReadingPosition | null>("get_reading_position", { path });
    if (generation !== documentGeneration.current || userGeneration !== userScrollGeneration.current) return;
    if (saved) {
      const heading = saved.headingId ? document.getElementById(saved.headingId) : null;
      if (heading) {
        const headings = sourceHeadings(container);
        const index = headings.indexOf(heading);
        const nextTop = headings[index + 1]?.offsetTop ?? container.scrollHeight;
        container.scrollTop = heading.offsetTop + (nextTop - heading.offsetTop) * saved.headingRatio;
      } else {
        container.scrollTop = (container.scrollHeight - container.clientHeight) * saved.documentRatio;
      }
    }
    updateReadingTelemetry();
  }, [navigateHeading, updateReadingTelemetry]);

  const loadDocument = useCallback(async (path: string, hash?: string, recordHistory = true) => {
    const generation = ++documentGeneration.current;
    try {
      const current = documentRef.current;
      window.clearTimeout(saveTimer.current);
      if (current && current.path !== path) persistPosition(current.path);
      if (current?.path === path) preserveAnchor();
      if (recordHistory && current && current.path !== path) {
        backHistory.current = [...backHistory.current.slice(-98), current.path];
        forwardHistory.current = [];
        setHistoryVersion((value) => value + 1);
      }
      const payload = await invoke<DocumentPayload>("read_document", { path });
      if (generation !== documentGeneration.current) return;
      documentRef.current = payload;
      setDoc(payload);
      document.title = `${payload.name} · 静读 Markdown`;
      window.setTimeout(() => void restorePosition(payload.path, generation, hash), 0);
    } catch (error) { notify(`无法打开文档：${errorText(error)}`); }
  }, [notify, persistPosition, preserveAnchor, restorePosition]);

  const openDocument = useCallback((path: string, hash?: string) => {
    if (narrow) setNarrowTreeOpen(false);
    void loadDocument(path, hash, true);
  }, [loadDocument, narrow]);

  const openDocumentInNewWindow = useCallback((path: string) => {
    void invoke("open_in_new_window", { path }).catch((error) => notify(`无法新建阅读窗口：${errorText(error)}`));
  }, [notify]);

  const navigateHistory = useCallback((direction: "back" | "forward") => {
    const source = direction === "back" ? backHistory : forwardHistory;
    const destination = direction === "back" ? forwardHistory : backHistory;
    const next = source.current.pop();
    if (!next) return;
    const current = documentRef.current;
    if (current) destination.current.push(current.path);
    setHistoryVersion((value) => value + 1);
    void loadDocument(next, undefined, false);
  }, [loadDocument]);

  const applyResolvedTarget = useCallback(async (target: OpenTarget, initializeBackground = true) => {
    try {
      documentGeneration.current++;
      if (documentRef.current) persistPosition(documentRef.current.path);
      documentRef.current = null;
      if (rootRef.current !== target.root) {
        backHistory.current = [];
        forwardHistory.current = [];
        setHistoryVersion((value) => value + 1);
      }
      rootRef.current = target.root;
      setRoot(target.root);
      setDoc(null);
      if (initializeBackground) {
        await invoke("start_watch", { root: target.root });
        void invoke("index_root", { root: target.root }).catch((error) => notify(`索引失败：${errorText(error)}`));
      }
      if (target.selectedFile) await loadDocument(target.selectedFile, undefined, false);
      refreshRecentRoots();
    } catch (error) { notify(`无法打开：${errorText(error)}`); }
  }, [loadDocument, notify, persistPosition, refreshRecentRoots]);

  const applyTarget = useCallback(async (path: string) => {
    try {
      await applyResolvedTarget(await invoke<OpenTarget>("open_target", { path }));
    } catch (error) { notify(`无法打开：${errorText(error)}`); }
  }, [applyResolvedTarget, notify]);

  const chooseFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "选择 Markdown 文件夹" });
    if (typeof selected === "string") {
      if (narrow) setNarrowTreeOpen(true); else setShowTree(true);
      await applyTarget(selected);
    }
  }, [applyTarget, narrow]);

  const chooseFile = useCallback(async () => {
    const selected = await open({ directory: false, multiple: false, title: "打开 Markdown 文件", filters: [{ name: "Markdown", extensions: ["md", "markdown"] }] });
    if (typeof selected === "string") { if (narrow) setNarrowTreeOpen(false); await applyTarget(selected); }
  }, [applyTarget, narrow]);

  useEffect(() => { documentRef.current = doc; }, [doc]);

  useEffect(() => {
    setHighlightPopover(null);
    selectionDraft.current = null;
    setHighlights([]);
    setResolvedHighlights([]);
    clearTextHighlights();
    if (doc) void refreshHighlights(doc.path);
  }, [doc?.path, refreshHighlights]);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const resolveAndPaint = () => {
      frame = 0;
      if (cancelled) return;
      const article = scrollRef.current?.querySelector<HTMLElement>(".markdown-body");
      const resolved = article ? resolveHighlights(article, highlights) : [];
      setResolvedHighlights(resolved);
      paintHighlights(resolved);
      const pending = pendingHighlightId.current;
      if (pending !== null) {
        const target = resolved.find((highlight) => highlight.id === pending);
        if (target && scrollToHighlight(target)) pendingHighlightId.current = null;
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(resolveAndPaint);
    };
    schedule();
    const article = scrollRef.current?.querySelector<HTMLElement>(".markdown-body");
    const observer = article ? new MutationObserver(schedule) : null;
    observer?.observe(article!, { childList: true, subtree: true, characterData: true });
    return () => { cancelled = true; observer?.disconnect(); if (frame) window.cancelAnimationFrame(frame); clearTextHighlights(); };
  }, [doc, highlights]);

  useEffect(() => {
    if (!isTauri() || initialized.current) return;
    initialized.current = true;
    invoke<ReaderPreferences | null>("load_preferences")
      .then((saved) => { const migrated = migratePreferences(saved); setPreferences(migrated); if (!savedWindowState) { setShowTree(migrated.showTree); setShowOutline(migrated.showOutline); } })
      .finally(() => setPreferencesReady(true));
    refreshRecentRoots();
    invoke<OpenTarget | null>("consume_window_target").then((target) => {
      if (target) void applyResolvedTarget(target, false);
    });
  }, [applyResolvedTarget, applyTarget, isMainWindow, refreshRecentRoots, savedWindowState]);

  useEffect(() => {
    if (!preferencesReady) return;
    try { localStorage.setItem(windowStateKey, JSON.stringify({ showTree, showOutline })); } catch { /* storage unavailable */ }
  }, [preferencesReady, showTree, showOutline, windowStateKey]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    const cleanups = [
      listen<string>("open-target-argument", ({ payload }) => void applyTarget(payload)).then(async (unlisten) => {
        if (!active) { unlisten(); return () => {}; }
        if (isMainWindow && !startupConsumed.current) {
          startupConsumed.current = true;
          const path = await invoke<string | null>("consume_startup_target");
          if (path) void applyTarget(path);
        }
        return unlisten;
      }),
      listen<IndexStatus>("index-status", ({ payload }) => { if (payload.root === rootRef.current) setIndexStatus(payload); }),
      listen<string>("tree-changed", ({ payload }) => { if (payload === rootRef.current) setTreeVersion((value) => value + 1); }),
      listen<PreferencesChanged>("preferences-updated", ({ payload }) => {
        if (payload.source === windowLabel) return;
        preserveAnchor();
        skipPreferenceSave.current = true;
        setPreferences((current) => ({ ...migratePreferences(payload.preferences), showTree: current.showTree, showOutline: current.showOutline }));
      }),
      listen<HighlightsChanged>("highlights-updated", ({ payload }) => {
        if (payload.source === windowLabel && payload.path !== "*") return;
        if (payload.path === "*") void refreshHighlights(documentRef.current?.path);
        else if (documentRef.current?.path === payload.path) void refreshHighlights(payload.path);
        else if (rootRef.current) void refreshHighlights(documentRef.current?.path);
      }),
      listen<ExternalChangeEvent>("external-change", ({ payload }) => {
        if (documentRef.current?.path === payload.path) {
          void loadDocument(payload.path, undefined, false).then(() => notify("文件已在外部更新"));
        }
      })
    ];
    return () => { active = false; cleanups.forEach((promise) => void promise.then((fn) => fn())); };
  }, [applyTarget, isMainWindow, loadDocument, notify, preserveAnchor, refreshHighlights, windowLabel]);

  useEffect(() => {
    if (!isTauri() || !preferencesReady) return;
    if (skipPreferenceSave.current) { skipPreferenceSave.current = false; return; }
    if (previewingPreferences.current) return;
    const timer = window.setTimeout(() => void invoke("save_preferences", { preferences }), 250);
    return () => clearTimeout(timer);
  }, [preferences, preferencesReady, preferenceCommitVersion]);

  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let stopListening: (() => void) | undefined;
    const updateMaximized = () => void appWindow.isMaximized().then(setWindowMaximized);
    updateMaximized();
    void appWindow.onResized(updateMaximized).then((unlisten) => { stopListening = unlisten; });
    return () => stopListening?.();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); navigateHistory("back"); return; }
      if (event.altKey && event.key === "ArrowRight") { event.preventDefault(); navigateHistory("forward"); return; }
      if (primaryModifier(event) && !event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); void chooseFile(); }
      if (primaryModifier(event) && event.key.toLowerCase() === "p") { event.preventDefault(); if (root) openFolderSearch(); }
      if (primaryModifier(event) && event.key.toLowerCase() === "f") { event.preventDefault(); setFindOpen(true); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "d") { event.preventDefault(); setPrintOptionsOpen(true); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault(); setRightTab("highlights"); if (narrow) setNarrowOutlineOpen(true); else setShowOutline(true);
      }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "m") { event.preventDefault(); captureHighlightSelection(true); }
      if (primaryModifier(event) && event.key === ",") { event.preventDefault(); setSettingsSection("reading"); setSettingsOpen(true); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "e") { event.preventDefault(); if (root) toggleTree(); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); if (doc) toggleOutline(); }
      if (event.key === "F11") { event.preventDefault(); void getCurrentWindow().isFullscreen().then((yes) => getCurrentWindow().setFullscreen(!yes)); }
      if (event.key === "Escape") {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
        if (document.querySelector(".image-lightbox")) return;
        if (highlightPopover) { event.preventDefault(); setHighlightPopover(null); moreTrigger.current?.focus(); return; }
        if (printOptionsOpen) { event.preventDefault(); setPrintOptionsOpen(false); moreTrigger.current?.focus(); return; }
        if (settingsOpen) { event.preventDefault(); closeSettings("escape"); }
        else if (searchOpen) closeFolderSearch();
        else if (findOpen) setFindOpen(false);
        else if (moreOpen) { setMoreOpen(false); moreTrigger.current?.focus(); }
        else if (openMenuOpen) { setOpenMenuOpen(false); openMenuTrigger.current?.focus(); }
        else if (narrowOutlineOpen) { setNarrowOutlineOpen(false); outlineTrigger.current?.focus(); }
        else if (narrowTreeOpen) { setNarrowTreeOpen(false); treeTrigger.current?.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chooseFile, closeFolderSearch, closeSettings, doc, findOpen, highlightPopover, isMainWindow, moreOpen, narrow, narrowOutlineOpen, narrowTreeOpen, navigateHistory, openFolderSearch, openMenuOpen, printOptionsOpen, root, searchOpen, settingsOpen, toggleOutline, toggleTree]);

  useEffect(() => {
    clearFindHighlights();
    if (!findOpen || !findQuery.trim() || !doc) {
      setFindMatches([]);
      setFindIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      const article = scrollRef.current?.querySelector<HTMLElement>(".markdown-body");
      const matches = article ? findTextRanges(article, findQuery) : [];
      setFindMatches(matches);
      setFindIndex(0);
      updateFindHighlights(matches, 0);
      if (pendingSearch.current && matches.length) { scrollToRange(matches[0]); pendingSearch.current = ""; }
    }, 100);
    return () => { window.clearTimeout(timer); clearFindHighlights(); };
  }, [doc, findOpen, findQuery]);

  useEffect(() => {
    updateFindHighlights(findMatches, findIndex);
  }, [findIndex, findMatches]);

  useEffect(() => () => clearFindHighlights(), []);

  useEffect(() => () => {
    if (telemetryFrame.current !== undefined) window.cancelAnimationFrame(telemetryFrame.current);
  }, []);

  function navigateFind(delta: number) {
    if (!findMatches.length) return;
    const next = (findIndex + delta + findMatches.length) % findMatches.length;
    setFindIndex(next);
    scrollToRange(findMatches[next]);
  }

  function captureHighlightSelection(show = false) {
    if (show && selectionDraft.current) { setHighlightPopover(selectionDraft.current); return; }
    if (!doc) return;
    const article = scrollRef.current?.querySelector<HTMLElement>(".markdown-body");
    const selection = globalThis.getSelection();
    if (!article || !selection || selection.isCollapsed) { selectionDraft.current = null; return; }
    const draft = selectionToHighlight(article, selection, doc.path, "yellow");
    if (!draft) { selectionDraft.current = null; return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const popover = {
      x: Math.max(116, Math.min(window.innerWidth - 116, rect.left + rect.width / 2)),
      y: Math.max(56, rect.top > 64 ? rect.top - 10 : rect.bottom + 46),
      draft
    };
    selectionDraft.current = popover;
    if (show) setHighlightPopover(popover);
  }

  function navigateToStoredHighlight(highlight: TextHighlight) {
    setRightTab("highlights");
    if (highlight.path !== documentRef.current?.path) {
      pendingHighlightId.current = highlight.id;
      void loadDocument(highlight.path);
      return;
    }
    const resolved = resolvedHighlights.find((item) => item.id === highlight.id);
    if (!scrollToHighlight(resolved)) notify("这条高亮在外部修改后已无法定位，可删除后重新选择");
  }

  function saveReadingPosition() {
    scheduleReadingTelemetry();
    if (!doc || !scrollRef.current) return;
    const anchor = captureTextAnchor(scrollRef.current);
    if (anchor) liveAnchor.current = { path: doc.path, generation: userScrollGeneration.current, anchor };
    window.clearTimeout(saveTimer.current);
    const path = doc.path;
    saveTimer.current = window.setTimeout(() => persistPosition(path), 300);
  }

  const updatePreferences = (next: ReaderPreferences) => { preserveAnchor(); setPreferences(next); };
  const minimizeWindow = () => { if (isTauri()) void getCurrentWindow().minimize(); };
  const toggleWindowMaximized = () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    void appWindow.toggleMaximize().then(() => appWindow.isMaximized()).then(setWindowMaximized);
  };
  const closeWindow = () => { if (isTauri()) void getCurrentWindow().close(); };
  const presentation = readerPresentation(preferences);
  const { effective, style: readerStyle } = presentation;
  const sidebarsHidden = focusMode;
  const modalOpen = searchOpen || printOptionsOpen;
  useEffect(() => {
    if (topbarRef.current) topbarRef.current.inert = modalOpen;
    if (workspaceRef.current) workspaceRef.current.inert = modalOpen;
  }, [modalOpen]);
  void historyVersion;

  const readingClasses = ["app", presentation.classes,
    preferences.pdfStyle === "current" ? "print-current-theme" : "",
    preferences.pdfIncludeHighlights ? "print-with-highlights" : "print-without-highlights",
    focusMode ? "focus-mode" : ""].filter(Boolean).join(" ");

  return <div className={readingClasses}>
    <style>{presentation.fontCss}</style>
    <header ref={topbarRef} className="topbar" data-tauri-drag-region>
      <button ref={treeTrigger} onClick={() => root ? toggleTree() : void chooseFolder()} aria-expanded={narrow ? narrowTreeOpen : showTree} title={shortcutLabel("文件列表 (Ctrl+Shift+E)")} aria-label="文件列表"><PanelLeftClose /><span>文件列表</span></button>
      <button onClick={() => navigateHistory("back")} disabled={!backHistory.current.length} title="后退 (Alt+←)"><ArrowLeft /></button>
      <button onClick={() => navigateHistory("forward")} disabled={!forwardHistory.current.length} title="前进 (Alt+→)"><ArrowRight /></button>
      <div className="open-file-group"><button onClick={() => void chooseFile()} title={shortcutLabel("打开文件 (Ctrl+O)")}><FileText /><span>打开文件</span></button>
        <div className="toolbar-menu-wrap"><button ref={openMenuTrigger} className="open-file-options" aria-label="打开选项" aria-haspopup="menu" aria-controls="open-menu" aria-expanded={openMenuOpen} onClick={() => { if (settingsOpen) closeSettings("switch"); setOpenMenuOpen((open) => !open); setMoreOpen(false); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpenMenuOpen(true); setMoreOpen(false); } }}><ChevronDown /></button>
          {openMenuOpen && <div ref={openMenu} id="open-menu" className="toolbar-menu" role="menu" aria-label="打开选项" onKeyDown={(event) => handleMenuKeys(event, (reason) => { setOpenMenuOpen(false); if (reason === "escape") openMenuTrigger.current?.focus(); })}>
            <button role="menuitem" onClick={() => { setOpenMenuOpen(false); void chooseFolder(); }}><FolderOpen />打开文件夹</button>
          </div>}
        </div>
      </div>
      <div className="document-title" data-tauri-drag-region title={doc?.path}>{doc?.name ?? (root ? rootName(root) : "静读 Markdown")}</div>
      {indexStatus?.running && <div className="index-progress"><span>{indexStatus.phase === "rebuild" ? "重建" : "索引"} {indexStatus.indexed}/{indexStatus.total || "?"}</span><button onClick={() => void invoke("cancel_index")} title="取消索引"><Ban /></button></div>}
      <button disabled={!doc} onClick={() => setFindOpen(true)} title={shortcutLabel("在当前文档中查找 (Ctrl+F)")} aria-label="在当前文档中查找"><Search /><span>查找</span></button>
      <button ref={outlineTrigger} disabled={!doc} onClick={toggleOutline} aria-expanded={narrow ? narrowOutlineOpen : showOutline} title={shortcutLabel("大纲 (Ctrl+Shift+O)")} aria-label="大纲"><PanelRightClose /><span>大纲</span></button>
      <button ref={settingsTrigger} aria-label="阅读设置" aria-expanded={settingsOpen && settingsSection === "reading"} onClick={() => { if (settingsOpen && settingsSection === "reading") closeSettings("toggle"); else { if (settingsOpen) closeSettings("switch"); setSettingsSection("reading"); setSettingsOpen(true); setOpenMenuOpen(false); setMoreOpen(false); } }} title={shortcutLabel("阅读设置 (Ctrl+,)")}><span className="aa-icon">Aa</span></button>
      <div className="toolbar-menu-wrap"><button ref={moreTrigger} aria-label="更多" aria-haspopup="menu" aria-controls="more-menu" aria-expanded={moreOpen} onClick={() => { if (settingsOpen) closeSettings("switch"); setMoreOpen((open) => !open); setOpenMenuOpen(false); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMoreOpen(true); setOpenMenuOpen(false); } }}><MoreHorizontal /></button>{moreOpen && <div ref={moreMenu} id="more-menu" className="toolbar-menu" role="menu" aria-label="更多操作" onKeyDown={(event) => handleMenuKeys(event, (reason) => { setMoreOpen(false); if (reason === "escape") moreTrigger.current?.focus(); })}>
        <button role="menuitem" disabled={!doc} onClick={() => { if (doc) openDocumentInNewWindow(doc.path); setMoreOpen(false); }}><AppWindow />在新窗口打开</button>
        <button role="menuitem" disabled={!doc} onClick={() => { setPrintOptionsOpen(true); setMoreOpen(false); }}><Printer />打印或导出 PDF</button>
        <button role="menuitem" onClick={() => { setFocusMode((value) => !value); setMoreOpen(false); }}><Focus />{focusMode ? "恢复两侧栏" : "隐藏两侧栏"}</button>
        <button role="menuitem" onClick={() => { setSettingsSection("system"); setSettingsOpen(true); setMoreOpen(false); }}><Database />应用设置</button>
        <button role="menuitem" onClick={() => { void getCurrentWindow().isFullscreen().then((yes) => getCurrentWindow().setFullscreen(!yes)); setMoreOpen(false); }}><Maximize2 />全屏</button>
        {doc && <button role="menuitem" onClick={() => { void invoke("open_external", { path: doc.path, editor: "default" }).catch((error) => notify(errorText(error))); setMoreOpen(false); }}><ExternalLink />用默认程序打开</button>}
      </div>}</div>
      {!isMac && <div className="window-controls" aria-label="窗口控制">
        <button className="window-control" onClick={minimizeWindow} title="最小化" aria-label="最小化"><Minus /></button>
        <button className="window-control" onClick={toggleWindowMaximized} title={windowMaximized ? "还原" : "最大化"} aria-label={windowMaximized ? "还原" : "最大化"}>{windowMaximized ? <Copy /> : <Square />}</button>
        <button className="window-control close" onClick={closeWindow} title="关闭窗口" aria-label="关闭窗口"><X /></button>
      </div>}
    </header>

    <main ref={workspaceRef} className="workspace">
      {!sidebarsHidden && (narrow ? narrowTreeOpen : showTree) && root && <aside ref={treeSidebar} className={`left-sidebar ${narrow ? "overlay-sidebar" : ""}`}><FileTree key={`${root}:${treeVersion}`} root={root} selected={doc?.path ?? null} onOpen={openDocument} onOpenNew={openDocumentInNewWindow} onSearch={openFolderSearch} onChooseFolder={() => void chooseFolder()} /></aside>}
      <section className="reader-pane">
        {doc && <div className="reading-progress-track" aria-label={`阅读进度 ${Math.round(readingProgress * 100)}%`}><span style={{ width: `${readingProgress * 100}%` }} /></div>}
        {findOpen && <div className="find-bar">
          <input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") navigateFind(event.shiftKey ? -1 : 1); }} placeholder="在当前文档中查找" />
          <span className="find-count">{findQuery ? (findMatches.length ? `${findIndex + 1}/${findMatches.length}` : "0/0") : ""}</span>
          <button onClick={() => navigateFind(-1)} disabled={!findMatches.length} title="上一个 (Shift+Enter)"><ChevronUp /></button>
          <button onClick={() => navigateFind(1)} disabled={!findMatches.length} title="下一个 (Enter)"><ChevronDown /></button>
          <button onClick={() => setFindOpen(false)} title="关闭"><X /></button>
        </div>}
        {doc ? <div ref={scrollRef} className="reader-scroll" style={readerStyle} onScroll={saveReadingPosition} onWheel={() => { userScrollGeneration.current++; }} onTouchStart={() => { userScrollGeneration.current++; }} onPointerDown={() => { userScrollGeneration.current++; }} onKeyDown={() => { userScrollGeneration.current++; }} onMouseUp={() => captureHighlightSelection()} onContextMenu={(event) => { if (!globalThis.getSelection()?.isCollapsed) { event.preventDefault(); captureHighlightSelection(true); } }}>
          <MarkdownReader document={doc} night={presentation.night} showFrontmatter={preferences.showFrontmatter} remoteImagePolicy={preferences.remoteImagePolicy} allowedRemoteHosts={preferences.allowedRemoteHosts} onAllowRemoteHost={allowRemoteHost} onOpenDocument={openDocument} />
        </div> : <div className="welcome">
          {root ? <><h1>选择一篇文档</h1><p>从文件列表中选择要阅读的 Markdown 文件。</p><button className="primary" onClick={() => narrow ? setNarrowTreeOpen(true) : setShowTree(true)}>打开文件列表</button></>
            : <><h1>打开 Markdown 开始阅读</h1><div className="welcome-actions"><button className="primary" onClick={() => void chooseFile()}><FileText />打开文件</button><button onClick={() => void chooseFolder()}><FolderOpen />打开文件夹</button></div></>}
          {!root && !!recentRoots.length && <div className="recent-roots"><strong><FolderClock />最近阅读</strong>{recentRoots.slice(0, 5).map((recent) => <button key={recent.path} onClick={() => void applyTarget(recent.path)} title={recent.path}><span>{rootName(recent.path)}</span><small>{recent.path}</small></button>)}</div>}
        </div>}
      </section>
      {!sidebarsHidden && (narrow ? narrowOutlineOpen : showOutline) && doc && <aside ref={outlineSidebar} className={`right-sidebar ${narrow ? "overlay-sidebar" : ""}`}>
        <div className="sidebar-tabs"><button className={rightTab === "outline" ? "active" : ""} onClick={() => setRightTab("outline")}>大纲</button><button className={rightTab === "highlights" ? "active" : ""} onClick={() => setRightTab("highlights")}>高亮 {resolvedHighlights.length > 0 && <span>{resolvedHighlights.length}</span>}</button></div>
        {rightTab === "outline" ? <>
          <nav className="outline">{outline.length <= 1 ? <div className="outline-empty">{outline[0] && <button onClick={() => navigateHeading(outline[0].id)}>返回文首</button>}<p>这篇文档没有分节。</p></div> : outline.map((item) => <button key={item.id} className={activeHeading === item.id ? "active" : ""} aria-current={activeHeading === item.id ? "location" : undefined} style={{ paddingLeft: `${10 + (item.level - 1) * 12}px` }} onClick={() => { navigateHeading(item.id); if (narrow) setNarrowOutlineOpen(false); }}>{item.text}</button>)}</nav></>
          : <div className="highlights-panel">
            <div className="highlight-section-title"><span>当前文档</span><small>{resolvedHighlights.filter((item) => !item.orphaned).length}/{resolvedHighlights.length}</small></div>
            {!resolvedHighlights.length && <p className="highlight-empty">选中正文后即可添加高亮。记录只保存在应用数据库中。</p>}
            {resolvedHighlights.map((item) => <div key={item.id} className={`highlight-card color-${item.color} ${item.orphaned ? "orphaned" : ""}`}>
              <button className="highlight-quote" onClick={() => navigateToStoredHighlight(item)} title={item.orphaned ? "原文变化后已无法定位" : "跳转到高亮"}><span>{item.quote}</span>{item.orphaned && <small>待恢复</small>}</button>
              <div className="highlight-card-actions">{HIGHLIGHT_COLORS.map((color) => <button key={color} className={`highlight-color color-${color} ${item.color === color ? "active" : ""}`} title={`改为${color}`} aria-label={`改为${color}`} onClick={() => void changeHighlightColor(item.id, color, item.path)} />)}<button className="highlight-delete" title="删除高亮" aria-label="删除高亮" onClick={() => void deleteHighlight(item.id, item.path)}><Trash2 /></button></div>
            </div>)}
            {!!recentHighlights.some((item) => item.path !== doc.path) && <><div className="highlight-section-title recent"><span>最近高亮</span></div>{recentHighlights.filter((item) => item.path !== doc.path).slice(0, 30).map((item) => <button key={item.id} className={`recent-highlight color-${item.color}`} onClick={() => navigateToStoredHighlight(item)}><small>{rootName(item.path)}</small><span>{item.quote}</span></button>)}</>}
          </div>}
      </aside>}
    </main>

    {searchOpen && root && <SearchPanel root={root} onOpen={(path, query) => { pendingSearch.current = query; setFindQuery(query); setFindOpen(true); openDocument(path); }} onOpenNew={openDocumentInNewWindow} onClose={closeFolderSearch} />}
    {settingsOpen && <div ref={settingsLayer}><SettingsPanel value={preferences} root={root} initialSection={settingsSection} sampleStyle={readerStyle} onChange={updatePreferences} onPreviewStart={() => { previewingPreferences.current = true; }} onPreviewEnd={endPreferencesPreview} onClose={(reason) => closeSettings(reason ?? "button")} /></div>}
    {printOptionsOpen && <div className="modal-backdrop" onMouseDown={() => { setPrintOptionsOpen(false); moreTrigger.current?.focus(); }}><section className="print-options-panel" role="dialog" aria-modal="true" aria-label="打印选项" onMouseDown={(event) => event.stopPropagation()} onKeyDown={trapTab}>
      <div className="settings-title"><h2>打印选项</h2><button onClick={() => { setPrintOptionsOpen(false); moreTrigger.current?.focus(); }} aria-label="关闭打印选项"><X /></button></div>
      <label>页面外观<select autoFocus value={preferences.pdfStyle} onChange={(event) => updatePreferences({ ...preferences, pdfStyle: event.target.value as ReaderPreferences["pdfStyle"] })}><option value="paper">清晰白纸</option><option value="current">沿用当前阅读外观</option></select></label>
      <label className="switch-row"><input type="checkbox" checked={preferences.pdfIncludeHighlights} onChange={(event) => updatePreferences({ ...preferences, pdfIncludeHighlights: event.target.checked })} />保留文本高亮</label>
      <button className="primary" onClick={() => { setPrintOptionsOpen(false); void exportPdf(); moreTrigger.current?.focus(); }}><Printer />继续打印</button>
    </section></div>}
    {highlightPopover && <div className="highlight-popover" style={{ left: highlightPopover.x, top: highlightPopover.y }} role="toolbar" aria-label="添加高亮" onMouseDown={(event) => event.preventDefault()}>
      {HIGHLIGHT_COLORS.map((color) => <button key={color} className={`highlight-color color-${color}`} title={`添加${color}高亮`} aria-label={`添加${color}高亮`} onClick={() => void createHighlight(highlightPopover.draft, color)} />)}
      <button className="highlight-cancel" title="取消" aria-label="取消" onClick={() => { globalThis.getSelection()?.removeAllRanges(); setHighlightPopover(null); }}><X /></button>
    </div>}
    {message && <div className="toast">{message}</div>}
  </div>;
}

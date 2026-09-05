import { isMac, primaryModifier, shortcutLabel } from "./lib/platform";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AppWindow, ArrowLeft, ArrowRight, Ban, BookOpen, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Copy, ExternalLink, Focus, FolderClock, FolderOpen, Maximize2, Minus,
  Highlighter, PanelLeftClose, PanelRightClose, Printer, Search, Settings, Square, TerminalSquare,
  Trash2, X
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
import { readerFontCss } from "./lib/fonts";
import { extractOutline } from "./lib/markdown";
import { isDarkTheme, migratePreferences } from "./lib/readerPreferences";
import { formatModifiedTime, readingMetrics } from "./lib/reading";
import type {
  DocumentPayload, ExternalChangeEvent, HighlightColor, IndexStatus, NewTextHighlight, OpenTarget,
  ReaderPreferences, ReadingPosition, RecentRoot, ResolvedHighlight, TextHighlight
} from "./types";
import { DEFAULT_PREFERENCES } from "./types";

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function rootName(path: string): string { return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path; }
type PreferencesChanged = { source: string; preferences: ReaderPreferences };
type HighlightsChanged = { path: string; source: string };
type HighlightPopover = { x: number; y: number; draft: NewTextHighlight };

export default function App() {
  const windowLabel = isTauri() ? getCurrentWindow().label : "main";
  const isMainWindow = windowLabel === "main";
  const [root, setRoot] = useState("");
  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(!isTauri());
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number>();
  const telemetryFrame = useRef<number>();
  const initialized = useRef(false);
  const startupConsumed = useRef(false);
  const skipPreferenceSave = useRef(false);
  const documentRef = useRef<DocumentPayload | null>(null);
  const rootRef = useRef("");
  const backHistory = useRef<string[]>([]);
  const forwardHistory = useRef<string[]>([]);
  const pendingHighlightId = useRef<number | null>(null);
  const outline = useMemo(() => doc ? extractOutline(doc.content) : [], [doc]);
  const metrics = useMemo(() => doc ? readingMetrics(doc.content) : null, [doc]);

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
    window.dispatchEvent(new Event("jingreader:expand-for-print"));
    notify(`${isMac ? "请在系统打印窗口的 PDF 菜单选择“存储为 PDF”" : preferences.pdfStyle === "current"
      ? "将沿用当前阅读预设；请在打印窗口选择 Microsoft Print to PDF，必要时开启“背景图形”"
      : "请在系统打印窗口选择 Microsoft Print to PDF 并指定保存位置"}${preferences.pdfIncludeHighlights ? "；将保留文本高亮" : "；不包含文本高亮"}`);
    const previousTitle = document.title;
    document.title = documentRef.current.name.replace(/\.(md|markdown)$/i, "") || "静读文档";
    const restore = () => { document.title = previousTitle; };
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
  }, [notify, preferences.pdfIncludeHighlights, preferences.pdfStyle]);

  const refreshRecentRoots = useCallback(() => {
    if (!isTauri()) return;
    void invoke<RecentRoot[]>("list_recent_roots").then(setRecentRoots).catch(() => undefined);
  }, []);

  const updateReadingTelemetry = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const maximum = Math.max(1, container.scrollHeight - container.clientHeight);
    setReadingProgress(Math.max(0, Math.min(1, container.scrollTop / maximum)));
    const headings = [...container.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")];
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

  const restorePosition = useCallback(async (path: string, hash?: string) => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const container = scrollRef.current;
    if (!container) return;
    if (hash) {
      document.getElementById(decodeURIComponent(hash))?.scrollIntoView();
      updateReadingTelemetry();
      return;
    }
    const saved = await invoke<ReadingPosition | null>("get_reading_position", { path });
    if (saved) {
      const heading = saved.headingId ? document.getElementById(saved.headingId) : null;
      if (heading) {
        const headings = [...container.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")];
        const index = headings.indexOf(heading);
        const nextTop = headings[index + 1]?.offsetTop ?? container.scrollHeight;
        container.scrollTop = heading.offsetTop + (nextTop - heading.offsetTop) * saved.headingRatio;
      } else {
        container.scrollTop = (container.scrollHeight - container.clientHeight) * saved.documentRatio;
      }
    }
    updateReadingTelemetry();
  }, [updateReadingTelemetry]);

  const loadDocument = useCallback(async (path: string, hash?: string, recordHistory = true) => {
    try {
      const current = documentRef.current;
      if (recordHistory && current && current.path !== path) {
        backHistory.current = [...backHistory.current.slice(-98), current.path];
        forwardHistory.current = [];
        setHistoryVersion((value) => value + 1);
      }
      const payload = await invoke<DocumentPayload>("read_document", { path });
      setDoc(payload);
      document.title = `${payload.name} · 静读 Markdown`;
      window.setTimeout(() => void restorePosition(payload.path, hash), 0);
    } catch (error) { notify(`无法打开文档：${errorText(error)}`); }
  }, [notify, restorePosition]);

  const openDocument = useCallback((path: string, hash?: string) => {
    void loadDocument(path, hash, true);
  }, [loadDocument]);

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
  }, [loadDocument, notify, refreshRecentRoots]);

  const applyTarget = useCallback(async (path: string) => {
    try {
      await applyResolvedTarget(await invoke<OpenTarget>("open_target", { path }));
    } catch (error) { notify(`无法打开：${errorText(error)}`); }
  }, [applyResolvedTarget, notify]);

  const chooseFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "选择 Markdown 文件夹" });
    if (typeof selected === "string") await applyTarget(selected);
  }, [applyTarget]);

  useEffect(() => { documentRef.current = doc; }, [doc]);

  useEffect(() => {
    setHighlightPopover(null);
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
      .then((saved) => setPreferences(migratePreferences(saved)))
      .finally(() => setPreferencesReady(true));
    refreshRecentRoots();
    invoke<OpenTarget | null>("consume_window_target").then((target) => {
      if (target) void applyResolvedTarget(target, false);
    });
  }, [applyResolvedTarget, applyTarget, isMainWindow, refreshRecentRoots]);

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
        skipPreferenceSave.current = true;
        setPreferences(migratePreferences(payload.preferences));
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
  }, [applyTarget, isMainWindow, loadDocument, notify, refreshHighlights, windowLabel]);

  useEffect(() => {
    if (!isTauri() || !preferencesReady) return;
    if (skipPreferenceSave.current) { skipPreferenceSave.current = false; return; }
    const timer = window.setTimeout(() => void invoke("save_preferences", { preferences }), 250);
    return () => clearTimeout(timer);
  }, [preferences, preferencesReady]);

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
      if (primaryModifier(event) && !event.shiftKey && event.key.toLowerCase() === "o" && isMainWindow) { event.preventDefault(); void chooseFolder(); }
      if (primaryModifier(event) && event.key.toLowerCase() === "p") { event.preventDefault(); if (root) setSearchOpen(true); }
      if (primaryModifier(event) && event.key.toLowerCase() === "f") { event.preventDefault(); setFindOpen(true); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "d") { event.preventDefault(); exportPdf(); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "h") {
        event.preventDefault(); setRightTab("highlights"); setPreferences((p) => ({ ...p, showOutline: true }));
      }
      if (primaryModifier(event) && event.key === ",") { event.preventDefault(); setSettingsOpen(true); }
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "e") setPreferences((p) => ({ ...p, showTree: !p.showTree }));
      if (primaryModifier(event) && event.shiftKey && event.key.toLowerCase() === "o") setPreferences((p) => ({ ...p, showOutline: !p.showOutline }));
      if (event.key === "F11") { event.preventDefault(); void getCurrentWindow().isFullscreen().then((yes) => getCurrentWindow().setFullscreen(!yes)); }
      if (event.key === "Escape") { setSearchOpen(false); setSettingsOpen(false); setFindOpen(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chooseFolder, exportPdf, isMainWindow, navigateHistory, root]);

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

  function captureHighlightSelection(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !doc) return;
    const article = scrollRef.current?.querySelector<HTMLElement>(".markdown-body");
    const selection = globalThis.getSelection();
    if (!article || !selection || selection.isCollapsed) { setHighlightPopover(null); return; }
    const draft = selectionToHighlight(article, selection, doc.path, "yellow");
    if (!draft) { setHighlightPopover(null); return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setHighlightPopover({
      x: Math.max(116, Math.min(window.innerWidth - 116, rect.left + rect.width / 2)),
      y: Math.max(56, rect.top > 64 ? rect.top - 10 : rect.bottom + 46),
      draft
    });
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
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const container = scrollRef.current!;
      const headings = [...container.querySelectorAll<HTMLElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")];
      const top = container.scrollTop + 24;
      let active: HTMLElement | undefined;
      for (const heading of headings) { if (heading.offsetTop <= top) active = heading; else break; }
      const index = active ? headings.indexOf(active) : -1;
      const nextTop = headings[index + 1]?.offsetTop ?? container.scrollHeight;
      const headingRatio = active ? Math.max(0, Math.min(1, (top - active.offsetTop) / Math.max(1, nextTop - active.offsetTop))) : 0;
      const documentRatio = container.scrollTop / Math.max(1, container.scrollHeight - container.clientHeight);
      void invoke("save_reading_position", { position: { path: doc.path, headingId: active?.id ?? null, headingRatio, documentRatio } });
    }, 300);
  }

  const updatePreferences = (next: ReaderPreferences) => setPreferences(next);
  const minimizeWindow = () => { if (isTauri()) void getCurrentWindow().minimize(); };
  const toggleWindowMaximized = () => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    void appWindow.toggleMaximize().then(() => appWindow.isMaximized()).then(setWindowMaximized);
  };
  const closeWindow = () => { if (isTauri()) void getCurrentWindow().close(); };
  const fallbackFonts = preferences.fontFamily === "serif"
    ? '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", SimSun, serif'
    : '"Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", system-ui, sans-serif';
  const customFonts = [preferences.chineseFont && '"JingReader CJK"', preferences.latinFont && '"JingReader Latin"', fallbackFonts].filter(Boolean).join(", ");
  const headingFallback = preferences.fontFamily === "serif"
    ? 'Georgia, "Noto Serif CJK SC", "Songti SC", serif'
    : 'Inter, "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';
  const headingFont = [preferences.headingFont && '"JingReader Heading"', headingFallback].filter(Boolean).join(", ");
  const codeFont = [preferences.codeFont && '"JingReader Code"', '"Cascadia Code", "JetBrains Mono", Consolas, Menlo, monospace'].filter(Boolean).join(", ");
  const headingSpace = preferences.headingDensity === "compact" ? 0.78 : preferences.headingDensity === "airy" ? 1.2 : 1;
  const readerStyle = {
    "--reader-size": `${preferences.fontSize}px`, "--reader-leading": preferences.lineHeight,
    "--reader-width": `${preferences.contentWidth}px`, "--paragraph-space": `${preferences.paragraphSpacing}em`,
    "--reader-font": customFonts, "--heading-font": headingFont, "--code-font": codeFont,
    "--heading-scale": preferences.headingScale, "--heading-space": headingSpace,
    "--first-line-indent": `${preferences.firstLineIndent}em`, "--reader-align": preferences.textAlign,
    "--reader-tracking": `${preferences.letterSpacing}em`, "--reader-warmth": `${preferences.backgroundWarmth}%`,
    "--text-contrast": `${preferences.textContrast}%`, "--code-scale": `${preferences.codeScale}em`,
    "--formula-scale": `${preferences.formulaScale}em`, "--image-brightness": `${preferences.imageBrightness}%`
  } as React.CSSProperties;
  const sidebarsHidden = focusMode;
  void historyVersion;

  const readingClasses = [
    `app theme-${preferences.theme} font-${preferences.fontFamily}`,
    `paragraph-${preferences.paragraphStyle}`, `quote-${preferences.quoteStyle}`,
    `table-${preferences.tableStyle}`, `image-${preferences.imageStyle}`,
    `reading-focus-${preferences.readingFocus}`,
    preferences.codeWrap ? "code-wrap" : "", preferences.pdfStyle === "current" ? "print-current-theme" : "",
    preferences.pdfIncludeHighlights ? "print-with-highlights" : "print-without-highlights",
    focusMode ? "focus-mode" : ""
  ].filter(Boolean).join(" ");

  return <div className={readingClasses}>
    <style>{readerFontCss(preferences.chineseFont, preferences.latinFont, preferences.headingFont, preferences.codeFont)}</style>
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region><BookOpen /><span data-tauri-drag-region>静读 Markdown</span></div>
      <button onClick={() => navigateHistory("back")} disabled={!backHistory.current.length} title="后退 (Alt+←)"><ArrowLeft /></button>
      <button onClick={() => navigateHistory("forward")} disabled={!forwardHistory.current.length} title="前进 (Alt+→)"><ArrowRight /></button>
      {isMainWindow && <button onClick={() => void chooseFolder()} title={shortcutLabel("打开文件夹 (Ctrl+O)")}><FolderOpen /><span>打开文件夹</span></button>}
      <div className="document-title" data-tauri-drag-region title={doc?.path}>{doc?.name ?? (root || "不接管目录的长文阅读器")}</div>
      {indexStatus?.running && <div className="index-progress"><span>{indexStatus.phase === "rebuild" ? "重建" : "索引"} {indexStatus.indexed}/{indexStatus.total || "?"}</span><button onClick={() => void invoke("cancel_index")} title="取消索引"><Ban /></button></div>}
      <button disabled={!root} onClick={() => setSearchOpen(true)} title={shortcutLabel("全文搜索 (Ctrl+P)")}><Search /></button>
      <button onClick={() => setPreferences((p) => ({ ...p, showTree: !p.showTree }))} title="文件树"><PanelLeftClose /></button>
      <button onClick={() => setPreferences((p) => ({ ...p, showOutline: !p.showOutline }))} title="大纲"><PanelRightClose /></button>
      <button className={focusMode ? "active" : ""} onClick={() => setFocusMode((value) => !value)} title="专注模式"><Focus /></button>
      <button onClick={() => void getCurrentWindow().isFullscreen().then((yes) => getCurrentWindow().setFullscreen(!yes))} title="全屏 (F11)"><Maximize2 /></button>
      <button disabled={!doc} onClick={() => { if (doc) openDocumentInNewWindow(doc.path); }} title="在新窗口打开当前文档"><AppWindow /></button>
      <button disabled={!doc} className={rightTab === "highlights" && preferences.showOutline ? "active" : ""} onClick={() => { setRightTab("highlights"); setPreferences((p) => ({ ...p, showOutline: true })); }} title={shortcutLabel("高亮记录 (Ctrl+Shift+H)")} aria-label="高亮记录"><Highlighter /></button>
      <button disabled={!doc} onClick={() => void exportPdf()} title={shortcutLabel("导出 PDF (Ctrl+Shift+D)")} aria-label="导出 PDF"><Printer /></button>
      <button onClick={() => setSettingsOpen(true)} title={shortcutLabel("阅读设置 (Ctrl+,)")}><Settings /></button>
      {!isMac && <div className="window-controls" aria-label="窗口控制">
        <button className="window-control" onClick={minimizeWindow} title="最小化" aria-label="最小化"><Minus /></button>
        <button className="window-control" onClick={toggleWindowMaximized} title={windowMaximized ? "还原" : "最大化"} aria-label={windowMaximized ? "还原" : "最大化"}>{windowMaximized ? <Copy /> : <Square />}</button>
        <button className="window-control close" onClick={closeWindow} title="关闭窗口" aria-label="关闭窗口"><X /></button>
      </div>}
    </header>

    <main className="workspace">
      {!sidebarsHidden && preferences.showTree && root && <aside className="left-sidebar"><FileTree key={`${root}:${treeVersion}`} root={root} selected={doc?.path ?? null} onOpen={openDocument} onOpenNew={openDocumentInNewWindow} /></aside>}
      <section className="reader-pane">
        {doc && <div className="reading-progress-track" aria-label={`阅读进度 ${Math.round(readingProgress * 100)}%`}><span style={{ width: `${readingProgress * 100}%` }} /></div>}
        {findOpen && <div className="find-bar">
          <input autoFocus value={findQuery} onChange={(event) => setFindQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") navigateFind(event.shiftKey ? -1 : 1); }} placeholder="在当前文档中查找" />
          <span className="find-count">{findQuery ? (findMatches.length ? `${findIndex + 1}/${findMatches.length}` : "0/0") : ""}</span>
          <button onClick={() => navigateFind(-1)} disabled={!findMatches.length} title="上一个 (Shift+Enter)"><ChevronUp /></button>
          <button onClick={() => navigateFind(1)} disabled={!findMatches.length} title="下一个 (Enter)"><ChevronDown /></button>
          <button onClick={() => setFindOpen(false)} title="关闭"><X /></button>
        </div>}
        {doc ? <div ref={scrollRef} className="reader-scroll" style={readerStyle} onScroll={saveReadingPosition} onMouseUp={captureHighlightSelection}>
          <MarkdownReader document={doc} night={isDarkTheme(preferences.theme)} showFrontmatter={preferences.showFrontmatter} remoteImagePolicy={preferences.remoteImagePolicy} allowedRemoteHosts={preferences.allowedRemoteHosts} onAllowRemoteHost={allowRemoteHost} onOpenDocument={openDocument} />
          <footer className="document-footer">
            {preferences.showReadingStats && metrics && <div className="reading-stats">
              <span>{metrics.characters.toLocaleString("zh-CN")} 字符</span>
              <span>约 {metrics.minutes} 分钟</span>
              <span title="文件最后修改时间">修改于 {formatModifiedTime(doc.modifiedMs)}</span>
            </div>}
            <span className="footer-progress">{Math.round(readingProgress * 100)}%</span>
            <button onClick={exportPdf} title={shortcutLabel("导出 PDF (Ctrl+Shift+D)")}><Printer />导出 PDF</button>
            <button onClick={() => void invoke("open_external", { path: doc.path, editor: "default" }).catch((error) => notify(errorText(error)))}><ExternalLink />{isMac ? "文本编辑" : "默认程序"}</button>
            <button onClick={() => void invoke("open_external", { path: doc.path, editor: "vscode" }).catch((error) => notify(errorText(error)))}><TerminalSquare />VS Code</button>
          </footer>
        </div> : <div className="welcome">
          <div className="welcome-mark"><BookOpen /></div><h1>安静地读完一篇长文</h1>
          <p>不建立 vault，不安装插件，也不会在资料目录留下配置。</p>
          <button className="primary" onClick={() => void chooseFolder()}><FolderOpen />打开一个文件夹</button>
          {!!recentRoots.length && <div className="recent-roots"><strong><FolderClock />最近阅读</strong>{recentRoots.slice(0, 5).map((recent) => <button key={recent.path} onClick={() => void applyTarget(recent.path)} title={recent.path}><span>{rootName(recent.path)}</span><small>{recent.path}</small></button>)}</div>}
          <small>也可以在资源管理器中右键文件夹或 Markdown 文件打开</small>
        </div>}
      </section>
      {!sidebarsHidden && preferences.showOutline && doc && <aside className="right-sidebar">
        <div className="sidebar-tabs"><button className={rightTab === "outline" ? "active" : ""} onClick={() => setRightTab("outline")}>本文大纲</button><button className={rightTab === "highlights" ? "active" : ""} onClick={() => setRightTab("highlights")}>高亮 <span>{resolvedHighlights.length}</span></button></div>
        {rightTab === "outline" ? <><div className="sidebar-heading">本文大纲 <span>{Math.round(readingProgress * 100)}%</span></div>
          <nav className="outline">{outline.map((item) => <button key={item.id} className={activeHeading === item.id ? "active" : ""} aria-current={activeHeading === item.id ? "location" : undefined} style={{ paddingLeft: `${10 + (item.level - 1) * 12}px` }} onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" })}>{item.text}</button>)}</nav></>
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

    {!preferences.showTree && !focusMode && root && <button className="edge-toggle left" onClick={() => setPreferences((p) => ({ ...p, showTree: true }))}><ChevronRight /></button>}
    {!preferences.showOutline && !focusMode && doc && <button className="edge-toggle right" onClick={() => setPreferences((p) => ({ ...p, showOutline: true }))}><ChevronLeft /></button>}
    {searchOpen && root && <SearchPanel root={root} onOpen={openDocument} onOpenNew={openDocumentInNewWindow} onClose={() => setSearchOpen(false)} />}
    {settingsOpen && <SettingsPanel value={preferences} root={root} onChange={updatePreferences} onClose={() => setSettingsOpen(false)} />}
    {highlightPopover && <div className="highlight-popover" style={{ left: highlightPopover.x, top: highlightPopover.y }} role="toolbar" aria-label="添加高亮" onMouseDown={(event) => event.preventDefault()}>
      {HIGHLIGHT_COLORS.map((color) => <button key={color} className={`highlight-color color-${color}`} title={`添加${color}高亮`} aria-label={`添加${color}高亮`} onClick={() => void createHighlight(highlightPopover.draft, color)} />)}
      <button className="highlight-cancel" title="取消" aria-label="取消" onClick={() => { globalThis.getSelection()?.removeAllRanges(); setHighlightPopover(null); }}><X /></button>
    </div>}
    {message && <div className="toast">{message}</div>}
  </div>;
}

import { Children, cloneElement, createContext, createElement, isValidElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ImagePreview from "./ImagePreview";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import DOMPurify from "dompurify";
import { useTabInvoke } from "../lib/tabContext";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, Code2, Image as ImageIcon, Maximize2, SlidersHorizontal } from "lucide-react";
import type { AssetPayload, DocumentPayload } from "../types";
import { isExternalUrl, resolveLocalPath } from "../lib/paths";
import { holdImageResizeScroll } from "../lib/imageResizeScroll";
import { imageSizeKey, readImageWidth, saveImageWidth } from "../lib/imageSizing";
import { useOutsideDismiss } from "../lib/useOutsideDismiss";
import { normalizeTexDelimiters, remarkCallouts, remarkHeadingIds, remarkSanitizeHtml, remarkWikiLinks, splitFrontmatter } from "../lib/markdown";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    blockquote: [["dataCallout", /^(note|tip|important|warning|caution|info|example|quote)$/]],
    a: [...(defaultSchema.attributes?.a ?? []), "id"]
  }
};
const ReaderNightContext = createContext(false);
const markdownPlugins = [remarkGfm, remarkMath, remarkFrontmatter, remarkWikiLinks, remarkCallouts, remarkHeadingIds, remarkSanitizeHtml];
const htmlPlugins: PluggableList = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]];

function useVisible<T extends HTMLElement>(rootMargin = "500px") {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const reveal = () => setVisible(true);
    window.addEventListener("jingreader:expand-for-print", reveal);
    return () => window.removeEventListener("jingreader:expand-for-print", reveal);
  }, []);
  return { ref, visible };
}

type RemoteImagePolicy = "ask" | "allow" | "block";

function remoteHost(source: string): string {
  try { return new URL(source).hostname.toLocaleLowerCase(); }
  catch { return ""; }
}

function LocalImage({ documentPath, source, alt, remotePolicy, allowedRemoteHosts, onAllowRemoteHost, loadMargin }: {
  documentPath: string;
  source: string;
  alt?: string;
  remotePolicy: RemoteImagePolicy;
  allowedRemoteHosts: string[];
  onAllowRemoteHost: (host: string) => void;
  loadMargin: string;
}) {
  const invoke = useTabInvoke();
  const { ref, visible } = useVisible<HTMLSpanElement>(loadMargin);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [allowOnce, setAllowOnce] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sizeKey = imageSizeKey(documentPath, source);
  const [displayWidth, setDisplayWidth] = useState(() => readImageWidth(sizeKey));
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const [renderedWidth, setRenderedWidth] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const resizeRef = useRef<{ x: number; y: number; width: number } | null>(null);
  const scrollHold = useRef<ReturnType<typeof holdImageResizeScroll> | null>(null);
  const finishResize = () => { resizeRef.current = null; scrollHold.current?.finish(); scrollHold.current = null; };
  useLayoutEffect(() => { scrollHold.current?.stabilize(); }, [displayWidth]);
  useEffect(() => () => { scrollHold.current?.finish(); }, []);
  const percent = displayWidth ?? (naturalWidth ? Math.round(renderedWidth / naturalWidth * 100) : 100);
  const [scaleDraft, setScaleDraft] = useState(String(percent));
  useEffect(() => setScaleDraft(String(percent)), [percent]);
  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const observer = new ResizeObserver(() => setRenderedWidth(image.getBoundingClientRect().width));
    observer.observe(image);
    return () => observer.disconnect();
  }, [url, collapsed]);
  const [sizing, setSizing] = useState(false);
  const actionsRef = useRef<HTMLSpanElement>(null);
  useOutsideDismiss(sizing, [actionsRef], () => setSizing(false));
  const changeWidth = (width: number | null) => {
    setDisplayWidth(width);
    saveImageWidth(sizeKey, width);
  };
  const previewCaller = useRef<HTMLElement | null>(null);
  const printCollapsed = useRef(false);
  const isRemote = /^https?:/i.test(source);
  const host = isRemote ? remoteHost(source) : "";
  const remoteAllowed = remotePolicy !== "block" && (remotePolicy === "allow" || allowedRemoteHosts.includes(host) || allowOnce);

  useEffect(() => {
    setUrl("");
    setError(false);
    setCollapsed(false);
    if (!visible) return;
    if (/^data:/i.test(source)) { setUrl(source); return; }
    let objectUrl = "";
    const command = isRemote ? "read_remote_image" : "read_asset";
    const args = isRemote ? { url: source } : { documentPath, path: resolveLocalPath(documentPath, source) };
    if (isRemote && !remoteAllowed) return;
    invoke<AssetPayload>(command, args)
      .then((payload) => {
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mime }));
        setUrl(objectUrl);
      }).catch(() => setError(true));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [documentPath, isRemote, remoteAllowed, source, visible]);

  useEffect(() => {
    if (!zoomed) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setZoomed(false); window.setTimeout(() => previewCaller.current?.focus(), 0); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomed]);
  useEffect(() => {
    const expand = () => { printCollapsed.current = collapsed; setCollapsed(false); };
    const restore = () => setCollapsed(printCollapsed.current);
    window.addEventListener("jingreader:expand-for-print", expand);
    window.addEventListener("jingreader:restore-after-print", restore);
    return () => { window.removeEventListener("jingreader:expand-for-print", expand); window.removeEventListener("jingreader:restore-after-print", restore); };
  }, [collapsed]);

  const imageLabel = alt?.trim() || source.split(/[\\/]/).pop() || "图片";
  const closePreview = () => { setZoomed(false); window.setTimeout(() => previewCaller.current?.focus(), 0); };

  return <span ref={ref} className={`image-frame ${collapsed ? "is-collapsed" : ""}`}>
    {url ? <>{collapsed
      ? <span className="collapsed-media"><ImageIcon /><span title={imageLabel}>{imageLabel}</span><button type="button" onClick={() => setCollapsed(false)} title="展开图片"><ChevronRight />展开图片</button></span>
      : <><span ref={actionsRef} className={`image-actions ${sizing ? "is-sizing" : ""}`} aria-label="图片操作" onKeyDown={(event) => {
        if (event.key === "Escape" && sizing) {
          event.stopPropagation();
          setSizing(false);
          actionsRef.current?.querySelector<HTMLButtonElement>(".image-size-toggle")?.focus();
        }
      }}>
        <button type="button" onClick={() => { setSizing(false); setCollapsed(true); }} title="折叠图片"><ChevronDown />折叠</button>
        <button className="image-size-toggle" type="button" onClick={() => setSizing((value) => !value)} aria-expanded={sizing} title="调整显示大小"><SlidersHorizontal />大小</button>
        {sizing && <span className="image-size-panel" role="group" aria-label="图片显示大小">
          <label><span>原图缩放（%）</span>
            <input type="number" min="1" max="400" step="1" value={scaleDraft} aria-label="原图缩放百分比" onChange={(event) => { setScaleDraft(event.target.value); const value = Number(event.target.value); if (value >= 1 && value <= 400) changeWidth(value); }} onBlur={() => setScaleDraft(String(percent))} />
          </label>
          <span>100% 为原始尺寸；也可拖动图片任意角落。</span>
          <button type="button" onClick={() => changeWidth(100)}>原始大小（100%）</button>
          <button type="button" onClick={() => changeWidth(null)} disabled={displayWidth === null}>适应正文</button>
        </span>}
      </span><span className="image-viewport"><span className="image-surface" style={{ width: naturalWidth ? displayWidth === null && naturalHeight ? `min(${naturalWidth}px, ${70 * naturalWidth / naturalHeight}vh)` : `${naturalWidth * (displayWidth ?? 100) / 100}px` : undefined, maxWidth: displayWidth === null ? "100%" : "none" }}>
        <img ref={imageRef} src={url} alt={alt ?? ""} draggable={false} tabIndex={0} loading="lazy" referrerPolicy="no-referrer" onLoad={(event) => { setNaturalWidth(event.currentTarget.naturalWidth); setNaturalHeight(event.currentTarget.naturalHeight); setRenderedWidth(event.currentTarget.getBoundingClientRect().width); }} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !event.currentTarget.closest("a")) { event.preventDefault(); previewCaller.current = event.currentTarget; setZoomed(true); } }} onClick={(event) => { if (event.currentTarget.closest("a")) return; event.preventDefault(); event.stopPropagation(); previewCaller.current = event.currentTarget; setZoomed(true); }} />
        {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner, index) => <button key={corner} className={`image-resize-handle ${corner}`} type="button" aria-label={`${["左上角", "右上角", "左下角", "右下角"][index]}拖动缩放图片`} title={`${["左上角", "右上角", "左下角", "右下角"][index]}拖动缩放图片 · ${percent}%（双击恢复 100%）`} onClick={(event) => event.stopPropagation()} onDoubleClick={() => changeWidth(100)} onKeyDown={(event) => { if (["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp"].includes(event.key)) { event.preventDefault(); changeWidth(Math.max(1, Math.min(400, percent + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -5 : 5)))); } }} onPointerDown={(event) => { if (event.button !== 0 || !naturalWidth) return; event.preventDefault(); event.stopPropagation(); scrollHold.current = holdImageResizeScroll(event.currentTarget); resizeRef.current = { x: event.clientX, y: event.clientY, width: imageRef.current?.getBoundingClientRect().width ?? naturalWidth }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const drag = resizeRef.current; if (!drag) return; const dx = (event.clientX - drag.x) * (corner.endsWith("left") ? -1 : 1); const dy = (event.clientY - drag.y) * (corner.startsWith("top") ? -1 : 1) * (naturalWidth / (naturalHeight || naturalWidth)); const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy; changeWidth(Math.max(1, Math.min(400, Math.round((drag.width + delta) / naturalWidth * 100)))); }} onPointerUp={(event) => { finishResize(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={finishResize} onLostPointerCapture={finishResize}><Maximize2 /></button>)}
      </span></span></>}
      {zoomed && createPortal(<ImagePreview src={url} alt={alt || "图片预览"} onClose={closePreview} />, globalThis.document.body)}</>
      : error ? <span className="broken-image">图片无法读取：{source}</span>
      : isRemote && remotePolicy === "block" ? <span className="image-placeholder remote-image-consent">远程图片已阻止<small>{host}</small></span>
      : isRemote && !remoteAllowed ? <span className="image-placeholder remote-image-consent">此文档引用了远程图片<small>{host}</small><span><button onClick={() => setAllowOnce(true)}>仅加载这张</button><button onClick={() => onAllowRemoteHost(host)}>始终允许此站点</button></span></span>
      : <span className="image-placeholder">图片加载中…</span>}
  </span>;
}

function CollapsibleCodeBlock({ children, language, lines, wide }: { children: ReactNode; language: string; lines: number; wide: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const label = language || "代码";
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);
  return <div className={`code-block ${wide ? "is-wide" : ""} ${lines <= 3 ? "is-short" : ""} ${collapsed ? "is-collapsed" : ""}`}>
    <div className="code-block-toolbar"><span><Code2 />{label}<small>{lines} 行</small></span><button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} title={collapsed ? "展开代码块" : "折叠代码块"}>{collapsed ? <ChevronRight /> : <ChevronDown />}{collapsed ? "展开" : "折叠"}</button></div>
    {!collapsed && <pre role="region" aria-label={`${label}代码，可横向滚动`} tabIndex={0}>{children}</pre>}
  </div>;
}

const CALLOUT_TITLES: Record<string, string> = { note: "说明", tip: "提示", important: "重要", warning: "警告", caution: "注意", info: "信息", example: "示例", quote: "引用" };

function CalloutBlock({ children, calloutKind }: { children?: ReactNode; calloutKind?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);
  const parts = Children.toArray(children);
  const first = parts[0];
  if (calloutKind) return <aside className={`callout callout-${calloutKind}`}><button className="callout-heading" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>{collapsed ? <ChevronRight /> : <ChevronDown />}<strong>{CALLOUT_TITLES[calloutKind] || calloutKind}</strong></button>{!collapsed && <div className="callout-body">{children}</div>}</aside>;
  if (!isValidElement<{ children?: ReactNode }>(first)) return <blockquote>{children}</blockquote>;
  const firstChildren = Children.toArray(first.props.children);
  const marker = typeof firstChildren[0] === "string" ? /^\[!([A-Za-z]+)\][+-]?\s*/.exec(firstChildren[0]) : null;
  if (!marker) return <blockquote>{children}</blockquote>;
  const kind = marker[1].toLowerCase();
  const cleaned = cloneElement(first, { children: [String(firstChildren[0]).slice(marker[0].length), ...firstChildren.slice(1)] });
  const body = [cleaned, ...parts.slice(1)];
  return <aside className={`callout callout-${kind}`}><button className="callout-heading" type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}>{collapsed ? <ChevronRight /> : <ChevronDown />}<strong>{CALLOUT_TITLES[kind] || marker[1]}</strong></button>{!collapsed && <div className="callout-body">{body}</div>}</aside>;
}

function CollapsibleHeading({ level, id, children }: { level: number; id?: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const affected: HTMLElement[] = [];
    let sibling = ref.current?.nextElementSibling as HTMLElement | null;
    while (sibling) {
      const match = /^H([1-6])$/.exec(sibling.tagName);
      if (match && Number(match[1]) <= level) break;
      affected.push(sibling);
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    const marker = id ?? `heading-${level}`;
    for (const element of affected) {
      const owners = new Set((element.dataset.sectionHiddenBy ?? "").split(" ").filter(Boolean));
      if (collapsed) owners.add(marker); else owners.delete(marker);
      if (owners.size) { element.dataset.sectionHiddenBy = [...owners].join(" "); element.setAttribute("data-section-hidden", ""); }
      else { delete element.dataset.sectionHiddenBy; element.removeAttribute("data-section-hidden"); }
    }
    return () => { for (const element of affected) { const owners = new Set((element.dataset.sectionHiddenBy ?? "").split(" ").filter(Boolean)); owners.delete(marker); if (owners.size) element.dataset.sectionHiddenBy = [...owners].join(" "); else { delete element.dataset.sectionHiddenBy; element.removeAttribute("data-section-hidden"); } } };
  }, [collapsed, id, level]);
  useEffect(() => {
    const reveal = (event: Event) => {
      const target = (event as CustomEvent<HTMLElement>).detail;
      const heading = ref.current;
      if (!heading || !target || heading === target) return;
      let sibling = heading.nextElementSibling;
      while (sibling) {
        const match = /^H([1-6])$/.exec(sibling.tagName);
        if (match && Number(match[1]) <= level) break;
        if (sibling === target || sibling.contains(target)) { setCollapsed(false); break; }
        sibling = sibling.nextElementSibling;
      }
    };
    window.addEventListener("jingreader:reveal-heading", reveal);
    return () => window.removeEventListener("jingreader:reveal-heading", reveal);
  }, [level]);
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);
  return createElement(`h${level}`, { id, ref, className: collapsed ? "section-collapsed" : undefined }, <button type="button" className="section-fold-button" title={collapsed ? "展开本节" : "折叠本节"} aria-label={collapsed ? "展开本节" : "折叠本节"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight /> : <ChevronDown />}</button>, children);
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children).find(isValidElement);
  const props = child?.props as { className?: string; children?: ReactNode } | undefined;
  const className = props?.className ?? "";
  if (className.includes("math-") || className.includes("language-math") || className.includes("language-mermaid")) return <>{children}</>;
  const language = /language-([^\s]+)/.exec(className)?.[1] ?? "";
  const value = String(props?.children ?? "").replace(/\n$/, "");
  const lines = value.split("\n");
  return <CollapsibleCodeBlock language={language} lines={Math.max(1, lines.length)} wide={lines.some((line) => [...line].length > 72)}>{children}</CollapsibleCodeBlock>;
}

function ScrollableTable({ children }: { children?: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const table = element.querySelector("table");
    if (table) {
      const rows = [...table.rows];
      // Leave author-supplied spanning cells alone; ordinary Markdown columns
      // can use their content to avoid turning sentences into vertical strips.
      if (rows.every((row) => [...row.cells].every((cell) => cell.colSpan === 1 && cell.rowSpan === 1))) {
        for (let column = 0; column < (rows[0]?.cells.length ?? 0); column++) {
          const cells = rows.map((row) => row.cells[column]).filter(Boolean);
          const values = cells.slice(1).map((cell) => cell.textContent?.trim() ?? "").filter(Boolean);
          const longest = values.reduce((max, value) => Math.max(max, [...value].length), 0);
          const kind = values.length && values.every((value) => /^\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?$/.test(value)) ? "date"
            : longest > 18 ? "prose" : longest <= 6 ? "compact" : "normal";
          cells.forEach((cell) => { cell.dataset.columnKind = kind; });
        }
      }
    }
    const measure = () => {
      setOverflow(Math.max(0, element.scrollWidth - element.clientWidth));
      setOffset(element.scrollLeft);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (table) observer?.observe(table);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [children]);
  return <div className="table-frame">
    {overflow > 1 && <div className="table-scroll-control">
      <span>横向查看表格</span>
      <input type="range" aria-label="表格横向位置" min={0} max={overflow} value={offset}
        onChange={(event) => { if (viewport.current) viewport.current.scrollLeft = Number(event.target.value); setOffset(Number(event.target.value)); }} />
    </div>}
    <div ref={viewport} className="table-scroll" role="region" aria-label="表格，可横向滚动" tabIndex={0} onScroll={(event) => setOffset(event.currentTarget.scrollLeft)}>
      <table>{children}</table>
    </div>
  </div>;
}

function LazyCode({ language, value, loadMargin }: { language: string; value: string; loadMargin: string }) {
  const { ref, visible } = useVisible<HTMLElement>(loadMargin);
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!visible) return;
    import("highlight.js").then(({ default: hljs }) => {
      try { setHtml(language && hljs.getLanguage(language) ? hljs.highlight(value, { language }).value : hljs.highlightAuto(value).value); }
      catch { setHtml(""); }
    });
  }, [language, value, visible]);
  return <code ref={ref} className={`hljs language-${language}`} {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : value}</code>;
}

function LazyMath({ source, display, loadMargin }: { source: string; display: boolean; loadMargin: string }) {
  const { ref, visible } = useVisible<HTMLElement>(loadMargin);
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!visible) return;
    import("katex").then(({ default: katex }) => {
      setHtml(katex.renderToString(source, { displayMode: display, throwOnError: false, strict: "warn", trust: false }));
    });
  }, [display, source, visible]);
  return <span ref={ref} className={display ? `lazy-math math-display ${source.length > 90 ? "is-wide" : ""}` : "lazy-math math-inline"}
    {...(display ? { role: "region", "aria-label": "数学公式，可横向滚动", tabIndex: 0 } : {})}
    {...(html ? { dangerouslySetInnerHTML: { __html: html } } : {})}>{html ? undefined : source}</span>;
}

export function sanitizeMermaidSvg(source: string): string {
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
    FORBID_ATTR: ["href", "xlink:href"]
  });
}

export function mermaidViewBoxWidth(source: string): number | null {
  const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
  const values = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = values?.length === 4 ? values[2] : Number.NaN;
  return Number.isFinite(width) && width > 0 ? Math.min(width, 12_000) : null;
}

function MermaidBlock({ source, loadMargin }: { source: string; loadMargin: string }) {
  const night = useContext(ReaderNightContext);
  const { ref, visible } = useVisible<HTMLDivElement>(loadMargin);
  const [svg, setSvg] = useState<{ markup: string; width: number | null }>({ markup: "", width: null });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSvg({ markup: "", width: null });
    setError("");
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: night ? "dark" : "neutral",
        suppressErrorRendering: true,
        flowchart: { htmlLabels: false }
      });
      try {
        const result = await mermaid.render(`mermaid-${crypto.randomUUID()}`, source);
        const markup = sanitizeMermaidSvg(result.svg);
        if (active) setSvg({ markup, width: mermaidViewBoxWidth(markup) });
      } catch (reason) { if (active) setError(String(reason)); }
    });
    return () => { active = false; };
  }, [source, visible, night]);
  return <div ref={ref} className={`mermaid-block ${svg.width && svg.width > 720 ? "is-wide" : ""}`} role="region" aria-label="Mermaid 图表，可横向滚动" tabIndex={0}>
    {svg.markup ? <div className="mermaid-canvas" style={svg.width ? { width: `${svg.width}px` } : undefined} dangerouslySetInnerHTML={{ __html: svg.markup }} />
      : error ? <pre className="diagram-error">{error}</pre> : "图表加载中…"}
  </div>;
}

type Props = {
  document: DocumentPayload;
  night: boolean;
  showFrontmatter?: boolean;
  remoteImagePolicy?: RemoteImagePolicy;
  allowedRemoteHosts?: string[];
  onAllowRemoteHost?: (host: string) => void;
  onOpenDocument: (path: string, hash?: string) => void;
};

export function isLongDocument(content: string): boolean {
  return content.length >= 80_000 || content.split("\n", 4_001).length > 4_000;
}

export function documentRenderTier(content: string): "normal" | "long" | "extreme" {
  if (content.length >= 1_000_000 || content.split("\n", 20_001).length > 20_000) return "extreme";
  return isLongDocument(content) ? "long" : "normal";
}

export default function MarkdownReader({
  document: doc, night, showFrontmatter = true, remoteImagePolicy = "ask", allowedRemoteHosts = [],
  onAllowRemoteHost = () => undefined, onOpenDocument
}: Props) {
  const renderTier = useMemo(() => documentRenderTier(doc.content), [doc.content]);
  const loadMargin = renderTier === "extreme" ? "80px" : "500px";
  const parsed = useMemo(() => {
    const result = splitFrontmatter(doc.content);
    return { ...result, body: normalizeTexDelimiters(result.body) };
  }, [doc.content]);
  const components = useMemo<Components>(() => ({
    pre: ({ children }) => <MarkdownPre>{children}</MarkdownPre>,
    table: ({ children }) => <ScrollableTable>{children}</ScrollableTable>,
    img: ({ src, alt }) => src ? <LocalImage key={imageSizeKey(doc.path, src)} documentPath={doc.path} source={src} alt={alt} remotePolicy={remoteImagePolicy} allowedRemoteHosts={allowedRemoteHosts} onAllowRemoteHost={onAllowRemoteHost} loadMargin={loadMargin} /> : null,
    blockquote: ({ children, node }) => <CalloutBlock calloutKind={String(node?.properties?.dataCallout ?? "")}>{children}</CalloutBlock>,
    h1: ({ id, children }) => <CollapsibleHeading level={1} id={id}>{children}</CollapsibleHeading>,
    h2: ({ id, children }) => <CollapsibleHeading level={2} id={id}>{children}</CollapsibleHeading>,
    h3: ({ id, children }) => <CollapsibleHeading level={3} id={id}>{children}</CollapsibleHeading>,
    h4: ({ id, children }) => <CollapsibleHeading level={4} id={id}>{children}</CollapsibleHeading>,
    h5: ({ id, children }) => <CollapsibleHeading level={5} id={id}>{children}</CollapsibleHeading>,
    h6: ({ id, children }) => <CollapsibleHeading level={6} id={id}>{children}</CollapsibleHeading>,
    a: ({ href, id, children }) => <a href={href} id={id} onClick={(event) => {
      event.preventDefault();
      if (!href) return;
      if (href.startsWith("#")) {
        const hash = decodeURIComponent(href.slice(1));
        const target = [hash, `user-content-${hash}`, hash.startsWith("user-content-") ? hash.slice(13) : ""]
          .map((id) => id && document.getElementById(id)).find(Boolean);
        if (target) {
          window.dispatchEvent(new CustomEvent("jingreader:reveal-heading", { detail: target }));
          requestAnimationFrame(() => requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth" })));
        }
      }
      else if (isExternalUrl(href)) void openUrl(href);
      else {
        const [source, hash] = href.split("#");
        onOpenDocument(resolveLocalPath(doc.path, source), hash);
      }
    }}>{children}</a>,
    code: ({ className, children }) => {
      const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
      const value = String(children).replace(/\n$/, "");
      if (language === "math") return <LazyMath source={value} display={!(className ?? "").includes("math-inline")} loadMargin={loadMargin} />;
      if (language === "mermaid") return <MermaidBlock source={value} loadMargin={loadMargin} />;
      if (!className) return <code>{children}</code>;
      return <LazyCode language={language} value={value} loadMargin={loadMargin} />;
    }
  }), [allowedRemoteHosts, doc.path, loadMargin, onAllowRemoteHost, onOpenDocument, remoteImagePolicy]);

  const markdown = useMemo(() => <ReactMarkdown
    remarkPlugins={markdownPlugins}
    rehypePlugins={htmlPlugins}
    components={components}
  >{parsed.body}</ReactMarkdown>, [components, parsed.body]);

  return <ReaderNightContext.Provider value={night}><article className={`markdown-body ${renderTier !== "normal" ? "long-document" : ""} ${renderTier === "extreme" ? "extreme-document" : ""}`} data-render-tier={renderTier} data-document-path={doc.path}>
    {showFrontmatter && parsed.frontmatter.length > 0 && <details className="frontmatter"><summary>文档属性</summary>{parsed.frontmatter.map((line, index) => <div key={index}>{line}</div>)}</details>}
    {markdown}
  </article></ReaderNightContext.Provider>;
}

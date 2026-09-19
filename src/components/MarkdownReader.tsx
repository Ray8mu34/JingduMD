import { Children, cloneElement, createElement, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, ChevronRight, Code2, Image as ImageIcon, Maximize2, Scan, X, ZoomIn, ZoomOut } from "lucide-react";
import type { AssetPayload, DocumentPayload } from "../types";
import { isExternalUrl, resolveLocalPath } from "../lib/paths";
import { normalizeTexDelimiters, remarkCallouts, remarkHeadingIds, remarkSanitizeHtml, remarkWikiLinks, splitFrontmatter } from "../lib/markdown";

const markdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    blockquote: [["dataCallout", /^(note|tip|important|warning|caution|info|example|quote)$/]]
  }
};

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
  const { ref, visible } = useVisible<HTMLSpanElement>(loadMargin);
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [allowOnce, setAllowOnce] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const isRemote = /^https?:/i.test(source);
  const host = isRemote ? remoteHost(source) : "";
  const remoteAllowed = remotePolicy !== "block" && (remotePolicy === "allow" || allowedRemoteHosts.includes(host) || allowOnce);

  useEffect(() => {
    setUrl("");
    setError(false);
    setCollapsed(false);
    setPreviewScale(1);
    if (!visible) return;
    if (/^data:/i.test(source)) { setUrl(source); return; }
    let objectUrl = "";
    const command = isRemote ? "read_remote_image" : "read_asset";
    const args = isRemote ? { url: source } : { path: resolveLocalPath(documentPath, source) };
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
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomed(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [zoomed]);
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);

  const imageLabel = alt?.trim() || source.split(/[\\/]/).pop() || "图片";

  return <span ref={ref} className={`image-frame ${collapsed ? "is-collapsed" : ""}`}>
    {url ? <>{collapsed
      ? <span className="collapsed-media"><ImageIcon /><span title={imageLabel}>{imageLabel}</span><button type="button" onClick={() => setCollapsed(false)} title="展开图片"><ChevronRight />展开图片</button></span>
      : <><span className="image-actions" aria-label="图片操作"><button type="button" onClick={() => setCollapsed(true)} title="折叠图片"><ChevronDown />折叠</button><button type="button" onClick={() => setZoomed(true)} title="放大查看图片"><Maximize2 />放大</button></span><img src={url} alt={alt ?? ""} loading="lazy" referrerPolicy="no-referrer" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setZoomed(true); }} /></>}
      {zoomed && createPortal(<div className="image-lightbox" role="dialog" aria-modal="true" aria-label={alt || "图片预览"} onClick={() => setZoomed(false)}>
        <div className="image-lightbox-toolbar" onClick={(event) => event.stopPropagation()}><button title="缩小" onClick={() => setPreviewScale((value) => Math.max(.5, value - .25))}><ZoomOut /></button><output>{Math.round(previewScale * 100)}%</output><button title="放大" onClick={() => setPreviewScale((value) => Math.min(4, value + .25))}><ZoomIn /></button><button title="适应窗口" onClick={() => setPreviewScale(1)}><Scan /></button><button title="关闭图片预览" onClick={() => setZoomed(false)}><X /></button></div>
        <div ref={previewRef} className={`image-lightbox-stage ${previewScale > 1 ? "can-drag" : ""}`} onClick={(event) => event.stopPropagation()} onDoubleClick={() => setPreviewScale((value) => value === 1 ? 2 : 1)} onWheel={(event) => { event.preventDefault(); setPreviewScale((value) => Math.max(.5, Math.min(4, value + (event.deltaY < 0 ? .25 : -.25)))); }} onPointerDown={(event) => { const stage = previewRef.current; if (!stage || previewScale <= 1) return; dragRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const stage = previewRef.current; const drag = dragRef.current; if (!stage || !drag) return; stage.scrollLeft = drag.left - (event.clientX - drag.x); stage.scrollTop = drag.top - (event.clientY - drag.y); }} onPointerUp={() => { dragRef.current = null; }}>
          <span className="image-lightbox-canvas" style={{ width: `${96 * previewScale}vw`, height: `${88 * previewScale}vh` }}><img src={url} alt={alt ?? ""} draggable={false} /></span>
        </div>
      </div>, globalThis.document.body)}</>
      : error ? <span className="broken-image">图片无法读取：{source}</span>
      : isRemote && remotePolicy === "block" ? <span className="image-placeholder remote-image-consent">远程图片已阻止<small>{host}</small></span>
      : isRemote && !remoteAllowed ? <span className="image-placeholder remote-image-consent">此文档引用了远程图片<small>{host}</small><span><button onClick={() => setAllowOnce(true)}>仅加载这张</button><button onClick={() => onAllowRemoteHost(host)}>始终允许此站点</button></span></span>
      : <span className="image-placeholder">图片加载中…</span>}
  </span>;
}

function CollapsibleCodeBlock({ children, language, lines }: { children: ReactNode; language: string; lines: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const label = language || "代码";
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);
  return <div className={`code-block ${collapsed ? "is-collapsed" : ""}`}>
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
    for (const element of affected) element.toggleAttribute("data-section-hidden", collapsed);
    return () => { for (const element of affected) element.removeAttribute("data-section-hidden"); };
  }, [collapsed, level]);
  useEffect(() => { const expand = () => setCollapsed(false); window.addEventListener("jingreader:expand-for-print", expand); return () => window.removeEventListener("jingreader:expand-for-print", expand); }, []);
  return createElement(`h${level}`, { id, ref, className: collapsed ? "section-collapsed" : undefined }, <button type="button" className="section-fold-button" title={collapsed ? "展开本节" : "折叠本节"} aria-label={collapsed ? "展开本节" : "折叠本节"} aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight /> : <ChevronDown />}</button>, children);
}

function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children).find(isValidElement);
  const props = child?.props as { className?: string; children?: ReactNode } | undefined;
  const className = props?.className ?? "";
  if (className.includes("math-") || className.includes("language-mermaid")) return <>{children}</>;
  const language = /language-([^\s]+)/.exec(className)?.[1] ?? "";
  const value = String(props?.children ?? "").replace(/\n$/, "");
  return <CollapsibleCodeBlock language={language} lines={Math.max(1, value.split("\n").length)}>{children}</CollapsibleCodeBlock>;
}

function ScrollableTable({ children }: { children?: ReactNode }) {
  return <div className="table-scroll" role="region" aria-label="表格，可横向滚动" tabIndex={0}>
    <table>{children}</table>
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
  return <span ref={ref} className={display ? "lazy-math math-display" : "lazy-math math-inline"}
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

function MermaidBlock({ source, night, loadMargin }: { source: string; night: boolean; loadMargin: string }) {
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
  return <div ref={ref} className="mermaid-block" role="region" aria-label="Mermaid 图表，可横向滚动" tabIndex={0}>
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
    img: ({ src, alt }) => src ? <LocalImage documentPath={doc.path} source={src} alt={alt} remotePolicy={remoteImagePolicy} allowedRemoteHosts={allowedRemoteHosts} onAllowRemoteHost={onAllowRemoteHost} loadMargin={loadMargin} /> : null,
    blockquote: ({ children, node }) => <CalloutBlock calloutKind={String(node?.properties?.dataCallout ?? "")}>{children}</CalloutBlock>,
    h1: ({ id, children }) => <CollapsibleHeading level={1} id={id}>{children}</CollapsibleHeading>,
    h2: ({ id, children }) => <CollapsibleHeading level={2} id={id}>{children}</CollapsibleHeading>,
    h3: ({ id, children }) => <CollapsibleHeading level={3} id={id}>{children}</CollapsibleHeading>,
    h4: ({ id, children }) => <CollapsibleHeading level={4} id={id}>{children}</CollapsibleHeading>,
    h5: ({ id, children }) => <CollapsibleHeading level={5} id={id}>{children}</CollapsibleHeading>,
    h6: ({ id, children }) => <CollapsibleHeading level={6} id={id}>{children}</CollapsibleHeading>,
    a: ({ href, children }) => <a href={href} onClick={(event) => {
      event.preventDefault();
      if (!href) return;
      if (href.startsWith("#")) document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: "smooth" });
      else if (isExternalUrl(href)) void openUrl(href);
      else {
        const [source, hash] = href.split("#");
        onOpenDocument(resolveLocalPath(doc.path, source), hash);
      }
    }}>{children}</a>,
    code: ({ className, children }) => {
      const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
      const value = String(children).replace(/\n$/, "");
      if (language === "math") return <LazyMath source={value} display={(className ?? "").includes("math-display")} loadMargin={loadMargin} />;
      if (language === "mermaid") return <MermaidBlock source={value} night={night} loadMargin={loadMargin} />;
      if (!className) return <code>{children}</code>;
      return <LazyCode language={language} value={value} loadMargin={loadMargin} />;
    }
  }), [allowedRemoteHosts, doc.path, loadMargin, night, onAllowRemoteHost, onOpenDocument, remoteImagePolicy]);

  return <article className={`markdown-body ${renderTier !== "normal" ? "long-document" : ""} ${renderTier === "extreme" ? "extreme-document" : ""}`} data-render-tier={renderTier} data-document-path={doc.path}>
    {showFrontmatter && parsed.frontmatter.length > 0 && <details className="frontmatter"><summary>文档属性</summary>{parsed.frontmatter.map((line, index) => <div key={index}>{line}</div>)}</details>}
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter, remarkWikiLinks, remarkCallouts, remarkHeadingIds, remarkSanitizeHtml]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
      components={components}
    >{parsed.body}</ReactMarkdown>
  </article>;
}

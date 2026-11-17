import katex from "katex";

// The visual HTML is independent of theme. Bound both entry count and retained
// string bytes so repeated symbols can be reused without retaining whole books.
const cache = new Map<string, { html: string; bytes: number }>();
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 256;
let retainedBytes = 0;

export function cachedMathHtml(source: string, display: boolean): string | undefined {
  const key = `${display ? "display" : "inline"}\0${source}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.html;
  }
  return undefined;
}

export function rememberMathHtml(source: string, display: boolean, html: string) {
  const key = `${display ? "display" : "inline"}\0${source}`;
  const previous = cache.get(key);
  if (previous) { retainedBytes -= previous.bytes; cache.delete(key); }
  const bytes = (key.length + html.length) * 2;
  if (bytes <= MAX_BYTES) {
    while (cache.size && (cache.size >= MAX_ENTRIES || retainedBytes + bytes > MAX_BYTES)) {
      const oldest = cache.keys().next().value!;
      retainedBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(key, { html, bytes });
    retainedBytes += bytes;
  }
}

export function renderMathHtml(source: string, display: boolean): string {
  const cached = cachedMathHtml(source, display);
  if (cached !== undefined) return cached;
  // Each formula already has a named role=math wrapper. Generating a second,
  // hidden MathML subtree adds DOM/layout cost without adding accessibility.
  const html = katex.renderToString(source, {
    displayMode: display, output: "html", throwOnError: false, strict: "warn", trust: false
  });
  rememberMathHtml(source, display, html);
  return html;
}

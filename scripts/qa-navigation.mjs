import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5180 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=reader-showcase.md`);
  await page.locator(".markdown-body h1").waitFor();
  const result = await page.evaluate(async () => {
    const { extractOutline } = await import("/src/lib/markdown.ts");
    const { captureTextAnchor, restoreTextAnchor } = await import("/src/lib/readingAnchor.ts");
    const article = document.querySelector(".markdown-body");
    const scroll = document.querySelector(".reader-scroll");
    const headings = [...article.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")].filter((heading) => heading.id !== "user-content-footnote-label");
    const markdown = await fetch("/fixtures/reader-showcase.md").then((response) => response.text());
    const outline = extractOutline(markdown);
    const idsMatch = JSON.stringify(outline.map((item) => item.id)) === JSON.stringify(headings.map((heading) => heading.id));
    scroll.scrollTop = 650;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const anchor = captureTextAnchor(scroll);
    const before = scroll.scrollTop;
    scroll.style.setProperty("--reader-size", "23px");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restored = anchor && restoreTextAnchor(scroll, anchor);
    const next = captureTextAnchor(scroll);
    const deviation = anchor && next ? Math.abs(anchor.viewportTop - next.viewportTop) : Infinity;
    const lineHeight = parseFloat(getComputedStyle(article).lineHeight);
    return { idsMatch, mismatch: idsMatch ? null : { outline: outline.map((item) => item.id), dom: headings.map((heading) => heading.id) }, restored, deviation, lineHeight, moved: Math.abs(scroll.scrollTop - before) > 1 };
  });
  if (!result.idsMatch || !result.restored || result.deviation > result.lineHeight || !result.moved) throw new Error(JSON.stringify(result));
  const firstFold = page.locator(".section-fold-button").first();
  await firstFold.click();
  const nestedHeading = page.locator(".markdown-body h2").first();
  await page.waitForFunction(() => document.querySelector(".markdown-body h2")?.hasAttribute("data-section-hidden"));
  await page.evaluate(() => {
    const target = document.querySelector(".markdown-body h2");
    window.dispatchEvent(new CustomEvent("jingreader:reveal-heading", { detail: target }));
  });
  await page.waitForFunction(() => !document.querySelector(".markdown-body h2")?.hasAttribute("data-section-hidden"));
  const footnotes = await page.evaluate(() => [...document.querySelectorAll(".markdown-body a[href^='#']")]
    .map((anchor) => ({ href: anchor.getAttribute("href"), label: anchor.textContent })).filter((item) => item.href.includes("fn")));
  if (!footnotes.some((item) => item.href === "#user-content-fn-reader") || !footnotes.some((item) => item.href === "#user-content-fnref-reader")) throw new Error("Footnote links missing");
  await page.locator('a[href="#user-content-fn-reader"]').click();
  await page.waitForFunction(() => {
    const target = document.getElementById("user-content-user-content-fn-reader");
    const viewport = document.querySelector(".reader-scroll").getBoundingClientRect();
    const rect = target?.getBoundingClientRect();
    return rect && rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  await page.locator('a[href="#user-content-fnref-reader"]').click();
  await page.waitForFunction(() => {
    const target = document.getElementById("user-content-user-content-fnref-reader");
    const viewport = document.querySelector(".reader-scroll").getBoundingClientRect();
    const rect = target?.getBoundingClientRect();
    return rect && rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  console.log(JSON.stringify({ ...result, revealsCollapsedHeading: true, footnoteRoundTrip: true }));
  await page.close();
} finally { await browser.close(); await server.close(); }

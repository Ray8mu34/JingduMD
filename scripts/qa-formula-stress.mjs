import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const manifest = JSON.parse((await readFile("qa-artifacts/wasserman-merge-manifest.json", "utf8")).replace(/^\uFEFF/, ""));
const browser = await chromium.connectOverCDP(process.argv[2] || "http://127.0.0.1:45923");
const compact = process.argv[3] !== "original";
try {
  const page = browser.contexts()[0].pages()[0];
  await page.evaluate(compact => {
    // The diagnostic binary predates the final formula fix. Apply the same
    // accessibility grouping live without rewriting any source document.
    const group = () => {
      for (const element of document.querySelectorAll('.katex-mathml:not([aria-hidden="true"])')) {
        element.setAttribute("aria-hidden", "true");
        element.parentElement.setAttribute("role", "math");
        element.parentElement.setAttribute("aria-label", element.querySelector("annotation")?.textContent || element.textContent);
      }
    };
    window.__stressMathObserver?.disconnect();
    window.__restoreCompactMath = group;
    if (compact) {
      window.__stressMathObserver = new MutationObserver(group);
      window.__stressMathObserver.observe(document.body, { childList: true, subtree: true });
      group();
    } else {
      for (const element of document.querySelectorAll('.katex-mathml[aria-hidden="true"]')) {
        element.removeAttribute("aria-hidden");
        element.parentElement.removeAttribute("role");
        element.parentElement.removeAttribute("aria-label");
      }
    }
    delete window.__mathAxRestore;
  }, compact);
  if (await page.locator(".markdown-body").getAttribute("data-document-path") !== manifest.output)
    await page.evaluate(path => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "open-target-argument", payload: path }), manifest.output);
  await page.waitForFunction(path => document.querySelector(".markdown-body")?.dataset.documentPath === path, manifest.output, { timeout: 45000 });
  await page.evaluate(() => window.dispatchEvent(new Event("jingreader:expand-for-print")));
  await page.waitForFunction(() => document.querySelectorAll(".katex").length >= 1425 &&
    document.querySelectorAll(".katex").length === document.querySelectorAll(".lazy-math").length, null, { timeout: 60000 });
  await page.evaluate(() => window.dispatchEvent(new Event("jingreader:restore-after-print")));
  const stats = await page.evaluate(() => ({
    renderedFormulas: document.querySelectorAll(".katex").length,
    namedFormulas: document.querySelectorAll('.katex[role="math"][aria-label],.lazy-math > [role="math"][aria-label]').length,
    expandedMathML: document.querySelectorAll('.katex-mathml:not([aria-hidden="true"])').length,
    svgImages: [...document.querySelectorAll(".markdown-body .image-surface img")].filter(img => img.hasAttribute("data-svg-bitmap")).length,
    tier: document.querySelector(".markdown-body").dataset.renderTier
  }));
  assert.ok(stats.renderedFormulas >= 1425);
  assert.equal(stats.expandedMathML, compact ? 0 : stats.renderedFormulas);
  assert.equal(stats.svgImages, 0);
  const cdp = await page.context().newCDPSession(page);
  const tree = await cdp.send("Accessibility.getFullAXTree");
  stats.accessibilityNodes = tree.nodes.length;
  await cdp.send("Accessibility.disable");
  await page.waitForTimeout(1500);
  await page.locator(".reader-scroll").hover();
  await page.mouse.wheel(0, -1000000);
  await page.waitForTimeout(400);
  const point = await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll(".markdown-body p")].find(p => p.textContent.startsWith("本文件按"));
    paragraph.scrollIntoView({ block: "center" });
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0); range.setEnd(paragraph.firstChild, 1);
    const rect = range.getBoundingClientRect();
    const line = paragraph.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2, end: line.right - 5 };
  });
  await page.evaluate(() => {
    window.__stressBegin = () => {
    const stats = { moves: 0, changes: 0, frames: [], texts: [], active: true, last: performance.now() };
    const move = () => stats.moves++;
    const change = () => stats.changes++;
    document.addEventListener("pointermove", move);
    document.addEventListener("selectionchange", change);
    const frame = now => {
      if (!stats.active) return;
      stats.frames.push(now - stats.last); stats.last = now;
      stats.texts.push(getSelection()?.toString() || "");
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.__stressFinish = () => {
      stats.active = false;
      document.removeEventListener("pointermove", move);
      document.removeEventListener("selectionchange", change);
      const ordered = stats.frames.slice(3).sort((a, b) => a - b);
      return { pointerMoves: stats.moves, selectionUpdates: stats.changes, distinctPaintedSelections: new Set(stats.texts.filter(Boolean)).size,
        p95FrameMs: ordered[Math.floor(ordered.length * .95)], maxFrameMs: Math.max(...ordered), framesOver50ms: ordered.filter(ms => ms > 50).length };
    };
    };
    window.__stressBegin();
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  for (let index = 1; index <= 100; index++) {
    await page.mouse.move(point.x + (point.end - point.x) * index / 100, point.y);
    await page.waitForTimeout(6);
  }
  stats.drag = await page.evaluate(() => window.__stressFinish());
  await page.mouse.up();
  assert.ok(stats.drag.selectionUpdates > 10);
  await page.keyboard.press("Escape");
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.locator(".reader-scroll").hover();
  await page.evaluate(() => window.__stressBegin());
  for (let index = 0; index < 40; index++) { await page.mouse.wheel(0, 45); await page.waitForTimeout(8); }
  await page.waitForTimeout(100);
  stats.scroll = await page.evaluate(() => window.__stressFinish());
  stats.variant = compact ? "optimized" : "original";
  await writeFile(`qa-artifacts/formula-stress-${stats.variant}.json`, JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats, null, 2));
} finally {
  const page = browser.contexts()[0].pages()[0];
  await page?.evaluate(() => window.__restoreCompactMath?.()).catch(() => {});
  await browser.close();
}

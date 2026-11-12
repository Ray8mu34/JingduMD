import { createServer } from "vite";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

const documentPath = process.argv[2];
if (!documentPath) throw new Error("Usage: node scripts/qa-svg-selection.mjs <markdown file>");
const content = await readFile(documentPath, "utf8");
const assets = {};
for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+\.svg)\)/gi)) {
  const file = resolve(dirname(documentPath), match[1]);
  assets[basename(file)] = { mime: "image/svg+xml", data: Array.from(await readFile(file)) };
}
const server = await createServer({ server: { host: "127.0.0.1", port: 5186 } });
await server.listen();
const endpoint = process.argv[3];
const browser = endpoint ? await chromium.connectOverCDP(endpoint) : await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
const results = [];
try {
  const page = endpoint ? browser.contexts()[0].pages()[0] : await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1.5 });
  if (!endpoint) {
  await page.route("**/fixtures/reader-showcase.md", route => route.fulfill({ body: content, contentType: "text/plain" }));
  await page.addInitScript(assets => {
    let internals;
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, get: () => internals, set(value) {
      const invoke = value.invoke.bind(value);
      value.invoke = (command, args, options) => command === "read_asset"
        ? Promise.resolve(assets[String(args.path).split(/[\\/]/).pop()]) : invoke(command, args, options);
      internals = value;
    } });
  }, assets);
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=reader-showcase.md`);
  }
  await page.locator(".markdown-body h1").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".reader-scroll").hover();
  await page.mouse.wheel(0, 100);
  const frames = page.locator(".markdown-body .image-frame");
  for (let index = 0; index < await frames.count(); index++) {
    await frames.nth(index).scrollIntoViewIfNeeded();
    await frames.nth(index).locator("img").waitFor();
    await page.waitForFunction(index => document.querySelectorAll(".markdown-body .image-frame img")[index]?.complete, index);
  }
  assert.equal(await page.locator("img[data-svg-bitmap]").count(), Object.keys(assets).length, "every static SVG should use a prose bitmap");
  await page.evaluate(assets => {
    const payloads = Object.values(assets);
    document.querySelectorAll(".markdown-body .image-surface > img").forEach((img, index) => {
      img.dataset.qaBitmap = img.src;
      const payload = payloads[index];
      img.dataset.qaVector = URL.createObjectURL(new Blob([new Uint8Array(payload.data)], { type: payload.mime }));
    });
  }, assets);
  const image = frames.first().locator("img");
  await image.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const reader = document.querySelector(".reader-scroll");
    const image = document.querySelector(".markdown-body .image-frame img");
    reader.scrollTop += image.getBoundingClientRect().top - reader.getBoundingClientRect().top - 300;
  });
  await page.waitForTimeout(300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  for (const variant of ["vector", "bitmap"]) {
    await page.evaluate(async variant => {
      for (const image of document.querySelectorAll(".markdown-body .image-surface > img")) {
        image.src = variant === "vector" ? image.dataset.qaVector : image.dataset.qaBitmap;
        await image.decode();
      }
    }, variant);
    const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(item => [item.name, item.value]));
    const points = await page.evaluate(() => {
      const article = document.querySelector(".markdown-body");
      const reader = document.querySelector(".reader-scroll");
      const bounds = reader.getBoundingClientRect();
      const paragraphs = [...article.querySelectorAll("p")].filter(p => {
        const rect = p.getBoundingClientRect();
        return rect.top > bounds.top + 10 && rect.bottom < bounds.bottom - 10 && p.textContent.length > 25;
      });
      const paragraph = paragraphs[0];
      if (!paragraph) throw new Error("No visible paragraph for selection");
      getSelection().removeAllRanges();
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && !walker.currentNode.textContent.trim()) {}
      const node = walker.currentNode;
      const range = document.createRange();
      range.setStart(node, 0); range.setEnd(node, 1);
      const first = range.getBoundingClientRect();
      const stats = { moves: 0, changes: 0, paintedSelections: 0, gaps: [], last: performance.now(), lastText: "", active: true };
      const move = () => stats.moves++;
      const change = () => stats.changes++;
      window.addEventListener("pointermove", move);
      document.addEventListener("selectionchange", change);
      const frame = now => {
        if (!stats.active) return;
        stats.gaps.push(now - stats.last); stats.last = now;
        const text = getSelection()?.toString() || "";
        if (text !== stats.lastText) { stats.paintedSelections++; stats.lastText = text; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      window.__svgDragStats = stats;
      window.__endSvgDrag = () => {
        stats.active = false;
        window.removeEventListener("pointermove", move);
        document.removeEventListener("selectionchange", change);
      };
      return { x1: first.left + 1, y: first.top + first.height / 2, x2: paragraph.getBoundingClientRect().right - 4 };
    });
    await page.mouse.move(points.x1, points.y);
    await page.mouse.down();
    for (let index = 1; index <= 100; index++) {
      await page.mouse.move(points.x1 + (points.x2 - points.x1) * index / 100, points.y);
      await page.waitForTimeout(6);
    }
    await page.mouse.up();
    const selection = await page.evaluate(() => {
      window.__endSvgDrag();
      const stats = window.__svgDragStats;
      const ordered = stats.gaps.slice(3).sort((a, b) => a - b);
      return { pointerMoves: stats.moves, selectionChanges: stats.changes, paintedSelections: stats.paintedSelections,
        p95FrameMs: ordered[Math.floor(ordered.length * .95)], maxFrameMs: Math.max(...ordered), slowFrames: ordered.filter(ms => ms > 25).length };
    });
    if (selection.selectionChanges <= 8) {
      console.log({ variant, points, selection, selectedText: await page.evaluate(() => getSelection()?.toString()) });
      await page.screenshot({ path: join(output, "svg-drag-diagnostic.png") });
    }
    assert.ok(selection.selectionChanges > 8, "drag must actually select multiple characters");
    const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(item => [item.name, item.value]));
    results.push({ variant, ...selection, taskMs: (after.TaskDuration - before.TaskDuration) * 1000 });
    await page.keyboard.press("Escape");
    await page.evaluate(() => getSelection().removeAllRanges());
  }
  await page.screenshot({ path: join(output, "svg-selection.png") });
  await page.evaluate(() => {
    for (const img of document.querySelectorAll("img[data-qa-vector]")) {
      URL.revokeObjectURL(img.dataset.qaVector);
      delete img.dataset.qaVector;
      delete img.dataset.qaBitmap;
    }
  });
  await writeFile(join(output, "svg-selection.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }

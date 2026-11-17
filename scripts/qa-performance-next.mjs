import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const manifest = JSON.parse((await readFile("qa-artifacts/wasserman-merge-manifest.json", "utf8")).replace(/^\uFEFF/, ""));
const content = await readFile(manifest.output, "utf8");
const assets = {};
for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  assets[match[1].replaceAll("\\", "/")] = { mime: "image/png", data: Array.from(await readFile(resolve(dirname(manifest.output), match[1])) ) };
}
const notebook = JSON.stringify({ nbformat: 4, cells: Array.from({ length: 80 }, (_, index) => ({
  cell_type: "markdown", source: `## 单元格 ${index}\n\n正文与公式 $x_${index}^2$。`, attachments: {}
})) });
const files = ["src/App.tsx", "src/components/MarkdownReader.tsx", "src/lib/notebook.ts", "src/lib/notebookHighlights.ts", "src/lib/highlights.ts"];
const baseline = new Map(files.map(file => [resolve(file).replaceAll("\\", "/"), execFileSync("git", ["show", `9b3f88c:${file}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })]));
const results = [];

for (const variant of ["before", "after"]) {
  const server = await createServer({ cacheDir: `node_modules/.vite-performance-${variant}`, server: { host: "127.0.0.1", port: 5208 }, plugins: variant === "before" ? [{
    name: "read-baseline-source", enforce: "pre", load(id) { return baseline.get(id.split("?")[0]); }
  }] : [] });
  await server.listen();
  const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    await page.route("**/fixtures/reader-showcase.md", route => route.fulfill({ body: content, contentType: "text/plain" }));
    await page.route("**/fixtures/perf-notebook.ipynb", route => route.fulfill({ body: notebook, contentType: "application/json" }));
    await page.addInitScript(({ assets, notebook }) => {
      const parse = JSON.parse;
      window.__notebookParses = 0;
      JSON.parse = function (value, ...args) { if (value === notebook) window.__notebookParses++; return parse.call(JSON, value, ...args); };
      let internals;
      Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, get: () => internals, set(value) {
        const invoke = value.invoke.bind(value);
        value.invoke = (command, args, options) => command === "read_asset"
          ? Promise.resolve(Object.entries(assets).find(([path]) => String(args.path).replaceAll("\\", "/").endsWith(`/${path}`))?.[1])
          : invoke(command, args, options);
        internals = value;
      } });
    }, { assets, notebook });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
    await page.locator(".markdown-body h1").first().waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("jingreader:expand-for-print")));
    await page.waitForFunction(() => document.querySelectorAll(".katex").length === 3872, null, { timeout: 60000 });
    await page.evaluate(() => window.dispatchEvent(new Event("jingreader:restore-after-print")));
    await page.evaluate(() => document.fonts.ready);
    const stats = await page.evaluate(async () => {
      const { resolveHighlights } = await import("/src/lib/highlights.ts");
      const article = document.querySelector(".markdown-body");
      const nodes = article.querySelectorAll("*").length;
      const fragment = document.createDocumentFragment();
      const records = [];
      for (let i = 1; i <= 40; i++) {
        const span = document.createElement("span");
        span.dataset.fileHighlight = String(-1000000-i); span.textContent = `高亮内容 ${i}`;
        fragment.append(span);
        records.push({ id: -1000000-i, quote: span.textContent, color: "yellow", path: "benchmark.md", root: "", startOffset: 0, endOffset: 1, prefix: "", suffix: "", headingId: null, createdMs: 0, updatedMs: 0 });
      }
      article.append(fragment);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
      const measure = input => {
        const timings = [];
        for (let i = 0; i < 7; i++) {
          const started = performance.now();
          const ranges = resolveHighlights(article, input);
          if (ranges.some(item => item.range?.toString() !== item.quote)) throw new Error(`Incorrect highlight range: ${JSON.stringify(ranges.filter(item => item.range?.toString() !== item.quote).map(item => ({ id: item.id, expected: item.quote, actual: item.range?.toString() })))}`);
          timings.push(performance.now() - started);
        }
        return median(timings);
      };
      return { formulas: document.querySelectorAll(".katex").length, nodes,
        mathMLNodes: article.querySelectorAll(".katex-mathml *").length,
        emptyHighlightMedianMs: measure([]), nativeHighlightMedianMs: measure(records) };
    });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=perf-notebook.ipynb`);
    await page.waitForFunction(() => document.querySelectorAll(".markdown-body h2").length === 80);
    await page.waitForTimeout(500);
    stats.notebookJsonParses = await page.evaluate(() => window.__notebookParses);
    results.push({ variant, ...stats });
    console.log(JSON.stringify(results.at(-1)));
  } finally { await browser.close(); await server.close(); }
}
assert.equal(results[0].formulas, results[1].formulas);
assert.ok(results[1].nodes < results[0].nodes);
assert.equal(results[1].mathMLNodes, 0);
assert.equal(results[1].notebookJsonParses, 1);
assert.ok(results[0].notebookJsonParses > results[1].notebookJsonParses);
await writeFile("qa-artifacts/performance-next.json", JSON.stringify(results, null, 2));

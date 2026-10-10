import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { launchQaBrowser } from "./qa-browser.mjs";

const baseline = process.argv.includes('--baseline');
const source = process.argv.slice(2).find(arg => arg !== '--baseline');
const content = source ? await readFile(source, "utf8") : '# Lazy math scroll\n\n' + Array.from({ length: 100 }, (_, i) => `## Section ${i}\n\nKeep this sentence stable while reading. Inline $\\frac{x_${i}}{1+x^2}$ and more words.\n\n$$\n\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix} \\frac{1}{\\sqrt{2\\pi}} e^{-x^2/2}\n$$\n\nAfter the equation, keep reading this paragraph.\n\n`).join('');
const server = await createServer({ cacheDir: 'node_modules/.vite-qa-lazy-scroll', plugins: baseline ? [{ name: 'baseline-math-qa', enforce: 'pre', transform(code, id) {
  if (id.endsWith('/MarkdownReader.tsx')) return execFileSync('git', ['show', 'HEAD:src/components/MarkdownReader.tsx'], { encoding: 'utf8' })
    .replace('import("katex").then(({ default: katex }) => {', 'import("katex").then(async ({ default: katex }) => { await new Promise(resolve => setTimeout(resolve, 500));');
} }] : [], server: { host: "127.0.0.1", port: 5198 } });
await server.listen();
const browser = await launchQaBrowser();
try {
  for (const width of [1280, 760]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route('**/fixtures/plain-article.md', route => route.fulfill({ body: content }));
    await page.goto(server.resolvedUrls.local[0] + 'qa-app.html?sample=plain-article.md&tabs=1', { timeout: 90000 });
    await page.locator('.markdown-body h1').waitFor();
    await page.waitForTimeout(600);
    const math = await page.locator('.lazy-math').evaluateAll(nodes => ({ total: nodes.length, ready: nodes.filter(node => node.querySelector('.katex')).length }));
    assert.ok(math.total > 0, 'Regression document needs formulas');
    if (!baseline) assert.equal(math.ready, math.total, 'Ordinary article still contains formula placeholders before reading');
    const scroll = page.locator('.reader-scroll');
    const box = await scroll.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 180);
    let worst = 0;
    const records = [];
    for (let step = 0; step < 24; step++) {
      await page.mouse.wheel(0, 650);
      await page.waitForTimeout(20);
      const result = await page.evaluate(async () => {
        const container = document.querySelector('.reader-scroll');
        const viewport = container.getBoundingClientRect();
        const caret = document.caretRangeFromPoint(viewport.x + viewport.width / 2, viewport.y + 180);
        const paragraph = caret?.startContainer.parentElement?.closest('p,h1,h2,h3,li');
        const node = caret?.startContainer;
        const offset = caret?.startOffset;
        const initial = caret?.getBoundingClientRect().top;
        const top = container.scrollTop;
        const mathBefore = container.querySelectorAll('.katex').length;
        await new Promise(resolve => setTimeout(resolve, 600));
        return { shift: node?.isConnected && node.nodeType === Node.TEXT_NODE && !node.parentElement.closest('.lazy-math') && initial !== undefined ? caret.getBoundingClientRect().top - initial : 0, scrollChange: container.scrollTop - top, text: paragraph?.textContent?.slice(0, 45), offset, loaded: container.querySelectorAll('.katex').length - mathBefore };
      });
      worst = Math.max(worst, Math.abs(result.shift));
      if (Math.abs(result.shift) > 2 || result.loaded) records.push({ step, ...result });
    }
    console.log(JSON.stringify({ width, worst, records }));
    assert.ok(worst <= 2, `Lazy rendering moved visible text by ${worst}px at width ${width}`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

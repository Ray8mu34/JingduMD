import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const source = process.argv[2];
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const specimen = JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: 'python' } }, cells: [
  { cell_type: 'markdown', source: '# 中文阅读验证\n\n公式 $y=wx+b$。![内存附件](attachment:图.png)\n\n[跳到后续](#后续)', attachments: { '图.png': { 'image/png': png } } },
  { cell_type: 'code', source: "print('代码检索词')\n# 静态内容，不执行", outputs: [
    { output_type: 'stream', text: '输出专有词\n' + '长输出\n'.repeat(60) },
    { output_type: 'display_data', data: { 'text/html': '<script>globalThis.notebookExecuted=true</script><table onclick="alert(1)"><tr>' + '<th>宽表格列</th>'.repeat(18) + '</tr><tr>' + '<td>回归数据 123456</td>'.repeat(18) + '</tr></table>', 'text/plain': '不应重复显示' } },
    { data: { 'image/png': 'broken', 'text/plain': '图片损坏的文本备选' } },
    { data: { 'application/widget': {} } }, null
  ] },
  { cell_type: 'markdown', source: '# 中文阅读验证\n\n后续正文\n\n## 后续\n\n全文检索词' },
  { cell_type: 'code', source: 'no_output()', outputs: [] },
  { cell_type: 'raw', source: '<b>原始文本</b>' }
] }, null, 2);
await mkdir('qa-artifacts', { recursive: true });
await writeFile('fixtures/notebook-showcase.ipynb', specimen);
const files = source ? (await readdir(source)).filter(name => /\.ipynb$/i.test(name)) : [];
const originals = new Map(await Promise.all(files.map(async name => [name, await readFile(join(source, name))])));
const samples = new Map([['notebook-showcase.ipynb', specimen], ...[...originals].map(([name, bytes]) => [name, bytes.toString('utf8')])]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const server = await createServer({ server: { host: '127.0.0.1', port: 5197 } });
await server.listen();
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
const results = [];
try {
  for (const [name, content] of samples) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/fixtures/*', route => {
      const requested = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
      return samples.has(requested) ? route.fulfill({ body: samples.get(requested), contentType: 'text/plain; charset=utf-8' }) : route.continue();
    });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=${encodeURIComponent(name)}`);
    await page.getByText('静态阅读 · Markdown 正文可高亮 · 代码与输出只读').waitFor();
    assert.equal(await page.getByTitle('编辑 Markdown 源码').count(), 0);
    if (!await page.locator('.outline').count()) await page.getByRole('button', { name: '大纲', exact: true }).first().click();
    await page.locator('.outline').waitFor();
    const headings = page.locator('.outline button');
    const headingIds = await page.evaluate(async () => {
      const { parseNotebook, notebookOutline } = await import('/src/lib/notebook.ts');
      const qa = window.__JINGREADER_QA__;
      return notebookOutline(parseNotebook(qa.documents.get(qa.selected).content)).map(h => h.id);
    });
    assert(await headings.count() > 0);
    for (let i = 0; i < await headings.count(); i++) {
      await headings.nth(i).click();
      try { await page.waitForFunction(id => { const rect = document.getElementById(id)?.getBoundingClientRect(); return rect && rect.top >= 0 && rect.top < innerHeight; }, headingIds[i], { timeout: 5000 }); }
      catch (error) { console.error(name, i, headingIds[i], await page.evaluate(id => ({ html: document.getElementById(id)?.outerHTML, y: document.getElementById(id)?.getBoundingClientRect().top, scroll: document.querySelector('.reader-scroll')?.scrollTop }), headingIds[i])); throw error; }
    }
    await page.evaluate(() => window.dispatchEvent(new Event('jingreader:expand-for-print')));
    const result = await page.evaluate(() => {
      const article = document.querySelector('.markdown-body');
      const ids = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => h.id);
      return { headings: ids.length, unique: new Set(ids).size, formulas: article.querySelectorAll('.katex').length,
        outputs: article.querySelectorAll('.notebook-output').length, unsafe: article.querySelectorAll('script, iframe, [onclick]').length,
        formulaErrors: [...article.querySelectorAll('.katex-error')].map(el => el.getAttribute('title')),
        displayFormulas: article.querySelectorAll('.math-display .katex-display').length,
        overflow: document.documentElement.scrollWidth - innerWidth, calls: window.__JINGREADER_QA__.calls };
    });
    assert.equal(result.unique, result.headings);
    assert.equal(result.unsafe, 0);
    assert.deepEqual(result.formulaErrors, [], `${name}: formula parse errors`);
    if (name === '03.01_线性回归.ipynb') {
      assert(result.displayFormulas > 10);
      assert.equal(await page.getByRole('heading', { name: /3\.1\.1\.4 小批量随机梯度下降/ }).count(), 1);
      assert.equal(await page.getByRole('heading', { name: /3\.1\.1\.5 预测/ }).count(), 1);
      await page.getByRole('heading', { name: /3\.1\.1\.3 解析解/ }).evaluate(el => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: 'qa-artifacts/notebook-math-fixed.png' });
    }
    assert(result.overflow <= 1);
    assert(!result.calls.some(c => /write_file|save_document|copy_document|execute|kernel/.test(c)));
    assert.deepEqual(errors, []);
    if (name === 'notebook-showcase.ipynb') {
      await page.getByTitle('折叠代码块').first().click();
      await page.getByRole('button', { name: '在当前文档中查找', exact: true }).click();
      await page.getByPlaceholder('在当前文档中查找').fill('代码检索词');
      await page.locator('.find-count').filter({ hasText: '1/1' }).waitFor();
      await page.getByPlaceholder('在当前文档中查找').fill('输出专有词');
      await page.locator('.find-count').filter({ hasText: '0/0' }).waitFor();
      assert.equal(await page.locator('.notebook-output').getByText('不应重复显示').count(), 0);
      await page.locator('.reader-scroll').evaluate(el => el.scrollTop = 0);
      await page.getByRole('link', { name: '跳到后续' }).click();
      assert(await page.locator('#user-content-nb-2-后续').count());
      const searchCounts = await page.evaluate(async () => {
        const { findTextRanges } = await import('/src/lib/find.ts');
        const root = document.querySelector('.markdown-body');
        return [findTextRanges(root, '代码检索词').length, findTextRanges(root, '输出专有词').length];
      });
      assert.deepEqual(searchCounts, [1, 0]);
      assert.equal(await page.evaluate(() => globalThis.notebookExecuted), undefined);
      await page.setViewportSize({ width: 760, height: 900 });
      await page.locator('.reader-scroll').evaluate(el => el.scrollTop = 0);
      await page.waitForFunction(() => { const img = document.querySelector('img[alt="内存附件"]'); return img?.complete && img.naturalWidth > 0; });
      await page.screenshot({ path: 'qa-artifacts/notebook-narrow.png' });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.locator('.reader-scroll').evaluate(el => el.scrollTop = 0);
    await page.screenshot({ path: `qa-artifacts/notebook-${results.length}.png` });
    results.push({ name, ...result, calls: undefined });
    await page.close();
  }
  if (source) assert.deepEqual((await readdir(source)).filter(n => /\.ipynb$/i.test(n)).sort(), files.sort());
  for (const [name, bytes] of originals) assert.equal(hash(await readFile(join(source, name))), hash(bytes), `${name} changed`);
  await writeFile('qa-artifacts/notebook-results.json', JSON.stringify({ results, sourceFilesUnchanged: originals.size }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }

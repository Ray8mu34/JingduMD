import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const source = `# 代码墨色预览

函数用墨蓝、运算符用青色；括号随嵌套层级呈现赭橙、紫、青。

\`\`\`python
# 保留淡墨感，让调用和结构更容易辨认
Z = torch.zeros_like(Y)
print('id(Z):', id(Z))
Z[:] = X + Y

before = id(X)
X += Y
id(X) == before

# 三层嵌套：同一对括号同色
X = torch.tensor([[1, 2, 3], [4, 5, 6]])
torch.zeros((2, 3, 4))
print('文字里的括号 ([]) 不参与配色')

if X.numel() > 0:
    result = X.reshape(2, 3).sum(dim=1)
\`\`\`
`;
await mkdir('qa-artifacts', { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5199 } });
await server.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/fixtures/code-colors.md', route => route.fulfill({ body: source, contentType: 'text/plain; charset=utf-8' }));
  for (const theme of ['warm', 'white', 'night', 'nord']) {
    await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=code-colors.md&appearance=${theme}`);
    await page.locator('.code-bracket-2').first().waitFor();
    const result = await page.evaluate(() => {
      const root = document.querySelector('.markdown-body');
      const color = selector => getComputedStyle(root.querySelector(selector)).color;
      return { calls: [...root.querySelectorAll('.code-call')].map(n => n.textContent),
        colors: ['.code-call', '.code-operator', '.hljs-string', '.hljs-keyword', '.hljs-number'].map(color),
        brackets: [0, 1, 2].map(i => color(`.code-bracket-${i}`)),
        pollutedStrings: root.querySelectorAll('.hljs-string .code-bracket-0, .hljs-comment .code-call').length,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(result.calls.includes('zeros_like'));
    assert(result.calls.includes('reshape'));
    assert.equal(new Set(result.colors).size, 5);
    assert.equal(new Set(result.brackets).size, 3);
    assert.equal(result.pollutedStrings, 0);
    assert.equal(result.overflow, false);
    await page.screenshot({ path: `qa-artifacts/code-ink-${theme}.png` });
    results.push({ theme, ...result });
  }
  await page.setViewportSize({ width: 480, height: 900 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'qa-artifacts/code-ink-narrow.png' });
  await page.setViewportSize({ width: 1360, height: 810 });
  await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=code-colors.md&appearance=warm`);
  await page.locator('.code-bracket-2').first().waitFor();
  // Review sheet uses two clones of the actual rendered code component. The old
  // half restores the former token colors and removes only the new annotations.
  await page.evaluate(() => {
    const article = document.querySelector('.markdown-body');
    const code = article.querySelector('.code-block');
    const before = code.cloneNode(true);
    before.querySelectorAll('.code-call,.code-operator,[class^="code-bracket-"]').forEach(n => n.replaceWith(...n.childNodes));
    before.style.cssText = '--syntax-string:#75501c;--syntax-number:#235e67;--syntax-title:#245b78;--syntax-builtin:#4e6654;--syntax-keyword:#713e80;--syntax-muted:#615a50;';
    const after = code.cloneNode(true);
    article.replaceChildren();
    for (const [label, block] of [['修改前', before], ['修改后 · 墨色增强', after]]) {
      const section = document.createElement('section');
      const heading = document.createElement('h2'); heading.textContent = label;
      section.append(heading, block); article.append(section);
    }
    article.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:28px;width:100%;max-width:none;padding:0 28px;font-size:18px';
    document.querySelector('.reader-scroll').style.padding = '20px 0';
    document.querySelector('.qa-toolbar').textContent = '静读 · 同一段 Python 代码的配色对比';
  });
  await page.screenshot({ path: 'qa-artifacts/code-ink-comparison.png' });
  assert.deepEqual(errors, []);
  await writeFile('qa-artifacts/code-ink-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }

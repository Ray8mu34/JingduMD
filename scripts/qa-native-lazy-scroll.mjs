// Build the isolated app with --debug --no-bundle --config
// qa-artifacts/multiwindow-config.json, then pass a Markdown path to this script.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const source = resolve(process.argv[2]);
const executable = resolve('src-tauri/target/debug/jingreader.exe');
assert.ok((await readFile(executable)).includes(Buffer.from('com.jingreader.qa.multiwindow')), 'Build the isolated QA app first');
const digest = async () => createHash('sha256').update(await readFile(source)).digest('hex');
const before = await digest();
const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const child = spawn(executable, [source], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, windowsHide: true, stdio: 'ignore' });
let browser;
const until = async (action, label) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const result = await action(); if (result) return result; } catch {}
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`Timed out: ${label}`);
};
try {
  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, 'WebView2 debugging');
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(() => browser.contexts().flatMap(context => context.pages())[0], 'reader');
  await page.locator('.markdown-body h1').waitFor();
  const math = await page.locator('.lazy-math').evaluateAll(nodes => ({ total: nodes.length, ready: nodes.filter(node => node.querySelector('.katex')).length }));
  assert.ok(math.total > 0);
  assert.equal(math.ready, math.total);
  const tab = page.getByRole('tab', { selected: true });
  await tab.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '文章操作' });
  await menu.getByRole('menuitem', { name: '在文件资源管理器中显示' }).click();
  await menu.waitFor({ state: 'detached' });
  const scroll = page.locator('.reader-scroll');
  const box = await scroll.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 180);
  let worst = 0;
  for (let step = 0; step < 15; step++) {
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(30);
    const shift = await page.evaluate(async () => {
      const viewport = document.querySelector('.reader-scroll').getBoundingClientRect();
      const caret = document.caretRangeFromPoint(viewport.x + viewport.width / 2, viewport.y + 180);
      const node = caret?.startContainer;
      if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement.closest('.lazy-math')) return 0;
      const top = caret.getBoundingClientRect().top;
      await new Promise(done => setTimeout(done, 100));
      return caret.getBoundingClientRect().top - top;
    });
    worst = Math.max(worst, Math.abs(shift));
  }
  assert.ok(worst <= 2, `Native reading text moved ${worst}px`);
  assert.equal(await digest(), before, 'Source document changed');
  console.log(JSON.stringify({ native: 'WebView2', formulas: math, reveal: 'native opener succeeded', worst, sourceUnchanged: true }));
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child.exitCode === null) child.kill();
}

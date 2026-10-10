import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { launchQaBrowser } from "./qa-browser.mjs";

const server = await createServer({ cacheDir: 'node_modules/.vite-qa-file-context', server: { host: "127.0.0.1", port: 5199 } });
await server.listen();
const browser = await launchQaBrowser();
try {
  await mkdir('qa-artifacts', { recursive: true });
  for (const width of [1280, 760]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(server.resolvedUrls.local[0] + 'qa-app.html?tabs=1', { timeout: 90000 });
    await page.locator('.markdown-body h1').waitFor();
    const treeToggle = page.getByRole('button', { name: '文件列表', exact: true });
    if (await treeToggle.getAttribute('aria-expanded') === 'false') await treeToggle.click();
    const first = page.getByRole('button', { name: 'plain-article.md', exact: true });
    await first.click({ button: 'right' });
    const menu = page.getByRole('menu', { name: '文章操作' });
    await menu.getByRole('menuitem', { name: '在文件资源管理器中显示' }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.revealRequests.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__JINGREADER_QA__.revealRequests[0]), ['C:\\qa-fixtures\\plain-article.md']);
    assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'reader-showcase.md', 'Right-click switched the document');
    await first.click();
    await page.getByRole('tab', { name: 'plain-article.md', selected: true }).waitFor();
    const background = page.getByRole('tab', { name: 'reader-showcase.md' });
    await background.click({ button: 'right' });
    await page.screenshot({ path: `qa-artifacts/file-context-${width}.png` });
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900, 'Menu exceeds viewport');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '在文件资源管理器中显示');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__JINGREADER_QA__.revealRequests.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__JINGREADER_QA__.revealRequests[1]), ['C:\\qa-fixtures\\reader-showcase.md']);
    assert.equal(await page.getByRole('tab', { selected: true }).textContent(), 'plain-article.md');
    await background.focus();
    await page.keyboard.press('Shift+F10');
    await menu.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0);
    assert.ok(await background.evaluate(node => node === document.activeElement), 'Escape failed to restore focus');
    await background.click({ button: 'right' });
    await page.evaluate(() => window.__JINGREADER_QA__.revealFailure = true);
    await menu.getByRole('menuitem', { name: '在文件资源管理器中显示' }).click();
    await page.getByRole('alert').filter({ hasText: 'QA file unavailable' }).waitFor();
    await page.evaluate(() => window.__JINGREADER_QA__.revealFailure = false);
    await menu.getByRole('menuitem', { name: '在文件资源管理器中显示' }).click();
    await menu.waitFor({ state: 'detached' });
    console.log(`File tree and background-tab reveal, keyboard, viewport and retry passed at ${width}px.`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

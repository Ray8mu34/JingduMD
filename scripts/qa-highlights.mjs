import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5187 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("qa-artifacts", { recursive: true });
try {
  for (const width of [760, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md`);
    await page.locator(".markdown-body p").first().waitFor();
    const select = () => page.evaluate(() => {
      const p = document.querySelector(".markdown-body p");
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, Math.min(12, text.length));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
    const clickHighlight = async () => {
      await page.waitForFunction(() => CSS.highlights.has("jingreader-highlight-green") || CSS.highlights.has("jingreader-highlight-blue"));
      const point = await page.evaluate(() => {
        const highlight = CSS.highlights.get("jingreader-highlight-green") ?? CSS.highlights.get("jingreader-highlight-blue");
        const rect = [...highlight][0].getClientRects()[0];
        return { x: rect.left + 4, y: rect.top + rect.height / 2 };
      });
      await page.mouse.click(point.x, point.y);
      await page.getByRole("toolbar", { name: "编辑高亮" }).waitFor();
    };
    await select();
    await page.getByRole("button", { name: "添加绿色高亮" }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.highlights.length === 1 && CSS.highlights.has("jingreader-highlight-green"));
    await clickHighlight();
    await page.getByRole("button", { name: "改为蓝色高亮" }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.highlights[0].color === "blue" && CSS.highlights.has("jingreader-highlight-blue"));
    await select(); // Selecting the exact same passage should recolor, not duplicate it.
    await page.getByRole("button", { name: "添加绿色高亮" }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.highlights[0].color === "green" && CSS.highlights.has("jingreader-highlight-green"));
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.highlights.length), 1);
    await clickHighlight();
    await page.screenshot({ path: join("qa-artifacts", `highlights-toolbar-${width}.png`) });
    await page.getByRole("toolbar", { name: "编辑高亮" }).getByRole("button", { name: "删除高亮" }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.highlights[0].deleted && !CSS.highlights.has("jingreader-highlight-green"));
    await page.getByRole("button", { name: "撤销删除" }).click();
    await page.waitForFunction(() => !window.__JINGREADER_QA__.highlights[0].deleted && CSS.highlights.has("jingreader-highlight-green"));
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "标注管理与备份" }).click();
    const manager = page.getByRole("dialog", { name: "标注管理与备份" });
    await manager.getByRole("heading", { name: "plain-article.md" }).waitFor();
    assert(await page.locator(".topbar").evaluate((el) => el.inert));
    const geometry = await manager.evaluate((el) => ({ overflow: el.scrollWidth > el.clientWidth, bottom: el.getBoundingClientRect().bottom, width: innerWidth, right: el.getBoundingClientRect().right }));
    assert(!geometry.overflow && geometry.bottom <= 900 && geometry.right <= geometry.width);
    await page.screenshot({ path: join("qa-artifacts", `highlights-manager-${width}.png`) });
    console.log(`${width}: create, recolor, delete, undo, manager layout passed`);
    await manager.getByRole("button", { name: "移入回收站" }).click();
    await page.waitForFunction(() => window.__JINGREADER_QA__.highlights[0].deleted);
    await manager.getByRole("tab", { name: /回收站/ }).click();
    await manager.getByRole("button", { name: "恢复这一条" }).click();
    console.log(`${width}: restoring recycle item`);
    await page.waitForFunction(() => !window.__JINGREADER_QA__.highlights[0].deleted);
    await page.waitForFunction(() => !document.querySelector('[aria-label="关闭标注管理"]').disabled);
    await page.keyboard.press("Escape");
    await manager.waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Highlight create/recolor/delete/undo, exact-selection dedup, manager/recycle and responsive layout passed at 760/1280px.");
} catch (error) { console.error(error); process.exitCode = 1;
} finally { await browser.close(); await server.close(); }

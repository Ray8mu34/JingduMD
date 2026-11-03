import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

// Check the native URL scope too: the browser IPC mock cannot enforce Tauri ACLs.
const capability = JSON.parse(await readFile("src-tauri/capabilities/default.json", "utf8"));
assert(capability.permissions.includes("opener:allow-default-urls"));
const server = await createServer({ server: { host: "127.0.0.1", port: 5197 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const results = [];
try {
  for (const { width, repeats } of [760, 1280].flatMap(width => [9, 50].map(repeats => ({ width, repeats })))) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md`);
    await page.locator(".markdown-body p").first().waitFor();
    await page.evaluate(repeats => {
      const qa = window.__JINGREADER_QA__;
      qa.documents.get(qa.selected).content = "# 阅读位置回归\n\n" + Array.from({ length: 80 }, (_, i) => `第${i}段：` + "这里是用于检查高亮后阅读位置是否稳定的正文文字。".repeat(repeats)).join("\n\n");
      qa.emitExternal();
    }, repeats);
    await page.waitForFunction(() => document.querySelectorAll(".markdown-body p").length === 80);
    await page.waitForTimeout(350);
    const scroll = page.locator(".reader-scroll");
    await scroll.hover();
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(350);
    for (let round = 0; round < 4; round++) {
      const before = await page.evaluate(async () => {
        const scroll = document.querySelector(".reader-scroll");
        const viewport = scroll.getBoundingClientRect();
        const p = [...document.querySelectorAll(".markdown-body p")].find(p => p.getBoundingClientRect().top > viewport.top + 30);
        scroll.scrollTop += p.getBoundingClientRect().top - viewport.top - 180;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        p.dataset.positionProbe = "true";
        const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange();
        range.setStart(node, 0); range.setEnd(node, 18);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
        return { top: scroll.scrollTop, text: p.textContent, y: p.getBoundingClientRect().top };
      });
      await page.getByRole("button", { name: "添加黄色高亮" }).click();
      await page.getByRole("toolbar").waitFor({ state: "hidden" });
      await page.waitForTimeout(450);
      const after = await page.evaluate(text => {
        const p = [...document.querySelectorAll(".markdown-body p")].find(p => p.textContent === text);
        return { top: document.querySelector(".reader-scroll").scrollTop, y: p.getBoundingClientRect().top };
      }, before.text);
      assert(Math.abs(after.y - before.y) <= 2, `Highlight moved paragraph: ${JSON.stringify({ width, round, before, after })}`);
      results.push({ width, repeats, round, delta: after.y - before.y });
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(200);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile("qa-artifacts/highlight-position-results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }

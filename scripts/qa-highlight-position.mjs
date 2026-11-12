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
const withImages = process.argv.includes("--images");
try {
  for (const { width, repeats } of [760, 1280].flatMap(width => [9, 50].map(repeats => ({ width, repeats })))) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md${withImages ? "&imageResize" : ""}`);
    await page.locator(".markdown-body p").first().waitFor();
    await page.evaluate(({ repeats, withImages }) => {
      const qa = window.__JINGREADER_QA__;
      qa.documents.get(qa.selected).content = "# 阅读位置回归\n\n" + Array.from({ length: 80 }, (_, i) => `第${i}段：` + "这里是用于检查高亮后阅读位置是否稳定的正文文字。".repeat(repeats) + (withImages && i % 8 === 3 ? `\n\n![测试图${i}](figure-${i}.svg)` : "")).join("\n\n");
      qa.emitExternal();
    }, { repeats, withImages });
    await page.waitForFunction(count => document.querySelectorAll(".markdown-body p").length === count, withImages ? 90 : 80);
    if (withImages) {
      await page.evaluate(() => window.dispatchEvent(new Event("jingreader:expand-for-print")));
      await page.waitForFunction(() => document.querySelectorAll(".image-frame img").length === 10, null, { timeout: 60000 });
      await page.evaluate(() => window.dispatchEvent(new Event("jingreader:restore-after-print")));
      await page.locator(".reader-scroll").evaluate(e => { e.scrollTop = 0; });
    }
    await page.waitForTimeout(350);
    const scroll = page.locator(".reader-scroll");
    await scroll.hover();
    await page.mouse.wheel(0, 2600);
    await page.waitForTimeout(350);
    for (let round = 0; round < 4; round++) {
      const before = await page.evaluate(async () => {
        const scroll = document.querySelector(".reader-scroll");
        const viewport = scroll.getBoundingClientRect();
        const p = [...document.querySelectorAll(".markdown-body p:not(:has(.image-frame))")].find(p => p.getBoundingClientRect().top > viewport.top + 30);
        scroll.scrollTop += p.getBoundingClientRect().top - viewport.top - 180;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        p.dataset.positionProbe = "true";
        const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange();
        range.setStart(node, 0); range.setEnd(node, 18);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
        window.__imageIdentityProbe = [...document.querySelectorAll(".image-frame img")].map(image => ({ image, src: image.src }));
        return { top: scroll.scrollTop, text: p.textContent, y: p.getBoundingClientRect().top };
      });
      await page.getByRole("button", { name: "添加黄色高亮" }).click();
      await page.getByRole("toolbar").waitFor({ state: "hidden" });
      await page.waitForTimeout(450);
      const after = await page.evaluate(text => {
        const p = [...document.querySelectorAll(".markdown-body p")].find(p => p.textContent === text);
        return { top: document.querySelector(".reader-scroll").scrollTop, y: p.getBoundingClientRect().top,
          imagesStable: window.__imageIdentityProbe.every(({image, src}) => image.isConnected && image.src === src) };
      }, before.text);
      assert(Math.abs(after.y - before.y) <= 2, `Highlight moved paragraph: ${JSON.stringify({ width, round, before, after })}`);
      assert(after.imagesStable, "Highlight remounted or reloaded a loaded image");
      results.push({ width, repeats, round, delta: after.y - before.y });
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(200);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  await writeFile(`qa-artifacts/highlight-position${withImages ? "-images" : ""}-results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }

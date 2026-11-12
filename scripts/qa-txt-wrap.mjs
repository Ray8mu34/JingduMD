import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const server = await createServer({ server: { host: "127.0.0.1", port: 5198 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const results = [];
const long = "中文长段落 **格式** 与 English words 123 ".repeat(90) + "https://example.test/" + "a".repeat(400) + " 查找终点";
const content = "# 原样标题\n\n  保留空格 <b>不是 HTML</b>\n\n" + long + "\n";
await mkdir("qa-artifacts", { recursive: true });
try {
  for (const width of [390, 760, 1280]) {
    for (const txt of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const sample = txt ? "wrap-check.TXT" : "plain-article.md";
      await page.route(`**/fixtures/${sample}`, route => route.fulfill({ contentType: "text/plain; charset=utf-8", body: content }));
      await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=${sample}&tabs`);
      await page.locator(".markdown-body").waitFor();
      if (txt) {
        assert.equal(await page.locator(".plain-text-body").textContent(), content);
        assert.equal(await page.locator(".markdown-body h1, .markdown-body b").count(), 0);
        assert.equal(await page.locator(".plain-text-body").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
      }
      await page.getByTitle(txt ? "编辑 TXT 文本" : "编辑 Markdown 源码", { exact: true }).click();
      const area = page.getByRole("textbox", { name: txt ? "TXT 文本" : "Markdown 源码", exact: true });
      assert.equal(await area.inputValue(), content);
      const geometry = await area.evaluate(el => {
        const mirror = document.querySelector(".source-colors");
        return { width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.scrollHeight, mirrorHeight: mirror.scrollHeight, whiteSpace: getComputedStyle(el).whiteSpace, mirrorWhiteSpace: getComputedStyle(mirror).whiteSpace };
      });
      assert(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
      assert(Math.abs(geometry.height - geometry.mirrorHeight) < 3, JSON.stringify(geometry));
      assert.equal(geometry.whiteSpace, "pre-wrap");
      assert.equal(geometry.mirrorWhiteSpace, "pre-wrap");
      await area.press("Control+F");
      const find = page.getByRole("textbox", { name: "查找源码内容", exact: true });
      await find.fill("查找终点"); await find.press("Enter");
      assert.equal(await area.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), "查找终点");
      assert(await area.evaluate(el => el.scrollTop > 0));
      assert(await area.evaluate(el => {
        const mirror = document.querySelector(".source-colors");
        const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
        let offset = el.selectionStart, node;
        while ((node = walker.nextNode())) {
          if (offset < node.length) {
            const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect(), bounds = el.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
          }
          offset -= node.length;
        }
        return false;
      }), "found text must be visible after wrapping");
      await page.getByRole("button", { name: "关闭源码查找" }).click();
      await area.press("Control+End");
      await area.pressSequentially("changed");
      let undoSteps = 0;
      while (await area.inputValue() !== content && undoSteps < 10) { await area.press("Control+Z"); undoSteps++; }
      assert.equal(await area.inputValue(), content);
      for (let i = 0; i < undoSteps; i++) await area.press("Control+Y");
      assert.equal(await area.inputValue(), content + "changed");
      await area.press("Control+S");
      await page.waitForFunction(() => document.querySelector(".source-mode [role=status]")?.textContent === "已保存");
      const saved = await page.evaluate(() => { const qa = window.__JINGREADER_QA__; return qa.documents.get(qa.selected).content; });
      assert.equal(saved, content + "changed", "soft wrapping must not add newline characters");
      await page.screenshot({ path: `qa-artifacts/txt-wrap-${txt ? "txt" : "md"}-${width}.png` });
      assert.deepEqual(errors, []);
      results.push({ width, txt, geometry, passed: true });
      await page.close();
    }
  }
  const links = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await links.route("**/fixtures/plain-article.md", route => route.fulfill({ body: "# 说明\n\n[打开订阅 TXT](订阅.txt)" }));
  await links.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md&tabs`);
  await links.getByRole("link", { name: "打开订阅 TXT" }).waitFor();
  await links.evaluate(text => {
    const qa = window.__JINGREADER_QA__, path = "C:\\qa-fixtures\\订阅.txt";
    qa.documents.set(path, { path, name: "订阅.txt", content: text, modifiedMs: 0, size: text.length, revision: "txt" });
  }, content);
  await links.getByRole("link", { name: "打开订阅 TXT" }).click();
  assert.equal(await links.locator(".plain-text-body").textContent(), content);
  results.push({ markdownLinkToTxt: true, passed: true });
  await links.close();
  await writeFile("qa-artifacts/txt-wrap-results.json", JSON.stringify(results, null, 2));
  console.log("TXT and Markdown wrapping: all 6 viewport/format combinations passed");
} finally { await browser.close(); await server.close(); }

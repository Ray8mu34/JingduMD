import assert from "node:assert/strict";
import { createServer } from "vite";
import { launchQaBrowser } from "./qa-browser.mjs";
const server = await createServer({ server: { host: "127.0.0.1", port: 5191 } });
await server.listen();
const browser = await launchQaBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?tabs=1`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-body h1").waitFor();
  const first = page.getByRole("tab", { name: "reader-showcase.md", exact: true });
  await first.waitFor();
  await page.getByRole("button", { name: "文件列表", exact: true }).click();
  const left = page.getByRole("separator", { name: "文件栏宽度" });
  await left.focus(); await page.keyboard.press("Home"); await page.keyboard.press("ArrowRight");
  assert.equal(await left.getAttribute("aria-valuenow"), "170");
  // Compare positions at the same reading width. Opening/resizing the sidebar
  // reflows text and intentionally restores a text anchor, not an old pixel offset.
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  await page.locator(".reader-scroll").evaluate((element) => { element.dispatchEvent(new WheelEvent("wheel", { bubbles: true })); element.scrollTop = 900; });
  await page.waitForFunction(() => window.__JINGREADER_QA__.positionWrites.length > 0);
  const before = await page.locator(".reader-scroll").evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "plain-article.md", exact: true }).click();
  await page.getByRole("tab", { name: "plain-article.md", exact: true }).waitFor();
  await page.getByRole("heading", { name: "一篇普通文章" }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 2);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("jingreader:sidebar-widths:v1")).treeWidth),170);
  await first.click();
  await page.locator(".markdown-body h1").waitFor();
  try {
    await page.waitForFunction((before) => Math.abs(document.querySelector(".reader-scroll").scrollTop - before) < 100, before);
  } catch (error) {
    console.error("Tab position diagnostic", await page.evaluate((before) => ({ before, after: document.querySelector(".reader-scroll").scrollTop, positions: [...window.__JINGREADER_QA__.positions] }), before));
    throw error;
  }
  assert.equal(await left.getAttribute("aria-valuenow"), "170");
  await page.getByRole("button", { name: "在新窗口打开当前标签页" }).click();
  assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.windowRequests.at(-1)), "C:\\qa-fixtures\\reader-showcase.md");
  const mac = await page.evaluate(() => /mac/i.test(navigator.platform));
  if (mac) await page.evaluate(() => window.__JINGREADER_QA__.emitMenu("reader-new-tab")); else await page.keyboard.press("Control+t");
  await page.getByRole("tab", { name: "新标签页", exact: true }).waitFor();
  await page.getByRole("heading", { name: "打开 Markdown 开始阅读" }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 3);
  if (mac) await page.evaluate(() => window.__JINGREADER_QA__.emitMenu("reader-close-tab")); else await page.keyboard.press("Control+w");
  await page.getByRole("heading", { name: "一篇普通文章" }).waitFor();
  assert.equal(await page.getByRole("tab").count(), 2);
  if (!mac) { await page.keyboard.press("Control+n"); assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.windowRequests.at(-1)), null); }
  await page.getByRole("tab", { name: "reader-showcase.md", exact: true }).click();
  await page.locator(".markdown-body h1").waitFor();
  await page.getByRole("button", { name: "关闭标签页 plain-article.md", exact: true }).click();
  assert.equal(await page.getByRole("tab").count(), 1);
  await page.setViewportSize({ width: 560, height: 700 });
  assert.ok(await page.locator(".topbar").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "split-screen toolbar overflow");
  assert.ok(await page.locator(".document-tabs").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "tab strip overflow");
  const scopes = await page.evaluate(() => [...new Set(window.__JINGREADER_QA__.scopedCalls.filter((call) => call.command === "read_document").map((call) => call.tabId))]);
  assert.equal(scopes.length, 2);
  assert.ok(scopes.every(Boolean));
  assert.deepEqual(errors, []);
  await page.close();
  console.log("Tabs: open/switch/close, position restoration, separate IPC scopes, new windows, shortcuts and 560px layout passed.");
} finally { await browser.close(); await server.close(); }

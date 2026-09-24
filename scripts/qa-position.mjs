import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5187 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
  await page.locator(".markdown-body h1").waitFor();
  await page.getByRole("button", { name: "文件列表" }).click();
  const scroll = page.locator(".reader-scroll");
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(400);
  const oldTop = await scroll.evaluate((element) => element.scrollTop);
  assert(oldTop > 500, `first document is too short to test position inheritance: ${oldTop}`);
  await page.getByRole("button", { name: "plain-article.md" }).click();
  await page.locator(".document-title").getByText("plain-article.md").waitFor();
  await page.waitForTimeout(500);
  const newTop = await scroll.evaluate((element) => element.scrollTop);
  const bPath = "C:\\qa-fixtures\\plain-article.md";
  const bWrites = await page.evaluate((path) => window.__JINGREADER_QA__.positionWrites.filter((item) => item === path).length, bPath);
  assert(newTop <= 2, `new document inherited previous scrollTop: ${newTop}`);
  assert(bWrites === 0, `new document inherited and persisted previous position: ${bWrites} writes`);
  await page.getByRole("button", { name: "reader-showcase.md" }).click();
  await page.waitForFunction((top) => Math.abs(document.querySelector(".reader-scroll").scrollTop - top) < 150, oldTop);
  const returnedTop = await scroll.evaluate((element) => element.scrollTop);
  assert(Math.abs(returnedTop - oldTop) < 150, `return did not recover this window's document position: ${returnedTop}`);

  const cPath = "C:\\qa-fixtures\\delayed-long.md";
  await page.getByRole("button", { name: "delayed-long.md" }).click();
  await page.waitForTimeout(400);
  const longNewTop = await scroll.evaluate((element) => element.scrollTop);
  assert(longNewTop <= 2, `new long document inherited previous position: ${longNewTop}`);
  assert(await page.evaluate((path) => !window.__JINGREADER_QA__.positions.has(path), cPath), "new long document was given a position before user scroll");
  await page.reload();
  await page.locator(".markdown-body h1").waitFor();
  if (await page.getByRole("button", { name: "文件列表" }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "文件列表" }).click();
  await page.evaluate((path) => window.__JINGREADER_QA__.positions.set(path, { path, headingId: null, headingRatio: 0, documentRatio: .7 }), cPath);
  await page.getByRole("button", { name: "delayed-long.md" }).click();
  await page.waitForFunction(() => document.querySelector(".reader-scroll").scrollTop > 100);
  const savedTop = await scroll.evaluate((element) => element.scrollTop);
  assert(savedTop > 100, `existing document position was not restored: ${savedTop}`);

  const invalidPath = "C:\\qa-fixtures\\anonymous-timeline.md";
  await page.evaluate((path) => window.__JINGREADER_QA__.positions.set(path, { path, headingId: "missing", headingRatio: 2, documentRatio: -1 }), invalidPath);
  await page.getByRole("button", { name: "anonymous-timeline.md" }).click();
  await page.waitForTimeout(300);
  assert(await scroll.evaluate((element) => element.scrollTop) <= 2, "invalid saved position did not fall back to top");

  const failedPath = "C:\\qa-fixtures\\readme-sample.md";
  await page.evaluate((path) => {
    window.__JINGREADER_QA__.positions.set(path, { path, headingId: null, headingRatio: 0, documentRatio: .6 });
    window.__JINGREADER_QA__.positionReadFailures.add(path);
  }, failedPath);
  await page.getByRole("button", { name: "readme-sample.md" }).click();
  await page.waitForTimeout(500);
  const failureTop = await scroll.evaluate((element) => element.scrollTop);
  const failedWrites = await page.evaluate((path) => window.__JINGREADER_QA__.positionWrites.filter((item) => item === path).length, failedPath);
  assert(failureTop <= 2 && failedWrites === 0, `failed position read was saved over an existing record: top=${failureTop}, writes=${failedWrites}`);

  await page.evaluate((path) => window.__JINGREADER_QA__.documentReadDelays.set(path, 350), bPath);
  await page.getByRole("button", { name: "plain-article.md" }).click();
  await page.getByRole("button", { name: "reader-showcase.md" }).click();
  await page.waitForTimeout(450);
  assert(await page.locator(".document-title").innerText() === "reader-showcase.md", "slow document load replaced a newer navigation");

  await page.reload();
  await page.locator(".markdown-body h1").waitFor();
  if (await page.getByRole("button", { name: "文件列表" }).getAttribute("aria-expanded") === "false") await page.getByRole("button", { name: "文件列表" }).click();
  await page.evaluate((path) => {
    window.__JINGREADER_QA__.positions.set(path, { path, headingId: null, headingRatio: 0, documentRatio: .9 });
    window.__JINGREADER_QA__.positionReadDelays.set(path, 650);
  }, cPath);
  await page.getByRole("button", { name: "delayed-long.md" }).click();
  await page.locator(".document-title").getByText("delayed-long.md").waitFor();
  await scroll.hover();
  await page.mouse.wheel(0, 720);
  await page.waitForFunction(() => document.querySelector(".reader-scroll").scrollTop > 100);
  const manualTop = await scroll.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(750);
  const afterDelayedRead = await scroll.evaluate((element) => element.scrollTop);
  assert(Math.abs(afterDelayedRead - manualTop) < 150, `late position read overrode user scrolling: ${manualTop} → ${afterDelayedRead}`);
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=navigation-links.md`);
  await page.getByRole("link", { name: "跳转到长文后段" }).waitFor();
  const aPath = "C:\\qa-fixtures\\reader-showcase.md";
  await page.evaluate((path) => window.__JINGREADER_QA__.positions.set(path, { path, headingId: null, headingRatio: 0, documentRatio: .1 }), aPath);
  await page.getByRole("link", { name: "跳转到长文后段" }).click();
  await page.locator(".document-title").getByText("reader-showcase.md").waitFor();
  const targetHeading = page.getByRole("heading", { name: "导航与极端内容" });
  await page.waitForFunction(() => {
    const target = [...document.querySelectorAll(".markdown-body h2")].find((heading) => heading.textContent.includes("导航与极端内容"));
    const viewport = document.querySelector(".reader-scroll").getBoundingClientRect();
    const rect = target?.getBoundingClientRect();
    return rect && rect.top >= viewport.top - 3 && rect.top < viewport.top + 200;
  });
  assert(await targetHeading.isVisible(), "explicit hash target was not visible");
  console.log(JSON.stringify({ oldTop, newTop, bWrites, returnedTop, savedTop, failureTop, failedWrites, rapidNavigation: true, manualTop, afterDelayedRead, explicitHash: true }));
  await page.close();
} finally { await browser.close(); await server.close(); }

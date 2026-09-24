import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5183 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
try {
  for (const width of [760, 1100, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
    await page.locator(".reader-scroll > .markdown-body h1").waitFor();
    const toolbar = page.locator(".topbar");
    if (await toolbar.evaluate((element) => element.scrollWidth > element.clientWidth + 1)) throw new Error(`${width}px toolbar overflow`);
    if (await page.locator(".brand,.edge-toggle,.document-footer").count()) throw new Error(`${width}px retained old shell furniture`);
    await page.screenshot({ path: join(output, `app-shell-${width}.png`) });

    await page.getByRole("button", { name: "文件列表" }).click();
    await page.getByRole("navigation", { name: "文件树" }).waitFor();
    await page.getByRole("button", { name: /plain-article\.md/ }).click();
    await page.getByRole("heading", { name: "一篇普通文章" }).waitFor();
    if ((await page.locator(".left-sidebar").count()) !== (width < 900 ? 0 : 1)) throw new Error(`${width}px file list persistence mismatch`);
    if (width < 900) {
      await page.getByRole("button", { name: "文件列表" }).click();
      await page.locator(".reader-scroll").click({ position: { x: 700, y: 250 } });
      if (await page.locator(".left-sidebar").count()) throw new Error("Narrow overlay stayed open after document click");
      await page.getByRole("button", { name: "文件列表" }).click();
    } else if (width === 1100) {
      await page.setViewportSize({ width: 760, height: 900 });
      await page.waitForFunction(() => !document.querySelector(".left-sidebar"));
      await page.setViewportSize({ width: 1100, height: 900 });
      await page.waitForFunction(() => !!document.querySelector(".left-sidebar"));
    }
    await page.getByRole("button", { name: "搜索文件夹" }).click();
    await page.getByRole("dialog", { name: "全文搜索" }).waitFor();
    if (!await toolbar.evaluate((element) => element.inert)) throw new Error(`${width}px folder search left toolbar active`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[aria-label="全文搜索"]'));
    await page.getByRole("button", { name: "大纲" }).click();
    await page.locator(".right-sidebar .outline").waitFor();
    const activeBackground = await page.locator(".outline button.active").first().evaluate((element) => getComputedStyle(element).backgroundColor);
    if (activeBackground !== "rgba(0, 0, 0, 0)") throw new Error(`${width}px outline current location still has a card fill: ${activeBackground}`);
    await page.getByRole("button", { name: "在当前文档中查找" }).click();
    await page.getByPlaceholder("在当前文档中查找").waitFor();
    await page.close();
  }
  const single = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await single.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=readme-sample.md`);
  await single.locator(".reader-scroll > .markdown-body h1").waitFor();
  if (await single.locator(".right-sidebar").count()) throw new Error("Single-title document opened outline without request");
  await single.getByRole("button", { name: "大纲" }).click();
  await single.getByText("这篇文档没有分节。").waitFor();
  await single.close();
  const folder = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await folder.goto(`${server.resolvedUrls.local[0]}qa-app.html?folderOnly=1`);
  await folder.getByRole("heading", { name: "选择一篇文档" }).waitFor();
  await folder.close();
  const empty = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await empty.goto(`${server.resolvedUrls.local[0]}qa-app.html?noTarget=1`);
  await empty.getByRole("heading", { name: "打开 Markdown 开始阅读" }).waitFor();
  if ((await empty.getByRole("button", { name: "打开文件" }).count()) < 1 || (await empty.getByRole("button", { name: "打开文件夹" }).count()) < 1) throw new Error("Empty state lacks direct open actions");
  await empty.close();
  console.log("Full App shell passed at 760, 1100, 1600px plus single-title and empty states.");
} finally { await browser.close(); await server.close(); }

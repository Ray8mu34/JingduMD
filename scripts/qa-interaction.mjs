import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5182 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  for (const width of [760, 1100, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
    await page.locator(".markdown-body h1").waitFor();
    const more = page.getByRole("button", { name: "更多" });
    const menu = page.getByRole("menu", { name: "更多操作" });
    await more.click();
    await menu.waitFor();
    if (!(await menu.locator('[role="menuitem"]').first().evaluate((element) => element === document.activeElement))) throw new Error(`${width}px: menu did not receive focus`);
    await page.keyboard.press("End");
    if (!(await menu.locator('[role="menuitem"]').last().evaluate((element) => element === document.activeElement))) throw new Error(`${width}px: End did not reach final command`);
    await page.keyboard.press("Escape");
    if (await menu.count() || !(await more.evaluate((element) => element === document.activeElement))) throw new Error(`${width}px: Escape did not close and restore focus`);
    await more.click();
    await page.locator(".reader-scroll > .markdown-body").click({ position: { x: 200, y: 250 } });
    if (await menu.count()) throw new Error(`${width}px: menu remained open after clicking document`);
    await more.click();
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => !document.querySelector('[aria-label="更多操作"]'));
    await more.click();
    await more.click();
    if (await menu.count()) throw new Error(`${width}px: trigger did not toggle menu closed`);
    const settings = page.locator('button[title^="阅读设置"]');
    await settings.click();
    const dialog = page.getByRole("dialog", { name: "阅读设置" });
    await dialog.waitFor();
    if (await dialog.getAttribute("aria-modal") === "true") throw new Error(`${width}px: reading settings claims to be modal`);
    await page.locator(".reader-scroll > .markdown-body").click({ position: { x: 200, y: 250 } });
    if (await dialog.count()) throw new Error(`${width}px: reading settings remained open after document click`);
    await settings.click();
    await dialog.getByRole("button", { name: "增大字号" }).click();
    await page.locator(".reader-scroll > .markdown-body").click({ position: { x: 200, y: 250 } });
    await page.waitForFunction(() => window.__JINGREADER_QA__?.saves.at(-1)?.fontSize === 19);
    await settings.click();
    await page.keyboard.press("Escape");
    if (await dialog.count() || !(await settings.evaluate((element) => element === document.activeElement))) throw new Error(`${width}px: settings Escape did not restore focus`);
    await settings.click();
    await more.click();
    if (!(await menu.count()) || await dialog.count()) throw new Error(`${width}px: switching popovers required an extra click`);
    await menu.getByRole("menuitem", { name: /打印或导出 PDF/ }).click();
    const print = page.getByRole("dialog", { name: "打印选项" });
    await print.waitFor();
    if (!(await page.locator(".topbar").evaluate((element) => element.inert))) throw new Error(`${width}px: print dialog left background interactive`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[aria-label="打印选项"]') && !document.querySelector(".topbar").inert);
    await page.close();
  }
  console.log("Full App menu, settings, focus and save interactions passed at 760, 1100, 1600px.");
} finally { await browser.close(); await server.close(); }

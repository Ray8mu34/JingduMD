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
    await page.getByRole("button", { name: "更多" }).click();
    await page.locator('.toolbar-menu [role="menuitem"]').first().waitFor();
    await page.locator(".markdown-body").click({ position: { x: 200, y: 250 } });
    if (await page.locator('.toolbar-menu [role="menuitem"]').count()) throw new Error(`${width}px: menu remained open after clicking document`);
    await page.close();
  }
  console.log("Full App outside-click interaction passed at 760, 1100, 1600px.");
} finally { await browser.close(); await server.close(); }

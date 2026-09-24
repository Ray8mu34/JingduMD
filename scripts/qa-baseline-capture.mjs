import { createServer } from "vite";
import { chromium } from "playwright";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "");
const server = await createServer({ root, server: { host: "127.0.0.1", port: 5185, fs: { allow: [root, resolve("node_modules")] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  for (const width of [760, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
    await page.locator(".markdown-body h1").waitFor();
    await page.getByRole("button", { name: "阅读设置" }).click();
    await page.screenshot({ path: join(process.cwd(), "qa-artifacts", `refinement-before-${width}.png`) });
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

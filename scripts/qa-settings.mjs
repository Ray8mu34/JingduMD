import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5179 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
try {
  for (const width of [760, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=reader-showcase.md&panel=settings`);
    const settings = page.getByRole("dialog", { name: "阅读设置" });
    await settings.waitFor();
    if (await settings.locator(".simple-choice button").count() !== 6) throw new Error("Expected two typography and four appearance choices");
    if (await settings.locator(".preset-card").count()) throw new Error("Legacy gallery is visible by default");
    await page.screenshot({ path: join(output, `after-settings-${width}.png`) });
    await settings.getByText("更多排版").click();
    await page.screenshot({ path: join(output, `after-settings-advanced-${width}.png`) });
    await page.close();
  }
} finally { await browser.close(); await server.close(); }

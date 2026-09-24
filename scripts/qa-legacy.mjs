import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5177 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
const failures = [];
const channels = (value) => {
  const parts = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  return value.startsWith("color(srgb") ? parts.slice(0, 3) : parts.slice(0, 3).map((part) => part / 255);
};
const luminance = (value) => channels(value).map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4)
  .reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => { const x = luminance(a); const y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
try {
  for (const theme of ["paper", "humanist", "chinese", "editorial", "swiss", "modern-textbook", "solarized", "night", "nord", "eink", "technical"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa.html?legacyTheme=${theme}`);
    await page.locator(".markdown-body table").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const colors = await page.evaluate(() => {
      const code = document.querySelector(".markdown-body pre code");
      code.scrollIntoView();
      const comment = document.createElement("span");
      comment.className = "hljs-comment";
      code.append(comment);
      const values = [getComputedStyle(document.querySelector(".markdown-body")).color,
        getComputedStyle(document.querySelector(".reader-scroll")).backgroundColor,
        getComputedStyle(comment).color,
        getComputedStyle(document.querySelector(".markdown-body pre")).backgroundColor];
      comment.remove();
      return values;
    });
    const ratios = [contrast(colors[0], colors[1]), contrast(colors[2], colors[3])];
    if (ratios.some((value) => value < 4.5)) failures.push({ theme, ratios });
    await page.locator(".reader-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: join(output, `after-legacy-${theme}.png`) });
    console.log(`${theme}: body ${ratios[0].toFixed(2)}, comment ${ratios[1].toFixed(2)}`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
if (failures.length) { console.error(failures); process.exitCode = 1; }

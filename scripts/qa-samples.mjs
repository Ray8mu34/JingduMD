import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5181 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
const samples = ["plain-article.md", "reader-showcase.md", "anonymous-timeline.md", "readme-sample.md", "delayed-long.md"];
const failures = [];
try {
  for (const sample of samples) {
    for (const profile of ["reading", "study"]) {
      for (const appearance of ["warm", "white", "night", "nord"]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=${sample}&profile=${profile}&appearance=${appearance}`);
        await page.locator(".markdown-body h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(() => {
          const article = document.querySelector(".markdown-body");
          const scroll = document.querySelector(".reader-scroll");
          const table = article.querySelector(".table-scroll");
          if (table) table.scrollLeft = table.scrollWidth - table.clientWidth;
          const rightCell = table?.querySelector("tr:last-child td:last-child");
          return {
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
            readerOverflow: scroll.scrollWidth - scroll.clientWidth,
            tableReachable: !rightCell || rightCell.getBoundingClientRect().right <= table.getBoundingClientRect().right + 2,
            badgeLink: !!article.querySelector('a[href="https://example.com/build"] .image-frame'),
            renderTier: article.dataset.renderTier,
            headings: article.querySelectorAll("h1,h2,h3,h4,h5,h6").length
          };
        });
        if (result.pageOverflow > 1 || result.readerOverflow > 1 || !result.tableReachable ||
          (sample === "readme-sample.md" && !result.badgeLink) ||
          (sample === "delayed-long.md" && result.renderTier !== "long")) failures.push({ sample, profile, appearance, result });
        if (profile === "reading" && appearance === "warm") await page.screenshot({ path: join(output, `sample-${sample.replace(".md", "")}.png`), fullPage: false });
        await page.close();
      }
    }
    console.log(`${sample}: 8 combinations checked`);
  }
} finally { await browser.close(); await server.close(); }
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }

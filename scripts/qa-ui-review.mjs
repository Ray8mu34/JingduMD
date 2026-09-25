import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5199 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts", "ui-review");
await mkdir(output, { recursive: true });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const url = (sample) => `${server.resolvedUrls.local[0]}qa-app.html?sample=${sample}`;
try {
  for (const width of [760, 933, 1080, 1380, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url("anonymous-timeline.md"));
    await page.locator('td[data-column-kind="date"]').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const paneWidth = () => page.locator(".reader-pane").evaluate((el) => el.clientWidth);
    await page.getByRole("button", { name: "文件列表", exact: true }).click();
    await page.getByRole("button", { name: "大纲", exact: true }).click();
    check(await paneWidth() >= (width < 1080 ? width - 2 : 580), `${width}: sidebars squeezed reading pane`);
    check(!await page.locator(".topbar").evaluate((el) => el.scrollWidth > el.clientWidth), `${width}: toolbar overflow`);
    await page.getByRole("button", { name: "专注阅读", exact: true }).click();
    check(await page.locator(".left-sidebar,.right-sidebar").count() === 0, "Focus failed to hide sidebars");
    await page.getByRole("button", { name: "文件列表", exact: true }).click();
    check(await page.locator(".left-sidebar").isVisible(), "File button did not leave focus mode and reveal tree");
    await page.getByRole("button", { name: "专注阅读", exact: true }).click();
    const geometry = await page.locator("table").evaluate((table) => {
      const date = table.querySelector('td[data-column-kind="date"]');
      const prose = table.querySelector('td[data-column-kind="prose"]');
      const dateRange = document.createRange(); dateRange.selectNodeContents(date);
      return { dateLines: dateRange.getClientRects().length,
        proseWidth: prose.getBoundingClientRect().width,
        proseFont: parseFloat(getComputedStyle(prose).fontSize),
        viewportOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    check(geometry.dateLines === 1, `${width}: date wrapped across lines`);
    check(geometry.proseWidth >= geometry.proseFont * 10.9, `${width}: prose column too narrow`);
    check(!geometry.viewportOverflow, `${width}: wide table pushed the entire page`);
    await page.locator(".table-scroll").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    check(await page.locator(".table-scroll").evaluate((el) => el.querySelector("tr:last-child td:last-child").getBoundingClientRect().right <= el.getBoundingClientRect().right + 2), "Last column unreachable");
    await page.locator(".table-scroll").evaluate((el) => { el.scrollLeft = 0; });
    await page.screenshot({ path: join(output, `timeline-${width}.png`) });
    if (width === 1380) {
      await page.locator(".topbar").screenshot({ path: join(output, "toolbar-warm.png") });
      await page.getByRole("button", { name: "阅读设置", exact: true }).click();
      const panel = await page.locator(".simple-settings").boundingBox();
      const reader = await page.locator(".reader-pane").boundingBox();
      check(reader.x + reader.width <= panel.x + 1, "Wide settings cover article instead of docking");
      await page.screenshot({ path: join(output, "settings-docked.png") });
      await page.getByRole("radio", { name: "静谧夜读", exact: true }).check();
      await page.getByRole("button", { name: "关闭阅读设置" }).click();
      await page.mouse.move(600, 300);
      await page.waitForTimeout(200);
      await page.locator(".topbar").screenshot({ path: join(output, "toolbar-night.png") });
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
  await page.goto(url("typography-proof.md"));
  const short = page.locator(".code-block").filter({ hasText: "x = 1" }).first();
  await short.scrollIntoViewIfNeeded();
  check((await short.boundingBox()).height < 85, "Single-line code still has excessive chrome");
  await page.screenshot({ path: join(output, "typography.png") });
  await page.goto(url("reader-showcase.md"));
  await page.locator("table").last().waitFor();
  check(await page.locator("table").last().locator("th").count() === 20, "20-column fixture is not rendered as a table");
  await page.getByRole("button", { name: "文件列表", exact: true }).click();
  await page.locator(".reader-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "plain-article.md", exact: true }).click();
  await page.getByRole("heading", { name: "一篇普通文章" }).waitFor();
  await page.getByRole("button", { name: "reader-showcase.md", exact: true }).click();
  await page.getByText("已回到上次阅读位置", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返回文首", exact: true }).click();
  await page.waitForTimeout(200);
  check(await page.locator(".reader-scroll").evaluate((el) => el.scrollTop) <= 2, "Return to top did not override restored position");
  check(await page.locator(".position-notice").count() === 0, "Restoration notice did not dismiss");
  await page.close();
  console.log("UI review passed: 760/933/1080/1380/1600px; focus, date/prose columns, horizontal reachability, settings dock, short code, 20-column fixture.");
} finally { await browser.close(); await server.close(); }

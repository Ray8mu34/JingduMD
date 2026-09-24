import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const label = process.argv.find((arg) => arg.startsWith("--label="))?.slice(8) ?? "after";
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const dpiText = execFileSync("reg", ["query", "HKCU\\Control Panel\\Desktop\\WindowMetrics", "/v", "AppliedDPI"], { encoding: "utf8" });
const windowsAppliedDpi = Number.parseInt(dpiText.match(/AppliedDPI\s+REG_DWORD\s+(0x[0-9a-f]+)/i)?.[1] ?? "", 16) || null;
const server = await createServer({ server: { host: "127.0.0.1", port: 5186 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
const records = [];
const failures = [];
try {
  for (const sample of ["plain-article.md", "typography-proof.md", "reader-showcase.md", "anonymous-timeline.md", "readme-sample.md", "delayed-long.md"]) {
    for (const profile of ["reading", "study"]) {
      for (const scale of [1, 1.25, 1.5]) {
        const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: scale });
        const page = await context.newPage();
        await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=${sample}&profile=${profile}&appearance=warm`);
        await page.locator(".markdown-body h1").waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => {
          const article = document.querySelector(".markdown-body");
          const scroll = document.querySelector(".reader-scroll");
          const shortCode = [...article.querySelectorAll(".code-block")].find((node) => node.querySelector("pre")?.innerText.trim().length < 16);
          const table = article.querySelector(".table-scroll");
          if (table) table.scrollLeft = table.scrollWidth - table.clientWidth;
          const lastCell = table?.querySelector("tr:last-child td:last-child");
          return {
            articleWidth: article.getBoundingClientRect().width,
            bodyFont: getComputedStyle(article).fontFamily,
            headingFont: getComputedStyle(article.querySelector("h1")).fontFamily,
            leading: getComputedStyle(article).lineHeight,
            paragraphGap: getComputedStyle(article.querySelector("p")).marginBottom,
            headingScale: getComputedStyle(article.querySelector("h1")).fontSize,
            pageOverflow: document.documentElement.scrollWidth - innerWidth,
            scrollOverflow: scroll.scrollWidth - scroll.clientWidth,
            shortCodeExtraWidth: shortCode ? shortCode.getBoundingClientRect().width - article.getBoundingClientRect().width : null,
            lastCellReachable: !lastCell || lastCell.getBoundingClientRect().right <= table.getBoundingClientRect().right + 2,
            renderTier: article.dataset.renderTier
          };
        });
        const fonts = {};
        if (scale === 1.5 && sample === "typography-proof.md") {
          await page.locator(".markdown-body .math-display").first().scrollIntoViewIfNeeded();
          await page.locator(".markdown-body .math-display .katex").first().waitFor();
          const client = await context.newCDPSession(page);
          await client.send("DOM.enable"); await client.send("CSS.enable");
          const { root } = await client.send("DOM.getDocument");
          for (const [name, selector] of Object.entries({ body: ".markdown-body > p", heading: ".markdown-body h2", code: ".markdown-body pre code" })) {
            const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector });
            if (nodeId) fonts[name] = (await client.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map(({ familyName, glyphCount }) => ({ familyName, glyphCount }));
          }
          const { nodeIds } = await client.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".markdown-body .math-display .katex span" });
          const formulaFamilies = new Map();
          for (const nodeId of nodeIds.slice(0, 100)) {
            for (const { familyName, glyphCount } of (await client.send("CSS.getPlatformFontsForNode", { nodeId })).fonts) {
              formulaFamilies.set(familyName, (formulaFamilies.get(familyName) ?? 0) + glyphCount);
            }
          }
          fonts.formula = [...formulaFamilies].map(([familyName, glyphCount]) => ({ familyName, glyphCount }));
        }
        const record = { label, sha, sample, profile, appearance: "warm", styleMode: "canonical", cssViewport: "1100x900", simulatedDeviceScaleFactor: scale, windowsAppliedDpi, metrics, fonts };
        records.push(record);
        if (metrics.pageOverflow > 1 || metrics.scrollOverflow > 1 || !metrics.lastCellReachable || (metrics.shortCodeExtraWidth != null && metrics.shortCodeExtraWidth > 2)) failures.push(record);
        if (scale === 1.5 && ["plain-article.md", "typography-proof.md", "reader-showcase.md"].includes(sample)) {
          const stem = sample.replace(".md", "");
          await page.locator(".reader-scroll").evaluate((element) => { element.scrollTop = 0; });
          await page.screenshot({ path: join(output, `u4-${label}-${stem}-${profile}-first.png`) });
          const target = sample === "typography-proof.md" ? page.locator(".markdown-body h2").first() : page.locator(".markdown-body h2").first();
          if (await target.count()) {
            await target.scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(output, `u4-${label}-${stem}-${profile}-middle.png`) });
          }
          if (sample === "typography-proof.md") {
            await page.locator(".markdown-body .table-frame").scrollIntoViewIfNeeded();
            await page.screenshot({ path: join(output, `u4-${label}-${stem}-${profile}-wide.png`) });
          }
        }
        await context.close();
      }
    }
    console.log(`${sample}: reading/study × 100/125/150% device scale checked`);
  }
  const proof = records.filter((item) => item.sample === "typography-proof.md" && item.simulatedDeviceScaleFactor === 1.5);
  if (proof.length === 2) {
    const [reading, study] = proof;
    if (reading.metrics.bodyFont !== study.metrics.bodyFont || reading.metrics.headingFont === study.metrics.headingFont || !reading.fonts.formula?.length || !study.fonts.formula?.length) failures.push({ error: "profile font roles or KaTeX loading", reading: reading.fonts, study: study.fonts });
  }
  for (const profile of ["reading", "study"]) {
    const context = await browser.newContext({ viewport: { width: 760, height: 900 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=typography-proof.md&profile=${profile}&appearance=warm`);
    await page.locator(".markdown-body .table-frame").waitFor();
    await page.locator(".markdown-body .math-display .katex").first().waitFor();
    const narrow = await page.evaluate(() => {
      const article = document.querySelector(".markdown-body");
      const scroll = document.querySelector(".reader-scroll");
      const table = article.querySelector(".table-scroll");
      table.scrollLeft = table.scrollWidth - table.clientWidth;
      const lastCell = table.querySelector("tr:last-child td:last-child");
      return { pageOverflow: document.documentElement.scrollWidth - innerWidth, scrollOverflow: scroll.scrollWidth - scroll.clientWidth, lastCellReachable: lastCell.getBoundingClientRect().right <= table.getBoundingClientRect().right + 2, shortCodeExtraWidth: article.querySelector(".code-block:not(.is-wide)").getBoundingClientRect().width - article.getBoundingClientRect().width };
    });
    if (narrow.pageOverflow > 1 || narrow.scrollOverflow > 1 || !narrow.lastCellReachable || narrow.shortCodeExtraWidth > 2) failures.push({ profile, narrow });
    await page.locator(".reader-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.locator(".markdown-body h2").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `u4-${label}-typography-proof-${profile}-760-middle.png`) });
    await context.close();
  }
  await writeFile(join(output, `u4-${label}-metrics.json`), JSON.stringify(records, null, 2));
} finally { await browser.close(); await server.close(); }
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }

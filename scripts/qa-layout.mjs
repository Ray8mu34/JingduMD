import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5176 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = join(process.cwd(), "qa-artifacts");
await mkdir(output, { recursive: true });
const failures = [];
const geometry = new Map();
function channels(value) {
  if (value.startsWith("#")) return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255);
  const parts = value.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  return value.startsWith("color(srgb") ? parts.slice(0, 3) : parts.slice(0, 3).map((part) => part / 255);
}
function contrast(a, b) {
  const luminance = (rgb) => rgb.map((part) => part <= .04045 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4)
    .reduce((sum, part, index) => sum + part * [.2126, .7152, .0722][index], 0);
  const x = luminance(channels(a));
  const y = luminance(channels(b));
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

try {
  for (const width of [760, 1100, 1600]) {
    for (const profile of ["reading", "study"]) {
      for (const appearance of ["warm", "white", "night", "nord"]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await page.goto(`${base}qa.html?sample=reader-showcase.md&profile=${profile}&appearance=${appearance}`);
        await page.locator(".markdown-body table").first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.locator(".code-block").last().scrollIntoViewIfNeeded();
        await page.locator(".hljs-comment").first().waitFor({ timeout: 10000 });
        const result = await page.evaluate(() => {
          const scroll = document.querySelector(".reader-scroll");
          const tables = [...document.querySelectorAll(".table-scroll")];
          const fullPageOverflow = document.documentElement.scrollWidth - innerWidth;
          const last = tables.at(-1);
          if (last) last.scrollLeft = last.scrollWidth - last.clientWidth;
          const rightCell = last?.querySelector("tr:last-child td:last-child");
          const reachable = !!last && !!rightCell && rightCell.getBoundingClientRect().right <= last.getBoundingClientRect().right + 2;
          const code = document.querySelector(".hljs");
          const colors = ["", "comment", "keyword", "string", "number", "title"].map((kind) => {
            const span = document.createElement("span");
            if (kind) span.className = `hljs-${kind}`;
            code.append(span);
            const color = getComputedStyle(span).color;
            span.remove();
            return [kind || "text", color];
          });
          return { fullPageOverflow, reachable, controls: document.querySelectorAll(".table-scroll-control").length,
            overflowTables: tables.filter((table) => table.scrollWidth > table.clientWidth + 1).length, colors,
            headingHeight: document.querySelector(".markdown-body h1").getBoundingClientRect().height,
            paragraphHeight: document.querySelector(".markdown-body p").getBoundingClientRect().height,
            articleWidth: document.querySelector(".markdown-body").getBoundingClientRect().width,
            pageWidth: scroll.scrollWidth - scroll.clientWidth, codeBackground: getComputedStyle(document.querySelector(".code-block pre")).backgroundColor,
            bodyColor: getComputedStyle(document.querySelector(".markdown-body")).color, bodyBackground: getComputedStyle(scroll).backgroundColor };
        });
        const ratios = Object.fromEntries(result.colors.map(([kind, color]) => [kind, contrast(color, result.codeBackground)]));
        ratios.body = contrast(result.bodyColor, result.bodyBackground);
        const key = `${width}-${profile}`;
        const dimensions = [result.headingHeight, result.paragraphHeight, result.articleWidth];
        if (!geometry.has(key)) geometry.set(key, dimensions);
        const geometryStable = dimensions.every((value, index) => Math.abs(value - geometry.get(key)[index]) < 1);
        if (width === 760 && profile === "reading" && appearance === "warm") {
          result.sticky = await page.evaluate(async () => {
            const frame = [...document.querySelectorAll(".table-frame")].find((item) => item.querySelector(".table-scroll-control"));
            const row = frame?.querySelector("tbody tr");
            if (!frame || !row) return false;
            const body = row.parentElement;
            for (let i = 0; i < 45; i++) body.append(row.cloneNode(true));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const scroll = document.querySelector(".reader-scroll");
            scroll.scrollTop = frame.offsetTop + frame.clientHeight / 2;
            await new Promise((resolve) => setTimeout(resolve, 100));
            const top = frame.querySelector(".table-scroll-control").getBoundingClientRect().top;
            const viewportTop = scroll.getBoundingClientRect().top;
            return top >= viewportTop - 2 && top <= viewportTop + 8;
          });
          result.keyboard = await page.evaluate(() => {
            const table = [...document.querySelectorAll(".table-scroll")].find((element) => element.scrollWidth > element.clientWidth + 1);
            if (!table) return false;
            table.scrollLeft = 0;
            table.focus();
            return true;
          });
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(100);
          result.keyboard &&= await page.evaluate(() => [...document.querySelectorAll(".table-scroll")].some((element) => element.scrollWidth > element.clientWidth + 1 && element.scrollLeft > 0));
        }
        if (result.fullPageOverflow > 1 || result.pageWidth > 1 || !result.reachable || (result.overflowTables > 0 && !result.controls) || result.sticky === false || result.keyboard === false || !geometryStable || Object.values(ratios).some((value) => value < 4.5)) failures.push({ width, profile, appearance, result, ratios, geometryStable });
        if (width === 1100) { await page.locator(".reader-scroll").evaluate((element) => { element.scrollTop = 0; }); await page.screenshot({ path: join(output, `after-${profile}-${appearance}.png`), fullPage: false }); }
        console.log(JSON.stringify({ width, profile, appearance, overflow: result.fullPageOverflow, reachable: result.reachable, controls: result.controls, ratios }));
        await page.close();
      }
    }
  }
} finally { await browser.close(); await server.close(); }
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }

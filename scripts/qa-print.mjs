import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const server = await createServer({ server: { host: "127.0.0.1", port: 5178 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const temporary = join(process.cwd(), "tmp", "pdfs");
const output = join(process.cwd(), "qa-artifacts");
await mkdir(temporary, { recursive: true });
await mkdir(output, { recursive: true });
const pdfPath = join(temporary, "print-long-content.pdf");
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=reader-showcase.md&profile=study&appearance=warm`);
  await page.locator(".markdown-body table").first().waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("jingreader:expand-for-print")));
  await page.waitForFunction(() => [...document.querySelectorAll(".math-display")].every((element) => element.querySelector(".katex")), undefined, { timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".code-block")].every((element) => element.querySelector(".hljs")), undefined, { timeout: 15000 });
  await page.evaluate(() => {
    const tbody = document.querySelector(".table-frame tbody");
    const row = tbody.querySelector("tr");
    for (let i = 0; i < 80; i++) tbody.append(row.cloneNode(true));
    tbody.lastElementChild.lastElementChild.textContent = "最后一行仍可读";
    const code = document.querySelector(".code-block pre code");
    code.textContent = Array.from({ length: 110 }, (_, index) => `console.log("print line ${index + 1}");`).join("\n") + "\nconsole.log(\"print-last-line\");";
  });
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  if (pages < 3 || !text.includes("最后一行仍可读") || !text.includes("print-last-line")) throw new Error(`Print content missing: pages=${pages}`);
  execFileSync("pdftoppm", ["-f", "1", "-l", "2", "-png", "-r", "110", pdfPath, join(output, "print-page")]);
  console.log(`Printed ${pages} pages; final table cell and code line are present.`);
  await page.close();
} finally { await browser.close(); await server.close(); await rm(pdfPath, { force: true }); }

import { createServer } from "vite";
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const server = await createServer({ server: { host: "127.0.0.1", port: 5194 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
  await page.locator(".markdown-body h1").waitFor();
  await page.getByRole("button", { name: "阅读设置" }).click();
  const before = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const paragraph = [...article.querySelectorAll("p")].find((item) => [...item.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.length > 10));
    const text = [...paragraph.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.length > 10);
    const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 8);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    window.__R5_PROOF__ = { article, paragraph, selected: getSelection().toString() };
    const heading = article.querySelector("h1");
    const rect = article.getBoundingClientRect();
    return { width: rect.width, bodySize: getComputedStyle(article).fontSize, leading: getComputedStyle(article).lineHeight, headingSize: getComputedStyle(heading).fontSize, paragraphGap: getComputedStyle(paragraph).marginBottom, shellHeight: document.querySelector(".topbar").getBoundingClientRect().height, selection: getSelection().toString() };
  });
  assert(before.selection.length === 6, "selection proof was not created");
  for (const name of ["素白", "静谧夜读", "Nord 极夜", "暖纸"]) {
    await page.getByRole("radio", { name }).check();
    const current = await page.evaluate(() => {
      const article = document.querySelector(".markdown-body");
      const first = window.__R5_PROOF__.paragraph;
      return { sameArticle: article === window.__R5_PROOF__.article, sameParagraph: first === window.__R5_PROOF__.paragraph, selection: getSelection().toString(), width: article.getBoundingClientRect().width, bodySize: getComputedStyle(article).fontSize, leading: getComputedStyle(article).lineHeight, headingSize: getComputedStyle(article.querySelector("h1")).fontSize, paragraphGap: getComputedStyle(first).marginBottom, shellHeight: document.querySelector(".topbar").getBoundingClientRect().height };
    });
    assert(current.sameArticle && current.sameParagraph && current.selection === before.selection, `${name} rebuilt prose or cleared selection`);
    for (const key of ["width", "bodySize", "leading", "headingSize", "paragraphGap", "shellHeight"]) assert(current[key] === before[key], `${name} changed ${key}`);
  }
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  await page.waitForFunction(() => window.__JINGREADER_QA__.saves.length > 0);
  await page.evaluate(() => {
    const state = window.__JINGREADER_QA__;
    const current = state.saves.at(-1);
    state.emitPreferences({ ...current, fontSize: 26, typographyOverrides: { ...current.typographyOverrides, reading: {
      ...current.typographyOverrides.reading, lineHeight: 1.5, contentWidth: 640, paragraphSpacing: 1.3,
      codeScale: .9, formulaScale: 1.05, chineseHeadingFont: "SimSun", latinHeadingFont: "Arial"
    } } });
  });
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".markdown-body")).fontSize === "26px");
  const tokens = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const paragraph = article.querySelector("p");
    const code = article.querySelector("p code");
    const math = article.querySelector(".lazy-math.math-inline");
    return { size: parseFloat(getComputedStyle(article).fontSize), leading: parseFloat(getComputedStyle(article).lineHeight), width: article.getBoundingClientRect().width, gap: parseFloat(getComputedStyle(paragraph).marginBottom), code: parseFloat(getComputedStyle(code).fontSize), math: parseFloat(getComputedStyle(math).fontSize), shellHeight: document.querySelector(".topbar").getBoundingClientRect().height };
  });
  assert(tokens.size === 26 && Math.abs(tokens.leading - 39) < .1 && Math.abs(tokens.width - 640) < 1, `body tokens did not reach geometry: ${JSON.stringify(tokens)}`);
  assert(Math.abs(tokens.gap - 33.8) < 1 && Math.abs(tokens.code - 23.4) < 1 && Math.abs(tokens.math - 25.935) < 1, `block tokens did not reach elements: ${JSON.stringify(tokens)}`);
  assert(tokens.shellHeight === before.shellHeight, "reader size changed toolbar geometry");
  const blocks = page.locator(".markdown-body .code-block");
  await blocks.first().scrollIntoViewIfNeeded();
  assert(await blocks.count() >= 2, "labelled and unlabelled fenced blocks are missing");
  const codeStyles = await blocks.evaluateAll((elements) => elements.slice(0, 2).map((block) => {
    const pre = block.querySelector("pre"); const code = pre.querySelector("code");
    return { preBackground: getComputedStyle(pre).backgroundColor, prePadding: getComputedStyle(pre).padding, codeFamily: getComputedStyle(code).fontFamily, codeSize: getComputedStyle(code).fontSize, codeDisplay: getComputedStyle(code).display };
  }));
  assert(JSON.stringify(codeStyles[0]) === JSON.stringify(codeStyles[1]), `unlabelled fenced code has different layout: ${JSON.stringify(codeStyles)}`);
  await page.emulateMedia({ media: "print" });
  const print = await page.evaluate(() => ({ heading: getComputedStyle(document.querySelector(".markdown-body h2")).fontFamily, body: getComputedStyle(document.querySelector(".markdown-body")).fontFamily, code: getComputedStyle(document.querySelector(".markdown-body code")).fontFamily }));
  assert(print.heading.includes("JingReader Heading CJK") && print.heading.includes("JingReader Heading Latin"), "print lost heading font roles");
  assert(print.code.includes("Cascadia Code") && print.body.length > 0, "print lost body or code fonts");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const documentNode = await cdp.send("DOM.getDocument");
  const headingNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".markdown-body h2" });
  const usedFonts = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: headingNode.nodeId })).fonts.map((font) => font.familyName);
  assert(usedFonts.includes("Arial") && usedFonts.includes("SimSun"), `print media substituted configured heading fonts: ${usedFonts}`);
  await page.pdf({ path: "qa-artifacts/r5-custom-font-print.pdf", printBackground: true });
  const pdfFonts = execFileSync("pdffonts", ["qa-artifacts/r5-custom-font-print.pdf"], { encoding: "utf8" });
  assert(pdfFonts.includes("Arial-BoldMT") && pdfFonts.includes("SimSun"), "PDF omitted configured heading faces");
  await page.emulateMedia({ media: "screen" });
  console.log(JSON.stringify({ appearances: 4, selectionPreserved: true, tokenConsumers: tokens, fencedCodeConsistent: true, printRoles: usedFonts, embeddedPdfFonts: ["Arial-BoldMT", "SimSun"] }));
  await page.close();
} finally { await browser.close(); await server.close(); }

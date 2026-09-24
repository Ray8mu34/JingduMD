import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5192 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
  await page.locator(".markdown-body h1").waitFor();
  const formulas = page.locator(".markdown-body .lazy-math.math-display");
  for (let index = 0; index < await formulas.count(); index++) {
    const formula = formulas.nth(index);
    await formula.scrollIntoViewIfNeeded();
    await formula.locator(".katex").waitFor();
  }
  const records = [];
  for (const fontSize of [14, 18.5, 26]) for (const width of [360, 520, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((size) => {
      const state = window.__JINGREADER_QA__;
      const current = state.saves.at(-1);
      state.emitPreferences({ ...current, fontSize: size });
    }, fontSize);
    await page.waitForFunction((size) => parseFloat(getComputedStyle(document.querySelector(".markdown-body")).fontSize) === size, fontSize);
    for (let index = 0; index < await formulas.count(); index++) {
      await formulas.nth(index).scrollIntoViewIfNeeded();
      await formulas.nth(index).locator(".katex").waitFor();
    }
    const metrics = await page.evaluate(() => {
      const wrappers = [...document.querySelectorAll(".markdown-body .lazy-math.math-display")];
      return wrappers.map((wrapper) => {
        const display = wrapper.querySelector(".katex-display");
        const katex = wrapper.querySelector(".katex");
        const rectangle = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const measure = (element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowX: getComputedStyle(element).overflowX, overflowY: getComputedStyle(element).overflowY, fontSize: getComputedStyle(element).fontSize, rect: rectangle(element) });
        return { wrapper: measure(wrapper), display: display ? measure(display) : null, katex: katex ? measure(katex) : null };
      });
    });
    const reach = await page.evaluate(() => {
      const scroll = document.querySelector(".reader-scroll");
      const wide = [...document.querySelectorAll(".lazy-math.math-display")].filter((element) => element.scrollWidth > element.clientWidth + 1);
      return { pageOverflow: scroll.scrollWidth - scroll.clientWidth, ends: wide.map((element) => {
        const maximum = element.scrollWidth - element.clientWidth;
        element.scrollLeft = maximum;
        return { maximum, reached: element.scrollLeft };
      }) };
    });
    if (reach.pageOverflow > 1 || reach.ends.some(({ maximum, reached }) => Math.abs(maximum - reached) > 1)) throw new Error(`wide formula cannot be reached at ${fontSize}px / ${width}px: ${JSON.stringify(reach)}`);
    records.push({ fontSize, width, metrics });
  }
  for (const record of records) for (const [index, { wrapper, display }] of record.metrics.entries()) {
    if (wrapper.scrollHeight > wrapper.clientHeight + 1) throw new Error(`vertical formula overflow at ${record.fontSize}px / ${record.width}px / formula ${index + 1}`);
    if (wrapper.overflowY !== "hidden" || wrapper.overflowX !== "auto") throw new Error("formula scroll axes are not isolated");
    if (display.overflowX !== "visible" || display.overflowY !== "visible" || display.scrollHeight > display.clientHeight + 1) throw new Error("inner formula is clipped or separately scrollable");
    if (index === 0 && wrapper.scrollWidth > wrapper.clientWidth + 1) throw new Error("short formula scrolls horizontally");
  }
  const defaultOpticalFactor = parseFloat(records[0].metrics[0].katex.fontSize) / records[0].fontSize;
  if (Math.abs(defaultOpticalFactor - 1.15) > .01) throw new Error(`default formula scale is ${defaultOpticalFactor}, expected about 1.15`);
  await page.setViewportSize({ width: 950, height: 750 });
  for (const bodyFont of ["default", "SimSun"]) for (const [label, scale] of [["110", 1.1 / 1.15], ["115", 1], ["121", 1.21 / 1.15]]) {
    await page.evaluate((factor) => {
      const state = window.__JINGREADER_QA__;
      const current = state.saves.at(-1);
      state.emitPreferences({ ...current, fontSize: 18.5, typographyOverrides: { ...current.typographyOverrides, reading: { ...current.typographyOverrides.reading, formulaScale: factor.scale, chineseFont: factor.bodyFont === "default" ? "" : factor.bodyFont } } });
    }, { scale, bodyFont });
    await page.waitForFunction((factor) => Math.abs(parseFloat(getComputedStyle(document.querySelector(".lazy-math.math-display")).fontSize) - 18.5 * factor * .95) < .02, scale);
    await page.waitForFunction((family) => getComputedStyle(document.querySelector(".markdown-body")).fontFamily.includes('"JingReader CJK"') === (family !== "default"), bodyFont);
    await formulas.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `qa-artifacts/r4-optical-${bodyFont === "default" ? "default" : "custom"}-${label}.png` });
  }
  const contentProof = await page.evaluate(() => {
    const inline = document.querySelector(".lazy-math.math-inline");
    const article = document.querySelector(".markdown-body");
    const tag = [...document.querySelectorAll(".katex-mathml annotation")].find((node) => node.textContent.includes("\\tag"));
    return { inlineHeight: inline.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(article).lineHeight), tag: tag?.textContent ?? "" };
  });
  if (contentProof.inlineHeight > contentProof.lineHeight * 1.5 || !contentProof.tag.includes("原文 1")) throw new Error(`inline math or author tag was lost: ${JSON.stringify(contentProof)}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const documentNode = await cdp.send("DOM.getDocument");
  const mathNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".lazy-math.math-display .katex .mord" });
  const loadedFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: mathNode.nodeId });
  if (!loadedFonts.fonts.some((font) => font.familyName.startsWith("KaTeX_"))) throw new Error(`KaTeX font did not load: ${JSON.stringify(loadedFonts.fonts)}`);
  await page.emulateMedia({ media: "print" });
  const printOverflow = await page.evaluate(() => [...document.querySelectorAll(".lazy-math.math-display")].map((element) => getComputedStyle(element).overflowX));
  if (printOverflow.some((value) => value !== "visible")) throw new Error(`print math remains scrollable: ${printOverflow}`);
  await page.emulateMedia({ media: "screen" });
  console.log(JSON.stringify({ cases: records.length, formulas: records[0].metrics.length, verticalOverflow: 0, wideFormulaEndsReachable: true, inlineMathAndTag: true, printOverflow: "visible", opticalCandidates: [1.1, 1.15, 1.21], selectedOpticalFactor: Number(defaultOpticalFactor.toFixed(3)) }));
  await page.close();
} finally { await browser.close(); await server.close(); }

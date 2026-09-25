import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5197 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=chinese-longform.md`);
  await page.locator(".markdown-body h1").waitFor();
  await page.evaluate(() => {
    const state = window.__JINGREADER_QA__;
    state.fonts.push({ family: "Georgia", displayName: "Georgia", aliases: [], supportsCjk: false, supportsLatin: true });
    state.emitPreferences({ ...state.basePreferences, typographyOverrides: { ...state.basePreferences.typographyOverrides, reading: { paragraphStyle: "indent", firstLineIndent: 2 } } });
  });
  await page.waitForFunction(() => document.querySelector(".app").classList.contains("paragraph-indent"));
  const prose = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const first = article.querySelector("h1 + p");
    const afterSection = article.querySelector("h2 + p");
    const later = article.querySelector("p + p");
    const math = article.querySelector(".math-inline");
    const firstStyle = getComputedStyle(first);
    return {
      indentFirst: firstStyle.textIndent,
      indentSection: getComputedStyle(afterSection).textIndent,
      indentLater: getComputedStyle(later).textIndent,
      width: article.getBoundingClientRect().width,
      color: getComputedStyle(article).color,
      headingColor: getComputedStyle(article.querySelector("h1")).color,
      mathColor: getComputedStyle(math).color,
      lineBreak: firstStyle.lineBreak,
      wordBreak: firstStyle.wordBreak,
      prettySupported: CSS.supports("text-wrap", "pretty"),
      textWrap: firstStyle.textWrap,
      pageOverflow: document.querySelector(".reader-scroll").scrollWidth - document.querySelector(".reader-scroll").clientWidth
    };
  });
  assert(prose.indentFirst === "37px" && prose.indentSection === "37px" && prose.indentLater === "37px", `first lines disagree: ${JSON.stringify(prose)}`);
  assert(prose.width === 760 && prose.pageOverflow <= 1, `reader width changed: ${JSON.stringify(prose)}`);
  assert(prose.lineBreak === "strict" && prose.wordBreak === "normal", `CJK break policy missing: ${JSON.stringify(prose)}`);
  if (prose.prettySupported) assert(prose.textWrap.includes("pretty"), `pretty wrapping was not applied: ${JSON.stringify(prose)}`);
  assert(prose.color === prose.mathColor && prose.color !== prose.headingColor, `warm ink or math color diverged: ${JSON.stringify(prose)}`);
  const ink = prose.color.match(/\d*\.?\d+/g).map(Number);
  const rgb = prose.color.startsWith("color(srgb") ? ink.map((channel) => channel * 255) : ink;
  assert(rgb.every((channel, index) => Math.abs(channel - [71, 65, 59][index]) < .5) && prose.headingColor === "rgb(48, 45, 41)", `warm body or heading ink changed unexpectedly: ${JSON.stringify(prose)}`);

  const tails = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const samples = [...article.querySelectorAll(":scope > p")].filter((item) => !item.querySelector("*")).slice(0, 16);
    const linesFor = (content, width, textWrap) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = content;
      Object.assign(paragraph.style, { position: "absolute", visibility: "hidden", contentVisibility: "visible", width: `${width}px`, textWrap });
      article.append(paragraph);
      const node = paragraph.firstChild;
      const range = document.createRange();
      const lines = new Map();
      for (let index = 0; index < node.textContent.length; index++) {
        range.setStart(node, index); range.setEnd(node, index + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        lines.set(top, (lines.get(top) ?? "") + node.textContent[index]);
      }
      paragraph.remove();
      return [...lines.values()];
    };
    const source = samples[0].textContent;
    const pairs = Array.from({ length: 100 }, (_, index) => {
      const content = `${source.slice(0, 40 + index)}字。`;
      return { normal: linesFor(content, 760, "wrap").at(-1).length, pretty: linesFor(content, 760, "pretty").at(-1).length };
    });
    const forbiddenStart = /^[，。！？；：、）》」』】]/;
    const forbiddenEnd = /[（《「『【“]$/;
    const punctuationIssues = samples.slice(0, 4).flatMap((paragraph) => [640, 760].flatMap((width) =>
      linesFor(paragraph.textContent, width, "pretty").filter((line) => forbiddenStart.test(line.trimStart()) || forbiddenEnd.test(line.trimEnd()))));
    return { checked: pairs.length, shortNormal: pairs.filter((item) => item.normal <= 2).length,
      shortPretty: pairs.filter((item) => item.pretty <= 2).length,
      improved: pairs.filter((item) => item.pretty > item.normal).length,
      worsened: pairs.filter((item) => item.pretty < item.normal).length, punctuationIssues };
  });
  assert(tails.shortNormal > 0, `short-tail sample did not reproduce: ${JSON.stringify(tails)}`);
  assert(tails.punctuationIssues.length === 0, `CJK punctuation broke at line edges: ${JSON.stringify(tails)}`);

  await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const paragraph = document.createElement("p");
    paragraph.textContent = `中西混排 ${"Supercalifragilisticexpialidocious".repeat(8)} 与数学符号相邻。`;
    article.append(paragraph);
  });
  const longWord = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    const paragraph = article.lastElementChild;
    return { paragraphOverflow: paragraph.scrollWidth - paragraph.clientWidth, pageOverflow: document.querySelector(".reader-scroll").scrollWidth - document.querySelector(".reader-scroll").clientWidth };
  });
  assert(longWord.paragraphOverflow <= 1 && longWord.pageOverflow <= 1, `long Latin word overflowed: ${JSON.stringify(longWord)}`);

  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: /详细排版/ }).click();
  await page.getByRole("button", { name: "字体", exact: true }).click();
  await page.getByText("Noto Serif SC × Georgia；数学保留 KaTeX").waitFor();
  await page.screenshot({ path: "qa-artifacts/font-pair-option.png" });
  const savesBefore = await page.evaluate(() => window.__JINGREADER_QA__.saves.length);
  await page.getByRole("button", { name: "应用到两套排版" }).click();
  await page.waitForFunction(() => window.__JINGREADER_QA__.saves.at(-1)?.typographyOverrides.study.latinFont === "Georgia");
  const pair = await page.evaluate(() => {
    const saved = window.__JINGREADER_QA__.saves.at(-1);
    return { saves: window.__JINGREADER_QA__.saves.length, mode: saved.typographyProfile, appearance: saved.appearance,
      reading: saved.typographyOverrides.reading, study: saved.typographyOverrides.study,
      bodyFont: getComputedStyle(document.querySelector(".markdown-body")).fontFamily,
      headingFont: getComputedStyle(document.querySelector(".markdown-body h1")).fontFamily };
  });
  assert(pair.saves === savesBefore + 1 && pair.mode === "reading" && pair.appearance === "warm", `pair action changed another setting: ${JSON.stringify(pair)}`);
  for (const profile of [pair.reading, pair.study]) assert(profile.chineseFont === "Noto Serif SC" && profile.latinFont === "Georgia" && profile.fontFamily === "serif", `font pair did not cross profiles: ${JSON.stringify(pair)}`);
  assert(pair.bodyFont.includes("JingReader CJK") && pair.bodyFont.includes("JingReader Latin") && !pair.headingFont.includes("JingReader Heading CJK"), `pair changed heading or missed body roles: ${JSON.stringify(pair)}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const documentNode = await cdp.send("DOM.getDocument");
  const mixedNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".markdown-body > p:nth-of-type(2)" });
  const usedFonts = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: mixedNode.nodeId })).fonts.map((font) => font.familyName);
  assert(usedFonts.includes("Noto Serif SC") && usedFonts.includes("Georgia"), `mixed prose did not consume both installed fonts: ${usedFonts}`);
  await page.getByRole("button", { name: "返回阅读设置" }).click();
  await page.getByRole("radio", { name: "研读" }).check();
  await page.waitForFunction(() => document.querySelector(".app").classList.contains("profile-study"));
  assert((await page.locator(".markdown-body").evaluate((element) => getComputedStyle(element).fontFamily)).includes("JingReader Latin"), "study profile lost paired body fonts");
  await page.getByRole("radio", { name: "阅读" }).check();
  await page.getByRole("button", { name: "关闭阅读设置" }).click();
  await page.screenshot({ path: "qa-artifacts/text-flow-warm-indent.png" });
  await page.reload();
  await page.locator(".markdown-body h1").waitFor();
  const retained = await page.evaluate(() => getComputedStyle(document.querySelector(".markdown-body")).fontFamily);
  assert(retained.includes("JingReader CJK") && retained.includes("JingReader Latin"), `reload lost paired body fonts: ${retained}`);
  console.log(JSON.stringify({ prose, tails, longWord, usedFonts, pair: { reading: pair.reading, study: pair.study }, screenshot: "qa-artifacts/text-flow-warm-indent.png" }));
  await page.close();
} finally { await browser.close(); await server.close(); }

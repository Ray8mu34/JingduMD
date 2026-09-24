import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ server: { host: "127.0.0.1", port: 5190 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${server.resolvedUrls.local[0]}qa-app.html`);
  const heading = page.locator(".markdown-body h2", { hasText: "Swin Transformer" }).first();
  await heading.waitFor();
  await page.locator(".markdown-body .katex").first().scrollIntoViewIfNeeded();
  await page.locator(".markdown-body .katex").first().waitFor();
  await heading.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => {
    const article = document.querySelector(".markdown-body");
    return { body: getComputedStyle(article).fontFamily, code: getComputedStyle(article.querySelector("code")).fontFamily, math: getComputedStyle(article.querySelector(".katex")).fontFamily };
  });
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: /详细排版/ }).click();
  await page.getByRole("button", { name: "字体", exact: true }).click();
  assert(await page.locator(".reading-font-picker").count() === 5, "five font roles are not available");
  const choose = async (role, family) => {
    const picker = page.locator(".reading-font-picker").filter({ hasText: role });
    await picker.getByRole("button", { name: `${role}字体` }).click();
    await picker.getByRole("combobox").fill(family);
    await picker.getByRole("option", { name: new RegExp(family) }).click();
  };
  await choose("中文标题", "SimSun");
  await choose("西文标题", "Arial");
  await page.waitForFunction(() => {
    const override = window.__JINGREADER_QA__.saves.at(-1)?.typographyOverrides.reading;
    return override?.chineseHeadingFont === "SimSun" && override?.latinHeadingFont === "Arial";
  });
  let state = await page.evaluate(() => ({
    family: getComputedStyle(document.querySelector(".markdown-body h2")).fontFamily,
    body: getComputedStyle(document.querySelector(".markdown-body")).fontFamily,
    code: getComputedStyle(document.querySelector(".markdown-body code")).fontFamily,
    math: getComputedStyle(document.querySelector(".markdown-body .katex")).fontFamily,
    fontCss: document.querySelector(".app > style")?.textContent
  }));
  assert(state.family.includes("JingReader Heading CJK") && state.family.includes("JingReader Heading Latin"), "heading stack lost one role");
  assert(state.body === before.body && state.code === before.code && state.math === before.math, "heading choice changed body, code or formula family");
  assert(state.fontCss.includes('src:local("Arial Bold");font-weight:700') && state.fontCss.includes('src:local("Arial Italic");font-weight:400'), "known bold/italic faces were not registered");
  await page.screenshot({ path: "qa-artifacts/r3-heading-fonts.png" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const documentNode = await cdp.send("DOM.getDocument");
  const headingNode = await cdp.send("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: ".markdown-body h2" });
  const platformFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: headingNode.nodeId });
  assert(platformFonts.fonts.some((font) => font.familyName.includes("Arial")), "the Latin heading did not render with Arial");
  const strongNode = await cdp.send("DOM.querySelector", { nodeId: headingNode.nodeId, selector: "strong" });
  const italicNode = await cdp.send("DOM.querySelector", { nodeId: headingNode.nodeId, selector: "em" });
  const strongFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: strongNode.nodeId });
  const italicFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId: italicNode.nodeId });
  assert(platformFonts.fonts.some((font) => font.familyName === "SimSun"), "the CJK heading did not render with SimSun");
  assert(strongFonts.fonts.some((font) => font.postScriptName === "Arial-BoldMT"), "strong text did not use the actual Arial bold face");
  assert(italicFonts.fonts.some((font) => font.postScriptName === "Arial-BoldItalicMT"), "emphasis did not use the actual Arial bold italic face");
  await choose("中文标题", "Microsoft YaHei");
  await page.waitForFunction(() => window.__JINGREADER_QA__.saves.at(-1)?.typographyOverrides.reading.chineseHeadingFont === "Microsoft YaHei");
  assert((await page.evaluate(() => window.__JINGREADER_QA__.saves.at(-1).typographyOverrides.reading.latinHeadingFont)) === "Arial", "changing Chinese heading changed Latin heading");
  await page.reload();
  await heading.waitFor();
  await page.getByRole("button", { name: "阅读设置" }).click();
  await page.getByRole("button", { name: /详细排版/ }).click();
  await page.getByRole("button", { name: "字体", exact: true }).click();
  const labels = await page.locator(".reading-font-trigger span").allTextContents();
  assert(labels[2] === "Microsoft YaHei" && labels[3] === "Arial", "font roles were lost on reload");
  await page.getByRole("button", { name: "段落", exact: true }).click();
  await page.getByRole("button", { name: "个人排版" }).click();
  await page.getByRole("button", { name: /另存当前排版/ }).click();
  await page.getByRole("textbox", { name: "个人排版名称" }).fill("双语标题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.__JINGREADER_QA__.saves.at(-1)?.personalTypographies.some((item) => item.name === "双语标题"));
  const personal = await page.evaluate(() => window.__JINGREADER_QA__.saves.at(-1).personalTypographies.at(-1).overrides);
  assert(personal.chineseHeadingFont === "Microsoft YaHei" && personal.latinHeadingFont === "Arial", "personal typography omitted heading roles");
  console.log(JSON.stringify({ roles: labels, selected: [personal.chineseHeadingFont, personal.latinHeadingFont], bodyUnchanged: true, renderedFaces: ["SimSun", "Arial-BoldMT", "Arial-BoldItalicMT"], reload: true, personal: true }));
  await page.close();
} finally { await browser.close(); await server.close(); }

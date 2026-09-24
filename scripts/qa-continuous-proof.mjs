import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const server = await createServer({ server: { host: "127.0.0.1", port: 5196 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const output = "qa-artifacts/r6";
await mkdir(output, { recursive: true });
const samples = [
  { file: "chinese-longform.md", points: [["middle", "h2:nth-of-type(2)"], ["deep", "h5"]] },
  { file: "english-longform.md", points: [["middle", "h2:nth-of-type(2)"], ["code", ".code-block"]] },
  { file: "typography-proof.md", points: [["math", ".math-display"], ["deep", "h5"], ["wide", ".table-frame"]] },
  { file: "readme-sample.md", points: [] }
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const records = [];
try {
  for (const sample of samples) for (const profile of ["reading", "study"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=${sample.file}`);
    await page.locator(".markdown-body h1").waitFor();
    await page.evaluate((nextProfile) => {
      const state = window.__JINGREADER_QA__;
      state.emitPreferences({ ...state.basePreferences, styleMode: "canonical", typographyProfile: nextProfile, appearance: "white" });
    }, profile);
    await page.waitForFunction((nextProfile) => document.querySelector(".app").classList.contains(`profile-${nextProfile}`), profile);
    await page.addStyleTag({ content: ".app.qa-monochrome { --bg:#fff; --surface:#f7f7f7; --surface-2:#ededed; --text:#292929; --heading:#111; --muted:#666; --border:#ccc; --link:#333; --accent:#444; --selection:#ddd; --code-bg:#f5f5f5; --syntax-text:#292929; --syntax-muted:#666; --syntax-keyword:#292929; --syntax-string:#444; --syntax-number:#444; --syntax-title:#292929; }" });
    await page.evaluate(() => document.querySelector(".app").classList.add("qa-monochrome"));
    const article = page.locator(".markdown-body");
    const name = sample.file.replace(/\.md$/, "");
    const capture = async (point, selector) => {
      if (point !== "start") {
        await page.mouse.move(600, 400);
        await page.mouse.wheel(0, 1);
      }
      await page.evaluate((targetSelector) => {
        const target = document.querySelector(`.markdown-body ${targetSelector}`);
        if (!target) throw new Error(`Missing proof target: ${targetSelector}`);
        const scroll = document.querySelector(".reader-scroll");
        scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 170;
      }, selector);
      if (selector === ".math-display") await page.locator(".markdown-body .math-display .katex").first().waitFor();
      await page.waitForTimeout(120);
      await page.screenshot({ path: `${output}/mono-${name}-${profile}-${point}.png` });
      const metric = await article.evaluate((element, targetSelector) => {
        const scroll = document.querySelector(".reader-scroll");
        const target = element.querySelector(targetSelector);
        const targetBox = target.getBoundingClientRect();
        const scrollBox = scroll.getBoundingClientRect();
        const style = getComputedStyle(element);
        const sizes = Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [level, getComputedStyle(element.querySelector(`h${level}`) ?? element).fontSize]));
        return { scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, scrollClientHeight: scroll.clientHeight, documentScrollTop: document.scrollingElement.scrollTop, targetTop: targetBox.top, scrollTopEdge: scrollBox.top, targetVisible: targetBox.bottom > scrollBox.top && targetBox.top < scrollBox.bottom, width: element.getBoundingClientRect().width, bodySize: style.fontSize, leading: style.lineHeight, bodyFont: style.fontFamily, paragraphGap: getComputedStyle(element.querySelector("p")).marginBottom, headingSizes: sizes, pageOverflow: scroll.scrollWidth - scroll.clientWidth };
      }, selector);
      assert(metric.targetVisible, `${name} ${profile} ${point} target is not visible: ${JSON.stringify(metric)}`);
      if (point !== "start") assert(metric.scrollTop > 50, `${name} ${profile} ${point} did not move beyond the first screen`);
      assert(metric.pageOverflow <= 1, `${name} ${profile} ${point} overflows the page`);
      records.push({ sample: sample.file, profile, point, ...metric });
    };
    await capture("start", "h1");
    for (const [point, selector] of sample.points) await capture(point, selector);
    if (sample.file === "typography-proof.md") {
      await page.evaluate(() => document.querySelector(".app").classList.remove("qa-monochrome"));
      for (const appearance of ["warm", "white", "night", "nord"]) {
        await page.evaluate((nextAppearance) => {
          const state = window.__JINGREADER_QA__;
          state.emitPreferences({ ...state.basePreferences, styleMode: "canonical", typographyProfile: document.querySelector(".app").classList.contains("profile-study") ? "study" : "reading", appearance: nextAppearance });
        }, appearance);
        await page.waitForFunction((nextAppearance) => document.querySelector(".app").classList.contains(`appearance-${nextAppearance}`), appearance);
        await page.evaluate(() => { const target = document.querySelector(".markdown-body .math-display"); const scroll = document.querySelector(".reader-scroll"); scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 170; });
        await page.locator(".markdown-body .math-display .katex").first().waitFor();
        await page.screenshot({ path: `${output}/color-${profile}-${appearance}.png` });
      }
    }
    await page.close();
  }
  await writeFile(`${output}/metrics.json`, JSON.stringify(records, null, 2));
  console.log(JSON.stringify({ samples: samples.length, profiles: 2, monochromeProofs: records.length, appearances: 8, output }));
} finally { await browser.close(); await server.close(); }

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";
import { launchQaBrowser } from "./qa-browser.mjs";

const articlePath = process.argv[2];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#608b9f"/></svg>';
const sample = '# 论文图片\n\n前文\n![软换行图](figure.svg)\nFigure 1. Soft line break.\n\n![硬换行图](figure.svg)  \nFigure 2. Hard line break.\n\n![独立图](figure.svg)\n\n正文 ![行内图标](figure.svg) 后续。\n\n[![徽章](figure.svg)](https://example.test/)\n\n![引用图][fig]\n引用图注。\n\n[fig]: figure.svg';
const server = await createServer({ server: { host: "127.0.0.1", port: 5198 } });
await server.listen();
const browser = await launchQaBrowser();
const results = [];
try {
  for (const width of [390, 760, 1100]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((svg) => {
      window.__TAURI_INTERNALS__ = { invoke: async () => ({ mime: "image/svg+xml", data: Array.from(new TextEncoder().encode(svg)) }) };
    }, svg);
    await page.route("**/fixtures/figure-images.md", (route) => route.fulfill({ body: sample }));
    await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=figure-images.md`);
    await page.waitForFunction(() => [...document.querySelectorAll(".image-frame img")].length === 6 && [...document.querySelectorAll(".image-frame img")].every((img) => img.naturalWidth === 800));
    for (const label of ["软换行图", "硬换行图", "独立图", "引用图"]) {
      const img = page.getByAltText(label);
      const rect = await img.boundingBox();
      const frame = img.locator("xpath=ancestor::span[contains(@class,'image-frame')]");
      const bounds = await frame.boundingBox();
      assert.ok(rect.height > 100, `${label} shrank at ${width}`);
      assert.ok(Math.abs(rect.x + rect.width / 2 - bounds.x - bounds.width / 2) < 1, `${label} is not centered`);
      await img.hover();
      assert.equal(await frame.locator(".image-resize-handle").first().evaluate((e) => getComputedStyle(e).opacity), "1");
      await frame.getByTitle("调整显示大小").click();
      await page.getByRole("spinbutton").fill("40");
      await page.getByRole("spinbutton").press("Escape");
      assert.ok(Math.abs((await img.boundingBox()).width - 320) < 1);
    }
    for (const label of ["行内图标", "徽章"]) {
      const img = page.getByAltText(label);
      assert.ok((await img.boundingBox()).height < 50, `${label} grew into a figure`);
      const frame = img.locator("xpath=ancestor::span[contains(@class,'image-frame')]");
      assert.equal(await frame.getByTitle("调整显示大小").isVisible(), false);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByAltText("软换行图").click();
    const preview = page.locator(".image-lightbox img");
    const stage = page.locator(".image-lightbox-stage");
    await page.waitForFunction(() => document.querySelector(".image-lightbox img")?.naturalWidth === 800);
    await preview.click();
    assert.equal(await page.getByRole("dialog").count(), 1, "image click closed preview");
    await preview.dblclick();
    assert.equal(await page.getByRole("dialog").count(), 1, "double-click zoom closed preview");
    await page.getByTitle("放大", { exact: true }).click();
    let box = await stage.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const before = await stage.evaluate((e) => e.scrollLeft + e.scrollTop);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y - 40, { steps: 6 });
    await page.mouse.up();
    assert.equal(await page.getByRole("dialog").count(), 1, "pan closed preview");
    assert.ok(await stage.evaluate((e) => e.scrollLeft + e.scrollTop) > before + 20, "pan did not scroll");
    await page.getByTitle("适应窗口", { exact: true }).click();
    box = await stage.boundingBox();
    // Drag from blank canvas: the synthetic click after pointerup must not dismiss.
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + 25, box.y + 25, { steps: 4 });
    await page.mouse.up();
    assert.equal(await page.getByRole("dialog").count(), 1, "background drag closed preview");
    await page.mouse.click(box.x + 4, box.y + 4);
    assert.equal(await page.getByRole("dialog").count(), 0, "blank canvas did not close preview");
    await page.waitForFunction(() => document.activeElement?.getAttribute("alt") === "软换行图");
    await page.keyboard.press("Enter");
    await page.getByTitle("关闭图片预览").waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByTitle("缩小", { exact: true }).evaluate((e) => e === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.getByTitle("关闭图片预览").evaluate((e) => e === document.activeElement), true);
    await page.mouse.click(6, 6);
    assert.equal(await page.getByRole("dialog").count(), 0, "upper background did not close preview");
    await page.getByAltText("软换行图").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.screenshot({ path: `qa-artifacts/figure-images-${width}.png` });
    assert.deepEqual(errors, []);
    results.push({ width, figuresCentered: true, inlineIconsPreserved: true, resizeAndPreview: true, backgroundDismiss: true, panPreserved: true, keyboardAndFocus: true });
    await page.close();
  }

  if (articlePath) {
    const content = await readFile(articlePath, "utf8");
    const assets = new Map();
    for (const match of content.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)) {
      const filename = path.win32.basename(match[1]);
      assets.set(filename, { mime: "image/jpeg", data: [...await readFile(path.join(path.dirname(articlePath), match[1]))] });
    }
    for (const width of [760, 1380]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.exposeFunction("qaReadFigure", (args) => {
        const asset = assets.get(path.win32.basename(args.path));
        if (!asset) throw new Error("Unknown QA image");
        return asset;
      });
      await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: async (_command, args) => window.qaReadFigure(args) }; });
      await page.route("**/fixtures/pix2poly.md", (route) => route.fulfill({ body: content }));
      await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=pix2poly.md`);
      await page.locator(".markdown-body h1").waitFor();
      const frames = page.locator(".image-frame");
      assert.equal(await frames.count(), assets.size, "article lost images");
      for (let index = 0; index < await frames.count(); index++) {
        const frame = frames.nth(index);
        await frame.scrollIntoViewIfNeeded();
        await frame.locator("img").waitFor();
        await frame.locator("img").evaluate((img) => img.decode());
        const rect = await frame.locator("img").boundingBox();
        const bounds = await frame.boundingBox();
        assert.ok(rect.height > 80, `real figure ${index} shrank at ${width}`);
        assert.ok(Math.abs(rect.x + rect.width / 2 - bounds.x - bounds.width / 2) < 1, `real figure ${index} off-center`);
        assert.equal(await frame.getByTitle("调整显示大小").isVisible(), true);
      }
      const architecture = page.locator("p").filter({ hasText: "Figure 2. Overview" }).locator(".image-frame");
      await architecture.scrollIntoViewIfNeeded();
      await architecture.locator("img").hover();
      await page.screenshot({ path: `qa-artifacts/pix2poly-fixed-${width}.png` });
      await architecture.locator("img").click();
      await page.locator(".image-lightbox img").evaluate((img) => img.decode());
      await page.screenshot({ path: `qa-artifacts/pix2poly-preview-${width}.png` });
      const stageBounds = await page.locator(".image-lightbox-stage").boundingBox();
      await page.mouse.click(stageBounds.x + 4, stageBounds.y + 4);
      assert.equal(await page.getByRole("dialog").count(), 0);
      results.push({ article: path.basename(articlePath), width, images: assets.size, allFiguresCentered: true, backgroundDismiss: true });
      await page.close();
    }
  }
  await writeFile("qa-artifacts/figure-images-results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}

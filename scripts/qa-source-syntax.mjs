import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const fixture = ["# Markdown 源码高亮", "", "## 常用语法", "", "普通文字、**粗体**、*斜体*、~~删除线~~ 和 `inline code`。", "", "- [x] 列表任务", "> 引用文字", "[静读链接](https://example.com) 与 ![图片](images/demo.png)", "", "```javascript", "const message = '中文与 English';", "console.log(message);", "```", "", "制表符\t中文\t😀 emoji", ...Array.from({ length: 100 }, (_, i) => `${i}: 普通正文\t**高亮** ${"long line · ".repeat(20)}`), "# 最后一行", "", ""].join("\n");
const server = await createServer({ server: { host: "127.0.0.1", port: 5194 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("qa-artifacts", { recursive: true });
const results = [];
try {
  for (const width of [390, 760, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md&sourceHighlights`);
    await page.locator(".markdown-body p").first().waitFor();
    // Update the fixture's source before entering; no production editor APIs are replaced.
    await page.evaluate((text) => { const qa = window.__JINGREADER_QA__; qa.documents.set(qa.selected, { ...qa.documents.get(qa.selected), content: text, revision: "syntax-fixture" }); qa.emitExternal(); }, fixture);
    await page.getByRole("heading", { name: /Markdown 源码高亮/ }).waitFor();
    await page.getByTitle("编辑 Markdown 源码", { exact: true }).click();
    const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    const mirror = page.locator(".source-colors");
    const verifyEmphasis = async () => {
      const colors = await mirror.evaluate((element) => {
        const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = (values) => values.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        const background = luminance(rgb(getComputedStyle(element).backgroundColor));
        const body = rgb(getComputedStyle(element).color);
        return [...element.querySelectorAll(".source-token-emphasis")].filter((span) => ["**粗体**", "*斜体*", "~~删除线~~"].includes(span.textContent)).map((span) => {
          const color = rgb(getComputedStyle(span).color), foreground = luminance(color);
          return { text: span.textContent, chroma: Math.max(...color) - Math.min(...color), difference: Math.max(...color.map((value, i) => Math.abs(value - body[i]))), contrast: (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05) };
        });
      });
      assert.equal(colors.length, 3, "bold, italic and strikethrough each receive color");
      for (const color of colors) {
        assert(color.chroma >= 30 && color.difference >= 40, `${color.text} must visibly differ from ordinary text`);
        assert(color.contrast >= 4.5, `${color.text} must remain readable against the background`);
      }
    };
    const verifyText = async () => assert.equal(await mirror.textContent(), (await area.inputValue()) + "\u200b");
    await verifyText();
    await verifyEmphasis();
    assert.equal(await mirror.getAttribute("aria-hidden"), "true");
    for (const kind of ["heading", "marker", "emphasis", "link", "code"]) assert(await mirror.locator(`.source-token-${kind}`).count() > 0);
    assert.notEqual(await mirror.locator(".source-token-heading").first().evaluate((e) => getComputedStyle(e).color), await mirror.evaluate((e) => getComputedStyle(e).color));
    await page.screenshot({ path: `qa-artifacts/source-syntax-${width}.png` });

    // Native editing and undo remain the source of truth for the color layer.
    await area.press("Control+End"); await page.keyboard.insertText("**新增中文**"); await verifyText();
    await area.press("Control+Z"); await verifyText(); assert.equal(await area.inputValue(), fixture);
    await area.press("Control+Y"); await verifyText();
    await area.press("Control+S"); await page.waitForFunction(() => !document.querySelector(".source-input").readOnly);
    await area.press("Control+Z"); await verifyText();
    await area.press("Control+F"); const find = page.getByRole("textbox", { name: "查找源码内容", exact: true });
    await find.fill("最后一行"); await find.press("Enter");
    assert.equal(await area.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)), "最后一行");
    await page.getByRole("button", { name: "关闭源码查找" }).click();

    // Pixel comparison proves both surfaces share glyph positions, including
    // tabs, Chinese, emoji, horizontal scroll, both scrollbar tracks and EOF.
    const plain = await page.addStyleTag({ content: ".source-colors span { color: var(--text) !important; } .source-input { caret-color: transparent !important; }" });
    const differences = [];
    for (const position of ["top", "middle", "end"]) {
      await area.evaluate((e, position) => { e.setSelectionRange(0, 0); e.scrollTop = position === "top" ? 0 : position === "middle" ? 804 : e.scrollHeight; e.scrollLeft = position === "middle" ? 400 : position === "end" ? e.scrollWidth : 0; e.dispatchEvent(new Event("scroll")); }, position);
      const geometry = await page.evaluate(() => { const a = document.querySelector(".source-input"), m = document.querySelector(".source-colors"); return { x: a.scrollLeft - m.scrollLeft, y: a.scrollTop - m.scrollTop, width: a.clientWidth - m.clientWidth, height: a.clientHeight - m.clientHeight }; });
      assert.deepEqual(geometry, { x: 0, y: 0, width: 0, height: 0 });
      const colored = await page.locator(".source-surface").screenshot();
      const native = await page.addStyleTag({ content: ".source-colors { visibility: hidden !important; } .source-input { color: var(--text) !important; background: var(--bg) !important; }" });
      const input = await page.locator(".source-surface").screenshot();
      await native.evaluate((e) => e.remove());
      const difference = await page.evaluate(async ([first, second]) => {
        const decode = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height).data; };
        const [a, b] = await Promise.all([decode(first), decode(second)]); let different = 0;
        for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 20) different++;
        return different;
      }, [colored.toString("base64"), input.toString("base64")]);
      differences.push({ position, difference });
      if (difference >= 30) {
        await writeFile(`qa-artifacts/source-syntax-mirror-${width}-${position}.png`, colored);
        await writeFile(`qa-artifacts/source-syntax-native-${width}-${position}.png`, input);
      }
      assert(difference < 30, `color/native glyph mismatch ${width}px ${position}: ${difference}`);
    }
    await plain.evaluate((e) => e.remove());
    await area.evaluate((e) => e.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    assert.equal(await mirror.evaluate((e) => getComputedStyle(e).visibility), "hidden");
    assert.notEqual(await area.evaluate((e) => getComputedStyle(e).color), "rgba(0, 0, 0, 0)");
    await area.evaluate((e) => e.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await verifyText();
    await page.emulateMedia({ forcedColors: "active" });
    assert.equal(await mirror.evaluate((e) => getComputedStyle(e).visibility), "hidden");
    await page.emulateMedia({ forcedColors: "none" });
    if (width === 760) {
      await page.evaluate(() => { const qa = window.__JINGREADER_QA__; qa.emitPreferences({ ...qa.basePreferences, appearance: "night" }); });
      await verifyEmphasis();
      await area.press("Control+Home");
      await area.evaluate((e) => { e.scrollTop = 0; e.scrollLeft = 0; e.dispatchEvent(new Event("scroll")); });
      assert.notEqual(await mirror.locator(".source-token-heading").first().evaluate((e) => getComputedStyle(e).color), await mirror.evaluate((e) => getComputedStyle(e).color));
      await page.screenshot({ path: "qa-artifacts/source-syntax-night-760.png" });
      await page.setViewportSize({ width: 1000, height: 740 });
      await page.waitForFunction(() => { const a = document.querySelector(".source-input"), m = document.querySelector(".source-colors"); return a.clientWidth === m.clientWidth && a.clientHeight === m.clientHeight; });
    }
    assert.deepEqual(errors, []);
    results.push({ width, differences, passed: true });
    await context.close();
    console.log(`Source syntax ${width}px passed`);
  }
  await writeFile("qa-artifacts/source-syntax-results.json", JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }

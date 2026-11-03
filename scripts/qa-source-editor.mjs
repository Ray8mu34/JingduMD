import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const server = await createServer({ server: { host: "127.0.0.1", port: 5193 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("qa-artifacts", { recursive: true });
const results = [];
try {
  for (const width of [390, 760, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md&sourceHighlights&tabs`);
    const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    const dialog = page.getByRole("alertdialog", { name: "保存源码修改？" });
    const enter = () => page.getByTitle("编辑 Markdown 源码", { exact: true }).click();
    const disk = () => page.evaluate(() => { const qa = window.__JINGREADER_QA__; return qa.documents.get(qa.selected).content; });
    const saveCount = () => page.evaluate(() => window.__JINGREADER_QA__.calls.filter((c) => c === "save_document").length);
    await page.locator(".markdown-body p").first().waitFor();
    const original = await disk();
    await enter();
    assert.equal(await area.inputValue(), original);
    assert.equal(await page.locator(".reader-scroll").evaluate((e) => e.inert), true);
    assert.equal(await page.locator(".reader-scroll").evaluate((e) => getComputedStyle(e).visibility), "hidden");
    await area.press("Control+S");
    assert.equal(await saveCount(), 0);

    // Real keyboard input, clipboard paste, and undo/redo survive Ctrl+S.
    await area.press("Control+End");
    await area.pressSequentially("typed");
    await area.press("Control+S");
    await page.waitForFunction(() => window.__JINGREADER_QA__.documents.get(window.__JINGREADER_QA__.selected).content.endsWith("typed"));
    let undoSteps = 0;
    while (await area.inputValue() !== original && undoSteps < 10) { await area.press("Control+Z"); undoSteps++; }
    assert.equal(await area.inputValue(), original);
    for (let i = 0; i < undoSteps; i++) await area.press("Control+Y");
    assert.equal(await area.inputValue(), original + "typed");
    await page.evaluate(() => navigator.clipboard.writeText("\n粘贴 **原始语法**"));
    await area.press("Control+V");
    const pasted = original + "typed\n粘贴 **原始语法**";
    await page.waitForFunction((value) => document.querySelector(".source-input").value === value, pasted);
    await area.press("Control+Z"); assert.equal(await area.inputValue(), original + "typed");
    await area.press("Control+Shift+Z"); assert.equal(await area.inputValue(), pasted);
    assert.equal(await disk(), original + "typed", "draft must remain private");
    await area.press("Control+F");
    const find = page.getByRole("textbox", { name: "查找源码内容", exact: true });
    await find.fill("**原始语法**"); await find.press("Enter");
    assert.equal(await area.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)), "**原始语法**");
    await find.fill("不存在的匹配"); await find.press("Enter");
    await page.getByText("未找到匹配内容", { exact: true }).waitFor();
    await page.getByRole("button", { name: "清空源码查找" }).click(); assert.equal(await find.inputValue(), "");
    await page.getByRole("button", { name: "关闭源码查找" }).click();
    await area.press("Control+F"); await find.press("Escape"); await find.waitFor({ state: "hidden" });

    // Failed writes retain input and the leave dialog; cancel restores focus.
    await page.evaluate(() => { window.__JINGREADER_QA__.saveFailures = 1; });
    await page.getByRole("button", { name: "返回阅读", exact: true }).click();
    await dialog.waitFor(); assert.equal(await dialog.getByRole("button", { name: "继续编辑" }).evaluate((e) => e === document.activeElement), true);
    const dialogBounds = await dialog.boundingBox();
    assert(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= width + 1 && dialogBounds.y + dialogBounds.height <= 901);
    if (width === 760) await page.screenshot({ path: "qa-artifacts/source-editor-leave-760.png" });
    await dialog.getByRole("button", { name: "保存并继续" }).click();
    await dialog.getByRole("alert").waitFor(); assert.equal(await area.inputValue(), pasted);
    await dialog.press("Escape"); await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.textContent === "返回阅读");

    // Busy locks input and navigation; skipped watcher events are rechecked.
    await page.evaluate(() => { window.__JINGREADER_QA__.saveDelay = 350; });
    await area.focus(); await area.press("Control+S");
    await page.waitForFunction(() => document.querySelector(".source-input").readOnly);
    await page.keyboard.press("Control+t");
    assert.equal(await page.getByRole("tab").count(), 1);
    await page.waitForFunction(() => !document.querySelector(".source-input").readOnly);
    assert.equal(await disk(), pasted);
    await page.evaluate(() => { window.__JINGREADER_QA__.saveDelay = 0; });
    await area.press("Control+Z");
    assert.equal(await area.inputValue(), original + "typed");
    await area.press("Control+Y");
    assert.equal(await area.inputValue(), pasted);
    assert.equal(await page.locator(".source-error").count(), 0, "own save is not an external conflict");

    // IME events must not execute save/find/navigation shortcuts.
    const countBeforeIme = await saveCount();
    await area.evaluate((e) => {
      e.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      e.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, isComposing: true, bubbles: true }));
      e.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, isComposing: true, bubbles: true }));
      e.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    });
    assert.equal(await saveCount(), countBeforeIme); assert.equal(await page.getByRole("tab").count(), 1);

    // Explicit image copying and native insertion, including acknowledgement failure.
    await area.press("Control+End");
    await page.evaluate(() => { const qa = window.__JINGREADER_QA__; qa.dialogFile = "C:\\pictures\\test.png"; qa.finishFailures = 1; });
    await page.getByRole("button", { name: "插入图片", exact: true }).click();
    await page.getByText("Error: 图片确认失败，副本已保留。", { exact: true }).waitFor();
    assert.equal(await area.inputValue(), pasted + "![](images/image-1.png)");
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.images.size), 1);
    await area.press("Control+Z"); assert.equal(await area.inputValue(), pasted);
    await area.press("Control+Y"); assert.equal(await area.inputValue(), pasted + "![](images/image-1.png)");
    await page.getByRole("button", { name: "插入图片", exact: true }).click();
    assert((await area.inputValue()).endsWith("![](images/image-1.png)![](images/image-2.png)"));
    const beforeImageFailure = await area.inputValue();
    await page.evaluate(() => { window.__JINGREADER_QA__.imageFailures = 1; });
    await page.getByRole("button", { name: "插入图片", exact: true }).click();
    await page.getByText("Error: 图片复制失败，未插入引用。", { exact: true }).waitFor();
    assert.equal(await area.inputValue(), beforeImageFailure);
    // Force insertText to fail: only the unused new copy is rolled back.
    await page.evaluate(() => { window.__originalExec = document.execCommand; document.execCommand = () => false; });
    await page.getByRole("button", { name: "插入图片", exact: true }).click();
    await page.getByText(/无法在光标处插入图片/).waitFor();
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.images.size), 2);
    await page.evaluate(() => { document.execCommand = window.__originalExec; });

    // Watcher updates never replace dirty input; conflicts cannot overwrite disk.
    await page.evaluate(() => { const qa = window.__JINGREADER_QA__; const doc = qa.documents.get(qa.selected); doc.content = "# 外部版本\n\n外部修改"; doc.revision = "external"; qa.emitExternal(); });
    await page.getByText(/文件可能已在外部修改/).waitFor();
    assert.equal(await area.inputValue(), beforeImageFailure);
    await area.press("Control+S"); await page.getByText(/未能保存，输入已保留/).waitFor();
    assert.equal(await disk(), "# 外部版本\n\n外部修改");

    // First leave request wins, even across app and workspace navigation.
    await page.getByRole("button", { name: "新建标签页", exact: true }).click(); await dialog.waitFor();
    await page.evaluate(() => { window.__JINGREADER_QA__.requestClose(); });
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    assert.equal(await page.getByRole("tab").count(), 1);
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.destroyed), false);
    await page.getByRole("button", { name: "返回阅读", exact: true }).click();
    await dialog.getByRole("button", { name: "放弃修改" }).click();
    await area.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: /外部版本/ }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("title") === "编辑 Markdown 源码");
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.images.size), 2, "discard keeps explicit image assets");

    // Folder navigation is guarded before the backend root is changed.
    await enter(); await area.press("Control+End"); await area.pressSequentially(" draft");
    await page.evaluate(() => { window.__JINGREADER_QA__.dialogFile = "C:\\qa-fixtures"; });
    const opens = await page.evaluate(() => window.__JINGREADER_QA__.calls.filter((c) => c === "open_target").length);
    await page.getByRole("button", { name: "打开选项", exact: true }).click();
    await page.getByRole("menuitem", { name: "打开文件夹", exact: true }).click(); await dialog.waitFor();
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.calls.filter((c) => c === "open_target").length), opens);
    await dialog.getByRole("button", { name: "继续编辑" }).click();

    // Save-and-continue opens a new tab; active-tab close also protects input.
    await page.getByRole("button", { name: "新建标签页", exact: true }).click();
    await dialog.getByRole("button", { name: "保存并继续" }).click();
    await page.getByRole("heading", { name: "打开 Markdown 开始阅读", exact: true }).waitFor();
    await page.getByRole("tab", { name: "plain-article.md", exact: true }).click();
    await enter(); await area.press("Control+End"); await area.pressSequentially(" close-draft");
    await page.getByRole("button", { name: "关闭标签页 plain-article.md", exact: true }).click(); await dialog.waitFor();
    await dialog.press("Tab"); await dialog.press("Tab"); await dialog.press("Tab");
    assert.equal(await dialog.getByRole("button", { name: "继续编辑" }).evaluate((e) => e === document.activeElement), true);
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    // Switch tabs, cancel, then discard. Text stays local until the decision.
    await page.getByRole("tab", { name: "新标签页", exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    assert((await area.inputValue()).endsWith("close-draft"));
    await page.screenshot({ path: `qa-artifacts/source-editor-${width}.png` });
    if (width === 760) {
      await page.evaluate(() => { const qa = window.__JINGREADER_QA__; qa.emitPreferences({ ...qa.basePreferences, appearance: "night" }); });
      await page.screenshot({ path: "qa-artifacts/source-editor-night-760.png" });
    }
    const bounds = await page.locator(".source-editor").boundingBox(); assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // Window close: cancel, failed save, retry success; destroy failures are retryable.
    await page.evaluate(() => { window.__JINGREADER_QA__.requestClose(); }); await dialog.waitFor();
    await dialog.getByRole("button", { name: "继续编辑" }).click();
    await page.evaluate(() => { const qa = window.__JINGREADER_QA__; qa.saveFailures = 1; qa.requestClose(); });
    await dialog.getByRole("button", { name: "保存并继续" }).click(); await dialog.getByRole("alert").waitFor();
    assert((await area.inputValue()).endsWith("close-draft"));
    await page.evaluate(() => { window.__JINGREADER_QA__.destroyFailures = 1; });
    await dialog.getByRole("button", { name: "保存并继续" }).click();
    await page.getByText(/无法关闭窗口/).waitFor();
    await page.evaluate(() => window.__JINGREADER_QA__.requestClose());
    await page.waitForFunction(() => window.__JINGREADER_QA__.destroyed);
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, browser: "Edge", coverage: "native input/paste/undo/redo/save/find/images/conflict/busy/IME/tabs/folder/window/focus" });
    await context.close();
    console.log(`Source editor ${width}px passed`);
  }
  await writeFile("qa-artifacts/source-editor-results.json", JSON.stringify(results, null, 2));
} finally { await browser.close(); await server.close(); }

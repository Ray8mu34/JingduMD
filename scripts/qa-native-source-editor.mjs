// Build: pnpm build; pnpm exec tauri build --debug --no-bundle --config qa-artifacts/source-editor-config.json
// Uses its own application identifier and temporary documents, never the installed app.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp, readFile, readdir, chmod, unlink, symlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const executable = resolve("src-tauri/target/debug/jingreader.exe");
assert((await readFile(executable)).includes(Buffer.from("com.jingreader.qa.source-editor")), "Build the isolated source-editor QA application first");
const base = await mkdtemp(resolve("qa-artifacts/native-source-"));
const path = join(base, "原生源码.md");
const second = join(base, "另一个文件.md");
const image = join(base, "测试图片.png");
const original = "# 原生源码\r\n\r\n修正前 **原始内容** $x$\r\n";
const originalBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(original)]);
await writeFile(path, originalBytes);
await writeFile(second, "# 第二篇\n\n标签切换测试");
await writeFile(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1EAAAAASUVORK5CYII=", "base64"));
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const child = spawn(executable, [path], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, windowsHide: true, stdio: "ignore" });
const until = async (action, description) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch {}
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`Timed out: ${description}`);
};
let browser, page;
const diagnostics = [];
const report = { base, browser: "Windows WebView2", passed: false, checks: [] };
try {
  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "WebView2 debugging");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap((context) => context.pages())[0], "native window");
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => diagnostics.push(error.message));
  await page.getByRole("heading", { name: /原生源码/ }).waitFor();
  await page.evaluate((image) => {
    const nativeInvoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    window.__nativeSourceInvoke = nativeInvoke;
    window.__sourcePicker = image;
    const nativeFetch = window.fetch.bind(window);
    // Tauri's invoke property is immutable. Stub only the OS picker response
    // at its fetch transport; document/image commands still reach real Rust.
    window.fetch = (request, options) => decodeURIComponent(String(request)).endsWith("/plugin:dialog|open")
      ? Promise.resolve(new Response(JSON.stringify(window.__sourcePicker), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
      : nativeFetch(request, options);
  }, image);
  const enter = () => page.getByTitle("编辑 Markdown 源码", { exact: true }).click();
  const area = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  const dialog = page.getByRole("alertdialog", { name: "保存源码修改？" });
  const content = async () => (await readFile(path)).toString("utf8");
  const discard = async () => {
    await page.getByRole("button", { name: "返回阅读", exact: true }).click();
    await dialog.getByRole("button", { name: "放弃修改" }).click();
    await area.waitFor({ state: "hidden" });
  };
  await enter();
  const normalized = original.replaceAll("\r\n", "\n");
  assert.equal(await area.inputValue(), normalized);
  assert.equal(await page.locator(".source-colors").textContent(), normalized + "\u200b");
  assert(await page.locator(".source-token-heading").count() > 0);
  await area.press("Control+S"); assert.deepEqual(await readFile(path), originalBytes);
  await area.press("Control+End"); await page.keyboard.insertText("新增文字");
  await area.press("Control+S");
  await until(async () => (await content()).endsWith("新增文字"), "manual disk save");
  const saved = await readFile(path);
  assert(saved.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.equal(saved.subarray(3).toString(), original + "新增文字");
  await area.press("Control+Z"); assert.equal(await area.inputValue(), normalized);
  await area.press("Control+Y"); assert.equal(await area.inputValue(), normalized + "新增文字");
  assert.equal(await page.locator(".source-colors").textContent(), normalized + "新增文字\u200b");
  const backups = join(process.env.APPDATA, "com.jingreader.qa.source-editor", "highlight-backups");
  const entries = await readdir(backups);
  let foundBackup = false;
  for (const entry of entries) {
    const manifest = JSON.parse(await readFile(join(backups, entry, "manifest.json"), "utf8"));
    if (manifest.sourcePath === path && (await readFile(join(backups, entry, "original.md"))).equals(originalBytes)) foundBackup = true;
  }
  assert(foundBackup, "byte-exact backup must exist before source save");
  report.checks.push("UTF-8 BOM/CRLF save, byte-exact backup, no-op, undo/redo after Ctrl+S");

  // Real image-copy commands and the native insertion/undo history.
  await area.press("Control+End");
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".source-input").value.includes("![](images/"));
  const withImage = await area.inputValue();
  const references = [...withImage.matchAll(/!\[\]\((images\/[^)]+)\)/g)].map((match) => match[1]);
  assert.equal(references.length, 1);
  assert.deepEqual(await readFile(join(base, references[0])), await readFile(image));
  await area.press("Control+Z"); assert.equal(await area.inputValue(), normalized + "新增文字");
  await area.press("Control+Y"); assert.equal(await area.inputValue(), withImage);
  await page.getByRole("button", { name: "插入图片", exact: true }).click();
  await until(async () => (await readdir(join(base, "images"))).length === 2, "unique image copy");
  const imageNames = await readdir(join(base, "images")); assert.equal(new Set(imageNames).size, 2);
  await discard();
  assert.equal((await readdir(join(base, "images"))).length, 2, "discard must retain copied assets");
  assert.deepEqual(await readFile(path), saved, "discard must not save references");
  report.checks.push("native insertText undo/redo, real local copy, unique filenames, discard retains assets");

  // Actual filesystem watcher: private draft survives a real external update.
  await enter(); await area.press("Control+End"); await page.keyboard.insertText("私人草稿");
  const privateText = await area.inputValue();
  const external = "# 外部版本\n\n外部内容";
  await writeFile(path, external);
  await page.getByText(/文件可能已在外部修改/).waitFor();
  assert.equal(await area.inputValue(), privateText);
  await area.press("Control+S"); await page.getByText(/未能保存，输入已保留/).waitFor();
  assert.equal(await content(), external);
  await discard(); await page.getByRole("heading", { name: /外部版本/ }).waitFor();
  report.checks.push("real watcher preserves dirty draft and rejects external-write conflict");

  // Readonly and deleted documents fail without clearing input or recreating files.
  await enter(); await area.press("Control+End"); await page.keyboard.insertText("保留输入");
  const retained = await area.inputValue();
  await chmod(path, 0o444);
  try {
    await area.press("Control+S"); await page.getByText(/文件为只读/).waitFor();
    assert.equal(await area.inputValue(), retained); assert.equal(await content(), external);
  } finally { await chmod(path, 0o666); }
  await unlink(path);
  await area.press("Control+S"); await page.getByText(/路径不存在或无法访问/).waitFor();
  assert.equal(await area.inputValue(), retained);
  assert.equal(await readFile(path).then(() => true, () => false), false);
  await writeFile(path, external); await discard();
  report.checks.push("readonly and deletion preserve draft and do not recreate source");

  // Backend rejects images junctions and canonical source-path redirection.
  const alternate = join(base, "alternate"); await mkdir(alternate);
  const linkedDoc = join(alternate, "linked.md"); await writeFile(linkedDoc, "linked");
  const imagesLink = join(alternate, "images"); await symlink(join(base, "images"), imagesLink, "junction");
  const rejected = await page.evaluate(async ({ linkedDoc, image }) => {
    try { await window.__nativeSourceInvoke("import_document_image", { documentPath: linkedDoc, sourcePath: image, tabId: "primary" }); return false; }
    catch (error) { return String(error).includes("普通文件夹"); }
  }, { linkedDoc, image });
  assert.equal(rejected, true);
  const docLink = join(base, "doc-link"); await symlink(alternate, docLink, "junction");
  const redirected = await page.evaluate(async ({ path, linked }) => {
    const doc = await window.__nativeSourceInvoke("read_document", { path, tabId: "primary" });
    try { await window.__nativeSourceInvoke("save_document", { path: linked, expected: doc.content, revision: doc.revision, content: "bad", tabId: "primary" }); return false; }
    catch (error) { return String(error).includes("路径已变化"); }
  }, { path: linkedDoc, linked: join(docLink, "linked.md") });
  assert.equal(redirected, true);
  report.checks.push("Windows junction rejection for images and canonical document path");

  // Open a second tab through the real picker path, cancel and then allow navigation.
  await enter(); await area.press("Control+End"); await page.keyboard.insertText("标签草稿");
  await page.evaluate((second) => { window.__sourcePicker = second; }, second);
  await page.getByRole("button", { name: "打开文件", exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(await page.getByRole("tab").count(), 1);
  await page.getByRole("button", { name: "打开文件", exact: true }).click();
  await dialog.getByRole("button", { name: "保存并继续" }).click();
  await page.getByRole("heading", { name: /第二篇/ }).waitFor();
  await page.getByRole("tab", { name: "原生源码.md", exact: true }).click();
  await page.getByRole("heading", { name: /外部版本/ }).waitFor();
  report.checks.push("native file-open routing and tab leave protection (OS picker response stubbed)");

  // Tauri close-requested must wait for the application-owned decision.
  await enter(); await area.press("Control+End"); await page.keyboard.insertText("关闭前保存");
  await page.screenshot({ path: "qa-artifacts/source-editor-native.png" });
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click(); await dialog.waitFor();
  await dialog.getByRole("button", { name: "继续编辑" }).click(); assert.equal(page.isClosed(), false);
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await dialog.getByRole("button", { name: "保存并继续" }).click();
  await until(() => page.isClosed(), "window close after successful save");
  assert((await content()).endsWith("关闭前保存"));
  report.checks.push("native close-requested cancel/save-and-close");
  assert.deepEqual(diagnostics, []);
  report.passed = true;
  console.log(JSON.stringify(report));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator("body").innerText()).slice(-3500));
    await page.screenshot({ path: "qa-artifacts/source-editor-native-failure.png" });
  }
  throw error;
} finally {
  await writeFile("qa-artifacts/source-editor-native-results.json", JSON.stringify({ ...report, diagnostics }, null, 2));
  await browser?.close();
  if (child.exitCode === null) child.kill();
}

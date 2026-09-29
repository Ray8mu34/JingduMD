// Build frontend first: pnpm build
// Then: pnpm exec tauri build --debug --no-bundle --config qa-artifacts/multiwindow-config.json
// Uses a separate application identifier so the user's library/settings are untouched.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const executable = resolve("src-tauri/target/debug/jingreader.exe");
if (!(await readFile(executable)).includes(Buffer.from("com.jingreader.qa.multiwindow"))) {
  throw new Error("Run pnpm qa:multiwindow to build the isolated QA application first.");
}
const base = await mkdtemp(resolve("qa-artifacts/native-windows-"));
const paths = [];
for (const [index, title] of ["文章甲", "文章乙", "文章丙", "文章丁"].entries()) {
  const folder = join(base, String(index));
  await mkdir(folder);
  const path = join(folder, `${title}.md`);
  await writeFile(path, `# ${title}\n\n` + Array.from({ length: 35 }, (_, i) => `## 第 ${i + 1} 节\n\n${"窗口和标签页应独立保存阅读内容与位置。".repeat(20)}\n\n`).join(""));
  paths.push(path);
}
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
const child = spawn(executable, [paths[0]], { env, windowsHide: true, stdio: "ignore" });
let browser;
const diagnostics = [];
const until = async (action, description) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out: ${description}`);
};
try {
  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "WebView2 debugging");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = () => browser.contexts().flatMap((context) => context.pages()).filter((page) => !page.isClosed());
  const main = await until(() => pages()[0], "main page");
  main.on("pageerror", (error) => diagnostics.push(error.message));
  main.on("console", (message) => { if (message.type() === "error") diagnostics.push(message.text()); });
  main.setDefaultTimeout(30000);
  await main.getByRole("heading", { name: /文章甲/ }).waitFor();
  await main.locator(".reader-scroll").evaluate((element) => { element.scrollTop = 1100; });
  await main.getByRole("button", { name: "新建标签页", exact: true }).click();
  await main.getByRole("heading", { name: "打开 Markdown 开始阅读" }).waitFor();
  // Exercise the native open event route without opening an interactive OS file picker.
  await main.evaluate((path) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", { event: "open-target-argument", payload: path }), paths[2]);
  await main.getByRole("heading", { name: /文章丙/ }).waitFor();
  assert.equal(await main.getByRole("tab").count(), 2);
  await main.getByRole("tab", { name: "文章甲.md", exact: true }).click();
  await main.getByRole("heading", { name: /文章甲/ }).waitFor();
  await main.waitForFunction(() => document.querySelector(".reader-scroll").scrollTop > 950);
  console.log("Native cross-folder tabs and reading position passed.");
  await main.evaluate((path) => window.__TAURI_INTERNALS__.invoke("open_in_new_window", { path }), paths[1]);
  const second = await until(() => pages().find((page) => page !== main), "second independent window");
  second.setDefaultTimeout(30000);
  await second.getByRole("heading", { name: /文章乙/ }).waitFor();
  assert.equal(await main.getByRole("tab").count(), 2);
  await writeFile(paths[1], "# 文章乙\n\n外部更新已同步");
  await second.getByText("外部更新已同步", { exact: true }).waitFor();
  console.log("Native independent window and file watcher passed.");
  await main.getByRole("tab", { name: "文章丙.md", exact: true }).click();
  await main.getByRole("heading", { name: /文章丙/ }).waitFor();
  assert.equal(await second.getByRole("heading", { name: /文章乙/ }).count(), 1);
  await main.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await until(() => main.isClosed(), "close first window");
  assert.equal(await second.getByRole("heading", { name: /文章乙/ }).count(), 1);
  const reopen = spawn(executable, [paths[3]], { env, windowsHide: true, stdio: "ignore" });
  const third = await until(() => pages().find((page) => page !== second), "external open after main closes");
  third.setDefaultTimeout(30000);
  await third.getByRole("heading", { name: /文章丁/ }).waitFor();
  assert.equal(await second.getByRole("heading", { name: /文章乙/ }).count(), 1);
  await third.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await second.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await until(() => child.exitCode !== null, "exit after last window");
  if (reopen.exitCode === null) reopen.kill();
  console.log("Native Windows/WebView2: cross-folder tabs, scroll restoration, independent windows, file watching, main-window closure and external reopen passed.");
} catch (error) {
  for (const page of browser?.contexts().flatMap((context) => context.pages()) ?? []) {
    console.error("Native page:", page.url(), (await page.locator("body").innerText().catch(() => "unavailable")).slice(0, 800));
  }
  console.error("Native console:", diagnostics);
  throw error;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child.exitCode === null) child.kill();
}

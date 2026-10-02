// Build with pnpm build, then pnpm exec tauri build --debug --no-bundle
// --config qa-artifacts/multiwindow-config.json before running this check.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const executable = resolve("src-tauri/target/debug/jingreader.exe");
if (!(await readFile(executable)).includes(Buffer.from("com.jingreader.qa.multiwindow"))) {
  throw new Error("Build the isolated QA application first (see script header).");
}
const base = await mkdtemp(resolve("qa-artifacts/native-windows-images-"));
const project = join(base, "天文学 课程");
const folder = join(project, "course", "01-solar-system");
const assets = join(project, "assets", "01");
await mkdir(folder, { recursive: true });
await mkdir(assets, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
await writeFile(join(assets, "relations.png"), png);
await writeFile(join(assets, "共享 图片.png"), png);
await writeFile(join(folder, "local.png"), png);
const path = join(folder, "slides.md");
await writeFile(path, '# 对象关系 {#L01-S02}\n\n![太阳、地球与月球](../../assets/01/relations.png){height=3.8in}\n\n![中文路径](../../assets/01/共享%20图片.png)\n\n<img src="../../assets/01/relations.png" alt="HTML 图片">\n\n![同目录](local.png)');
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const child = spawn(executable, [path], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  windowsHide: true, stdio: "ignore"
});
let browser;
const until = async (action, description) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch {}
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out: ${description}`);
};
try {
  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok, "WebView2 debugging");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(() => browser.contexts().flatMap((context) => context.pages())[0], "reader page");
  for (const label of ["太阳、地球与月球", "中文路径", "HTML 图片", "同目录"]) {
    const image = page.getByAltText(label, { exact: true });
    await image.scrollIntoViewIfNeeded();
    await until(() => image.evaluate((element) => element.complete && element.naturalWidth > 0), label);
    assert.match(await image.getAttribute("src"), /^blob:/);
  }
  const root = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_index_diagnostics", { tabId: "primary" }));
  assert.equal(root.currentRoot, folder);
  assert.equal(await page.locator(".broken-image").count(), 0);
  await page.screenshot({ path: join(base, "rendered.png") });
  // Switching to a broader root also keeps the same image references working.
  await page.evaluate(async ({ project, path }) => {
    await window.__TAURI_INTERNALS__.invoke("open_target", { path: project, tabId: "primary" });
    await window.__TAURI_INTERNALS__.invoke("read_asset", { documentPath: path, path: project + "/assets/01/relations.png", tabId: "primary" });
  }, { project, path });
  console.log("Native WebView2: ../../ images outside the root, encoded Chinese/space paths, HTML images and same-folder images rendered successfully.");
  console.log(`Evidence: ${join(base, "rendered.png")}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (child.exitCode === null) child.kill();
}

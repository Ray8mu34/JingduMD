import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const server = await createServer({ server: { host: "127.0.0.1", port: 5189 } });
await server.listen();
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
await mkdir("qa-artifacts", { recursive: true });
const results = [];
try {
  for (const width of [760, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md&sourceHighlights`, { timeout: 60000 });
    await page.locator(".markdown-body p").first().waitFor();
    const select = async (start, end, paragraph = 0) => page.evaluate(({ start, end, paragraph }) => {
      const p = document.querySelectorAll(".markdown-body p")[paragraph];
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let offset = 0, node, started = false;
      while ((node = walker.nextNode())) {
        if (!started && start < offset + node.length) { range.setStart(node, start - offset); started = true; }
        if (end <= offset + node.length) { range.setEnd(node, end - offset); break; }
        offset += node.length;
      }
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      p.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    }, { start, end, paragraph });
    const source = () => page.evaluate(() => window.__JINGREADER_QA__.documents.get(window.__JINGREADER_QA__.selected).content);
    const color = async (start, end, label) => {
      await select(start, end);
      await page.getByRole("button", { name: `添加${label}高亮` }).click();
      await page.waitForFunction(() => window.__JINGREADER_QA__.calls.includes("write_file_highlights"));
      await page.getByRole("toolbar").waitFor({ state: "hidden" });
    };
    await color(0, 8, "黄色");
    await page.locator(".file-highlight-yellow").first().waitFor();
    await color(2, 4, "蓝色");
    await page.locator(".file-highlight-blue").waitFor();
    assert((await source()).includes("==🟡ab==🔵cd==efgh=="));
    await page.locator(".file-highlight-blue").click();
    await page.getByRole("button", { name: "删除高亮", exact: true }).click();
    await page.locator(".file-highlight-blue").waitFor({ state: "hidden" });
    assert((await source()).includes("==🟡abcdefgh=="));
    await page.getByRole("button", { name: "撤销删除" }).click();
    await page.locator(".file-highlight-blue").waitFor();
    await color(6, 11, "绿色");
    await page.locator(".file-highlight-green").first().waitFor();
    assert((await source()).includes("==🟢gh==== ==🟢ijk==".replace(" ", "")));
    await page.screenshot({ path: `qa-artifacts/source-highlights-${width}.png` });

    // A legacy mark migrates only after its source backup/write succeeds.
    await page.evaluate(() => {
      const qa = window.__JINGREADER_QA__;
      qa.highlights.push({ id: 99, path: qa.selected, root: "C:\\qa-fixtures", quote: "第二段", prefix: "", suffix: "", startOffset: 0, endOffset: 3, headingId: null, color: "pink", createdMs: 1, updatedMs: 1 });
      qa.writeFailures = 1;
    });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "标注管理与备份" }).click();
    const manager = page.getByRole("dialog", { name: "标注管理与备份" });
    await manager.getByRole("button", { name: "迁移当前目录旧高亮" }).click();
    await manager.getByRole("status").filter({ hasText: "备份失败" }).waitFor();
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.highlights[0].deleted), undefined);
    await manager.getByRole("button", { name: "迁移当前目录旧高亮" }).click();
    await manager.getByRole("status").filter({ hasText: "已迁移 1 条高亮" }).waitFor();
    assert.equal(await page.evaluate(() => window.__JINGREADER_QA__.highlights[0].deleted), true);
    assert((await source()).includes("==🟣第二段=="));
    await page.screenshot({ path: `qa-artifacts/source-migration-${width}.png` });
    await manager.getByRole("button", { name: "关闭标注管理" }).click();
    await page.locator(".file-highlight-pink").waitFor();
    await select(12, 14);
    await page.evaluate(() => { const qa = window.__JINGREADER_QA__; qa.documents.get(qa.selected).content += "\n外部编辑"; });
    await page.getByRole("button", { name: "添加蓝色高亮" }).click();
    await page.getByText("无法保存高亮：原文件已变化，未覆盖外部修改。", { exact: true }).waitFor();
    assert((await source()).endsWith("外部编辑"));
    await page.reload();
    await page.locator(".markdown-body p").nth(1).waitFor();
    const formattedText = await page.locator(".markdown-body p").nth(1).innerText();
    await select(0, formattedText.length, 1);
    await page.getByRole("button", { name: "添加粉色高亮" }).click();
    await page.getByRole("toolbar").waitFor({ state: "hidden" });
    assert((await source()).includes("==🟣第二段 **加粗文字** 与 [链接文字](https://example.com)。=="));
    await page.locator(".markdown-body strong .file-highlight-pink").click();
    await page.getByRole("button", { name: "改为蓝色高亮" }).click();
    await page.getByRole("toolbar").waitFor({ state: "hidden" });
    assert((await source()).includes("==🔵第二段 **加粗文字** 与 [链接文字](https://example.com)。=="));
    await page.locator(".markdown-body strong .file-highlight-blue").click();
    await page.getByRole("button", { name: "删除高亮", exact: true }).click();
    await page.locator(".markdown-body strong .file-highlight-blue").waitFor({ state: "hidden" });
    assert(!(await source()).includes("==🔵第二段"));
    await page.getByRole("button", { name: "撤销删除" }).click();
    await page.locator(".markdown-body strong .file-highlight-blue").waitFor();
    await page.screenshot({ path: `qa-artifacts/source-continuity-${width}.png` });
    assert.equal(errors.length, 0, errors.join("\n"));
    results.push({ width, nested: true, crossing: true, undo: true, migration: true, backupFailure: true, staleWrite: true, formattedContinuity: true, formattedRecolorDeleteUndo: true, errors });
    await page.close();
  }
  await writeFile("qa-artifacts/source-highlights-results.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }

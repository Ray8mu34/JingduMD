import assert from "node:assert/strict";
import { createServer } from "vite";
import { launchQaBrowser } from "./qa-browser.mjs";
const server = await createServer({ server: { host: "127.0.0.1", port: 5188 } }); await server.listen();
const browser = await launchQaBrowser();
try {
 for (const width of [390, 760, 1100]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__ = { invoke: async () => ({ mime: "image/svg+xml", data: Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" fill="#608b9f"/></svg>')) }) }; });
  await page.route("**/fixtures/image-sizing.md", r => r.fulfill({ body: '# 图片大小\n\n![示例](sample.svg)\n\n正文。\n\n```math\nx^2+y^2=1\n```\n\n$$\nx^2\n$$' }));
  await page.goto(`${server.resolvedUrls.local[0]}qa.html?sample=image-sizing.md`);
  const img = page.locator('.image-surface img');
  await page.waitForFunction(() => document.querySelector('.image-surface img')?.naturalWidth === 800);
  await page.getByTitle('调整显示大小').click();
  const input = page.getByRole('spinbutton', { name: '原图缩放百分比' });
  await input.fill('40');
  await page.waitForFunction(() => Math.abs(document.querySelector('.image-surface img').getBoundingClientRect().width - 320) < 1);
  assert.equal(Math.round((await img.boundingBox()).height), 160);
  await input.press('Escape');
  for (const [corner, sx, sy] of [['左上角',-1,-1],['右上角',1,-1],['左下角',-1,1],['右下角',1,1]]) {
   await page.getByTitle('调整显示大小').click(); await input.fill('40'); await input.press('Escape');
   const handle=page.getByRole('button',{name:corner+'拖动缩放图片',exact:true});
   const box=await handle.boundingBox();
   await page.mouse.move(box.x+12,box.y+12); await page.mouse.down(); await page.mouse.move(box.x+12+40*sx,box.y+12+20*sy,{steps:8}); await page.mouse.up();
   assert.equal(Math.round((await img.boundingBox()).width),360,corner);
   assert.equal(await page.getByRole('dialog').count(),0);
  }
  await page.reload(); await img.waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('.image-surface img').getBoundingClientRect().width - 360)<1);
  await page.getByTitle('调整显示大小').click();
  await page.getByRole('button',{name:'原始大小（100%）',exact:true}).click();
  assert.equal(Math.round((await img.boundingBox()).width),800);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.getByRole('button',{name:'适应正文',exact:true}).click();
  await input.press('Escape'); await img.click();
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.code-block').count(),0);
  assert.equal(await page.locator('.math-display').count(),2);
  await page.locator('.math-display').first().scrollIntoViewIfNeeded();
  await page.locator('.math-display .katex').first().waitFor();
  assert.equal(await page.locator('.math-display .katex').first().evaluate(e=>getComputedStyle(e).textAlign),'center');
  await page.screenshot({path:`qa-artifacts/image-scale-${width}.png`});
  await page.route('**/fixtures/tall-image.md',r=>r.fulfill({body:'# 长图\n\n![长图](tall.svg)'}));
  await page.addInitScript(()=> { window.__TAURI_INTERNALS__={invoke:async()=>({mime:'image/svg+xml',data:Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="8000"><rect width="800" height="8000" fill="#608b9f"/></svg>'))})}; });
  await page.goto(server.resolvedUrls.local[0]+'qa.html?sample=tall-image.md');
  await page.waitForFunction(()=>document.querySelector('.image-surface img')?.naturalHeight===8000);
  const tall=page.locator('.image-surface img');
  assert.ok((await tall.boundingBox()).height<=631,'long image must fit viewport height');
  assert.ok(Math.abs((await tall.boundingBox()).width/(await tall.boundingBox()).height-.1)<.001);
  await page.screenshot({path:'qa-artifacts/tall-image-'+width+'.png'});
  await page.close();
 }
 console.log('Original image dimensions, corner drag, persistence, fit, overflow and math blocks passed at 390/760/1100.');
} finally { await browser.close(); await server.close(); }

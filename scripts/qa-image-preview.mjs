import assert from 'node:assert/strict';
import {createServer} from 'vite';
import { launchQaBrowser } from "./qa-browser.mjs";
const server=await createServer({server:{host:'127.0.0.1',port:5196}});await server.listen();
const browser=await launchQaBrowser();
try{
 for(const width of [390,1100]){
  const page=await browser.newPage({viewport:{width,height:850}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:async()=>({mime:'image/svg+xml',data:Array.from(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260"><rect width="400" height="260" fill="#608b9f"/><text x="50" y="120" font-size="30">Zoom test</text></svg>'))})};});
  await page.route('**/fixtures/preview.md',r=>r.fulfill({body:'# 预览缩放\n\n![预览图](preview.svg)'}));
  await page.goto(server.resolvedUrls.local[0]+'qa.html?sample=preview.md',{timeout:90000});
  await page.locator('.image-surface img').click();
  const img=page.locator('.image-lightbox img');
  await page.waitForFunction(()=>document.querySelector('.image-lightbox img')?.naturalWidth===400);
  const initial=await img.boundingBox();
  await page.getByTitle('放大',{exact:true}).click();
  const enlarged=await img.boundingBox();assert.ok(Math.abs(enlarged.width/initial.width-1.25)<.01,'button must resize image pixels');
  const stage=page.locator('.image-lightbox-stage');const bounds=await stage.boundingBox();
  const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  await page.mouse.move(x,y);
  for(let i=0;i<5;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(90);}
  const before=await img.boundingBox();const relative={x:(x-before.x)/before.width,y:(y-before.y)/before.height};
  await page.mouse.wheel(0,-100);await page.waitForTimeout(100);
  const after=await img.boundingBox();assert.ok(Math.abs(after.width/before.width-1.25)<.01,'wheel must resize image pixels');
  assert.ok(Math.abs(after.x+relative.x*after.width-x)<2,'horizontal focal point drift');
  assert.ok(Math.abs(after.y+relative.y*after.height-y)<2,'vertical focal point drift');
  const scrollBefore=await stage.evaluate(e=>e.scrollLeft);
  await page.mouse.down();await page.mouse.move(x-60,y-30,{steps:6});await page.mouse.up();
  assert.ok(await stage.evaluate(e=>e.scrollLeft)>scrollBefore+40,'panning');
  await page.screenshot({path:`qa-artifacts/preview-zoom-${width}.png`});
  await page.getByTitle('适应窗口',{exact:true}).click();
  const fitted=await img.boundingBox();assert.ok(fitted.width<=width&&fitted.height<=bounds.height);
  assert.ok(Math.abs(fitted.width-initial.width)<1,'fit reset');
  assert.equal(await stage.evaluate(e=>e.scrollLeft+e.scrollTop),0);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Preview button/wheel pixel scaling, cursor anchoring, panning, fit/reset and Escape passed at 390/1100px.');
}finally{await browser.close();await server.close();}

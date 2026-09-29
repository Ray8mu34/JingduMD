import assert from 'node:assert/strict';
import {createServer} from 'vite';
import { launchQaBrowser } from "./qa-browser.mjs";
const server=await createServer({plugins:process.argv.includes('--baseline')?[{name:'baseline-image-scroll',enforce:'pre',transform(code,id){if(id.endsWith('/MarkdownReader.tsx'))return code.replace('scrollHold.current = holdImageResizeScroll(event.currentTarget);','');}}]:[],server:{host:'127.0.0.1',port:5195}});await server.listen();
const browser=await launchQaBrowser();
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.route('**/fixtures/plain-article.md',r=>r.fulfill({body:'# Scroll stability\n\n'+('前文阅读内容。'.repeat(120)+'\n\n').repeat(5)+'![图](resize.svg)\n\n'+('后文阅读内容。'.repeat(120)+'\n\n').repeat(8)}));
 await page.goto(server.resolvedUrls.local[0]+'qa-app.html?sample=plain-article.md&imageResize=1',{timeout:90000});
 await page.locator('.image-frame').scrollIntoViewIfNeeded(); const img=page.locator('.image-surface img');await img.scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('.image-surface img')?.naturalHeight===1200);
 for(const corner of ['左上角','右上角','左下角','右下角']){
  await page.getByTitle('调整显示大小').click();await page.getByRole('spinbutton',{name:'原图缩放百分比'}).fill('50');await page.keyboard.press('Escape');
  const handle=page.getByRole('button',{name:corner+'拖动缩放图片',exact:true});
  await handle.evaluate(e=>e.scrollIntoView({block:'center'}));
  await page.waitForTimeout(150);
  const initial=await page.locator('.reader-scroll').evaluate(e=>e.scrollTop);
  const box=await handle.boundingBox();await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();
  let worst=0;const sign=corner.includes('左')?1:-1;
  for(let i=1;i<=8;i++){await page.mouse.move(box.x+12+i*8*sign,box.y+12);await page.waitForTimeout(35);worst=Math.max(worst,Math.abs(await page.locator('.reader-scroll').evaluate(e=>e.scrollTop)-initial));}
  await page.mouse.up();await page.waitForTimeout(250);
  worst=Math.max(worst,Math.abs(await page.locator('.reader-scroll').evaluate(e=>e.scrollTop)-initial));
  console.log(corner,'maximum scroll jump',worst);assert.ok(worst<=2,corner+' scroll moved '+worst);
 }
 console.log('All four corners preserve scroll position during and after resizing.');
}finally{await browser.close();await server.close();}



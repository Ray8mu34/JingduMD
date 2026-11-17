import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
// Attach to an already open isolated WebView2 reader showing the merged lecture.
// node scripts/qa-native-reading-performance.mjs label 45927 [--full]
// --full prepares all 3,872 formulas before measuring, so loaded-DOM comparisons
// do not benefit from different amounts of deferred content. No source is edited.
const variant = process.argv[2] ?? 'before';
const port = process.argv[3] ?? '45927';
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
  assert(page);
  await page.locator('.markdown-body h1').first().waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if (process.argv.includes('--full')) {
    await page.evaluate(()=>window.dispatchEvent(new Event('jingreader:expand-for-print')));
    await page.waitForFunction(()=>document.querySelectorAll('.katex').length===3872,null,{timeout:60000});
    await page.evaluate(()=>window.dispatchEvent(new Event('jingreader:restore-after-print')));
  }
  const results = [];
  const start = async label => page.evaluate(label => {
    const samples = { label, frames: [], scrollEvents:0, selectionEvents:0, moves:0, longTasks:[], formulasAtStart:document.querySelectorAll('.katex').length };
    window.__readingMeasure = samples;
    let previous = performance.now();
    const frame = now => { samples.frames.push(now-previous); previous=now; samples.raf=requestAnimationFrame(frame); };
    samples.raf=requestAnimationFrame(frame);
    samples.selection = () => samples.selectionEvents++;
    samples.scroll = () => samples.scrollEvents++;
    samples.move = e => { if(e.buttons) samples.moves++; };
    document.addEventListener('selectionchange',samples.selection);
    document.addEventListener('pointermove',samples.move);
    document.querySelector('.reader-scroll').addEventListener('scroll',samples.scroll);
    samples.observer = new PerformanceObserver(list => samples.longTasks.push(...list.getEntries().map(x=>x.duration)));
    samples.observer.observe({type:'longtask',buffered:false});
  }, label);
  const finish = async () => page.evaluate(() => {
    const s=window.__readingMeasure;
    cancelAnimationFrame(s.raf);
    document.removeEventListener('selectionchange',s.selection);
    document.removeEventListener('pointermove',s.move);
    document.querySelector('.reader-scroll').removeEventListener('scroll',s.scroll);
    s.observer.disconnect();
    const frames=s.frames.slice(1).sort((a,b)=>a-b);
    const summary={label:s.label,frames:frames.length,frameMedianMs:frames[Math.floor(frames.length*.5)],frameP95Ms:frames[Math.floor(frames.length*.95)],
      framesOver50Ms:frames.filter(x=>x>50).length,maxFrameMs:frames.at(-1),longTasks:s.longTasks,
      selectionEvents:s.selectionEvents,pointerMoves:s.moves,scrollEvents:s.scrollEvents,
      formulasAtStart:s.formulasAtStart,formulasAtEnd:document.querySelectorAll('.katex').length,selectedCharacters:getSelection()?.toString().length};
    delete window.__readingMeasure; return summary;
  });
  // Use a fixed section well below the document's restored reading position.
  await page.evaluate(()=>{getSelection()?.removeAllRanges();document.querySelector('.reader-scroll').scrollTop=1000;});
  await page.waitForTimeout(1200);
  const box=await page.locator('.reader-scroll').boundingBox();
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.5);
  await start('scroll-forward');
  for(let i=0;i<36;i++){await page.mouse.wheel(0,260);await page.waitForTimeout(20);}
  results.push(await finish());
  await page.waitForTimeout(2500);
  for(let round=0;round<2;round++) {
    await start(`scroll-loaded-${round}`);
    for(let i=0;i<24;i++){await page.mouse.wheel(0,i<12?-180:180);await page.waitForTimeout(20);}
    results.push(await finish());
    await page.waitForTimeout(700);
  }
  // Find a visible, single-line stretch of actual prose; drag through its text.
  const points=await page.evaluate(()=>{
    const viewport=document.querySelector('.reader-scroll').getBoundingClientRect();
    const walker=document.createTreeWalker(document.querySelector('.markdown-body'),NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(node.data.trim().length<14||node.parentElement.closest('.lazy-math,button,pre,[aria-hidden=true]'))continue;
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);
      const a=range.getBoundingClientRect();
      if(a.y<viewport.y+80||a.bottom>viewport.bottom-100||a.x<viewport.x)continue;
      let end=a;
      for(let i=2;i<Math.min(node.length,45);i++){
        range.setStart(node,i-1);range.setEnd(node,i);const b=range.getBoundingClientRect();
        if(Math.abs(b.y-a.y)>2)break; end=b;
      }
      if(end.right-a.x>100)return {x:a.x+1,y:a.y+a.height*.5,endX:end.right-1,endY:end.y+end.height*.5};
    }
    return null;
  });
  assert(points,'No visible prose for drag test');
  await start('drag-loaded-prose');
  for(let round=0;round<3;round++){
    await page.mouse.move(points.x,points.y);await page.mouse.down();
    for(let i=1;i<=48;i++){
      await page.mouse.move(points.x+(points.endX-points.x)*i/48,points.y+(points.endY-points.y)*i/48);
      await page.waitForTimeout(8);
    }
    await page.mouse.up(); await page.waitForTimeout(180);
  }
  results.push(await finish());
  assert(results.at(-1).selectedCharacters>0,'Drag did not select prose');
  const record={variant,host:'native WebView2',title:await page.title(),results};
  await writeFile(`qa-artifacts/native-reading-${variant}.json`,JSON.stringify(record,null,2));
  console.log(JSON.stringify(record));
} finally { await browser.close(); }

import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:5193}});await server.listen();
const browser=await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1400,height:950}});const page=await context.newPage();
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 const prefs=JSON.parse(fs.readFileSync(`${process.env.APPDATA}/com.jingreader.app/settings.json`,'utf8'));
 await page.addInitScript(p=>{if(!localStorage.getItem('jingreader-qa-preferences'))localStorage.setItem('jingreader-qa-preferences',JSON.stringify(p));},prefs);
 await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md`,{timeout:90000});
 await page.locator('.markdown-body p').first().waitFor();
 await page.locator('.markdown-body p').first().evaluate(e=>e.append(' Western ABC abc 123.'));
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const {root}=await cdp.send('DOM.getDocument');
 const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.markdown-body p'});
 console.log('ACTUAL BODY FONTS',JSON.stringify(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})));
 await page.getByRole('button',{name:'阅读设置',exact:true}).click();
 await page.getByRole('button',{name:/详细排版/}).click();
 const align=page.getByLabel('独立公式对齐');assert.equal(await align.inputValue(),'center');
 await align.selectOption('left');
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('jingreader-qa-preferences')).formulaAlign==='left');
 await page.reload();
 assert.equal(await page.locator('.reader-scroll').evaluate(e=>getComputedStyle(e).getPropertyValue('--formula-align').trim()),'left');
 const left=page.getByRole('separator',{name:'文件栏宽度'});
 if(!await left.count())await page.getByRole('button',{name:'文件列表',exact:true}).click();
 await left.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
 const other=await context.newPage();await other.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=plain-article.md`,{timeout:90000});
 await other.locator('.markdown-body h1').waitFor(); await other.waitForFunction(()=>document.querySelector('.left-sidebar'));
 const second=other.getByRole('separator',{name:'文件栏宽度'});
 if(!await second.count())await other.getByRole('button',{name:'文件列表',exact:true}).click();
 assert.equal(await second.getAttribute('aria-valuenow'),'170');
 await left.focus();await page.keyboard.press('ArrowRight');
 await other.waitForFunction(()=>document.querySelector('[aria-label="文件栏宽度"]').getAttribute('aria-valuenow')==='180');
 console.log('Formula preference persists; sidebar widths shared across windows.');
}finally{await browser.close();await server.close();}




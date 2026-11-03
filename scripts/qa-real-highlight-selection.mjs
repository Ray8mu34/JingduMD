import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {launchQaBrowser} from './qa-browser.mjs';
const original=await readFile(process.argv[2],'utf8');
const server=await createServer({server:{host:'127.0.0.1',port:5188}});await server.listen();
const {parseFileHighlights}=await server.ssrLoadModule('/src/lib/fileHighlights.ts');
const browser=await launchQaBrowser();
const quote='在实践中可能看见这么一种经验做法：使用一个固定的学习率来进行训练的同时观察验证集错误率，每当验证集错误率停止下降，就乘以一个常数（比如0.5）来降低学习率';
const results=[];
try{
 for(const width of [760,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]+'qa-app.html?sample=plain-article.md');
  await page.locator('.markdown-body').waitFor();
  await page.evaluate(content=>{const qa=window.__JINGREADER_QA__;qa.documents.get(qa.selected).content=content;qa.emitExternal();},original);
  const item=page.locator('.markdown-body li').filter({hasText:'在实践中可能看见这么一种经验做法'}).last();
  await item.waitFor();await item.scrollIntoViewIfNeeded();const textBefore=await item.textContent();
  await item.evaluate((li,quote)=>{
   const walker=document.createTreeWalker(li,NodeFilter.SHOW_TEXT);let node;
   while(node=walker.nextNode()){const at=node.data.indexOf(quote);if(at<0)continue;const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+quote.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);li.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));return;}
   throw Error('Reported prose was not found');
  },quote);
  await page.getByRole('button',{name:'添加黄色高亮'}).click();
  await item.locator('.file-highlight-yellow').filter({hasText:quote}).waitFor();
  const source=()=>page.evaluate(()=>{const qa=window.__JINGREADER_QA__;return qa.documents.get(qa.selected).content;});
  assert.equal(parseFileHighlights(await source()).clean,parseFileHighlights(original).clean);
  await item.locator('.file-highlight-yellow').filter({hasText:quote}).click();
  await page.getByRole('button',{name:'改为蓝色高亮'}).click();
  await item.locator('.file-highlight-blue').filter({hasText:quote}).waitFor();
  await item.locator('.file-highlight-blue').filter({hasText:quote}).click();
  await page.getByRole('button',{name:'删除高亮',exact:true}).click();
  await item.locator('.file-highlight-blue').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'撤销删除'}).click();
  await item.locator('.file-highlight-blue').filter({hasText:quote}).waitFor();
  assert.equal(await item.textContent(),textBefore);
  assert.equal(parseFileHighlights(await source()).clean,parseFileHighlights(original).clean);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`qa-artifacts/real-list-highlight-${width}.png`});
  results.push({width,add:true,recolor:true,deleteUndo:true,sourceUnchanged:true,listTextUnchanged:true});await page.close();
 }
 await writeFile('qa-artifacts/real-list-highlight-result.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await server.close();}

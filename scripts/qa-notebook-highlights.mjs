import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';

const native = process.argv.includes('--native');
const sample = 'highlight-edit.ipynb';
const original = JSON.stringify({nbformat:4,nbformat_minor:5,metadata:{keep:'metadata'},cells:[
 {cell_type:'markdown',id:'one',source:['# 第一节\n\n','第一段 **加粗文字** 和普通正文。\n\n','$$\\begin{aligned}\nx &= y\n\\end{aligned}$$\n\n','公式后的正文用于高亮。'],attachments:{'test.png':{'image/png':'untouched'}}},
 {cell_type:'code',source:"print('代码不能标注')",execution_count:1,outputs:[{output_type:'stream',text:'输出不能标注'}]},
 {cell_type:'markdown',id:'two',source:'# 第二节\n\n第二段相同文字。'}
]},null,2);
await mkdir('qa-artifacts/notebook-highlight-fixtures',{recursive:true});
const file = new URL('../qa-artifacts/notebook-highlight-fixtures/highlight-edit.ipynb',import.meta.url);
if (!native || process.argv.includes('--prepare-only')) await writeFile(file, original);
if (process.argv.includes('--prepare-only')) process.exit(0);
let server;
if(!native){server=await createServer({server:{host:'127.0.0.1',port:5196}});await server.listen();}
const browser=native?await chromium.connectOverCDP('http://127.0.0.1:45918'):await chromium.launch({executablePath:'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
const page=native?browser.contexts().flatMap(c=>c.pages())[0]:await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 if(!native){await page.route('**/fixtures/highlight-edit.ipynb',r=>r.fulfill({body:original,contentType:'text/plain'}));await page.goto(`${server.resolvedUrls.local[0]}qa-app.html?sample=${sample}`);}
 await page.getByText('静态阅读 · Markdown 正文可高亮 · 代码与输出只读').waitFor();
 const source=async()=>native?(await readFile(file,'utf8')):await page.evaluate(()=>{const q=window.__JINGREADER_QA__;return q.documents.get(q.selected).content;});
 const select=async(text)=>page.evaluate(text=>{
  const spans=[...document.querySelectorAll('.markdown-body [data-source-start]')];
  const span=spans.find(s=>s.textContent.includes(text));if(!span)throw new Error('Missing source span: '+text);
  span.scrollIntoView({block:'center'});
  const node=span.firstChild,at=node.textContent.indexOf(text),range=document.createRange();range.setStart(node,at);range.setEnd(node,at+text.length);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  span.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
 },text);
 const add=async(text,color)=>{await select(text);await page.getByRole('button',{name:`添加${color}高亮`}).click();await page.getByRole('toolbar').waitFor({state:'hidden'});};
 await add('公式后的正文','黄色');
 await page.locator('.file-highlight-yellow').waitFor();
 assert(JSON.parse(await source()).cells[0].source.join('').includes('==🟡公式后的正文=='));
 await page.locator('.file-highlight-yellow').click();
 await page.getByRole('button',{name:'改为蓝色高亮'}).click();
 await page.locator('.file-highlight-blue').waitFor();
 await page.locator('.file-highlight-blue').click();
 await page.getByRole('button',{name:'删除高亮',exact:true}).click();
 await page.locator('.file-highlight-blue').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'撤销删除'}).click();
 await page.locator('.file-highlight-blue').waitFor();
 await add('第二段相同文字','绿色');
 await page.locator('.file-highlight-green').waitFor();
 const saved=await source();const parsed=JSON.parse(saved),baseline=JSON.parse(original);
 assert.equal(parsed.cells[2].source,'# 第二节\n\n==🟢第二段相同文字==。');
 assert.deepEqual(parsed.cells[1],baseline.cells[1]);assert.deepEqual(parsed.metadata,baseline.metadata);assert.deepEqual(parsed.cells[0].attachments,baseline.cells[0].attachments);
 // Reload the file through the same reader, without replacing the test source.
 if(native){
  if(!await page.getByRole('navigation',{name:'文件树'}).isVisible()) await page.getByRole('button',{name:'文件列表',exact:true}).click();
  await page.getByRole('navigation',{name:'文件树'}).getByRole('button',{name:sample,exact:true}).click();
 }else{
  await page.evaluate(()=>{const q=window.__JINGREADER_QA__;q.emitExternal(q.selected);});
 }
 await page.locator('.file-highlight-blue').waitFor();await page.locator('.file-highlight-green').waitFor();
 assert.equal(await page.locator('.katex-error').count(),0);
 assert.equal(await page.locator('.notebook-code-cell [data-source-start]').count(),0);
 // Check actual file-content conflict handling before any UI watcher reload.
 if(native){
  const path=await page.locator('.markdown-body').getAttribute('data-document-path');
  const invoke=(args)=>page.evaluate(args=>window.__TAURI_INTERNALS__.invoke('write_file_highlights',args),args);
  const args={path,expected:saved,content:saved,migratedIds:[],migratedRecords:[]};
  await writeFile(file,saved+'\n');
  await assert.rejects(invoke(args),/变化/);
  await writeFile(file,saved);
  await assert.rejects(invoke({...args,content:saved.replace('untouched','changed')}),/source|元数据|附件/);
  await assert.rejects(invoke({...args,content:saved.replace('代码不能标注','被改写')}),/source|代码/);
  assert.equal(await source(),saved);
 }
 await page.evaluate(()=>{
  const spans=[...document.querySelectorAll('.markdown-body [data-source-start]')];
  const first=spans.find(s=>s.textContent.includes('第一段')),last=spans.find(s=>s.textContent.includes('第二段相同文字'));
  const range=document.createRange();range.setStart(first.firstChild,0);range.setEnd(last.firstChild,3);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  first.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
 });
 await page.getByRole('button',{name:'添加粉色高亮'}).click();
 await page.getByRole('toolbar').waitFor({state:'hidden'});
 const across=JSON.parse(await source());
 assert(across.cells[0].source.join('').includes('🟣'));
 assert(across.cells[2].source.includes('🟣'));
 assert.deepEqual(across.cells[1],baseline.cells[1]);
 assert.equal(await page.locator('.notebook-code-cell [data-file-highlight]').count(),0);
 await page.evaluate(()=>{
  const code=document.querySelector('.notebook-code-cell pre'),range=document.createRange();range.selectNodeContents(code);
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);code.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
 });
 assert.equal(await page.getByRole('toolbar').count(),0);
 if(!native){
  await select('第一段');await page.getByRole('toolbar').waitFor();
  await page.evaluate(()=>{const q=window.__JINGREADER_QA__;q.documents.get(q.selected).content+='\n';q.emitExternal(q.selected);});
  await page.getByRole('toolbar').waitFor({state:'hidden'});
 }
 await page.screenshot({path:`qa-artifacts/notebook-highlights-${native?'native':'browser'}.png`});
 assert.deepEqual(errors,[]);
 const report={native,add:true,recolor:true,deleteUndo:true,reload:true,formulaMapping:true,crossCellSelection:true,codeSelectionDisabled:true,otherCellsUnchanged:true,staleWriteRejected:native,nonMarkdownWriteRejected:native,errors};
 await writeFile(`qa-artifacts/notebook-highlights-${native?'native':'browser'}-results.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally {await browser.close();if(server)await server.close();}

import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const out=path.resolve(process.env.SCREENSHOT_DIR||'work/mobile-screenshots');
await mkdir(out,{recursive:true});
const url=process.env.SITE_URL||'https://jasonz0829vip.github.io/tv-program-weekly-share/';
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true});
const results=[];
try{
 for(const width of [320,360,375,390,414,430]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  if(!process.env.SITE_URL)await page.route('https://jasonz0829vip.github.io/tv-program-weekly-share/**',async route=>{
   const name=new URL(route.request().url()).pathname.replace('/tv-program-weekly-share/','')||'index.html';
   try{await route.fulfill({path:path.join(root,name)});}catch{await route.continue();}
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#sharedSyncBadge')?.dataset.state==='connected',{timeout:30000});
  assert(await page.evaluate(()=>records.length>0&&new Set(records.map(x=>x.program)).size>0),'shared records loaded');
  for(const view of ['overview','comparison','ledger','quality']){
   await page.evaluate(v=>navigate(v),view);
   await page.screenshot({path:path.join(out,`${width}-${view}.png`),fullPage:true});
   if(view==='overview')await page.screenshot({path:path.join(out,`${width}-top.png`)});
   else await page.screenshot({path:path.join(out,`${width}-${view}-viewport.png`)});
   const check=await page.evaluate(()=>{
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const over=[...document.querySelectorAll('h1,.stat-val,.revenue-route-top,.route-normalized b,.five-bar-label,.nav-btn,.date-pills button,.modal-header,.five-values')].filter(visible).filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>({class:e.className,text:e.textContent.trim(),width:e.clientWidth,scroll:e.scrollWidth}));
    const wrapped=[...document.querySelectorAll('.nav-btn span,.date-pills button,.stat-val small')].filter(visible).filter(e=>{const r=document.createRange();r.selectNodeContents(e);return new Set([...r.getClientRects()].map(x=>Math.round(x.top))).size>1}).map(e=>e.textContent);
    return {width:innerWidth,scroll:document.documentElement.scrollWidth,over,wrapped,nav:document.querySelectorAll('.nav-btn').length};
   });
   assert(check.scroll<=width+1,`${width}/${view}: page overflow ${JSON.stringify(check)}`);
   assert.deepEqual(check.over,[],`${width}/${view}: clipped metric or control`);
   assert.deepEqual(check.wrapped,[],`${width}/${view}: short label wrapped`);
   assert.equal(check.nav,4);
   if(view==='ledger')assert.equal(await page.locator('.five-bar-slot').count(),6);
   results.push({width,view,...check});
  }
  await page.evaluate(()=>{navigate('overview');setPreset('custom');openExcelUploader()});
  await page.screenshot({path:path.join(out,`${width}-upload.png`)});
  assert(await page.locator('#excelSyncModal').isVisible());
  const dialog=await page.locator('.shared-excel-modal').evaluate(e=>({w:e.clientWidth,s:e.scrollWidth}));
  assert(dialog.s<=dialog.w+1,`${width}: upload dialog overflow`);
  await page.evaluate(()=>showExcelHistory());
  await page.waitForTimeout(600);
  await page.evaluate(()=>closeExcelUploader());
  // Simulate a larger preferred font, without changing data or publishing files.
  await page.evaluate(()=>{
   const sizes=[...document.querySelectorAll('body,body *')].filter(e=>e instanceof HTMLElement).map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);
   sizes.forEach(([e,size])=>e.style.fontSize=`${size*1.2}px`);
  });
  await page.screenshot({path:path.join(out,`${width}-larger-text.png`),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
  assert.deepEqual(await page.locator('.stat-val').evaluateAll(els=>els.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)),[],`${width}: enlarged KPI overflow`);
  assert.deepEqual(errors,[],`${width}: runtime errors`);
  await page.close();
 }
 await writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));
 console.log(`PASS: ${results.length} viewport/view checks, six upload dialogs and larger-text checks. Screenshots: ${out}`);
}finally{await browser.close();}

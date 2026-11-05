// Real SheetJS XLS/XLSX + upload UI regression. All browser requests are isolated.
// Only synthetic orders are used by CI. No production request or publication is allowed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const cdn='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const sheetjs=process.env.SHEETJS_PATH?fs.readFileSync(process.env.SHEETJS_PATH,'utf8'):await fetch(cdn).then(r=>{if(!r.ok)throw Error('SheetJS download failed: '+r.status);return r.text()});
assert.equal(crypto.createHash('sha256').update(sheetjs).digest('hex'),'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41','Pinned SheetJS bytes');
const current=JSON.parse(fs.readFileSync(path.join(root,'data/current.json'),'utf8'));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
const results=[];
try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(req.method()!=='GET'){writes.push(req.url());return route.abort();}
   if(req.url()===cdn)return route.fulfill({contentType:'application/javascript',body:sheetjs});
   if(url.pathname==='/api/current')return route.fulfill({json:{...current,capabilities:['other-consumption-v1']}});
   if(url.pathname==='/sync-config.json')return route.fulfill({json:{apiBase:'https://fixture.invalid',mirrorPath:'data/current.json',pollSeconds:86400}});
   if(url.hostname==='dashboard.test'){
    const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!file.includes('..')&&fs.existsSync(path.join(root,file)))return route.fulfill({path:path.join(root,file)});
   }
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://dashboard.test/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.UrbanSync?.api.online);
  const original=await page.evaluate(()=>JSON.stringify(UrbanSync.api.snapshot));
  await page.addScriptTag({url:cdn});
  for(const bookType of ['xls','xlsx']){
   const encoded=await page.evaluate(bookType=>{
    const route=[['2026年11月1日首播'],...Array.from({length:6},(_,i)=>[null,`17:${30+i*5}-`+(i===5?'18:00':`17:${35+i*5}`),1]),[null,null,6,null,0]];
    const header=['标签名称','user_id','最早标签时间','订单编号','产品名称','产品编号','业务类别','年夜饭','订单状态','合同金额','实付金额','支付时间'];
    const rows=[header,...Array.from({length:104},(_,i)=>['新版电视-我们退休啦-越南','synthetic-user',46327,'00000000000000000'+String(i).padStart(3,'0'),'合成产品','synthetic-product','商品','否','已支付',i?1:225.9,i?1:225.9,46327.5236])];
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(route),'越南全景');
    const totals=XLSX.utils.aoa_to_sheet([['越南全景',null,null,null,null,1,1,225.9]]);totals.H1.z='[$-10804]#,##0;\\(#,##0\\)';XLSX.utils.book_append_sheet(wb,totals,'汇总数据');
    const details=XLSX.utils.aoa_to_sheet(rows);
    for(let r=2;r<=105;r++){details['K'+r].z='[$-10804]#,##0;\\(#,##0\\)';details['C'+r].z='yyyy-mm-dd';details['L'+r].z='yyyy-mm-dd hh:mm';}
    XLSX.utils.book_append_sheet(wb,details,'标签用户订单明细');
    return XLSX.write(wb,{type:'base64',bookType});
   },bookType);
   await page.evaluate(()=>openExcelUploader());
   await page.locator('#excelFilePicker').setInputFiles({name:'synthetic-2026.'+bookType,mimeType:'application/octet-stream',buffer:Buffer.from(encoded,'base64')});
   await page.waitForFunction(()=>UrbanSync.api.parseResult&&!document.querySelector('#excelFilePicker').disabled);
   const parsed=await page.evaluate(()=>({blocking:UrbanSync.api.parseResult.blocking,summary:UrbanSync.api.parseResult.snapshot.otherConsumption,first:UrbanSync.api.parseResult.localOtherOrders[0],payment:UrbanSync.api.parseResult.snapshot.paymentSummary[0].amount}));
   assert.deepEqual(parsed.blocking,[]);assert.equal(parsed.summary.orderCount,104);assert.equal(parsed.summary.amount,328.9);assert.equal(parsed.first.amount,225.9);assert.equal(parsed.payment,225.9);assert.equal(parsed.first.orderId,'00000000000000000000');assert.match(parsed.first.paidAt,/2026-11-01/);
   assert.equal(await page.locator('#excelLocalPreview').isEnabled(),true);
   await page.evaluate(()=>previewExcelLocally());assert.equal(await page.evaluate(()=>records.length),1);
   await page.evaluate(()=>exitExcelLocalPreview());assert.equal(await page.evaluate(()=>JSON.stringify(UrbanSync.api.snapshot)),original);
   // Reopen and cancel without invoking the data publication function.
   await page.evaluate(()=>{openExcelUploader();closeExcelUploader()});
   assert.equal(await page.evaluate(()=>JSON.stringify(UrbanSync.api.snapshot)),original);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   results.push({width,bookType,orders:104,amount:328.9,nativeFraction:225.9,publicationRequests:writes.length});
  }
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}

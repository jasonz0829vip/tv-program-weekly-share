// Fully isolated browser regression: all requests are intercepted; no production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('..',import.meta.url));
const publicFixture=JSON.parse(fs.readFileSync(process.env.INITIAL_SNAPSHOT||path.join(root,'data/current.json'),'utf8'));
const initial=structuredClone(publicFixture);
// Supply LATEST_SNAPSHOT for an independently parsed real workbook; otherwise
// use a synthetic correction scenario, never infer production-data deletion.
const latest=process.env.LATEST_SNAPSHOT?JSON.parse(fs.readFileSync(process.env.LATEST_SNAPSHOT,'utf8')):structuredClone(initial.snapshot);
if(!process.env.LATEST_SNAPSHOT)latest.records=latest.records.filter(r=>!(r.program==='越南全景'&&r.date==='2026-11-02'&&r.startTime==='09:30'));
latest.totals.sessions=latest.records.length;
const output=process.env.SCREENSHOT_DIR||path.join(root,'../browser-regression');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined});
const results=[];
try{
  for(const width of [320,390,1440]){
    let current=structuredClone(initial),published=[];
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.pathname==='/api/publish'){
        assert.equal(url.hostname,'fixture.invalid');
        const body=request.postDataJSON();published.push(body);
        current={ok:true,version:'fixture-latest',updatedAt:'2026-11-03T00:00:00.000Z',snapshot:body.snapshot};
        return route.fulfill({json:{ok:true,version:current.version}});
      }
      if(request.method()!=='GET')throw Error('Unexpected non-GET request: '+request.url());
      if(url.pathname==='/api/current')return route.fulfill({json:current});
      if(url.pathname==='/sync-config.json')return route.fulfill({json:{apiBase:'https://fixture.invalid',mirrorPath:'data/current.json',pollSeconds:86400}});
      if(url.pathname==='/data/current.json')return route.fulfill({json:current});
      if(url.hostname==='dashboard.test'){
        const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
        if(!name.includes('..')&&fs.existsSync(path.join(root,name)))return route.fulfill({path:path.join(root,name)});
      }
      return route.fulfill({status:404,body:''});
    });
    await page.goto('https://dashboard.test/',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.UrbanSync?.api.online);
    const baselineCount=await page.evaluate(()=>records.length);
    const setDraft=()=>page.evaluate(snapshot=>{
      UrbanSync.api.parseResult={snapshot,warnings:[],blocking:[]};
      openExcelUploader();recomputeExcelPreview();
    },latest);
    await setDraft();
    assert.equal(await page.evaluate(()=>UrbanSync.api.preview.records.length),latest.records.length);
    assert.match(await page.locator('#excelSyncPreview').textContent(),/1 场未出现在本次文件/);
    await page.evaluate(()=>closeExcelUploader());
    assert.equal(await page.evaluate(()=>records.length),baselineCount,'close does not apply draft');
    await setDraft();await page.evaluate(()=>previewExcelLocally());
    assert.equal(await page.evaluate(()=>records.length),latest.records.length);
    await page.evaluate(()=>{setPreset('all');openFive();setFiveProgram('越南全景');setFiveSelection(0,'2026-11-02|越南全景|重播|17:30')});
    assert.equal(await page.locator('#fiveSelect0 option[value="2026-11-02|越南全景|重播|09:30"]').count(),0);
    assert.deepEqual(await page.locator('#fiveStats strong').allTextContents(),['98','9','107','15–20 分钟']);
    assert.deepEqual(await page.locator('.five-bar-number').allTextContents(),['3','11','14','30','28','12']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:path.join(output,`${width}-latest-vietnam.png`),fullPage:true});
    await page.evaluate(()=>exitExcelLocalPreview());
    assert.equal(await page.evaluate(()=>records.length),baselineCount,'exit restores confirmed snapshot');
    await setDraft();
    page.once('dialog',d=>d.dismiss());await page.evaluate(()=>publishExcel());
    assert.equal(published.length,0,'cancel sends no publication request');
    assert.equal(await page.evaluate(()=>records.length),baselineCount);
    await setDraft();
    page.on('dialog',d=>d.accept());await page.evaluate(()=>publishExcel());
    assert.equal(published.length,1);
    assert.deepEqual(published[0].snapshot.records,latest.records);
    assert.equal(await page.evaluate(()=>records.length),latest.records.length);
    await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>UrbanSync.api.online);
    assert.equal(await page.evaluate(()=>records.length),latest.records.length,'reload keeps latest confirmed version without resurrecting cache');
    for(const view of ['overview','comparison','ledger','quality']){
      await page.evaluate(view=>navigate(view),view);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${width}/${view}`);
    }
    assert.deepEqual(errors,[]);
    results.push({width,baselineCount,latestCount:latest.records.length,checks:'preview, close, repeat, exit, cancel, simulated publish, reload, four navigation views',errors});
    await page.close();
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}

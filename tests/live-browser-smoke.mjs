import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url=process.env.SITE_URL||'https://jasonz0829vip.github.io/tv-program-weekly-share/?smoke=20261020';
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const port=Number(process.env.SMOKE_PORT||19224);
const dir=mkdtempSync(path.join(os.tmpdir(),'urban-channel-browser-'));
const proc=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--no-first-run','--disable-features=TranslateUI',
  '--remote-debugging-port='+port,'--user-data-dir='+dir,'about:blank'
],{stdio:['ignore','ignore','pipe'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:''}});
let chromeError='';
proc.stderr.on('data',d=>{chromeError+=String(d).slice(0,300)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(1700)});return r.json()}
let tab,ws,reqId=0,pending=new Map(),errors=[],failedRequests=[],consoleErrors=[],badStatus=[],writeRequests=[];
async function connect(){
  for(let i=0;i<150;i++){
    try{const list=await json('http://127.0.0.1:'+port+'/json/list');tab=list.find(t=>t.type==='page');if(tab?.webSocketDebuggerUrl)break}catch(e){}
    if(proc.exitCode!==null)throw Error('Chrome exited with '+proc.exitCode+' '+chromeError);
    await sleep(200);
  }
  if(!tab?.webSocketDebuggerUrl)throw Error('Chrome DevTools did not become available within 30 seconds '+chromeError);
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  ws.addEventListener('message',evt=>{
    const p=JSON.parse(evt.data);
    if(p.id){
      const waiter=pending.get(p.id);
      if(waiter){pending.delete(p.id);p.error?waiter.reject(Error(p.error.message)):waiter.resolve(p.result)}
    }else if(p.method==='Network.requestWillBeSent'&&['POST','PUT','PATCH','DELETE'].includes(p.params?.request?.method)){
      writeRequests.push(p.params.request.url);
    }else if(p.method==='Runtime.exceptionThrown'){
      errors.push(p.params?.exceptionDetails?.text+' '+(p.params?.exceptionDetails?.exception?.description||''));
    }else if(p.method==='Runtime.consoleAPICalled'&&p.params?.type==='error'){
      consoleErrors.push(p.params.args?.map(x=>x.value||x.description||'').join(' ')||'console error');
    }else if(p.method==='Network.loadingFailed'){
      if(!p.params.canceled)failedRequests.push(p.params.errorText);
    }else if(p.method==='Network.responseReceived'&&p.params?.response?.status>=400){
      badStatus.push({status:p.params.response.status,url:p.params.response.url});
    }
  });
}
async function cdp(method,params={}){
  const id=++reqId;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
    setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error('CDP timeout '+method))}},20000);
  });
}
async function evaluate(expression){
  const p=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(p.exceptionDetails)throw Error('JS eval: '+p.exceptionDetails.text+' '+p.exceptionDetails.exception?.description);
  return p.result?.value;
}
function assert(x,message){if(!x)throw Error('SMOKE FAIL: '+message)}
async function main(){
  // The push workflow may start before Pages finishes serving the new assets.
  let currentParser=false;
  for(let i=0;i<36;i++){
    const index=await fetch(url+'&release_check='+Date.now()).then(r=>r.text());
    const parser=await fetch(new URL('excel-import.js?v=2.1.6&release_check='+Date.now(),url)).then(r=>r.text());
    if(index.includes('excel-import.js?v=2.1.6')&&parser.includes('function worksheetRows(')){currentParser=true;break;}
    await sleep(5000);
  }
  assert(currentParser,'Pages must serve the native-number parser and cache-busted script reference');
  await connect();
  await Promise.all([cdp('Runtime.enable'),cdp('Page.enable'),cdp('Network.enable')]);
  await cdp('Page.addScriptToEvaluateOnNewDocument',{source:
    "window.__clientExceptions=[];window.addEventListener('error',e=>window.__clientExceptions.push('error: '+e.message+' at '+e.filename+':'+e.lineno));window.addEventListener('unhandledrejection',e=>window.__clientExceptions.push('promise rejection: '+(e.reason?.message||String(e.reason))));"});
  await cdp('Page.navigate',{url});
  await sleep(7000);
  const before=await evaluate("({title:document.title,heading:document.querySelector('h1')?.textContent,programCount:document.querySelector('#fiveProgram')?.options.length,minuteBars:document.querySelectorAll('.five-bar-slot').length,metric:document.querySelector('#sharedSyncBadge')?.textContent,backendVersion:window.UrbanSync?.api?.currentVersion,mobileNavCount:document.querySelectorAll('.nav-btn').length,labels:document.querySelector('.side-bottom')?.textContent,clientExceptions:window.__clientExceptions,ready:document.readyState})");
  console.log('Homepage diagnostic:',JSON.stringify(before));
  assert(before.title==='都市频道经营驾驶舱','exact page title: '+before.title);
  assert(before.heading==='都市频道经营驾驶舱','exact heading');
  assert(before.mobileNavCount===4,'four navigation items must remain');

  const initialSchedule=await evaluate("({shown:document.querySelectorAll('.schedule-item').length,total:UrbanRecommendation.evaluate(records,PAYMENT_ROUTES).items.length,open:document.querySelectorAll('.schedule-item[open]').length})");
  assert(initialSchedule.shown===Math.min(5,initialSchedule.total)&&initialSchedule.open===0,'default five collapsed scheduling recommendations');
  await evaluate("document.querySelector('.schedule-pagination button')?.click()");
  const schedule=await evaluate("({items:[...document.querySelectorAll('.schedule-list .schedule-item')].map(x=>({program:x.querySelector('.schedule-name')?.textContent,status:x.querySelector('.schedule-status')?.textContent,summary:x.querySelector('.schedule-metrics')?.textContent,times:x.querySelectorAll('.schedule-time-item').length})),footer:document.querySelector('.schedule-footnote')?.textContent,errors:window.__clientExceptions})");
  console.log('Revenue-first schedule diagnostic:',JSON.stringify(schedule));
  const expectedSchedule=await evaluate("UrbanRecommendation.evaluate(records,PAYMENT_ROUTES).items.map(x=>({program:x.name,status:x.status,times:x.n}))");
  assert(schedule.items.length===expectedSchedule.length,'every loaded route must have a decision');
  assert(schedule.items.every((x,i)=>x.program===expectedSchedule[i].program&&x.status===expectedSchedule[i].status&&x.times===expectedSchedule[i].times),'recommendations and dates must reflect the current route data and policy');
  assert(schedule.footer.includes('不是单场归因收入'),'footnote must distinguish allocation from attributed earnings');
  assert(schedule.errors.length===0,'recommendation refresh must not throw');

  await evaluate("navigate('ledger')");
  await sleep(400);
  const ledger=await evaluate("({programCount:document.querySelector('#fiveProgram')?.options.length,sessionCount:document.querySelector('#fiveSelect0')?.options.length,minuteBars:document.querySelectorAll('.five-bar-slot').length,originalCharts:!!document.querySelector('#lvSessionBars svg'),fiveStats:document.querySelectorAll('.five-stat-item').length,minuteInvalid:document.querySelector('#fiveChart')?.textContent,errors:window.__clientExceptions})");
  console.log('Ledger diagnostic:',JSON.stringify({...ledger,minuteInvalid:String(ledger.minuteInvalid||'').slice(0,150)}));
  assert(ledger.programCount>=5,'five program choices loaded');
  assert(ledger.minuteBars===6,'single six-bin chart required');
  assert(ledger.fiveStats===4,'four headline statistics required');
  assert(ledger.originalCharts,'existing ledger visualizations remain');
  await evaluate("setFiveProgram('新加坡·马来西亚')");
  const shifted=await evaluate("({route:document.querySelector('#fiveProgram').value,bars:document.querySelectorAll('.five-bar-slot').length})");
  assert(shifted.route==='新加坡·马来西亚'&&shifted.bars===6,'route selector updates chart');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:3,mobile:true});
  await sleep(400);
  const mobile=await evaluate("({vw:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,chartWidth:document.querySelector('#fiveChart')?.clientWidth,errors:window.__clientExceptions})");
  console.log('Mobile diagnostic:',JSON.stringify(mobile));
  console.log('Runtime exceptions:',JSON.stringify(errors.slice(0,20)));
  console.log('Console errors:',JSON.stringify(consoleErrors.slice(0,20)));
  console.log('Failed network:',JSON.stringify(failedRequests.slice(0,20)));
  console.log('HTTP >=400:',JSON.stringify(badStatus.slice(0,20)));
  assert(errors.length===0&&mobile.errors.length===0,'JavaScript runtime errors present');
  assert(badStatus.length===0,'The live site returned HTTP errors: '+JSON.stringify(badStatus));
  // Exercise the actual production upload handler using synthetic local files.
  // Block the publish endpoint defensively; never call publishExcel.
  await cdp('Network.setBlockedURLs',{urls:['*/api/publish*']});
  const upload=await evaluate(`(async()=>{
    const before=JSON.stringify(UrbanSync.api.snapshot),version=UrbanSync.api.currentVersion;
    if(!window.XLSX)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';s.onload=resolve;s.onerror=()=>reject(Error('SheetJS failed'));document.head.appendChild(s)});
    const results=[];
    for(const bookType of ['xls','xlsx']){
      const rows=[['2026年11月1日首播'],...Array.from({length:6},(_,i)=>[null,'17:'+String(30+i*5)+'-'+(i===5?'18:00':'17:'+String(35+i*5)),1]),[null,null,6,null,0]];
      const headers=['标签名称','user_id','最早标签时间','订单编号','产品名称','产品编号','业务类别','年夜饭','订单状态','合同金额','实付金额','支付时间'];
      const orders=[headers,...[225.9,0.01,0].map((amount,i)=>['新版电视-我们退休啦-越南','synthetic-user','2026-11-01','synthetic-order-'+i,'合成产品','synthetic-product','商品','否','已支付',amount,amount,'2026-11-01'])];
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'越南全景');
      XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['越南全景',null,null,null,null,1,1,225.9]]),'汇总数据');
      const details=XLSX.utils.aoa_to_sheet(orders);for(const key of ['K2','K3','K4'])details[key].z='[$-10804]#,##0';XLSX.utils.book_append_sheet(wb,details,'标签用户订单明细');
      const file=new File([XLSX.write(wb,{type:'array',bookType})],'synthetic-live-check-2026.'+bookType);
      openExcelUploader();await handleExcelFile({target:{files:[file]}});
      const parsed=UrbanSync.api.parseResult;
      results.push({bookType,blocking:parsed?.blocking,amount:parsed?.snapshot.otherConsumption?.amount,orders:parsed?.snapshot.otherConsumption?.orderCount,first:parsed?.localOtherOrders[0]?.amount,previewReady:!document.querySelector('#excelLocalPreview').disabled});
      previewExcelLocally();exitExcelLocalPreview();closeExcelUploader();
    }
    return {results,version,afterVersion:UrbanSync.api.currentVersion,snapshotUnchanged:before===JSON.stringify(UrbanSync.api.snapshot)};
  })()`);
  console.log('Production upload precision diagnostic:',JSON.stringify(upload));
  assert(upload.results.every(r=>r.blocking.length===0&&r.amount===225.91&&r.orders===3&&r.first===225.9&&r.previewReady),'live XLS/XLSX upload must retain cents and allow local preview');
  assert(upload.snapshotUnchanged&&upload.version===upload.afterVersion,'upload preview must leave the confirmed production snapshot unchanged');
  assert(writeRequests.length===0,'live verification must never send a write request');
  await cdp('Network.setBlockedURLs',{urls:['*workers.dev*']});
  await cdp('Page.navigate',{url:url+(url.includes('?')?'&':'?')+'mainland_mock=1'});
  await sleep(9500);
  const china=await evaluate("({title:document.title,mirror:window.UrbanSync?.api?.mirrorLoaded,version:window.UrbanSync?.api?.currentVersion,staticVersion:window.UrbanSync?.api?.mirrorVersion,cloudOnline:window.UrbanSync?.api?.online,rows:records.length,scans:records.reduce((n,r)=>n+r.scans,0),issues:window.__clientExceptions})");
  console.log('Mainland Worker-block simulation:',JSON.stringify(china));
  assert(china.title==='都市频道经营驾驶舱'&&china.mirror,'mainland user should still load shared report without workers.dev');
  const published=await json(new URL('data/current.json',url));
  assert(china.version===china.staticVersion&&china.rows===published.snapshot.records.length&&china.scans===published.snapshot.totals.scans,'public mirror must remain consistent with its published source');
  assert(china.cloudOnline===true,'Netlify upload gateway must work when workers.dev is blocked');
  const activeGateway=await evaluate("window.UrbanSync?.api?.activeBase");
  assert(activeGateway==='https://urban-channel-sync.netlify.app','fallback must use the deployed Netlify gateway');
  assert(china.issues.length===0,'no JS errors on workers.dev-blocked network');
  await cdp('Network.setBlockedURLs',{urls:['*workers.dev*','*urban-channel-sync.netlify.app*']});
  await cdp('Page.navigate',{url:url+(url.includes('?')?'&':'?')+'all_apis_blocked=1'});
  await sleep(15000);
  const offline=await evaluate("({mirror:window.UrbanSync?.api?.mirrorLoaded,online:window.UrbanSync?.api?.online,rows:records.length})");
  assert(offline.mirror&&offline.rows===published.snapshot.records.length&&!offline.online,'all APIs blocked must retain mirror and disable publishing');
  console.log('PASS: live desktop/mobile and simulated mainland static fallback');
}
try{await main()}catch(error){
  console.error('BROWSER CHECK FAILED:',error.message);
  console.error('Runtime exceptions:',JSON.stringify(errors.slice(0,15)));
  console.error('Console errors:',JSON.stringify(consoleErrors.slice(0,15)));
  console.error('HTTP errors:',JSON.stringify(badStatus.slice(0,15)));
  console.error('Requests failed:',JSON.stringify(failedRequests.slice(0,15)));
  process.exitCode=1;
}finally{
  try{ws?.close()}catch{}
  try{proc.kill('SIGTERM')}catch{}
  try{rmSync(dir,{recursive:true,force:true})}catch{}
}


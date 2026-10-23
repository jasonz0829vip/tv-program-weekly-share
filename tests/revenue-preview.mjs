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
let tab,ws,reqId=0,pending=new Map(),errors=[],failedRequests=[],consoleErrors=[],badStatus=[];
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
 await connect();await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Network.enable');
 await cdp('Network.setBlockedURLs',{urls:['*workers.dev*','*urban-channel-sync.netlify.app*']});
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url});await sleep(4000);
 const data=await evaluate("({visible:document.querySelectorAll('.revenue-ranking button[data-revenue-route]').length,paid:PAYMENT_ROUTES.length,total:document.querySelector('#revenuePanelTotal').textContent,expected:fmt(sum(PAYMENT_ROUTES,'amount')),pending:document.querySelectorAll('.revenue-pending-row').length,unknown:new Set(records.map(x=>x.program).filter(n=>!PAYMENT_ROUTES.some(p=>p.program===n))).size})");
 assert(data.visible===Math.min(5,data.paid),'default five');assert(data.total===data.expected,'all routes total');assert(data.pending===data.unknown,'missing separately');
 assert(await evaluate("!document.querySelector('.revenue-search-toggle').open"),'search initially folded');
 await evaluate("document.querySelector('.revenue-search-toggle summary').click()");
 await evaluate("document.querySelector('.revenue-more button').click()");
 assert(await evaluate("document.querySelectorAll('.revenue-ranking button[data-revenue-route]').length===PAYMENT_ROUTES.length"),'all paid');
 assert(await evaluate("[...document.querySelectorAll('.revenue-zero')].length===PAYMENT_ROUTES.filter(x=>x.amount===0).length"),'zero explicit');
 const unchanged=await evaluate("document.querySelector('#revenuePanelTotal').textContent");assert(unchanged===data.total,'expand preserves totals');
 await evaluate("document.querySelector('.revenue-more button').click();var search=document.querySelector('.revenue-search');search.value='西葡';search.dispatchEvent(new Event('input',{bubbles:true}))");
 assert(await evaluate("document.querySelector('.revenue-ranking').textContent.includes('¥0')&&document.querySelector('.revenue-ranking').textContent.includes('已确认零成交')"),'search zero');
 assert(await evaluate("document.querySelector('#revenuePanelTotal').textContent")===data.total,'search preserves total');
 await evaluate("search.value='没有此线路';search.dispatchEvent(new Event('input',{bubbles:true}))");assert(await evaluate("document.querySelectorAll('.revenue-ranking button[data-revenue-route]').length")===0,'empty search');
 await evaluate("search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.revenue-search-toggle').open=false;document.querySelector('.revenue-chart-row').click()");await sleep(100);
 assert(await evaluate("document.querySelectorAll('#revenueSelectedDetail').length")===1,'single shared detail opens');
 await evaluate("document.querySelector('.revenue-close').click();document.documentElement.style.scrollBehavior='auto';document.querySelector('#revenueRoutes').parentElement.scrollIntoView({block:'start',behavior:'instant'})");await sleep(100);
 const fs=await import('node:fs/promises');const out=process.env.PREVIEW_OUT;await fs.mkdir(out,{recursive:true});
 async function shot(name){const x=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name),Buffer.from(x.data,'base64'))}
 await evaluate("window.scrollBy({top:-120,behavior:'instant'})");await sleep(100);await shot('revenue-desktop.png');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1400,deviceScaleFactor:1,mobile:false});await shot('revenue-and-schedule.png');
 await evaluate("document.querySelector('.revenue-chart-row').click()");await sleep(100);await shot('revenue-detail.png');
 const chartHeight=await evaluate("document.querySelector('.revenue-ranking').offsetHeight");
 await evaluate("document.querySelectorAll('.revenue-chart-row')[1].click()");
 assert(await evaluate("document.querySelectorAll('#revenueSelectedDetail').length===1&&document.querySelector('.revenue-detail-heading h4').textContent.includes(document.querySelectorAll('.revenue-chart-row')[1].dataset.revenueRoute)"),'second selection replaces same detail');
 assert(await evaluate("document.querySelector('.revenue-ranking').offsetHeight")===chartHeight,'selection never expands chart rows');
 assert(await evaluate("document.querySelector('.revenue-axis').textContent.includes(fmt(Math.max(4,Math.ceil(Math.max(1,...PAYMENT_ROUTES.map(x=>x.amount))/4/10000)*10000*4)))"),'shared amount scale');
 for(const width of [320,390,768]){
 await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:true});
 await evaluate("document.querySelector('#revenueRoutes').parentElement.scrollIntoView({block:'start',behavior:'instant'})");await sleep(100);
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'no horizontal overflow '+width);
 if(width===390){await shot('revenue-mobile.png');await evaluate("document.querySelector('.revenue-selected').scrollIntoView({block:'center',behavior:'instant'})");await sleep(100);await shot('revenue-mobile-detail.png')}
 }
 assert(errors.length===0,'runtime exceptions');console.log('PASS default5/all/collapse/search/zero/missing/detail; all-route total stable; 320/390/768 no overflow. '+JSON.stringify(data));
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


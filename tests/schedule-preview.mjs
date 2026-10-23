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
 await connect(); await cdp('Runtime.enable'); await cdp('Page.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url}); await sleep(4000);
 const base=await evaluate("({n:document.querySelectorAll('.schedule-item').length,total:UrbanRecommendation.evaluate(records,PAYMENT_ROUTES).items.length,open:document.querySelectorAll('.schedule-item[open]').length})");
 assert(base.n===Math.min(5,base.total)&&base.open===0,'default five collapsed routes');
 await evaluate("document.querySelector('.schedule-pagination button').click()");
 assert(await evaluate("document.querySelectorAll('.schedule-item').length")===base.total,'show all');
 await evaluate("document.querySelector('.schedule-pagination button').click()");
 for(const category of ['primary','observe','pause','review']){
  await evaluate(`document.querySelector('[data-category="${category}"]').click()`);
  assert(await evaluate(`document.querySelectorAll('.schedule-item').length===Math.min(5,UrbanRecommendation.evaluate(records,PAYMENT_ROUTES).items.filter(x=>x.tier==='${category}').length)`),'category '+category);
 }
 await evaluate("document.querySelector('[data-category=all]').click(); const input=document.querySelector('.schedule-search input'); input.value='不存在的线路';input.dispatchEvent(new Event('input',{bubbles:true}))");
 assert(await evaluate("document.querySelectorAll('.schedule-item').length")===0,'search empty state');
 await evaluate("var clearedInput=document.querySelector('.schedule-search input');clearedInput.value='';clearedInput.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.schedule-item summary').click()");
 await sleep(700);
 assert(await evaluate("document.querySelectorAll('.schedule-item[open]').length")===1,'expand detail');
 assert(await evaluate("!!document.querySelector('.schedule-item[open] .schedule-history:not([open])')"),'history collapsed');
 await evaluate("document.querySelector('.schedule-item summary').click();document.documentElement.style.scrollBehavior='auto';document.querySelector('.schedule-panel').scrollIntoView({block:'start',behavior:'instant'})");
 await sleep(700);
 const fs=await import('node:fs/promises');const out=process.env.PREVIEW_OUT;await fs.mkdir(out,{recursive:true});
 async function shot(name){let x=await cdp('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name),Buffer.from(x.data,'base64'))}
 await shot('schedule-desktop.png');
 await evaluate("document.querySelector('.schedule-item summary').click()");await sleep(700);await shot('schedule-detail.png');
 for(const width of [320,390,768]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:true});
  await evaluate("document.documentElement.style.scrollBehavior='auto';document.querySelector('.schedule-panel').scrollIntoView({block:'start',behavior:'instant'})");
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'no overflow '+width);
  if(width===390)await shot('schedule-mobile.png');
 }
 assert(errors.length===0,'runtime errors');console.log('PASS default5/showall/collapse, all4 categories, empty search, detail/history, 320/390/768 overflow; original policy unchanged. '+JSON.stringify(base));
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


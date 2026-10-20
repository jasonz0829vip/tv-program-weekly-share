import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url=process.env.SITE_URL||'https://jasonz0829vip.github.io/tv-program-weekly-share/?smoke=20261020';
const chrome=process.env.CHROME_BIN||'/usr/bin/google-chrome';
const port=19224;
const dir=mkdtempSync(path.join(os.tmpdir(),'urban-channel-browser-'));
const proc=spawn(chrome,[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--no-first-run','--disable-features=TranslateUI',
  '--remote-debugging-port='+port,'--user-data-dir='+dir,'about:blank'
],{stdio:['ignore','ignore','pipe']});
let chromeError='';
proc.stderr.on('data',d=>{chromeError+=String(d).slice(0,300)});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(url){const r=await fetch(url,{signal:AbortSignal.timeout(1700)});return r.json()}
let tab,ws,reqId=0,pending=new Map(),errors=[],failedRequests=[],consoleErrors=[],badStatus=[];
async function connect(){
  for(let i=0;i<50;i++){
    try{const list=await json('http://127.0.0.1:'+port+'/json/list');tab=list.find(t=>t.type==='page');if(tab?.webSocketDebuggerUrl)break}catch(e){}
    if(proc.exitCode!==null)throw Error('Chrome exited with '+proc.exitCode+' '+chromeError);
    await sleep(200);
  }
  if(!tab?.webSocketDebuggerUrl)throw Error('Chrome DevTools did not become available '+chromeError);
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
  console.log('PASS: live desktop/mobile smoke test');
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

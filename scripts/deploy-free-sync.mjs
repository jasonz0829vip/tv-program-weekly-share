#!/usr/bin/env node
/* Run only inside the manual GitHub Actions deployment with Cloudflare credentials stored as GitHub Secrets. */
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {waitForWorker} from './worker-health.mjs';

if(!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN){
  throw new Error('Cloudflare credentials are not configured. Add GitHub Actions secrets first.');
}
const name='tv-program-weekly-data';
function wrangler(args){
  return execFileSync('npx',['--no-install','wrangler',...args],{
    encoding:'utf8',env:process.env,timeout:120000,stdio:['ignore','pipe','pipe']
  });
}
function d1List(){
  const output=wrangler(['d1','list','--json']);
  const parsed=JSON.parse(output);
  return Array.isArray(parsed)?parsed:
    Array.isArray(parsed.result)?parsed.result:
    Array.isArray(parsed.databases)?parsed.databases:[];
}
let db=d1List().find(x=>x.name===name);
if(!db){
  console.log('Provisioning the free D1 database for the weekly dashboard.');
  const output=wrangler(['d1','create',name,'--location','apac']);
  if(!output.includes(name))console.log('D1 create request sent.');
  db=d1List().find(x=>x.name===name);
}
const id=db?.uuid||db?.id;
if(!/^[a-f0-9-]{36}$/i.test(id||''))throw new Error('Cloudflare D1 database could not be identified. Deployment halted to prevent unbound Worker.');
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
config.d1_databases=[{binding:'DB',database_name:name,database_id:id}];
writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2)+'\n','utf8');
console.log('Database bound. Installing/updating no paid services.');
const output=wrangler(['deploy','--strict']);
const workerUrls=output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.workers\.dev/gi)||[];
if(!workerUrls.length)throw new Error('Deployment returned no workers.dev URL. Check Cloudflare account subdomain setup.');
const url=workerUrls[workerUrls.length-1].replace(/\/+$/,'');
const health=await waitForWorker(url);
console.log('Worker live with writable D1 storage. HTTPS endpoint verified.');

if(!health.version){
  // Bootstrap ONLY data already visible in public GitHub Pages; no original client workbook, no PII.
  const html=readFileSync('index.html','utf8');
  const match=html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
  if(!match)throw new Error('Published historical records could not be located');
  const seed=JSON.parse(match[1]);
  const records=seed.records.map(r=>({
    date:r.date,program:r.program,type:r.type,startTime:r.startTime||'',scans:r.scans,orders:r.orders,
    first30:r.first30,after30:r.after30,phone:r.phone??null,group:r.group??null,
    fiveMinute:r.fiveMinute?{
      mode:'increment',values:r.fiveMinute.values,source:{
        sheet:r.fiveMinute.source?.sheet||r.program,
        valueCells:r.fiveMinute.source?.valueCells||'',
        timeCells:r.fiveMinute.source?.timeCells||'',
        totalCell:r.fiveMinute.source?.totalCell||''
      }
    }:null
  }));
  const source={name:'已核验电视节目数据.xls',hash:seed.fiveMinuteAudit?.sha256||'',sheets:11,
    notes:'从公开的历史节目聚合数据初始化，未上传客户咨询或个人信息'};
  const publish=await fetch(url+'/api/publish',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      baseVersion:null,snapshot:{schemaVersion:2,source,records,paymentSummary:seed.paymentSummary||[],metrics:[]}
    })
  });
  const result=await publish.json();
  if(!publish.ok&&!result.currentVersion)throw new Error('Initial historical upload failed: '+result.error);
  console.log(publish.ok?'Historical aggregated snapshot published':'Shared state already initialized; previous data preserved');
}
const syncConfig={apiBase:url,pollSeconds:45,note:'Uploaded XLS/XLSX is parsed in browser, only validated business metrics stored in D1. Public anonymous writers by design.'};
writeFileSync('sync-config.json',JSON.stringify(syncConfig,null,2)+'\n','utf8');
console.log('Frontend sync configuration prepared for publishing. No token stored.');

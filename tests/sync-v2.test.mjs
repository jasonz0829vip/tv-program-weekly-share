import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateSnapshot} from '../api/worker.mjs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const seedMatch=html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(seedMatch,'historical base should be preserved');
const seed=JSON.parse(seedMatch[1]);
const ctx={module:{exports:{}}};
vm.runInNewContext(readFileSync(new URL('../excel-import.js',import.meta.url),'utf8'),ctx);
const parser=ctx.module.exports;
const draft=parser.knownSnapshot(seed,{sha256:parser.KNOWN_SHA}).snapshot;
test('cloud-redacted provenance remains chartable without leaking original file metadata',()=>{
 const chart={SEED:seed};vm.createContext(chart);
 vm.runInContext(readFileSync(new URL('../five-minute.js',import.meta.url),'utf8'),chart);
 const cloud=validateSnapshot(draft);
 assert.equal(cloud.records.filter(r=>chart.fiveData(r).valid).length,16);
 const r=cloud.records[0];
 assert.equal(chart.fiveData({...r,fiveMinute:{...r.fiveMinute,source:{sheet:r.program}}}).valid,false);
});

test('Original historical xls exact source maps to 16 broadcasts, five routes and 96 real 5-min intervals',()=>{
 const v=validateSnapshot(draft);
 assert.equal(v.totals.sessions,16);
 assert.equal(v.totals.programs,5);
 assert.equal(v.totals.scans,1342);
 assert.equal(v.totals.amount,489071);
 assert.equal(v.records.filter(x=>x.fiveMinute?.values?.length===6).length,16);
 for(const row of v.records){
  assert.equal(row.fiveMinute.values.reduce((a,b)=>a+b,0),row.first30);
  assert.equal(row.first30+row.after30,row.scans);
 }
});
test('Duplicate session input is rejected',()=>{
 assert.throws(()=>validateSnapshot({...draft,records:[...draft.records,draft.records[0]]}),/重复/);
});
test('Bad 5-min interval total is rejected',()=>{
 const records=draft.records.map(r=>({...r}));
 records[0]={...records[0],fiveMinute:{...records[0].fiveMinute,values:[99,0,0,0,0,0]}};
 assert.throws(()=>validateSnapshot({...draft,records}),/六段之和/);
});
test('A new business metric may be attached without reworking 16 original records',()=>{
 const metric={key:'average_price_per_person',label:'人均客单价',unit:'元/人',valuesByProgram:{'拈花湾':499.5},source:'汇总数据'};
 const v=validateSnapshot({...draft,metrics:[metric]});
 assert.equal(v.metrics[0].valuesByProgram['拈花湾'],499.5);
});
test('Public API rejects direct PII metric',()=>{
 assert.throws(()=>validateSnapshot({...draft,metrics:[{key:'customer_phone',label:'手机号',unit:'',valuesByProgram:{'拈花湾':13000000000}}]}),/新指标/);
});
test('Synthetic worksheet incremental scans are parsed and verified',()=>{
 const rows=Array.from({length:12},()=>[]);
 rows[0][0]='2026年10月20日首播';
 for(let i=0;i<6;i++){const x=17*60+30+i*5,f=x=>String(Math.floor(x/60)).padStart(2,'0')+':'+String(x%60).padStart(2,'0');
   rows[i][1]=f(x)+'-'+f(x+5);rows[i][2]=i+1;rows[i][3]=21}
 rows[6][1]='18:00-18:05';rows[6][2]=2;
 rows[7][2]=23;rows[7][4]=4;
 const x=parser.parseMatrices({'示例线路':rows},{year:2026});
 assert.equal(x.blocking.length,0);
 assert.equal(x.snapshot.records.length,1);
 assert.equal(x.snapshot.records[0].scans,23);
 assert.equal(x.snapshot.records[0].first30,21);
 assert.equal(validateSnapshot(x.snapshot).totals.orders,4);
});
test('Front-end exposes XLS selection and backend-absent local preview without promising shared success',()=>{
 assert.match(html,/id="excelFilePicker"/);
 assert.match(html,/id="excelLocalPreview"/);
 assert.match(html,/id="excelSyncPublish"/);
 assert.match(html,/src="shared-sync.js"/);
 assert.match(html,/id="fiveMinutePanel"/);
 const conf=JSON.parse(readFileSync(new URL('../sync-config.json',import.meta.url),'utf8'));
 assert.ok(Object.hasOwn(conf,'apiBase'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {validateSnapshot} from '../api/worker.mjs';

// excel-import.js is deliberately a classic browser script; test it with a CommonJS shim.
const source=fs.readFileSync(new URL('../excel-import.js',import.meta.url),'utf8');
const parser=Function('module',source+'\nreturn module.exports;')({exports:{}});
assert.equal(typeof parser.parseMatrices,'function','Excel parser must expose named import methods');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const embedded=html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/);
assert.ok(embedded,'Source HTML should embed the verified 2026 season');
const seed=JSON.parse(embedded[1]);
test('actual aggregate workbook layout includes long follow-up intervals, shifted order columns and unfilled templates',()=>{
 const matrices=JSON.parse(fs.readFileSync(new URL('./fixtures/original-aggregate-layout.json',import.meta.url),'utf8'));
 const parsed=parser.parseMatrices(matrices,{year:2026});
 assert.deepEqual(parsed.blocking,[]);
 const checked=validateSnapshot(parsed.snapshot);
 assert.deepEqual(checked.totals,{sessions:16,programs:5,scans:1342,orders:47,amount:489071});
 assert.equal(checked.records.flatMap(r=>r.fiveMinute.values).length,96);
 for(const r of checked.records){
   const original=seed.records.find(s=>s.date===r.date&&s.program===r.program&&s.type===r.type);
   assert.ok(original);
   for(const field of ['scans','orders','first30','after30'])assert.equal(r[field],original[field]);
   assert.deepEqual(r.fiveMinute.values,original.fiveMinute.values);
 }
 assert.ok(parsed.warnings.some(w=>w.includes('西葡')&&w.includes('未填')));
});

const syntheticWorkbook=(withMoney=true)=>{
  const program='最新海南线路';
  const rows=[['2026年10月19日 首播',null,null,null,null]];
  const counts=[8,12,17,20,14,9];
  const h=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  for(let i=0;i<counts.length;i++){
    const t=17*60+30+i*5;
    rows.push([i===0?'2026年10月19日 首播':null,h(t)+'-'+h(t+5),counts[i],null,null]);
  }
  rows.push([null,null,80,null,5]);
  const sheet={[program]:rows};
  if(withMoney){
    sheet['汇总数据']=[['线路','','','','','全款订单','全款人数','全款实付金额','人均客单价','新增复购人数'],
      [program,null,null,null,null,4,8,8800,1100,3]];
  }
  return sheet;
};

test('Date parser prioritizes 10th–31st and rejects invalid dates',()=>{
  const expectations={
    '2026年10月19日首播':'2026-10-19',
    '2026年12月31日':'2026-12-31',
    '2026年02月09日':'2026-02-09',
    '2026/10/01':'2026-10-01',
    '10月19日重播':'2026-10-19',
    '2026-10-32':null,
    '2026年2月29日':null
  };
  for(const [label,expect] of Object.entries(expectations)){
    assert.equal(parser.dateLabel(label,2026),expect,label);
  }
});
test('Verified original input normalizes exactly 16 sessions, 96 increments and 489071 paid',()=>{
  const {snapshot,blocking}=parser.knownSnapshot(seed,{sha256:parser.KNOWN_SHA});
  assert.equal(blocking.length,0);
  const normalized=validateSnapshot(snapshot);
  assert.deepEqual(normalized.totals,{sessions:16,programs:5,scans:1342,orders:47,amount:489071});
  assert.equal(normalized.records.filter(r=>r.fiveMinute?.values?.length===6).length,16);
});
test('Updated workbook creates program, six minute increments, finance and new metrics',()=>{
  const data=parser.parseMatrices(syntheticWorkbook(),{year:2026});
  assert.equal(data.blocking.length,0);
  assert.equal(data.recognizedSheets[0],'最新海南线路');
  const normalized=validateSnapshot(data.snapshot);
  assert.deepEqual(normalized.totals,{sessions:1,programs:1,scans:80,orders:5,amount:8800});
  const row=normalized.records[0];
  assert.equal(row.date,'2026-10-19');
  assert.deepEqual(Array.from(row.fiveMinute.values),[8,12,17,20,14,9]);
  assert.equal(row.first30,80);
  assert.equal(row.after30,0);
  assert.deepEqual(new Set(normalized.metrics.map(x=>x.label)),new Set(['人均客单价','新增复购人数']));
  assert.equal(normalized.metrics.find(x=>x.label==='人均客单价').valuesByProgram['最新海南线路'],1100);
});
test('Missing E-column intention is a blocking error, never invented zero',()=>{
  const workbook=syntheticWorkbook(false);
  workbook['最新海南线路'][7][4]=null;
  const data=parser.parseMatrices(workbook,{year:2026});
  assert.ok(data.blocking.some(x=>x.includes('缺少有效原始数值')));
});
test('Workers reject duplicate, fake intervals and PII labels',()=>{
  const base=parser.knownSnapshot(seed).snapshot;
  assert.throws(()=>validateSnapshot({...base,records:[...base.records,base.records[0]]}),/重复/);
  const corrupt={...base.records[0],fiveMinute:{mode:'increment',values:[0,0,0,0,0,0],source:{sheet:'清远肇庆'}}};
  assert.throws(()=>validateSnapshot({...base,records:[corrupt]}),/之和/);
  assert.throws(()=>validateSnapshot({...base,metrics:[{key:'client_phone',label:'客户手机号',valuesByProgram:{'清远肇庆':13}}]}),/指标/);
});
test('Workers whitelist only approved aggregate fields; no raw client rows',()=>{
  const original=parser.knownSnapshot(seed).snapshot;
  const input={...original,records:original.records.map(x=>({...x,客户电话:'13800000000',full_client_detail:[{姓名:'测试'}]})),客户姓名:'测试'};
  const out=validateSnapshot(input);
  assert.ok(!JSON.stringify(out).includes('13800000000'));
  assert.ok(!JSON.stringify(out).includes('full_client_detail'));
  assert.ok(!JSON.stringify(out).includes('客户姓名'));
});
test('V2 upload UI and every existing navigation/chart remain available',()=>{
  for(const id of ['excelSyncModal','excelFilePicker','excelSyncPublish','sharedSyncBadge','sharedNewMetrics',
    'fiveMinutePanel','lvSessionBars','lvDailyScans','lvFirstReplay','lvScatter']){
    assert.ok(html.includes('id="'+id+'"'),id+' missing');
  }
  assert.match(html,/<script src="excel-import\.js(?:\?v=[0-9.]+)?"/);
  assert.match(html,/<script src="shared-sync\.js(?:\?[^"\s]*)?"/);
  assert.ok(html.includes('--mobile-safe-bottom:env(safe-area-inset-bottom)'));
  assert.ok(!html.includes('为什么会突出'));
  assert.ok(!html.includes('数据质量提醒'));
});

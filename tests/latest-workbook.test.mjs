import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const identity=Function('module',read('route-identity.js')+';return module.exports')({exports:{}});
const parser=Function('module',read('excel-import.js')+';return module.exports')({exports:{}});
const source=read('shared-sync.js');
const body=source.slice(source.indexOf('function mergeSnapshots('),source.indexOf('function renderFilePreview('));
const row=(startTime,scans)=>({date:'2026-11-02',program:'越南全景',type:'重播',startTime,scans,orders:0,first30:scans,after30:0,phone:0,group:null});
const snap=records=>({schemaVersion:2,records,paymentSummary:[],metrics:[],source:{name:'test'}});
const draft=(base,incoming,mode='merge',blocking=[])=>Function('API','SEED','sessionKey','window','UI',body+';return evaluateDraft()')({snapshot:base,parseResult:{snapshot:incoming,blocking}},{records:[row('00:00',99)]},identity.key,{UrbanIdentity:identity},()=>({value:mode}));
test('latest workbook removes stale Vietnam time key instead of accumulating both broadcasts',()=>{
  const old=snap([row('09:30',0)]),latest=snap([row('17:30',107)]);
  const actual=draft(old,latest);
  assert.deepEqual(actual.records,latest.records);
  assert.equal(actual.records.some(r=>r.startTime==='09:30'),false);
  assert.equal(old.records[0].startTime,'09:30','historical snapshot is not mutated');
});
test('all workbook domains replace old fields, removed routes, money, metrics and followup',()=>{
  const base={...snap([row('09:30',0)]),paymentSummary:[{program:'旧线路',amount:100}],metrics:[{key:'old',valuesByProgram:{'旧线路':1}}],followUpSummary:{schemaVersion:1,rows:[{sourceProduct:'旧线路',paidAmount:100}]}};
  const latest=snap([row('17:30',107)]);
  const actual=draft(base,latest);
  assert.deepEqual(actual.paymentSummary,[]);assert.deepEqual(actual.metrics,[]);assert.equal(actual.followUpSummary,undefined);
  assert.equal(base.followUpSummary.rows[0].paidAmount,100);
});
test('repeat latest import is idempotent and does not restore historical or seed rows',()=>{
  const latest=snap([row('17:30',107)]),first=draft(null,latest);
  assert.deepEqual(first.records,latest.records);assert.deepEqual(draft(first,latest),first);
});
test('a genuine zero in the latest workbook stays zero; missing values stay null',()=>{
  const latest=snap([{...row('09:30',0),phone:null,group:null}]);
  assert.deepEqual(draft(snap([row('17:30',107)]),latest).records,latest.records);
});
test('missing current start time is not backfilled from an older built-in record',()=>{
  const html=read('index.html'),body=html.slice(html.indexOf('function recordedTime('),html.indexOf('const displaySessionTime='));
  const recordedTime=Function('SEED',body+';return recordedTime')({records:[row('17:30',107)]});
  assert.equal(recordedTime({...row('17:30',107),startTime:''}),'');
  assert.equal(recordedTime({...row('17:30',107),startTime:undefined}),'');
  assert.equal(recordedTime(row('17:30',107)),'17:30');
});
test('invalid parse and conflicting Italy aliases still block replacement',()=>{
  assert.equal(draft(snap([]),snap([row('17:30',107)]),'replace',['invalid']),null);
  const a={...row('17:30',6),program:'意大利一地'},b={...a,program:'意大利一地16日游',scans:9};
  assert.throws(()=>draft(snap([]),snap([a,b])),/冲突/);
});
test('uploader presents latest entire workbook as the only active-data policy',()=>{
  const html=read('index.html'),modal=html.slice(html.indexOf('id="excelSyncModal"'),html.indexOf('<script id="seed-data"'));
  assert.doesNotMatch(modal,/option value="merge"|默认智能合并/);
  assert.match(modal,/最新完整表格/);
  assert.match(source,/旧版本仅保留在历史记录/);
});
const spainSheet='西葡（马进巴回）',spainTitle='西班牙+葡萄牙（马德里进巴塞罗那回）13日游';
const spainFinance=(title,amount)=>parser.parseMatrices({
  [spainSheet]:[['2026年10月20日首播'],...Array.from({length:6},(_,i)=>[null,`17:${30+i*5}-`+(i===5?'18:00':`17:${35+i*5}`),1]),[null,null,6,null,0]],
  '汇总数据':[[title,null,null,null,null,0,0,amount]]
},{year:2026,sheetMerges:{'汇总数据':[]}});
test('exact Spain Portugal financial title preserves a genuine latest-workbook zero',()=>{
  const p=spainFinance(spainTitle,0);assert.deepEqual(p.blocking,[]);assert.deepEqual(p.warnings,[]);
  assert.equal(p.snapshot.paymentSummary.length,1);assert.equal(p.snapshot.paymentSummary[0].program,spainSheet);assert.equal(p.snapshot.paymentSummary[0].amount,0);
  assert.equal(parser.canonical(spainTitle),spainSheet);
});
test('exact Spain Portugal mapping also accepts later money without using historical zero',()=>{
  const p=spainFinance(spainTitle,123.45);assert.deepEqual(p.blocking,[]);assert.equal(p.snapshot.paymentSummary[0].amount,123.45);
});
test('different Spain Portugal itinerary or duration does not silently share financial identity',()=>{
  for(const title of [spainTitle.replace('13日','12日'),spainTitle.replace('马德里进巴塞罗那回','巴塞罗那进马德里回')]){
    const p=spainFinance(title,123);assert.match(p.blocking.join(''),/无法确认归属线路/);assert.equal(p.snapshot.paymentSummary.length,0);
  }
});

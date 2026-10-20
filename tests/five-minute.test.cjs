const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const seed=JSON.parse(html.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const evidence=JSON.parse(fs.readFileSync(path.join(root,'data/five-minute-source.json'),'utf8'));
const ctx=vm.createContext({SEED:seed,records:seed.records,recordedTime:r=>r.startTime,splitCSV:undefined});
vm.runInContext(html.slice(html.indexOf('function splitCSV('),html.indexOf('function validateRecord(')),ctx);
vm.runInContext(fs.readFileSync(path.join(root,'five-minute.js'),'utf8'),ctx);
test('all 96 source increments reconcile; payment and original session totals preserved',()=>{
 assert.equal(seed.records.length,16);assert.equal(evidence.records.length,16);
 assert.equal(seed.records.reduce((n,r)=>n+r.scans,0),1342);
 assert.equal(seed.paymentSummary.reduce((n,r)=>n+r.amount,0),489071);
 assert.equal(new Set(seed.records.map(r=>r.program)).size,5);
 for(const r of seed.records){
  assert.equal(r.fiveMinute.values.length,6);
  assert.equal(r.fiveMinute.values.reduce((n,v)=>n+v,0),r.first30);
  assert.equal(r.first30+r.after30,r.scans);
  assert.equal(ctx.fiveData(r).valid,true);
  const evidenceRow=evidence.records.find(e=>e.date===r.date&&e.program===r.program&&e.type===r.type);
  assert.deepEqual(evidenceRow.values,r.fiveMinute.values);
  const times=r.fiveMinute.source.times.map(t=>t.split('-').map(x=>{const [h,m]=x.split(':').map(Number);return h*60+m}));
  times.forEach(([start,end],i)=>{assert.equal(end-start,5);if(i)assert.equal(start,times[i-1][1])});
 }
 const night=seed.records.find(r=>r.date==='2026-10-04');assert.equal(night.first30,17);assert.equal(night.after30,2);
});
test('missing, partial, negative, fractional, cumulative or mismatched data never draw',()=>{
 const base=seed.records[0];
 for(const values of [[null,7,15,15,28,16],[5,7],[5,7,-15,15,28,16],[5.5,7,15,15,28,16],[6,7,15,15,28,16]]){
  assert.equal(ctx.fiveData({...base,fiveMinute:{...base.fiveMinute,values}}).valid,false);
 }
 assert.equal(ctx.fiveData({...base,fiveMinute:{...base.fiveMinute,mode:'cumulative'}}).valid,false);
 assert.equal(ctx.fiveData({...base,after30:null}).valid,false);
 assert.equal(ctx.fiveData({...base,fiveMinute:{...base.fiveMinute,source:''}}).valid,false);
 const zero=seed.records.find(r=>r.program==='新加坡·马来西亚'&&r.date==='2026-10-14');assert.equal(ctx.fiveData(zero).values[5],0);
});
test('CSV round-trip and atomic rejection of invalid imports',()=>{
 const result=vm.runInContext(`(()=>{const r=records[0],rows=[FIVE_HEADERS,[r.date,r.program,r.type,r.startTime,...r.fiveMinute.values,r.first30,r.after30,'原表C列']];return {rows,csv:fiveCSV(rows)}})()`,ctx);
 assert.equal(ctx.parseFiveImport(result.csv).length,1);
 for(const [column,value] of [[4,''],[4,-1],[4,999],[10,99],[12,''],[0,'2099-01-01']]){
  const rows=JSON.parse(JSON.stringify(result.rows));rows[1][column]=value;
  assert.throws(()=>ctx.parseFiveImport(ctx.fiveCSV(rows)));
 }
 assert.throws(()=>ctx.parseFiveImport(ctx.fiveCSV([...result.rows,result.rows[1]])));
});
test('four primary entries and previous safe-area mobile navigation remain',()=>{
 assert.equal((html.match(/class="nav-btn/g)||[]).length,4);
 assert.ok(html.includes('--mobile-safe-bottom:env(safe-area-inset-bottom)'));
 assert.ok(html.includes('padding:0 0 var(--mobile-safe-bottom)'));
 assert.match(html,/id="lvSessionBars"/);assert.match(html,/id="lvDailyScans"/);
 assert.match(html,/id="lvFirstReplay"/);assert.match(html,/id="lvScatter"/);
});

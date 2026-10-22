import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../api/worker.mjs';

const source=readFileSync(new URL('../recommendation-policy.js',import.meta.url),'utf8');
const module={exports:{}};
const policy=Function('module',source+'\nreturn module.exports;')(module);
const site=readFileSync(new URL('../index.html',import.meta.url),'utf8');
// Original recommendation expectations use the fixed historical fixture, not the growing live mirror.
const current=validateSnapshot(JSON.parse(site.match(/<script id="seed-data" type="application\/json">([\s\S]*?)<\/script>/)[1]));
const sync=readFileSync(new URL('../shared-sync.js',import.meta.url),'utf8');

test('Historical fixture reconciliation: 5 routes, 16 sessions and ¥489071 full paid',()=>{
 const snapshot=current;
 assert.equal(snapshot.totals.sessions,16);
 assert.equal(snapshot.totals.amount,489071);
 assert.equal(new Set(snapshot.records.map(r=>r.program)).size,5);
 assert.equal(snapshot.records.reduce((x,r)=>x+r.scans,0),1342);
});
test('Original recommendations: highest scans but lowest realized gross output cannot mean add broadcasts',()=>{
 const result=policy.evaluate(current.records,current.paymentSummary);
 assert.deepEqual(result.items.map(x=>x.name),[
   '新加坡·马来西亚','越南全景','福建泰宁','清远肇庆','拈花湾'
 ]);
 assert.deepEqual(result.items.map(x=>x.status),[
   '优先续播','控制频次','谨慎验证','暂缓重播','暂缓追加排播'
 ]);
 const lowest=result.items.at(-1);
 assert.equal(lowest.avgScans,153.5);
 assert.equal(lowest.avgOrders,4.5);
 assert.equal(lowest.paid.amount,16217);
 assert.equal(lowest.revenuePerBroadcast,8108.5);
 assert.ok(Math.abs(lowest.paidPerScan-16217/307)<0.0001);
 assert.equal(lowest.paid.fullOrders,4);
 assert.match(lowest.reason,/成交产出/);
 assert.match(lowest.next,/不追加排播/);
 assert.equal(result.asOf,'2026-10-16');
});
test('Recommendation prioritizes realized gross output, not raw scans and intentions alone',()=>{
 const base=policy.evaluate(current.records,current.paymentSummary);
 const spore=base.items.find(g=>g.name==='拈花湾');
 const others=base.items.filter(g=>g.name!=='拈花湾');
 assert.equal(spore.avgScans,Math.max(...base.items.map(x=>x.avgScans)));
 assert.equal(spore.avgOrders,Math.max(...base.items.map(x=>x.avgOrders)));
 assert.equal(spore.revenuePerBroadcast,Math.min(...base.items.map(x=>x.revenuePerBroadcast)));
 assert.equal(spore.paidPerScan,Math.min(...base.items.map(x=>x.paidPerScan)));
 assert.ok(resultOrder(others)[0].revenuePerBroadcast>spore.revenuePerBroadcast);
});
function resultOrder(items){return items.slice().sort((a,b)=>b.revenuePerBroadcast-a.revenuePerBroadcast)}
test('Missing paid records may never automatically trigger more broadcasts',()=>{
 const incomplete=current.paymentSummary.filter(x=>x.program!=='拈花湾');
 const result=policy.evaluate(current.records,incomplete).items.find(x=>x.name==='拈花湾');
 assert.equal(result.status,'成交待核验');
 assert.equal(result.tier,'review');
 assert.match(result.reason,/不能仅凭扫码与意向金推荐/);
});
test('No hard-coded permanent punishment: future verified paid outcomes can change the decision',()=>{
 const rows=[...current.records,
   {date:'2026-10-18',program:'拈花湾',type:'重播',scans:110,orders:6},
   {date:'2026-10-19',program:'拈花湾',type:'重播',scans:110,orders:6}];
 const paid=current.paymentSummary.map(x=>x.program==='拈花湾'?{
   ...x,amount:320000,fullOrders:16,fullPersons:25
 }:x);
 const result=policy.evaluate(rows,paid).items.find(x=>x.name==='拈花湾');
 assert.equal(result.status,'优先续播');
 assert.equal(result.tier,'primary');
});
test('Production HTML and cloud sync both use the same policy, and preserve navigation and charts',()=>{
 assert.ok(site.includes('src="recommendation-policy.js?v=20261021"'));
 assert.ok(site.indexOf('src="recommendation-policy.js')<site.indexOf('src="shared-sync.js'));
 assert.ok(!site.includes('<span class="schedule-status">继续测试</span>'));
 assert.ok(site.includes('id="fiveMinutePanel"'));
 assert.ok(site.includes('id="excelSyncModal"'));
 assert.match(sync,/function refreshScheduleAdvice\(\)/);
 assert.match(sync,/window\.UrbanRecommendation\.evaluate\(records,PAYMENT_ROUTES\)/);
 assert.match(sync,/renderScheduleTimes\(\)/);
});

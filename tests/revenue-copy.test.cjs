const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function render(paidCount,zeroLast=false){
 const elements={};const records=Array.from({length:7},(_,i)=>({program:'线路'+i}));
 const ctx={$:id=>elements[id]??=( {} ),records,PAYMENT_ROUTES:records.slice(0,paidCount).map((r,i)=>({...r,amount:zeroLast&&i===6?0:100,fullOrders:zeroLast&&i===6?0:1,fullPersons:zeroLast&&i===6?0:2})),
 sum:(rows,key)=>rows.reduce((n,r)=>n+r[key],0),fmt:String,h:String,moneyAvg:String,decimal:()=>0,
 groups:rows=>rows.map(r=>({name:r.program,sessions:1,live:1,replay:0,scans:1,orders:0,liveScans:1,replayScans:0}))};
 const start=html.indexOf('function renderRevenue(){');
 vm.createContext(ctx);vm.runInContext(html.slice(start,html.indexOf('\nfunction ',start+1)),ctx);
 ctx.renderRevenue();return elements;
}
test('seven routes display actual coverage and never call partial payment data complete',()=>{
 const full=render(7);assert.equal(full.revenueCoverage.textContent,'共 7 条线路');
 const partial=render(6);assert.equal(partial.revenueCoverage.textContent,'共 7 条线路');
 assert.match(partial.revenueScope.textContent,/1 条线路未提供/);
 assert.equal(partial.kpiRevenue.textContent,'600');assert.equal(partial.revenueKpiScope.textContent,'按已提供的实付数据累计');
 const empty=render(0);assert.equal(empty.kpiRevenue.textContent,'—');assert.equal(empty.revenueCoverage.textContent,'共 7 条线路');
});
test('confirmed zero-sale route is included as zero rather than missing',()=>{
 const result=render(7,true);
 assert.equal(result.kpiRevenue.textContent,'600');
 assert.equal(result.revenueKpiScope.textContent,'全部线路累计');
 assert.doesNotMatch(result.revenueScope.textContent,/未提供|待补/);
 assert.match(result.revenueRoutes.innerHTML,/线路6/);
 assert.match(result.revenueRoutes.innerHTML,/¥0/);
});

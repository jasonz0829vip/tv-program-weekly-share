import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const parser=Function('module',fs.readFileSync(new URL('../excel-import.js',import.meta.url),'utf8')+';return module.exports')({exports:{}});
const header=['标签名称','user_id','最早标签时间','订单编号','产品名称','产品编号','业务类别','年夜饭','订单状态','合同金额','实付金额','支付时间'];
const order=(amount,id='000012345678901234567890')=>['新版电视-我们退休啦-越南','000001','2026-11-01',id,'合成产品','000007','商品','否','已支付',amount,amount,'2026-11-01 12:34'];
const session=[['2026年11月1日首播'],...Array.from({length:6},(_,i)=>[null,`17:${30+i*5}-`+(i===5?'18:00':`17:${35+i*5}`),1]),[null,null,6,null,0]];
const decode=address=>{const [,letters,row]=address.match(/^([A-Z]+)([0-9]+)/);return {r:Number(row)-1,c:[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1}};
const xlsx={read:bytes=>bytes,utils:{sheet_to_json:(sheet,opts)=>structuredClone(opts.raw?sheet.raw:sheet.display),decode_range:ref=>({s:decode(ref.split(':')[0])})},SSF:{is_date:format=>/yy|dd|hh|\[h\]|mm:ss/.test(format)}};
const sheet=(raw,display=raw,cells={})=>({raw,display,'!ref':'A1:M200',...cells});
async function parseDetails(raw,display=raw,cells={}){
 const book={SheetNames:['越南全景','汇总数据','标签用户订单明细'],Sheets:{'越南全景':sheet(session),'汇总数据':sheet([['越南全景',null,null,null,null,1,1,1]]),'标签用户订单明细':sheet([header,...raw],[header,...display],cells)}};
 return parser.parseFile({name:'synthetic-2026.xls',size:1,lastModified:Date.UTC(2026,10,1),arrayBuffer:async()=>new ArrayBuffer(1)},null,{...xlsx,read:()=>book});
}
test('parseFile reads 104 native currency amounts, never rounded display values',async()=>{
 const values=Array.from({length:104},(_,i)=>i===0?225.9:i===1?0.01:i===2?0:399);
 const raw=values.map((v,i)=>order(v,'synthetic-'+i)),display=raw.map(r=>{const a=r.slice();a[10]='$'+Math.round(a[10]).toLocaleString('en-US');return a});
 const cells=Object.fromEntries(values.map((v,i)=>['K'+(i+2),{t:'n',v,z:'[$-10804]#,##0;\\(#,##0\\)'}]));
 const parsed=await parseDetails(raw,display,cells);
 assert.deepEqual(parsed.blocking,[]);assert.equal(parsed.snapshot.otherConsumption.orderCount,104);
 assert.equal(parsed.snapshot.otherConsumption.amount,values.reduce((s,v)=>s+Math.round(v*100),0)/100);
 assert.equal(parsed.localOtherOrders[0].amount,225.9);assert.equal(parsed.localOtherOrders[1].amount,0.01);assert.equal(parsed.localOtherOrders[2].amount,0);
 assert.equal(parsed.snapshot.records[0].date,'2026-11-01');assert.equal(parsed.snapshot.records[0].startTime,'17:30');
});
test('real missing and invalid amounts remain blocked instead of taking display text',async()=>{
 for(const value of [null,-1,1.234,Infinity,1000000001,'$399']){
  const raw=order(value),display=raw.slice();if(typeof value==='number')display[10]='$1';
  const p=await parseDetails([raw],[display]);assert.match(p.blocking.join(''),/实付金额缺失或无效/,String(value));
 }
 for(const value of [0,0.01,1000000000])assert.deepEqual((await parseDetails([order(value)])).blocking,[]);
});
test('cached numeric formula precision survives without evaluating formula text',async()=>{
 const raw=order(1.23),display=raw.slice();display[10]='$1';
 const p=await parseDetails([raw],[display],{K2:{t:'n',v:1.23,z:'$0',f:'SUM(1.2,0.03)'}});
 assert.deepEqual(p.blocking,[]);assert.equal(p.snapshot.otherConsumption.amount,1.23);assert.ok(!JSON.stringify(p.snapshot).includes('SUM('));
});
test('timestamps, identifiers, literal amount text and scientific IDs keep their semantics',async()=>{
 const raw=order(225.9),display=raw.slice();raw[1]=1;raw[2]=46327;raw[11]=46327.5236;display[1]='000001';display[2]='2026-11-01';display[10]='$226';
 const p=await parseDetails([raw],[display]);assert.deepEqual(p.blocking,[]);
 assert.equal(p.localOtherOrders[0].orderId,'000012345678901234567890');assert.equal(p.localOtherOrders[0].paidAt,'2026-11-01 12:34');
 assert.ok(!JSON.stringify(p.snapshot).includes('000012345678901234567890'));
 assert.match((await parseDetails([order(1,'1.23456E+19')])).blocking.join(''),/科学记数/);
});
test('percentage and date formatted payments are not reinterpreted as ordinary amounts',async()=>{
 for(const [format,shown,value] of [['0%','12%',0.12],['yyyy-mm-dd','2026-11-01',46327],['[h]:mm:ss','36:00:00',1.5]]){
  const raw=order(value),display=raw.slice();display[10]=shown;
  const p=await parseDetails([raw],[display],{K2:{t:'n',v:value,z:format}});assert.match(p.blocking.join(''),/实付金额缺失或无效/);
 }
});
test('finance and route quantities use native values; date, percentage and unknown metadata stay formatted',()=>{
 const raw=[['线路',null,null,null,null,'全款订单','全款人数','实付金额','人均客单价','毛利率',null,null,null,'未知标识'],['越南全景',null,1,2,3,4,5,225.9,45.18,0.12,null,null,null,7]];
 const display=structuredClone(raw);display[1][2]='2026-11-01';display[1][7]='$226';display[1][8]='$45';display[1][9]='12%';display[1][13]='000007';
 const result=parser.worksheetRows(sheet(raw,display,{C2:{z:'yyyy-mm-dd'},H2:{z:'$0'},I2:{z:'$0'},J2:{z:'0%'}}),'汇总数据',xlsx);
 assert.equal(result[1][7],225.9);assert.equal(result[1][8],45.18);assert.equal(result[1][9],'12%');assert.equal(result[1][2],'2026-11-01');assert.equal(result[1][13],'000007');
 const routeRaw=structuredClone(session),routeDisplay=structuredClone(session);routeRaw[1][2]=1234;routeDisplay[1][2]='1.23E+3';
 assert.equal(parser.worksheetRows(sheet(routeRaw,routeDisplay),'越南全景',xlsx)[1][2],1234);
 const unknown=sheet([[null,null,1234]],[[null,null,'001234']]);assert.equal(parser.worksheetRows(unknown,'客户名单',xlsx)[0][2],'001234');assert.equal(parser.worksheetRows(unknown,'备注附表',xlsx)[0][2],'001234');
 const metadataRaw=[['线路',null,null,null,null,null,null,null,'未知标识','另一标识'],['越南全景',null,null,null,null,null,null,null,7,8]],metadataDisplay=structuredClone(metadataRaw);metadataDisplay[1][8]='000007';metadataDisplay[1][9]='000008';
 assert.deepEqual(parser.worksheetRows(sheet(metadataRaw,metadataDisplay),'汇总数据',xlsx)[1].slice(8),['000007','000008']);
});
test('native overlay respects non-A1 matrix offsets and reordered exact amount header',()=>{
 const raw=[['产品名称','实付金额','订单编号'],['合成产品',225.9,'000123']],display=[raw[0],['合成产品','$226','000123']];
 const s=sheet(raw,display,{'!ref':'C3:E4',D4:{v:225.9,t:'n',z:'$0'}});
 assert.deepEqual(parser.worksheetRows(s,'标签用户订单明细',xlsx),raw);
 s.D4.z='0%';assert.equal(parser.worksheetRows(s,'标签用户订单明细',xlsx)[1][1],'$226');
});
test('duplicate order validation is unchanged with formatted monetary input',async()=>{
 const raw=[order(12.34,'same'),order(12.34,'same')],display=raw.map(r=>{const a=r.slice();a[10]='$12';return a});
 const ok=await parseDetails(raw,display);assert.deepEqual(ok.blocking,[]);assert.equal(ok.snapshot.otherConsumption.orderCount,1);assert.equal(ok.snapshot.otherConsumption.amount,12.34);
 raw[1][10]=12.35;assert.match((await parseDetails(raw,display)).blocking.join(''),/冲突/);
});

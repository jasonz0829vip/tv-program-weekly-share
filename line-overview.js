(function(){
'use strict';
const box=document.createElement('section');box.className='line-overview';box.setAttribute('aria-label','线路经营概览');document.querySelector('#overview .stats').after(box);
let appliedFollowUp=null;let lineOrder='amount';const money=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sourceRows(){
 const source=appliedFollowUp;
 if(source?.schemaVersion===1&&Array.isArray(source.rows)){
  const groups=new Map();
  for(const row of source.rows){let g=groups.get(row.sourceProduct);if(!g){g={program:row.sourceProduct,items:[]};groups.set(row.sourceProduct,g)}g.items.push(row)}
  const sum=(items,key)=>items.some(r=>r[key]===null||r[key]===undefined)?null:(['paidAmount','otherConsumptionAmount'].includes(key)?items.reduce((n,r)=>n+Math.round(r[key]*100),0)/100:items.reduce((n,r)=>n+r[key],0));
  return [...groups.values()].map(g=>({program:g.program,amount:sum(g.items,'paidAmount'),paid:sum(g.items,'paidByOrder'),following:sum(g.items,'followingUp'),other:sum(g.items,'otherConsumptionAmount')}));
 }
 return PAYMENT_ROUTES.map(r=>({program:r.program,amount:r.amount,paid:r.fullOrders,following:null,other:null}));
}
function draw(){
const rows=sourceRows();
rows.sort((a,b)=>lineOrder==='paid'?(b.paid??-1)-(a.paid??-1):lineOrder==='name'?a.program.localeCompare(b.program,'zh-CN'):(b.amount??-1)-(a.amount??-1));
const max=Math.max(1,...rows.map(r=>r.amount||0));const pending=rows.filter(r=>[r.amount,r.paid,r.following,r.other].every(v=>v===null));const filled=rows.filter(r=>!pending.includes(r));
const total=PAYMENT_ROUTES.reduce((n,r)=>n+Math.round(r.amount*100),0)/100;const totalPaid=filled.some(r=>r.paid===null)?null:filled.reduce((n,r)=>n+r.paid,0),totalFollowing=filled.some(r=>r.following===null)?null:filled.reduce((n,r)=>n+r.following,0);const value=v=>v===null?'待补充':v;
const metric=(v,label,kind)=>'<div class="lo-count '+kind+'"><span>'+label+'</span><b>'+value(v)+(v===null?'':'<small> 人</small>')+'</b></div>';
box.innerHTML='<div class="lo-head"><div><span class="fu-kicker">成交与跟进，一起看</span><h2>线路经营概览</h2></div><label>排序 <select><option value="amount">实付金额优先</option><option value="paid">已付全款优先</option><option value="name">线路名称</option></select></label></div>'+
'<div class="lo-summary"><span>本线路实付合计 <b>¥'+money(total)+'</b></span><span>已付全款 <b>'+value(totalPaid)+'</b>'+(totalPaid===null?'':' 人')+'</span><span>跟进中 <b>'+value(totalFollowing)+'</b>'+(totalFollowing===null?'':' 人')+'</span><small>全部已填线路 · 与上方日期筛选独立</small></div>'+
'<div class="lo-columns"><span>线路</span><span>本线路实付金额</span><span>已付全款</span><span>跟进中</span><span>其他消费金额</span></div>'+
filled.map(r=>'<article class="lo-row"><div class="lo-name">'+esc(r.program)+'</div><div class="lo-money"><span>本线路实付</span><b>'+(r.amount===null?'待补充':'¥'+money(r.amount))+'</b><div class="lo-track"><i style="width:'+r.amount/max*100+'%"></i></div></div>'+metric(r.paid,'已付全款','paid')+metric(r.following,'跟进中','following')+'<div class="lo-other"><span>其他消费</span><b>'+value(r.other)+(r.other===null?'':' 元')+'</b></div></article>').join('')+
(pending.length?'<details class="lo-pending"><summary>待补充线路 <span>'+pending.length+' 条</span></summary>'+pending.map(r=>'<div><b>'+esc(r.program)+'</b><p>实付金额、已付全款、跟进中、其他消费：待补充</p></div>').join('')+'</details>':'')+
'<details class="lo-help"><summary>其他消费如何统计？</summary><p>按扫码来源线路记录；因A节目添加后购买B节目，也属于A来源的其他消费。该金额独立展示，不与本线路或全站实付相加。</p></details>';
box.querySelector('select').value=lineOrder;box.querySelector('select').onchange=e=>{lineOrder=e.target.value;draw()};
const old=document.querySelector('[aria-label="线路全款实付汇总"]');if(old)old.hidden=true;
}

const originalRender=render;render=function(){originalRender();draw()};draw();window.UrbanLines={refresh:draw,setFollowUp(value){appliedFollowUp=value}};
})();
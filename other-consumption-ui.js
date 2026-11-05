(function(){
'use strict';
let localOrders=[],localHash='',currentData=null,currentHash='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});
function apply(data,hash){
 currentData=data;currentHash=hash;
 const host=document.getElementById('sharedNewMetrics');if(!host)return;
 document.getElementById('otherConsumptionPanel')?.remove();document.getElementById('otherConsumptionDetails')?.remove();
 if(!data)return;
 host.hidden=false;let grid=host.querySelector('.shared-metrics-grid');
 if(!grid){host.innerHTML='<div class="shared-metrics-heading"><h3>经营补充指标</h3><span>本次完整表 · 全周期</span></div><div class="shared-metrics-grid"></div>';grid=host.querySelector('.shared-metrics-grid');}
 const card=document.createElement('article');card.id='otherConsumptionPanel';card.className='shared-metric-card other-consumption-panel';
 const categories=data.categories.filter(c=>c.key!=='unclassified'||c.orderCount>0),share=n=>data.amount>0?(n/data.amount*100).toFixed(2)+'%':'—';
 const delta=Math.round(data.amount*100)-Math.round(data.summaryAmount*100);
 card.innerHTML='<div class="other-heading"><h3>其他消费</h3><span>按扫码来源 · '+data.orderCount+' 单</span></div><div class="other-total"><small>实付总额</small><strong>¥'+money(data.amount)+'</strong></div>'+
 '<div class="other-category-list">'+categories.map(c=>'<div class="other-category"><span>'+esc(c.label)+'</span><div><b>¥'+money(c.amount)+'</b><small>'+share(c.amount)+'</small><i style="--share:'+Math.min(100,data.amount?c.amount/data.amount*100:0)+'%"></i></div></div>').join('')+'</div>'+
 (delta?'<p class="other-alert" role="status">金额待核：明细 ¥'+money(data.amount)+'，汇总 ¥'+money(data.summaryAmount)+'，相差 ¥'+money(Math.abs(delta)/100)+'。两者不叠加。</p>':'')+
 (data.audit?.length||data.sessionAudit?.length?'<p class="other-audit">已确认更正已记录 · '+((data.audit?.length||0)+(data.sessionAudit?.length||0))+' 项</p>':'')+
 (data.blankSummaryBatches?'<p class="other-muted">'+data.blankSummaryBatches+' 批其他消费未填，汇总暂按 0 计。</p>':'')+
 (data.annualDinner.orderCount?'<p class="other-muted">年夜饭标签 '+data.annualDinner.orderCount+' 单 / ¥'+money(data.annualDinner.amount)+'，已含在业务分类内。</p>':'')+
 (data.categories.find(c=>c.key==='unclassified')?.orderCount?'<p class="other-alert">含未分类业务，请核对后补充映射。</p>':'')+
 (data.unknownSourceOrders?'<p class="other-alert">'+data.unknownSourceOrders+' 单扫码来源待核，未猜测归属。</p>':'')+
 (data.checks||[]).filter(c=>c.left!==c.right).map(c=>'<p class="other-alert">'+(c.key==='scan_totals'?'扫码':'意向金')+'口径待核：节目场次 '+c.left+'，汇总批次 '+c.right+'。保留原值。</p>').join('')+
 '<p class="other-muted">独立统计，不并入本线路或全站实付。与上方日期筛选独立。</p>';
 grid.appendChild(card);
 const details=document.createElement('div');details.id='otherConsumptionDetails';details.className='other-details';
 details.innerHTML='<details><summary>查看购买产品汇总 <span>'+data.products.length+' 项</span></summary><div class="other-products">'+data.products.map(p=>'<article><div><b>'+esc(p.name)+'</b><small>'+esc(p.rawCategory)+' · '+p.orderCount+' 单</small></div><strong>¥'+money(p.amount)+'</strong></article>').join('')+'</div></details>'+
 '<details><summary>查看订单明细 <span>仅本机</span></summary>'+ (localHash===hash&&localOrders.length?'<div class="other-local-orders">'+localOrders.map(r=>'<article><div><b>'+esc(r.product)+'</b><small>扫码来源：'+esc(r.sourcePrograms?.join(' / ')||'待核')+' · '+esc(r.rawCategory)+'</small><small>订单尾号 '+esc(r.orderId.slice(-4))+' · '+esc(r.status)+' · '+esc(r.paidAt)+'</small></div><strong>¥'+money(r.amount)+'</strong></article>').join('')+'</div>':'<p class="other-muted">详细订单仅在导入此文件的本机内存中查看，不保存或共享客户、订单标识。</p>')+'</details>'+
 (data.audit?.length||data.sessionAudit?.length?'<details><summary>原表更正确认记录</summary>'+(data.audit||[]).map(a=>'<p class="other-muted">汇总第 '+a.sourceRow+' 行：¥'+money(a.from)+' → ¥'+money(a.to)+'。'+esc(a.reason)+'</p>').join('')+(data.sessionAudit||[]).map(a=>'<p class="other-muted">'+esc(a.program)+' '+esc(a.date)+' '+esc(a.type)+'：意向金 '+a.from+' → '+a.to+' 单。'+esc(a.reason)+'</p>').join('')+'</details>':'');
 host.appendChild(details);
}
window.UrbanOther={apply,setLocalOrders(rows,hash){localOrders=Array.isArray(rows)?rows:[];localHash=hash||'';},clearLocalOrders(){localOrders=[];localHash='';apply(currentData,currentHash);}};
})();

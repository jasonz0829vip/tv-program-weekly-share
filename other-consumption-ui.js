(function(){
'use strict';
let localOrders=[],localHash='',currentData=null,currentHash='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});
function connectToggle(buttonId,detailsId,label,count,unit){
 const button=document.getElementById(buttonId),details=document.getElementById(detailsId);if(!button||!details)return;
 const update=()=>{button.setAttribute('aria-expanded',String(details.open));button.textContent=(details.open?'收起':'查看')+label+'（'+count+unit+'）';};
 button.addEventListener('click',()=>{details.open=!details.open;update();if(details.open)details.scrollIntoView({block:'start',behavior:'smooth'});});
 details.addEventListener('toggle',update);update();
}
function apply(data,hash){
 currentData=data;currentHash=hash;
 const host=document.getElementById('sharedNewMetrics');if(!host)return;
 document.getElementById('otherConsumptionPanel')?.remove();document.getElementById('otherConsumptionDetails')?.remove();
 if(!data)return;
 host.hidden=false;let grid=host.querySelector('.shared-metrics-grid');
 if(!grid){host.innerHTML='<div class="shared-metrics-heading"><h3>经营补充指标</h3><span>本次完整表 · 全周期</span></div><div class="shared-metrics-grid"></div>';grid=host.querySelector('.shared-metrics-grid');}
 const card=document.createElement('article');card.id='otherConsumptionPanel';card.className='shared-metric-card other-consumption-panel';
 const categories=data.categories.filter(c=>c.key!=='unclassified'||c.orderCount>0),share=n=>data.amount>0?(n/data.amount*100).toFixed(2)+'%':'—';
 const hasLocal=localHash===hash&&localOrders.length>0;
 card.innerHTML='<div class="other-heading"><h3 title="按扫码来源独立统计，不并入线路或全站实付">其他消费</h3><span>独立统计 · '+data.orderCount+' 单</span></div><div class="other-total"><small>实付总额</small><strong>¥'+money(data.amount)+'</strong></div>'+
 '<div class="other-category-list">'+categories.map(c=>'<div class="other-category"><span>'+esc(c.label)+'</span><div><b>¥'+money(c.amount)+'</b><small>'+share(c.amount)+'</small><i style="--share:'+Math.min(100,data.amount?c.amount/data.amount*100:0)+'%"></i></div></div>').join('')+'</div>'+
 '<button type="button" class="other-view-products" id="otherProductToggle" aria-controls="otherProductDetails" aria-expanded="false" '+(data.products.length?'':'disabled')+'>查看产品明细（'+data.products.length+'项）</button>'+
 (hasLocal?'<button type="button" class="other-view-orders" id="otherOrderToggle" aria-controls="otherOrderDetails" aria-expanded="false">查看订单明细（'+localOrders.length+'笔，仅本机）</button>':'<p class="other-local-state">订单明细：本机导入后可查看</p>');
 grid.appendChild(card);
 const details=document.createElement('div');details.id='otherConsumptionDetails';details.className='other-details';
 details.innerHTML='<details id="otherProductDetails"><summary>购买产品明细 <span>'+data.products.length+' 项</span></summary><div class="other-products">'+data.products.map(p=>'<article><div><b>'+esc(p.name)+'</b><small>'+esc(p.rawCategory)+' · '+p.orderCount+' 单</small></div><strong>¥'+money(p.amount)+'</strong></article>').join('')+'</div></details>'+
 (hasLocal?'<details id="otherOrderDetails"><summary>订单明细 <span>'+localOrders.length+' 笔 · 仅本机</span></summary><div class="other-local-orders">'+localOrders.map(r=>'<article><div><b>'+esc(r.product)+'</b><small>扫码来源：'+esc(r.sourcePrograms?.join(' / ')||'待核')+' · '+esc(r.rawCategory)+'</small><small>订单尾号 '+esc(r.orderId.slice(-4))+' · '+esc(r.status)+' · '+esc(r.paidAt)+'</small></div><strong>¥'+money(r.amount)+'</strong></article>').join('')+'</div></details>':'');
 host.appendChild(details);
 connectToggle('otherProductToggle','otherProductDetails','产品明细',data.products.length,'项');
 if(hasLocal)connectToggle('otherOrderToggle','otherOrderDetails','订单明细',localOrders.length,'笔，仅本机');
}
window.UrbanOther={apply,setLocalOrders(rows,hash){localOrders=Array.isArray(rows)?rows:[];localHash=hash||'';},clearLocalOrders(){localOrders=[];localHash='';apply(currentData,currentHash);}};
})();

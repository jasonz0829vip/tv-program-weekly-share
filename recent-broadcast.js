(function(){
'use strict';
const RecentModel = {
  select(rows, start, end, program='all') {
    const sorted=rows.filter(r=>r.date>=start&&r.date<=end&&(program==='all'||r.program===program))
      .sort((a,b)=>(b.date+' '+b.startTime).localeCompare(a.date+' '+a.startTime)||a.program.localeCompare(b.program));
    if(!sorted.length)return null;
    const latest=sorted[0], stamp=r=>r.date+' '+r.startTime;
    const previous=rows.filter(r=>r!==latest&&r.program===latest.program&&r.type==='重播'&&stamp(r)<stamp(latest))
      .sort((a,b)=>stamp(b).localeCompare(stamp(a)))[0];
    return {latest,previous,delta:previous?latest.scans-previous.scans:null,
      percent:previous?.scans>0?(latest.scans-previous.scans)/previous.scans*100:null};
  }
};
if(typeof module!=='undefined')module.exports=RecentModel;
if(typeof document==='undefined')return;
const box=document.createElement('section');box.className='recent-preview';box.setAttribute('aria-label','最近播出变化');
const overview=document.getElementById('overview');const banner=document.getElementById('excelShareBanner');
if(banner)banner.after(box);else overview.prepend(box);
let program='all';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function draw(){
 const opts=['all',...new Set(records.map(r=>r.program))];
 if(!opts.includes(program))program='all';
 const m=RecentModel.select(records,start,end,program),r=m?.latest,p=m?.previous;
  box.innerHTML='<div class="recent-top"><div><span class="recent-eyebrow">最近播出</span><h2>'+(r?esc(r.program)+' <span class="recent-type">'+esc(r.type)+'</span>':'当前范围暂无播出')+'</h2></div><label class="recent-filter">节目 <select>'+opts.map(x=>'<option value="'+esc(x)+'"'+(x===program?' selected':'')+'>'+esc(x==='all'?'全部节目':x)+'</option>').join('')+'</select></label></div>'+
   '<div class="recent-range">'+esc(start)+' — '+esc(end)+' · 本模块节目筛选 · 基准取全历史上一重播</div>'+
   (r?'<div class="recent-main"><div class="recent-takeaway"><span class="recent-date">'+esc(r.date)+' · 扫码起点 '+esc(r.startTime||'未知')+'</span><h3>'+(p?'扫码'+(m.delta<0?'减少':m.delta>0?'增加':'持平')+'，<br>意向订单'+(r.orders-p.orders<0?'减少':r.orders-p.orders>0?'增加':'持平')+'。':'本场已录入，<br>暂无上一重播可对照。')+'</h3><span class="recent-sample">'+(p?'仅1场对照'+(r.startTime!==p.startTime?' · 扫码时段不同':''):'不计算无基准的涨跌')+'</span></div><div class="recent-numbers"><div><span>本场扫码</span><strong>'+r.scans+'<small>人次</small></strong><em>'+(p?(m.delta>=0?'+':'')+m.delta+' 人次 <b>'+(m.percent===null?'基数为0':(m.percent>0?'+':'')+m.percent.toFixed(1)+'%')+'</b>':'暂无对照')+'</em></div><div><span>本场意向金</span><strong>'+r.orders+'<small>单</small></strong><em>'+(p?(r.orders-p.orders>=0?'+':'')+(r.orders-p.orders)+' 单':'暂无对照')+'</em></div></div></div>'+
   (p?'<div class="recent-baseline"><span>上一重播'+(p.date<start?' · 范围外':'')+'</span><b>'+esc(p.date)+' · '+esc(p.startTime)+'</b><span>扫码 <b>'+p.scans+'</b> 人次</span><span>意向金 <b>'+p.orders+'</b> 单</span></div>':'<div class="recent-baseline">暂无更早的同节目重播可对照</div>')+
   '<div class="recent-bottom"><details><summary>比较口径</summary><p>扫码起点不是已核实开播时间。仅1场对照，时段、时长和流量可比性未经核实；不代表因果或真实转化率。不分摊线路实付，不改变累计口径。</p></details><button id="recentLocate">查看本场明细 <span>→</span></button></div>':'<p class="recent-empty">请调整日期或节目；不会自动回退到范围外。</p>');

 const button=box.querySelector('#recentLocate');
 if(button)button.onclick=()=>{
  navigate('ledger');
  document.getElementById('searchInput').value='';
  document.getElementById('ledgerProgramFilter').value=r.program;
  document.getElementById('typeFilter').value=r.type;
  renderLedger();setFiveView('original');
  const target=[...document.querySelectorAll('#ledgerContainer tbody tr')].find(row=>{
   const c=row.cells;return c[0]?.textContent===r.date&&c[1]?.textContent===r.program&&c[2]?.textContent===r.type&&c[3]?.textContent===(recordedTime(r)||'—');
  });
  if(target){document.querySelectorAll('.recent-target').forEach(x=>x.classList.remove('recent-target'));target.classList.add('recent-target');target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'smooth'});}
 };
 box.querySelector('select').onchange=e=>{program=e.target.value;draw()};
}
const originalRender=render;render=function(){originalRender();draw()};draw();
})();

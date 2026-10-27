(function(){
'use strict';
const RecentModel = {
  select(rows, start, end, program='all') {
    const sorted=rows.filter(r=>r.date>=start&&r.date<=end&&(program==='all'||r.program===program))
      .sort((a,b)=>(b.date+' '+b.startTime).localeCompare(a.date+' '+a.startTime)||a.program.localeCompare(b.program));
    if(!sorted.length)return null;
    const latest=sorted[0], stamp=r=>r.date+' '+r.startTime;
    const previous=rows.filter(r=>r!==latest&&r.program===latest.program&&r.type==='�ز�'&&stamp(r)<stamp(latest))
      .sort((a,b)=>stamp(b).localeCompare(stamp(a)))[0];
    return {latest,previous,delta:previous?latest.scans-previous.scans:null,
      percent:previous?.scans>0?(latest.scans-previous.scans)/previous.scans*100:null};
  }
};
if(typeof module!=='undefined')module.exports=RecentModel;
if(typeof document==='undefined')return;
const box=document.createElement('section');box.className='recent-preview';box.setAttribute('aria-label','��������仯');
const overview=document.getElementById('overview');const banner=document.getElementById('excelShareBanner');
if(banner)banner.after(box);else overview.prepend(box);
let program='all';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function draw(){
 const opts=['all',...new Set(records.map(r=>r.program))];
 if(!opts.includes(program))program='all';
 const m=RecentModel.select(records,start,end,program),r=m?.latest,p=m?.previous;
  box.innerHTML='<div class="recent-top"><div><span class="recent-eyebrow">�������</span><h2>'+(r?esc(r.program)+' <span class="recent-type">'+esc(r.type)+'</span>':'��ǰ��Χ���޲���')+'</h2></div><label class="recent-filter">��Ŀ <select>'+opts.map(x=>'<option value="'+esc(x)+'"'+(x===program?' selected':'')+'>'+esc(x==='all'?'ȫ����Ŀ':x)+'</option>').join('')+'</select></label></div>'+
   '<div class="recent-range">'+esc(start)+' �� '+esc(end)+' �� ��ģ���Ŀɸѡ �� ��׼ȡȫ��ʷ��һ�ز�</div>'+
   (r?'<div class="recent-main"><div class="recent-takeaway"><span class="recent-date">'+esc(r.date)+' �� ɨ����� '+esc(r.startTime||'δ֪')+'</span><h3>'+(p?'ɨ��'+(m.delta<0?'����':m.delta>0?'����':'��ƽ')+'��<br>���򶩵�'+(r.orders-p.orders<0?'����':r.orders-p.orders>0?'����':'��ƽ')+'��':'������¼�룬<br>������һ�ز��ɶ��ա�')+'</h3><span class="recent-sample">'+(p?'��1������'+(r.startTime!==p.startTime?' �� ɨ��ʱ�β�ͬ':''):'�������޻�׼���ǵ�')+'</span></div><div class="recent-numbers"><div><span>����ɨ��</span><strong>'+r.scans+'<small>�˴�</small></strong><em>'+(p?(m.delta>=0?'+':'')+m.delta+' �˴� <b>'+(m.percent===null?'����Ϊ0':(m.percent>0?'+':'')+m.percent.toFixed(1)+'%')+'</b>':'���޶���')+'</em></div><div><span>���������</span><strong>'+r.orders+'<small>��</small></strong><em>'+(p?(r.orders-p.orders>=0?'+':'')+(r.orders-p.orders)+' ��':'���޶���')+'</em></div></div></div>'+
   (p?'<div class="recent-baseline"><span>��һ�ز�'+(p.date<start?' �� ��Χ��':'')+'</span><b>'+esc(p.date)+' �� '+esc(p.startTime)+'</b><span>ɨ�� <b>'+p.scans+'</b> �˴�</span><span>����� <b>'+p.orders+'</b> ��</span></div>':'<div class="recent-baseline">���޸����ͬ��Ŀ�ز��ɶ���</div>')+
   '<div class="recent-bottom"><details><summary>�ȽϿھ�</summary><p>ɨ����㲻���Ѻ�ʵ����ʱ�䡣��1�����գ�ʱ�Ρ�ʱ���������ɱ���δ����ʵ���������������ʵת���ʡ�����̯��·ʵ�������ı��ۼƿھ���</p></details><button id="recentLocate">�鿴������ϸ <span>��</span></button></div>':'<p class="recent-empty">��������ڻ��Ŀ�������Զ����˵���Χ�⡣</p>');

 const button=box.querySelector('#recentLocate');
 if(button)button.onclick=()=>{
  navigate('ledger');
  document.getElementById('searchInput').value='';
  document.getElementById('ledgerProgramFilter').value=r.program;
  document.getElementById('typeFilter').value=r.type;
  renderLedger();setFiveView('original');
  const target=[...document.querySelectorAll('#ledgerContainer tbody tr')].find(row=>{
   const c=row.cells;return c[0]?.textContent===r.date&&c[1]?.textContent===r.program&&c[2]?.textContent===r.type&&c[3]?.textContent===(recordedTime(r)||'��');
  });
  if(target){document.querySelectorAll('.recent-target').forEach(x=>x.classList.remove('recent-target'));target.classList.add('recent-target');target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'center',behavior:'smooth'});}
 };
 box.querySelector('select').onchange=e=>{program=e.target.value;draw()};
}
const originalRender=render;render=function(){originalRender();draw()};draw();
})();


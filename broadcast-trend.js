// Local visual replacement only. Daily totals retain the original aggregation.
(function(){
let selected='';
const box=document.getElementById('trendChart');
const style=document.createElement('style');style.textContent=`#trendChart{height:auto!important;min-height:0!important}.tp-read{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:2px 0 12px}.tp-values{display:flex;gap:24px;font-size:11px;color:#8b9bad}.tp-values b{font-size:17px;font-weight:600;color:#365579;margin-left:6px}.tp-values small{font-size:10px;font-weight:400;color:#98a6b7}.tp-read select{border:1px solid #e3eaf2;border-radius:6px;padding:6px 9px;background:white;color:#6a819e;font-size:11px}.tp-chart svg{display:block;width:100%;height:auto;overflow:visible;font-family:inherit}.tp-caption{font-size:9px;color:#a0adbd;margin:5px 0 0;line-height:1.6}@media(max-width:600px){.tp-read{align-items:start;gap:10px}.tp-values{gap:12px;font-size:9px}.tp-values b{font-size:15px;margin-left:4px}.tp-values small{font-size:8px}.tp-read select{font-size:10px;max-width:112px;padding:5px}.tp-caption{font-size:9px}}`;document.head.append(style);
function plot(rows){
const map=new Map();rows.forEach(r=>{const d=map.get(r.date)||{date:r.date,scans:0,orders:0};d.scans+=r.scans;d.orders+=r.orders;map.set(r.date,d)});
const days=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
document.getElementById('trendInfo').textContent=days.length+' 个播出日';
if(!days.length){box.innerHTML='<p class="tp-caption">当前范围暂无播出数据。</p>';return}
if(!days.some(d=>d.date===selected))selected=days.at(-1).date;
const active=days.find(d=>d.date===selected),max=Math.max(...days.map(d=>d.scans));
const step=Math.max(1,Math.ceil(max/4/10)*10),ceiling=step*4;
const chartWidth=box.querySelector('.tp-chart')?.getBoundingClientRect().width||box.getBoundingClientRect().width;const w=Math.max(260,Math.round(chartWidth)),h=w<500?200:250,L=34,R=14,T=16,B=30,pw=w-L-R,ph=h-T-B;
const ms=d=>Date.parse(d+'T00:00:00Z'),first=ms(days[0].date),last=ms(days.at(-1).date);
const x=d=>L+(last===first?pw/2:(ms(d.date)-first)/(last-first)*pw),y=d=>T+ph-d.scans/ceiling*ph;
const peak=days.reduce((a,b)=>b.scans>a.scans?b:a);
const grid=Array.from({length:5},(_,i)=>{const v=i*step,yy=T+ph-v/ceiling*ph;return '<line x1="'+L+'" x2="'+(w-R)+'" y1="'+yy+'" y2="'+yy+'" stroke="'+(i?'#edf1f6':'#dfe6ef')+'" stroke-width="1"/><text x="'+(L-9)+'" y="'+(yy+3)+'" text-anchor="end" font-size="11" fill="#9aaabd">'+v+'</text>'}).join('');
// Calendar spacing, observed dates only: no interpolation of missing daily counts.
const labelCount=w<500?4:6,labelDates=Array.from({length:Math.min(labelCount,days.length)},(_,i)=>days[Math.round(i*(days.length-1)/(Math.min(labelCount,days.length)-1||1))]);
const labels=labelDates.map((d,i)=>'<text x="'+x(d)+'" y="'+(h-8)+'" text-anchor="'+(i===0?'start':i===labelDates.length-1?'end':'middle')+'" font-size="11" fill="#98a8bb">'+d.date.slice(5).replace('-','/')+'</text>').join('');
const path=days.map((d,i)=>(i?'L':'M')+x(d).toFixed(2)+','+y(d).toFixed(2)).join(' ');
box.innerHTML='<div class="tp-read"><div class="tp-values"><span>扫码<b>'+active.scans+'<small> 人次</small></b></span><span>意向金<b>'+active.orders+'<small> 单</small></b></span></div><label><select aria-label="查看播出日数据">'+days.map(d=>'<option value="'+d.date+'"'+(d.date===selected?' selected':'')+'>'+d.date+'</option>').join('')+'</select></label></div><div class="tp-chart"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="按真实日期间隔绘制的扫码人次趋势，零基线"><g>'+grid+'</g><line x1="'+x(active)+'" x2="'+x(active)+'" y1="'+T+'" y2="'+(T+ph)+'" stroke="#ccd8e7" stroke-dasharray="3 4"/><path d="'+path+'" fill="none" stroke="#416f9e" stroke-width="2.6" stroke-linejoin="round"/>'+days.map(d=>'<circle cx="'+x(d)+'" cy="'+y(d)+'" r="'+(d===active?4:0)+'" fill="'+(d===active?'#426c9f':'#fff')+'" stroke="#597fae" stroke-width="'+(d===active?1.5:1)+'"/><circle role="button" tabindex="0" data-date="'+d.date+'" aria-label="'+d.date+' 扫码'+d.scans+'人次 意向金'+d.orders+'单" cx="'+x(d)+'" cy="'+y(d)+'" r="12" fill="transparent" style="cursor:pointer"><title>'+d.date+' · 扫码 '+d.scans+' 人次 · 意向金 '+d.orders+' 单</title></circle>').join('')+labels+'</svg></div><p class="tp-caption">选择日期或点选折线，查看当日数据。</p>';
box.querySelector('select').onchange=e=>{selected=e.target.value;plot(getPeriod())};
box.querySelectorAll('[data-date]').forEach(el=>{const pick=()=>{selected=el.dataset.date;plot(getPeriod())};el.onclick=pick;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick()}}});
}
box.parentElement.classList.add('tp-panel');box.parentElement.querySelector('.section-sub').textContent='扫码人次 · 按播出日合计';const css=document.createElement('link');css.rel='stylesheet';css.href='broadcast-trend.css?v=20261027-1';css.onload=()=>plot(getPeriod());document.head.append(css);renderTrend=plot;plot(getPeriod());let width=0,resizeFrame=0;new ResizeObserver(()=>{const now=Math.round(box.getBoundingClientRect().width);if(now&&now!==width){width=now;cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>plot(getPeriod()))}}).observe(box);
})();

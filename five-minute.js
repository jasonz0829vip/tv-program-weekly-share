'use strict';
const FIVE_LABELS=['0–5','5–10','10–15','15–20','20–25','25–30'];
const FIVE_COLORS=['#4069d8','#0c9688','#bb7440'];
let fiveView='minute',fiveMode='line',fiveSelected=[];
function sessionId(r){return [r.date,r.program,r.type,r.startTime||''].join('|')}
function seedFive(r){
  const s=SEED.records.find(x=>sessionId(x)===sessionId(r));
  return s&&['scans','orders','first30','after30'].every(k=>s[k]===r[k])?s.fiveMinute:null;
}
function fiveData(r){
  const d=r.fiveMinute||seedFive(r),v=d?.values;
  if(!Array.isArray(v)||v.length!==6||v.some(n=>typeof n!=='number'||!Number.isSafeInteger(n)||n<0))return {valid:false,reason:'缺少完整的六段扫码增量，缺测不记为0。'};
  if(d.mode!=='increment')return {valid:false,reason:'需要独立分段增量，累计值不能直接绘图。'};
  if(!d.source||!String(typeof d.source==='string'?d.source:d.source.file||'').trim())return {valid:false,reason:'缺少数据来源，请补充后再核验。'};
  if(r.first30==null||v.reduce((a,b)=>a+b,0)!==r.first30)return {valid:false,reason:'六段之和与30分钟内扫码数不符，暂不绘图。'};
  if(r.after30==null||r.first30+r.after30!==r.scans)return {valid:false,reason:'30分钟内与后续扫码之和不等于该场总量，暂不绘图。'};
  return {valid:true,values:v,source:d.source};
}
function setFiveView(view){
  fiveView=view;
  $('fiveMinutePanel').hidden=view!=='minute';$('fiveOriginal').hidden=view!=='original';
  for(const b of document.querySelectorAll('[data-five-view]'))b.setAttribute('aria-selected',String(b.dataset.fiveView===view));
}
function openFive(){navigate('ledger');setFiveView('minute');history.replaceState(null,'','#ledger-five');$('fiveTabs').scrollIntoView({block:'start',behavior:'smooth'})}
function setFiveMode(mode){fiveMode=mode;renderFiveMinute()}
function setFiveSelection(index,value){fiveSelected[index]=value;renderFiveMinute()}
function fiveName(r){return r.date+' '+r.program+' '+r.type+' '+(recordedTime(r)||'时间待补')}
function renderFiveMinute(){
  const rows=ledgerRecordsForCharts().slice().reverse();
  if(!fiveSelected.length&&rows.length){fiveSelected=[sessionId(rows[0]),sessionId(rows.find(r=>r.program===rows[0].program&&sessionId(r)!==sessionId(rows[0]))||rows[1]||rows[0]),''];if(fiveSelected[0]===fiveSelected[1])fiveSelected[1]=''}
  const ids=rows.map(sessionId);
  if(!ids.includes(fiveSelected[0]))fiveSelected[0]=ids[0]||'';
  for(let i=1;i<3;i++)if(!ids.includes(fiveSelected[i]))fiveSelected[i]='';
  const selected=[];
  for(let i=0;i<3;i++){
    const el=$('fiveSelect'+i),value=fiveSelected[i]||'';
    el.innerHTML=(i?'<option value="">不比较</option>':'')+rows.map(r=>'<option value="'+h(sessionId(r))+'">'+h(fiveName(r))+'</option>').join('');el.value=value;
    const r=rows.find(r=>sessionId(r)===value);if(r&&!selected.some(s=>sessionId(s.r)===value))selected.push({r,color:FIVE_COLORS[i],data:fiveData(r)});
  }
  const validCount=rows.filter(r=>fiveData(r).valid).length;
  $('fiveCoverage').textContent=validCount+' / '+rows.length+' 场六段完整';
  $('fiveScope').textContent='沿用上方日期、线路与首播／重播筛选。当前 '+rows.length+' 场，可选择最多3场并排比较。';
  $('fiveLegend').innerHTML=selected.map(s=>'<span style="--series:'+s.color+'">'+h(fiveName(s.r))+(s.data.valid?'':'（缺测／未通过核验）')+'</span>').join('');
  for(const b of document.querySelectorAll('[data-five-mode]'))b.setAttribute('aria-pressed',String(b.dataset.fiveMode===fiveMode));
  const commonMax=Math.max(1,...selected.filter(s=>s.data.valid).flatMap(s=>s.data.values));
  $('fiveChart').innerHTML=fiveChart(selected,commonMax);
  $('fiveCards').innerHTML=selected.length?selected.map(s=>fiveCard(s,commonMax)).join(''):'<div class="five-missing">当前筛选没有场次，请切换日期或线路。</div>';
  $('fiveScrollHint').textContent=selected.length>1?'手机可左右滑动比较各场卡片；上图使用相同人数刻度。':'六段为各自区间新增扫码数，后续扫码单独列示。';
  setFiveView(fiveView);
}
function fiveChart(selected,max){
  const good=selected.filter(s=>s.data.valid);
  if(!good.length)return '<div class="five-missing">暂无通过核验的完整六段数据，不绘制推测曲线。请选择其他场次或补录分段数据。</div>';
  const W=700,H=285,L=46,R=18,T=24,B=48,pw=W-L-R,ph=H-T-B,ceil=Math.ceil(max/4)*4;
  const x=i=>L+pw*(i+.5)/6,y=v=>T+ph*(1-v/ceil);
  let svg=Array.from({length:5},(_,i)=>{const v=ceil*i/4;return `<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#e5ecf6"/><text x="${L-10}" y="${y(v)+4}" text-anchor="end" fill="#6f8199" font-size="12">${v}</text>`}).join('');
  good.forEach((s,j)=>{
    const pts=s.data.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ');
    if(fiveMode==='line')svg+=`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="3"/>`;
    s.data.values.forEach((v,i)=>{
      const title=h(fiveName(s.r)+' '+FIVE_LABELS[i]+'分钟：'+v+'人次');
      if(fiveMode==='bar'){const bw=Math.min(24,pw/6/(good.length+1)),xx=x(i)+(j-(good.length-1)/2)*(bw+3)-bw/2;svg+=`<rect x="${xx}" y="${y(v)}" width="${bw}" height="${T+ph-y(v)}" rx="3" fill="${s.color}"><title>${title}</title></rect>`}
      else svg+=`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="white" stroke="${s.color}" stroke-width="2"><title>${title}</title></circle>`;
    });
  });
  svg+=FIVE_LABELS.map((label,i)=>`<text x="${x(i)}" y="${H-22}" text-anchor="middle" fill="#506b8b" font-size="13">${label}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每5分钟新增扫码人数${fiveMode==='line'?'折线':'柱状'}对比图"><text x="5" y="14" font-size="12" fill="#657e9b">人次</text>${svg}<text x="${W-8}" y="${H-3}" text-anchor="end" font-size="11" fill="#6b8099">相对首个扫码区间起点 / 分钟</text></svg>`;
}
function fiveCard({r,color,data},max){
  const nums=data.valid?data.values:[null,null,null,null,null,null];
  const source=data.source;
  const src=typeof source==='string'?h(source):source?`${h(source.file)} · ${h(source.sheet)}!${h(source.valueCells)}<br>时间区间：${h(source.timeCells)}；总量：${h(source.totalCell)}<br>D列合并合计：${h(source.mergedTotalRange)}（${h(source.mergedTotal)}）<br>${h(source.note)}<br>文件 SHA-256：${h(source.sha256)}`:'尚无可核验的六段来源';
  return `<article class="five-card" style="--series:${color}"><h3>${h(r.program)}</h3><p class="five-session">${h(r.date)} · ${h(r.type)} · 扫码起点 ${h(recordedTime(r)||'待补')}</p><div class="five-totals"><span>30分钟内<b>${r.first30==null?'—':fmt(r.first30)}</b></span><span>后续扫码<b>${r.after30==null?'—':fmt(r.after30)}</b></span><span>总扫码<b>${fmt(r.scans)}</b></span></div>${data.valid?'':'<p class="five-missing">'+h(data.reason)+'</p>'}<table class="five-values"><thead><tr><th>相对区间（分钟）</th><th>人数</th><th>同刻度比较</th></tr></thead><tbody>${nums.map((n,i)=>`<tr><td>${FIVE_LABELS[i]}</td><td>${n==null?'缺测':fmt(n)}</td><td>${n==null?'—':`<i style="width:${n/max*100}%"></i>`}</td></tr>`).join('')}</tbody></table><details class="five-source"><summary>查看原始单元格与口径</summary><p>${src}</p>${source?.times?'<p>'+source.times.map((t,i)=>h(t)+'：'+nums[i]).join('<br>')+'</p>':''}</details></article>`;
}
const FIVE_HEADERS=['日期','节目','播出类型','扫码起始时间','0–5分钟','5–10分钟','10–15分钟','15–20分钟','20–25分钟','25–30分钟','30分钟内扫码','后续扫码','来源'];
function fiveCSV(rows){return '\ufeff'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')}
function downloadFiveTemplate(){
  const rows=ledgerRecordsForCharts();
  saveBlob(fiveCSV([FIVE_HEADERS,...rows.map(r=>[r.date,r.program,r.type,recordedTime(r),'','','','','','',r.first30??'',r.after30??'',''])]),'每5分钟扫码_增量录入模板.csv','text/csv;charset=utf-8');
}
function exportFive(){saveBlob(fiveCSV([FIVE_HEADERS,...ledgerRecordsForCharts().map(r=>{const d=fiveData(r);return [r.date,r.program,r.type,recordedTime(r),...(d.valid?d.values:['','','','','','']),r.first30??'',r.after30??'',typeof d.source==='string'?d.source:d.source?d.source.file+' / '+d.source.sheet+'!'+d.source.valueCells:'']})]),'每5分钟扫码_含来源.csv','text/csv;charset=utf-8')}
function parseFiveImport(text){
  const lines=splitCSV(text.replace(/^\ufeff/,''));
  if(JSON.stringify(lines[0])!==JSON.stringify(FIVE_HEADERS))throw new Error('列名或顺序与模板不符，请使用下载的分时模板');
  if(lines.length<2)throw new Error('没有数据行');
  const seen=new Set(),updates=[];
  lines.slice(1).forEach((row,i)=>{
    if(row.length!==FIVE_HEADERS.length)throw new Error('第'+(i+2)+'行列数错误');
    const [date,program,type,time]=row.map(v=>v.trim());
    const matches=records.filter(r=>r.date===date&&r.program===program&&r.type===type&&recordedTime(r)===time);
    if(matches.length!==1)throw new Error('第'+(i+2)+'行无法唯一匹配已有场次');
    const r=matches[0],id=sessionId(r);if(seen.has(id))throw new Error('第'+(i+2)+'行场次重复');seen.add(id);
    const numeric=row.slice(4,12).map(v=>v.trim());
    if(numeric.some(v=>!/^\d+$/.test(v)))throw new Error('第'+(i+2)+'行缺测或非非负整数，空白不能当0');
    const vals=numeric.map(Number);if(vals.some(v=>!Number.isSafeInteger(v)))throw new Error('数值超出有效范围');
    const next={...r,first30:vals[6],after30:vals[7],fiveMinute:{values:vals.slice(0,6),mode:'increment',source:row[12].trim()}};
    // The existing 30-minute control must agree; correcting a control requires its own source review.
    if(r.first30!==next.first30||r.after30!==next.after30)throw new Error('第'+(i+2)+'行30分钟或后续合计与现有场次不符，请先核对原表');
    const data=fiveData(next);if(!data.valid)throw new Error('第'+(i+2)+'行：'+data.reason);
    updates.push(next);
  });
  return updates;
}
async function importFive(e){
  const file=e.target.files?.[0];if(!file)return;
  try{
    const updates=parseFiveImport(await file.text()),map=new Map(updates.map(r=>[sessionId(r),r])),next=records.map(r=>map.get(sessionId(r))||r);
    localStorage.setItem(storageKey,JSON.stringify(next));records=next;render();
    $('fiveFeedback').className='five-feedback';$('fiveFeedback').textContent='已通过核验并保存 '+updates.length+' 场，仅保存在本浏览器，可导出备份。';
  }catch(err){$('fiveFeedback').className='five-feedback error';$('fiveFeedback').textContent='未导入：'+err.message}
  finally{e.target.value=''}
}

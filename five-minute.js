'use strict';
const FIVE_LABELS=['0–5','5–10','10–15','15–20','20–25','25–30'];
let fiveView='minute',fiveProgram='',fiveSession='';
function sessionId(r){return [r.date,r.program,r.type,r.startTime||''].join('|')}
function seedFive(r){
  const s=SEED.records.find(x=>sessionId(x)===sessionId(r));
  return s&&['scans','orders','first30','after30'].every(k=>s[k]===r[k])?s.fiveMinute:null;
}
function fiveData(r){
  const d=r.fiveMinute||seedFive(r),v=d?.values;
  if(!Array.isArray(v)||v.length!==6||v.some(n=>typeof n!=='number'||!Number.isSafeInteger(n)||n<0))return {valid:false,reason:'缺少完整的六段扫码增量，缺测不记为0。'};
  if(d.mode!=='increment')return {valid:false,reason:'需要独立分段增量，累计值不能直接绘图。'};
  const source=d.source;
  const hasSource=typeof source==='string'?source.trim():source&&(String(source.file||'').trim()||['sheet','valueCells','timeCells','totalCell'].every(k=>typeof source[k]==='string'&&source[k].trim()));
  if(!hasSource)return {valid:false,reason:'缺少数据来源，请补充后再核验。'};
  if(r.first30==null||v.reduce((a,b)=>a+b,0)!==r.first30)return {valid:false,reason:'六段之和与30分钟内扫码数不符，暂不绘图。'};
  if(r.after30==null||r.first30+r.after30!==r.scans)return {valid:false,reason:'30分钟内与后续扫码之和不等于该场总量，暂不绘图。'};
  return {valid:true,values:v,source:d.source};
}
function setFiveView(view){
  fiveView=view;
  $('fiveMinutePanel').hidden=view!=='minute';
  $('fiveOriginal').hidden=view!=='original';
  for(const b of document.querySelectorAll('[data-five-view]')){
    b.setAttribute('aria-selected',String(b.dataset.fiveView===view));
  }
}
function openFive(){
  navigate('ledger');
  setFiveView('minute');
  history.replaceState(null,'','#ledger-five');
  $('fiveTabs').scrollIntoView({block:'start',behavior:'smooth'});
}
function setFiveProgram(name){
  fiveProgram=name;
  fiveSession='';
  renderFiveMinute();
}
function setFiveSelection(index,value){
  if(index!==0)return;
  fiveSession=value;
  renderFiveMinute();
}
function fiveName(r){return r.date+' · '+r.type+' · '+(recordedTime(r)||'时间未录')}
function fiveStats(r,data){
  if(!r)return '';
  const peak=data.valid?Math.max(...data.values):null;
  const peakIndexes=data.valid?data.values.map((n,i)=>n===peak?i:-1).filter(i=>i>=0):[];
  const peakText=peak===null?'缺测':peakIndexes.map(i=>FIVE_LABELS[i]).join('、')+' 分钟';
  const items=[
    {label:'30分钟内扫码',value:r.first30,unit:'人次'},
    {label:'后续跟踪扫码',value:r.after30,unit:'人次'},
    {label:'累计扫码',value:r.scans,unit:'人次'},
    {label:'扫码最多的时段',value:peakText,unit:peak===null?'':fmt(peak)+' 人次'}
  ];
  return items.map((x,i)=>'<div class="five-stat-item '+(i===3?'five-stat-peak':'')+'"><span>'+x.label+'</span>'+
    '<strong>'+ (typeof x.value==='number'?fmt(x.value):h(x.value==null?'—':x.value))+'</strong>'+
    '<small>'+h(x.unit)+'</small></div>').join('');
}
function renderFiveMinute(){
  const rows=ledgerRecordsForCharts().slice().reverse();
  const names=[...new Set(rows.map(r=>r.program))];
  if(!names.includes(fiveProgram))fiveProgram=names[0]||'';
  const programSelect=$('fiveProgram');
  programSelect.innerHTML=names.length?names.map(n=>'<option value="'+h(n)+'">'+h(n)+'</option>').join(''):'<option value="">当前日期范围没有节目</option>';
  programSelect.value=fiveProgram;
  programSelect.disabled=!names.length;
  const sessions=rows.filter(r=>r.program===fiveProgram);
  const sessionIds=sessions.map(sessionId);
  if(!sessionIds.includes(fiveSession))fiveSession=sessionIds[0]||'';
  const sessionSelect=$('fiveSelect0');
  sessionSelect.innerHTML=sessions.length?sessions.map(r=>'<option value="'+h(sessionId(r))+'">'+h(fiveName(r))+'</option>').join(''):'<option value="">暂无场次</option>';
  sessionSelect.value=fiveSession;
  sessionSelect.disabled=!sessions.length;
  const r=sessions.find(r=>sessionId(r)===fiveSession);
  const data=r?fiveData(r):null;
  const validCount=rows.filter(r=>fiveData(r).valid).length;
  $('fiveCoverage').textContent=validCount+' / '+rows.length+' 场分段已核实';
  $('fiveScope').textContent='只看选中场次的六个5分钟扫码数。先选节目，再选首播或重播；不叠加其他场次。';
  $('fiveStats').innerHTML=r?fiveStats(r,data):'<div class="five-missing">当前筛选没有场次，请切换上方日期或线路。</div>';
  $('fiveChart').innerHTML=r?fiveChart(r,data):'<div class="five-missing">暂无场次数据。</div>';
  $('fiveCards').innerHTML=r?fiveCard(r,data):'';
  setFiveView(fiveView);
}
function fiveChart(r,data){
  if(!data.valid)return '<div class="five-missing">'+h(data.reason)+'</div>';
  const max=Math.max(1,...data.values);
  const bars=data.values.map((n,i)=>{
    const isPeak=n===max&&n>0;
    return '<div class="five-bar-slot'+(isPeak?' is-peak':'')+'">'+
      '<div class="five-bar-number">'+fmt(n)+'</div>'+
      '<div class="five-bar-track"><span class="five-bar-fill" style="height:'+(n===0?0:Math.max(2,n/max*100)).toFixed(1)+'%"></span></div>'+
      '<div class="five-bar-label">'+FIVE_LABELS[i]+'</div></div>';
  }).join('');
  return '<div class="five-single-bar-chart" role="img" aria-label="'+h(r.program+' '+r.date+' '+r.type+'六段扫码：'+data.values.join('、')+'人次')+'">'+bars+'</div>'+
    '<div class="five-chart-axis">播出相对时段（分钟） · 数字为本时段新增扫码人次</div>';
}
function fiveCard(r,data){
  const nums=data.valid?data.values:[null,null,null,null,null,null];
  const source=data.source;
  const src=typeof source==='string'?h(source):source?[
    [source.file,source.sheet&&source.sheet+'!'+(source.valueCells||'')].filter(Boolean).map(h).join(' · '),
    source.timeCells&&'时间区间：'+h(source.timeCells)+'；总量：'+h(source.totalCell||''),
    source.mergedTotalRange&&'D列合并合计：'+h(source.mergedTotalRange)+'（'+h(source.mergedTotal)+'）',
    source.note&&h(source.note),source.definition&&h(source.definition),
    source.sha256&&'文件 SHA-256：'+h(source.sha256)
  ].filter(Boolean).join('<br>'):'尚无可核验的六段来源';
  const max=data.valid?Math.max(1,...data.values):1;
  const rows=nums.map((n,i)=>{
    const pctText=n===null||!r.first30?'—':(n/r.first30*100).toFixed(1)+'%';
    const width=n===null?0:n/max*100;
    return '<tr><td>'+FIVE_LABELS[i]+' 分钟</td>'+
      '<td>'+ (n===null?'缺测':fmt(n))+'</td>'+
      '<td><div class="five-value-share"><span>'+pctText+'</span>'+
      (n===null?'':'<i style="width:'+width.toFixed(1)+'%"></i>')+'</div></td></tr>';
  }).join('');
  const sourceTime=source?.times?.length===6?'<p>'+source.times.map((t,i)=>h(t)+'：'+(nums[i]===null?'缺测':nums[i])).join('<br>')+'</p>':'';
  return '<article class="five-card"><div class="five-single-heading"><h3>六段扫码明细</h3>'+
    '<p>'+h(r.program)+' · '+h(r.date)+' · '+h(r.type)+' · 首段起点 '+h(recordedTime(r)||'待补')+'</p></div>'+
    '<table class="five-values"><thead><tr><th scope="col">时间段</th><th scope="col">扫码人数</th><th scope="col">30分钟内占比</th></tr></thead>'+
    '<tbody>'+rows+'</tbody></table>'+
    '<details class="five-source"><summary>查看原表单元格与统计口径</summary><p>'+src+'</p>'+sourceTime+'</details></article>';
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

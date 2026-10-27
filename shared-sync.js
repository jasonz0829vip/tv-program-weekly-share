/* 都市频道共享周报 V2: upload original XLS/XLSX locally, publish de-identified data to D1. */
'use strict';
(function(){
const API={base:'',enabled:false,currentVersion:null,snapshot:null,updatedAt:'',preview:null,sourceFile:null,parseResult:null,polling:false,sheetLoader:null,localPreview:false,online:false,mirrorLoaded:false,mirrorVersion:null,mirrorTime:'',mirrorPath:'data/current.json',sourceKind:'seed',gateways:[],activeBase:''};
const CLOUD_CACHE_KEY='urban-channel-last-confirmed-shared-v1';
const UI=id=>document.getElementById(id);
const text=(id,value)=>{const el=UI(id);if(el)el.textContent=String(value??'')};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const total=(rows,key)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
const dates=(rows)=>rows.map(r=>r.date).sort();
const sessionKey=r=>[r.date,r.program,r.type,r.startTime||''].join('|');
const fmtNumber=n=>Number(n||0).toLocaleString('zh-CN');
const safeStatus=(label,type)=>{
  const badge=UI('sharedSyncBadge');
  if(!badge)return;
  badge.textContent=label;
  badge.dataset.state=type||'pending';
};
function feedback(message,style='neutral'){
  const el=UI('excelSyncFeedback');
  if(el){el.textContent=message;el.dataset.level=style}
}
function showModal(){const modal=UI('excelSyncModal');if(modal){modal.classList.add('show');UI('excelFilePicker')?.focus()}}
function hideModal(){UI('excelSyncModal')?.classList.remove('show')}
function openExcelUploader(){
  showModal();feedback(API.online?'选择原始 .xls / .xlsx 文件即可开始解析，完成核验后可发布给所有人。':API.enabled?'当前网络无法连接共享接口。Excel仍可在本机解析预览，但不能宣称已发布给所有人。':'可以先解析、预览 Excel；全员共享还需连接免费云端服务。');
  updatePublishButton();
}
function setRunning(b){
  const btn=UI('excelSyncPublish');
  if(btn){btn.disabled=b||!API.online||!API.preview;btn.textContent=b?'正在同步…':'确认发布 · 全员同步'}
  const demo=UI('excelLocalPreview');if(demo)demo.disabled=b||!API.preview;
  const file=UI('excelFilePicker');if(file)file.disabled=b;
}
function updatePublishButton(){setRunning(false)}
function cleanBase(s){
  const val=String(s||'').trim().replace(/\/+$/,'');
  if(!val)return '';
  try{const u=new URL(val);return u.protocol==='https:'&&u.hostname&&!u.username&&!u.password&&!u.search&&!u.hash?val:''}catch{return ''}
}
async function request(path,options={}){
  const bases=[API.base,...API.gateways].filter(Boolean);
  if(!bases.length)throw Error('尚未配置共享数据上传服务');
  let preferred=API.activeBase||'';
  try{if(!preferred)preferred=localStorage.getItem('urban-channel-best-gateway')||''}catch(e){}
  const ordered=preferred&&bases.includes(preferred)?[preferred,...bases.filter(x=>x!==preferred)]:bases;
  let lastFailure;
  for(const base of ordered){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),ordered.length>1?6000:15000);
    try{
      const res=await fetch(base+path,{...options,signal:controller.signal,cache:'no-store'});
      let payload;
      try{payload=await res.json()}catch(e){throw Error('共享接口没有返回有效JSON')}
      if(!res.ok||payload?.ok===false){
        const error=Error(payload?.error||'同步失败：HTTP '+res.status);
        // Validation and optimistic-lock errors are shared across all proxies. No fallback retry.
        if(res.status>=400&&res.status<500&&res.status!==429)throw Object.assign(error,{stop:true});
        throw error;
      }
      API.activeBase=base;
      try{localStorage.setItem('urban-channel-best-gateway',base)}catch(e){}
      return payload;
    }catch(error){
      if(error.stop)throw error;
      lastFailure=error;
    }finally{clearTimeout(timeout)}
  }
  throw Error('国内、国外共享接口当前均无法访问：'+(lastFailure?.name==='AbortError'?'连接超时':String(lastFailure?.message||'网络不可达')));
}
async function loadSheetJS(){
  if(window.XLSX?.read)return window.XLSX;
  if(API.sheetLoader)return API.sheetLoader;
  const urls=[
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  ];
  API.sheetLoader=(async()=>{
    for(const url of urls){
      try{
        await new Promise((resolve,reject)=>{
          const script=document.createElement('script');
          let finished=false;
          const timer=setTimeout(()=>{if(!finished){finished=true;script.remove();reject(Error('加载超时'))}},12000);
          script.src=url;script.async=true;
          script.onload=()=>{if(!finished){finished=true;clearTimeout(timer);resolve()}};
          script.onerror=()=>{if(!finished){finished=true;clearTimeout(timer);script.remove();reject(Error('加载失败'))}};
          document.head.appendChild(script);
        });
        if(window.XLSX?.read)return window.XLSX;
      }catch(e){console.warn('Excel parser CDN retry:',e.message)}
    }
    throw Error('Excel解析组件无法加载，请切换网络后重试；原始文件不曾上传到任何服务器。');
  })();
  try{return await API.sheetLoader}finally{API.sheetLoader=null}
}
function mergeSnapshots(incoming,mode){
  if(mode==='replace')return incoming;
  const base=API.snapshot||{
    records:SEED.records,paymentSummary:SEED.paymentSummary,metrics:[],source:{notes:'历史内置周报'}
  };
  const recordMap=new Map();
  (base.records||[]).forEach(r=>recordMap.set(sessionKey(r),r));
  (incoming.records||[]).forEach(r=>recordMap.set(sessionKey(r),r));
  const paidMap=new Map();
  (base.paymentSummary||[]).forEach(p=>paidMap.set(p.program,p));
  (incoming.paymentSummary||[]).forEach(p=>paidMap.set(p.program,p));
  const metricsMap=new Map();
  (base.metrics||[]).forEach(m=>metricsMap.set(m.key,m));
  (incoming.metrics||[]).forEach(m=>{
    const prev=metricsMap.get(m.key);
    metricsMap.set(m.key,{...m,valuesByProgram:{...(prev?.valuesByProgram||{}),...m.valuesByProgram}});
  });
  let followUpSummary=base.followUpSummary;
  if(incoming.followUpSummary){
    const replacing=new Set(incoming.followUpSummary.rows.map(r=>r.sourceProduct));
    followUpSummary={schemaVersion:1,rows:[...(base.followUpSummary?.rows||[]).filter(r=>!replacing.has(r.sourceProduct)),...incoming.followUpSummary.rows]};
  }
  return {...incoming,...(followUpSummary?{followUpSummary}:{}),
    records:[...recordMap.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.program.localeCompare(b.program)),
    paymentSummary:[...paidMap.values()],
    metrics:[...metricsMap.values()],
    source:{...incoming.source,notes:'智能合并新旧场次；同场次采用最新数据；全款同线路覆盖，不重复累加'}
  };
}
function evaluateDraft(){
  if(!API.parseResult||API.parseResult.blocking?.length)return null;
  const mode=UI('excelSyncMode')?.value||'merge';
  return mergeSnapshots(API.parseResult.snapshot,mode);
}
function renderFilePreview(){
  const result=API.parseResult, box=UI('excelSyncPreview');
  if(!result||!box)return;
  if(result.blocking?.length){
    API.preview=null;
    box.innerHTML='<div class="excel-preview-error"><b>发现需要核实的字段，禁止发布</b>'+result.blocking.slice(0,12).map(x=>'<div>'+esc(x)+'</div>').join('')+'</div>';
    feedback('请核对原始 Excel：存在 '+result.blocking.length+' 项必须修复的错误。','error');
    updatePublishButton();return;
  }
  const d=evaluateDraft();API.preview=d;
  const r=d.records,groupSet=new Set(r.map(x=>x.program));
  const p=d.paymentSummary||[],metrics=d.metrics||[];
  const validFive=r.filter(x=>Array.isArray(x.fiveMinute?.values)&&x.fiveMinute.values.length===6
    &&x.fiveMinute.values.reduce((a,b)=>a+b,0)===x.first30).length;
  const original=result.snapshot.records.length;
  const warnings=result.warnings||[];
  box.innerHTML='<div class="excel-preview-overline">自动识别结果 · '+esc(UI('excelSyncMode')?.selectedOptions?.[0]?.textContent||'智能合并')+'</div>'+
   '<div class="excel-preview-grid"><div><span>本次文件场次</span><strong>'+original+'</strong></div><div><span>发布后场次</span><strong>'+r.length+'</strong></div><div><span>线路</span><strong>'+groupSet.size+'</strong></div><div><span>5分钟完整数据</span><strong>'+validFive+' / '+r.length+'</strong></div></div>'+
   '<div class="excel-preview-summary"><span>扫码累计 <b>'+fmtNumber(total(r,'scans'))+'</b> 人次</span><span>意向金 <b>'+fmtNumber(total(r,'orders'))+'</b> 单</span><span>全款实付 <b>'+(p.length?'¥'+fmtNumber(total(p,'amount')):'待补')+'</b></span></div>'+
   '<div class="excel-preview-programs">'+[...groupSet].map(x=>'<span>'+esc(x)+'</span>').join('')+'</div>'+
   (metrics.length?'<div class="excel-preview-metrics">识别到新增指标：'+metrics.map(m=>'<b>'+esc(m.label)+'</b>').join('、')+'</div>':'')+
   (warnings.length?'<details class="excel-preview-warnings"><summary>有 '+warnings.length+' 条数据提醒（点开核对）</summary>'+warnings.slice(0,15).map(x=>'<p>'+esc(x)+'</p>').join('')+'</details>':'')+
   '<p class="excel-preview-foot">仅向共享服务提交节目、场次、金额等经过字段白名单处理的汇总数据；原始文件和客户明细不会上传。发布后其他人自动看到同一版本。</p>';
  feedback(API.online?'解析完成。核对数字后即可发布到共享数据库。':'解析完成。本机预览可用；当前网络还未验证上传通道，请等共享接口恢复。',API.online?'success':'neutral');
  updatePublishButton();
}
async function handleExcelFile(event){
  const file=event.target?.files?.[0];if(!file)return;
  API.sourceFile=file;API.preview=null;API.parseResult=null;
  UI('excelSyncPreview').innerHTML='';
  feedback('正在读取 Excel 的工作表和公式汇总，请勿关闭上传窗口。');
  setRunning(true);
  try{
    if(!window.TVExcel?.parseFile)throw Error('Excel本地解析模块未加载');
    let result;
    try{result=await window.TVExcel.parseFile(file,SEED,window.XLSX)}
    catch(error){
      if(!/Excel解析组件未加载/.test(error.message))throw error;
      await loadSheetJS();
      result=await window.TVExcel.parseFile(file,SEED,window.XLSX);
    }
    API.parseResult=result;
    renderFilePreview();
  }catch(error){feedback('无法解析：'+error.message,'error');API.preview=null}
  finally{setRunning(false)}
}
async function publishExcel(){
  if(!API.online){feedback('当前网络无法连接全员共享接口。请先恢复网络连接；你仍可以使用「应用到本机预览」。','error');return}
  const data=evaluateDraft();if(!data){feedback('当前文件无法通过核验，请检查预览。','error');return}
  if(!confirm('确认把本次核验后的经营汇总发布给所有能够打开网页的同事？\n原始Excel不会上传，任何访客都可以发布下一个版本。'))return;
  setRunning(true);feedback('正在发布共享周报数据…');
  try{
    let body={baseVersion:API.currentVersion,snapshot:data};
    const current=API.snapshot;
    if(current && data.records.length < Math.ceil(current.records.length/2)){
      if(!confirm('新数据的场次数量少于现有版本的一半，确定要覆盖？'))return;
      body.confirmReplaceSmaller=true;
    }
    const result=await request('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    API.preview=null;API.parseResult=null;
    UI('excelSyncPreview').innerHTML='';
    const input=UI('excelFilePicker');if(input)input.value='';
    await refreshShared(true);
    feedback(result.unchanged?'与共享数据库中当前版本一致，无需重复发布。':'新数据已写入共享数据库。使用直连接口的同事可立即读取；本站国内外公开镜像会在后续自动发布后同步（可能延迟数分钟）。','success');
    setTimeout(()=>hideModal(),850);
  }catch(error){feedback('发布失败，旧数据仍保留：'+error.message,'error')}
  finally{setRunning(false)}
}
function programGroups(rows){
  const map=new Map();
  rows.forEach(r=>{
    let g=map.get(r.program);
    if(!g){g={name:r.program,n:0,live:0,replay:0,scans:0,orders:0,first30:0,after30:0};map.set(r.program,g)}
    g.n++;g[r.type==='首播'?'live':'replay']++;g.scans+=r.scans;g.orders+=r.orders;
    g.first30+=r.first30||0;g.after30+=r.after30||0;
  });return [...map.values()];
}
const scheduleView={category:'all',query:'',expanded:false,open:new Set()};
function refreshScheduleAdvice(){
  const box=document.querySelector('.schedule-list');
  if(!box)return;
  if(!window.UrbanRecommendation?.evaluate){
    box.innerHTML='<div class="table-empty">排播测算正在加载。未完成全款数据核验前不提供增加播次建议。</div>';
    return;
  }
  const analysis=window.UrbanRecommendation.evaluate(records,PAYMENT_ROUTES);
  const cards=analysis.items;
  if(!cards.length){
    box.innerHTML='<div class="table-empty">当前没有已核验的播出场次，不生成排播建议。</div>';
    return;
  }
  let controls=document.querySelector('.schedule-controls');
  if(!controls){
    controls=document.createElement('div');controls.className='schedule-controls';
    controls.innerHTML='<div class="schedule-filters" role="group" aria-label="排播建议分类"></div><label class="schedule-search">搜索线路<input type="search" placeholder="输入线路名称" aria-label="搜索排播线路"></label>';
    box.before(controls);
    controls.querySelector('input').addEventListener('input',e=>{scheduleView.query=e.target.value;scheduleView.expanded=false;scheduleView.draw()});
  }
  function draw(){
  const categories=[['all','全部'],['primary','优先续播'],['observe','控制与验证'],['pause','暂缓排播'],['review','待核验']];
  const filters=controls.querySelector('.schedule-filters');
  filters.innerHTML=categories.map(([key,label])=>'<button type="button" data-category="'+key+'" aria-pressed="'+(scheduleView.category===key)+'">'+label+' <span>'+cards.filter(g=>key==='all'||g.tier===key).length+'</span></button>').join('');
  filters.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{scheduleView.category=button.dataset.category;scheduleView.expanded=false;draw();controls.querySelector('[data-category="'+scheduleView.category+'"]').focus()}));
  const matches=cards.filter(g=>(scheduleView.category==='all'||g.tier===scheduleView.category)&&g.name.toLocaleLowerCase().includes(scheduleView.query.trim().toLocaleLowerCase()));
  const visible=scheduleView.expanded?matches:matches.slice(0,5);
  box.innerHTML=visible.map((g,i)=>{
    const paid=g.paid;
    const paidText=paid?'¥'+fmtNumber(paid.amount):'待核验';
    const orderText=paid?fmtNumber(paid.fullOrders)+'单':'—';
    const personsText=paid?fmtNumber(paid.fullPersons)+'人':'—';
    const paidPerPerson=paid&&g.paidPerPerson!==null?'¥'+fmtNumber(Math.round(g.paidPerPerson))+'/人':'—';
    const perShow=paid?'¥'+fmtNumber(Math.round(g.revenuePerBroadcast))+'/场':'—';
    const perScan=g.paidPerScan===null?'—':'¥'+Number(g.paidPerScan).toFixed(2)+'/人次';
    const action={primary:'优先安排1场验证性续播',observe:g.n<2?'补足样本后再决定排期':'低频验证，核对真实成交与退款',pause:g.status==='暂缓重播'?'先调整产品权益和转化链路':'核查成交与成本，改善前不追加',review:'补齐成交数据后再决定排播'}[g.tier];
    return '<details class="schedule-item schedule-'+g.tier+'" data-route="'+esc(g.name)+'"'+(scheduleView.open.has(g.name)?' open':'')+'><summary><span class="schedule-item-head">'+
      '<strong class="schedule-name">'+esc(g.name)+
      '</strong><span class="schedule-status">'+esc(g.status)+'</span></span>'+
      '<span class="schedule-compact-metrics"><span>累计实付 <b>'+esc(paidText)+'</b></span><span>播次均摊 <b>'+esc(perShow)+'</b></span></span>'+
      '<span class="schedule-action">'+esc(action)+'</span><span class="schedule-disclosure"><span class="when-closed">查看依据</span><span class="when-open">收起详情</span><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span></summary><div class="schedule-detail">'+
      '<div class="schedule-metrics">'+
      '<span>首播 <b>'+g.live+'</b> · 重播 <b>'+g.replay+'</b></span>'+
      '<span>场均扫码 <b>'+g.avgScans.toFixed(1)+' 人次</b></span>'+
      '<span>场均意向金 <b>'+g.avgOrders.toFixed(2)+' 单</b></span>'+
      '<span>累计全款实付 <b>'+esc(paidText)+'</b> · 全款 <b>'+esc(orderText)+'</b></span>'+
      '<span>全款付费人数 <b>'+esc(personsText)+'</b> · 人均实付 <b>'+esc(paidPerPerson)+'</b></span>'+
      '<span>按播次均摊实付 <b>'+esc(perShow)+'</b></span>'+
      '<span>按扫码规模折算实付 <b>'+esc(perScan)+'</b></span></div>'+
      '<p class="schedule-reason">'+esc(g.reason)+'</p>'+
      '<p class="schedule-next"><b>下一步：</b>'+esc(g.next)+'</p><details class="schedule-history"><summary>历次播出记录（'+g.n+'场）</summary><div class="schedule-times" data-program="'+esc(g.name)+'" aria-label="'+esc(g.name)+'历次播出时间"></div></details></div></details>';
  }).join('')||'<p class="table-empty" role="status">没有符合条件的线路，请切换分类或搜索名称。</p>';
  box.querySelectorAll('details[data-route]').forEach(detail=>detail.addEventListener('toggle',()=>{if(detail.open)scheduleView.open.add(detail.dataset.route);else scheduleView.open.delete(detail.dataset.route)}));
  let footer=document.querySelector('.schedule-pagination');
  if(!footer){footer=document.createElement('div');footer.className='schedule-pagination';box.after(footer)}
  footer.innerHTML='<span role="status">显示 '+visible.length+' / '+matches.length+' 条线路</span>'+(matches.length>5?'<button type="button">'+(scheduleView.expanded?'收起为5条':'查看全部 '+matches.length+' 条')+'</button>':'');
  footer.querySelector('button')?.addEventListener('click',()=>{scheduleView.expanded=!scheduleView.expanded;draw();footer.querySelector('button')?.focus()});
  if(typeof renderScheduleTimes==='function')renderScheduleTimes();
  }
  scheduleView.draw=draw;
  draw();
  const header=document.querySelector('.schedule-panel .section-sub');
  if(header)header.textContent='成交产出优先 · 已纳入全款实付、订单和播次均摊；扫码及意向仅作过程诊断';
  const asOf=document.querySelector('.schedule-asof');
  if(asOf)asOf.textContent='样本截至 '+(analysis.asOf?analysis.asOf.replace(/-/g,'.'):'待核验');
  const footnote=document.querySelector('.schedule-footnote');
  if(footnote)footnote.textContent=
    '统计口径：'+analysis.definition+
    ' 时间口径：各场时间为扫码区间起点，未核实正式开播时刻。缺少退款、节目成本和毛利，不得将收入排序等同于净利润。排播建议基于全部已发布场次与线路累计全款结果自动重算，不随上方日期筛选变化。';
  // Re-created schedule cards must reattach their real historical dates and scanning start times.
  if(typeof renderScheduleTimes==='function')renderScheduleTimes();
}
function refreshNewMetrics(metrics){
  let box=UI('sharedNewMetrics');
  if(!box)return;
  if(!Array.isArray(metrics)||!metrics.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  box.innerHTML='<div class="shared-metrics-heading"><h3>Excel 新增经营指标</h3><span>自动识别 · '+metrics.length+' 类指标</span></div>'+
    '<div class="shared-metrics-grid">'+metrics.map(m=>{
      const entries=Object.entries(m.valuesByProgram||{});
      return '<article class="shared-metric-card"><div class="shared-metric-name">'+esc(m.label)+
        ' <small>'+esc(m.unit)+'</small></div>'+entries.map(([name,value])=>
          '<div class="shared-metric-row"><span>'+esc(name)+'</span><b>'+fmtNumber(value)+' '+esc(m.unit)+'</b></div>').join('')+
        '<p>'+esc(m.note||m.source||'来自新版Excel')+'</p></article>';
    }).join('')+'</div>';
}
function applySnapshot(snapshot,version,updatedAt,options={}){
  if(!snapshot?.records?.length)return;
  records=snapshot.records;
  PAYMENT_ROUTES=Array.isArray(snapshot.paymentSummary)?snapshot.paymentSummary:[];
  issues=[];
  if(options.clearLegacyCache!==false){try{localStorage.removeItem(storageKey)}catch{}}
  const datesSorted=dates(records);
  if(preset==='all'){start=datesSorted[0];end=datesSorted[datesSorted.length-1]}
  else if(preset==='custom'&&start>end){start=datesSorted[0];end=datesSorted[datesSorted.length-1]}
  // Shared data supersedes cached local CSV. The original embedded sample remains as offline fallback.
  refreshScheduleAdvice();
  window.UrbanLines?.setFollowUp(snapshot.followUpSummary||null);
  render();
  refreshNewMetrics(snapshot.metrics||[]);
  text('sharedCurrentAt','共享版本 '+String(version||'').slice(0,19).replace('T',' ')+' · 数据截至 '+datesSorted[datesSorted.length-1]);
  text('sharedDataFooter','云端更新时间 '+(updatedAt?updatedAt.replace('T',' ').slice(0,19):'未记录')+'（UTC）');
  const title=UI('qualityIntroText');
  if(title)title.textContent='已发布数据通过格式与数值校验。如有业务定义差异，请回查原Excel和本页核验项。';
}
function previewExcelLocally(){
  const draft=evaluateDraft();
  if(!draft){feedback('请先选择并核验Excel文件','error');return}
  API.localPreview=true;
  applySnapshot(draft,'本机预览','',{clearLegacyCache:false});
  safeStatus('当前仅本机预览 · 尚未全员共享','preview');
  text('sharedCurrentAt','刚才上传的数据只在本设备预览；刷新网页会恢复共享版或历史内置版');
  text('sharedDataFooter','本机临时预览，未同步到其他同事');
  feedback('本机预览已应用，尚未同步其他人。云端接通后请使用「确认发布 · 全员同步」。','success');
  const reset=UI('excelLocalReset');if(reset)reset.hidden=false;
  hideModal();
  if(typeof navigate==='function')navigate('overview');
}
async function exitExcelLocalPreview(){
  API.localPreview=false;
  const reset=UI('excelLocalReset');if(reset)reset.hidden=true;
  if(API.enabled && API.snapshot){
    applySnapshot(API.snapshot,API.currentVersion,API.updatedAt);
    safeStatus('共享数据已连接 · 自动同步中','connected');
  }else{
    records=[...SEED.records];PAYMENT_ROUTES=SEED.paymentSummary;issues=[...SEED.quality];
    if(preset==='all'){start=SEED.sourceRange[0];end=SEED.sourceLastRecorded}
    render();
    refreshNewMetrics([]);
    safeStatus(API.enabled?'共享服务已连接 · 尚无公开版本':'待连接免费共享服务','pending');
    text('sharedCurrentAt','当前显示原始历史数据，无本机临时修改');
  }
  feedback('已结束本机临时预览','neutral');
}

/* Same-origin fallback: every viewer can read the identical published JSON without
   contacting workers.dev. The scheduled mirror job validates/de-identifies it first.
   This route is READ ONLY; it never pretends to make browser uploads writable. */
async function refreshPublishedMirror(force=false){
  let result;
  try{
    const path=API.mirrorPath||'data/current.json';
    const c=new AbortController();
    const timer=setTimeout(()=>c.abort(),8000);
    try{
      const response=await fetch(path+'?nocache='+Date.now(),{cache:'no-store',signal:c.signal});
      if(!response.ok)throw Error('本站尚未发布数据镜像');
      result=await response.json();
    }finally{clearTimeout(timer)}
    if(!result?.ok||!result.version||!Array.isArray(result.snapshot?.records)||!result.snapshot.records.length){
      throw Error('共享数据镜像内容不完整');
    }
    if(result.snapshot.totals?.sessions!==result.snapshot.records.length){
      throw Error('共享数据镜像场次数不符');
    }
    API.mirrorLoaded=true;
    API.mirrorVersion=result.version;
    API.mirrorTime=result.mirroredAt||'';
    // Live writable API always wins while online, even after a restore to an older version.
    if(API.online||API.localPreview)return;
    const cachedTime=Date.parse(API.updatedAt||'')||0;
    const mirrorTime=Date.parse(result.updatedAt||'')||0;
    if(API.sourceKind==='cache'&&API.currentVersion!==result.version&&cachedTime>mirrorTime)return;
    if(force||API.currentVersion!==result.version||!API.snapshot){
      applySnapshot(result.snapshot,result.version,result.updatedAt||'');
      API.snapshot=result.snapshot;
      API.currentVersion=result.version;
      API.updatedAt=result.updatedAt||'';
      API.sourceKind='mirror';
      try{localStorage.setItem(CLOUD_CACHE_KEY,JSON.stringify({
        version:result.version,updatedAt:result.updatedAt,snapshot:result.snapshot
      }))}catch(e){}
    }
    safeStatus('共享数据已发布 · 国内外可读取','connected');
    text('sharedCurrentAt','本站公开版本 · 截至 '+(result.updatedAt||'').replace('T',' ').slice(0,16)+
      ' UTC · 正在尝试连接上传通道');
  }catch(e){
    if(!API.snapshot&&!API.localPreview){
      text('sharedCurrentAt','本站数据镜像暂无更新；当前显示内置历史场次。');
    }
  }
}

async function refreshShared(force=false){
  if(!API.enabled||API.polling)return;
  API.polling=true;
  try{
    const result=await request('/api/current');
    API.online=true;
    API.sourceKind='cloud';
    if(result.version&&result.snapshot){
      if(force||result.version!==API.currentVersion){
        API.localPreview=false;
        const reset=UI('excelLocalReset');if(reset)reset.hidden=true;
        applySnapshot(result.snapshot,result.version,result.updatedAt);
        API.snapshot=result.snapshot;
        API.currentVersion=result.version;
        API.updatedAt=result.updatedAt||'';
        try{localStorage.setItem(CLOUD_CACHE_KEY,JSON.stringify({version:result.version,updatedAt:result.updatedAt,snapshot:result.snapshot}))}catch(e){}
      }
      if(!API.localPreview){safeStatus('共享数据已连接 · 自动同步中','connected');
      text('sharedCurrentAt','最新共享版本 · '+(result.updatedAt||'').replace('T',' ').slice(0,16)+' UTC');}
    }else{
      if(!API.localPreview)safeStatus('共享服务已连接 · 尚未发布新版','connected');
      text('sharedCurrentAt','尚无已发布共享数据，可上传首份Excel');
    }
  }catch(error){
    API.online=false;
    if(!API.localPreview){
      if(API.mirrorLoaded||API.snapshot){
        safeStatus('公开数据正常 · 上传通道不可达','pending');
        text('sharedCurrentAt','正在显示已发布的共享数据。国内外查看不必连接 Cloudflare；当前网络无法上传 Excel。'+
          (API.mirrorTime?' 公开副本同步于 '+API.mirrorTime.replace('T',' ').slice(0,16)+' UTC。':''));
      }else{
        safeStatus('尚未获取共享数据 · 显示内置历史记录','error');
        text('sharedCurrentAt','当前网络无法连接上传接口，也未获得本站公开数据副本。');
      }
    }
  }finally{API.polling=false;updatePublishButton()}
}
async function showHistory(){
  const box=UI('excelHistory');if(!box)return;
  box.hidden=false;box.textContent='正在读取最近30个共享版本…';
  if(!API.enabled){box.textContent='尚未连接共享服务';return}
  try{
    const data=await request('/api/versions');
    const entries=data.versions||[];
    box.innerHTML=entries.length?entries.map(v=>'<div class="excel-history-row"><div><strong>'+esc(v.file_name||'Excel经营周报')+
      '</strong><small>'+esc((v.created_at||'').replace('T',' ').slice(0,19))+
      ' UTC · '+Number(v.session_count||0)+' 场</small></div>'+
      '<button class="outline-btn" type="button" data-revert="'+esc(v.version)+'" '+(v.version===data.currentVersion?'disabled':'')+'>'
      +(v.version===data.currentVersion?'当前版本':'恢复此版')+'</button></div>').join(''):'还没有历史版本';
    for(const b of box.querySelectorAll('button[data-revert]')){
      b.addEventListener('click',()=>restoreVersion(b.dataset.revert));
    }
  }catch(error){box.textContent='历史版本读取失败：'+error.message}
}
async function restoreVersion(version){
  if(!API.enabled||!version)return;
  if(!confirm('确认将全员看到的数据恢复至这个历史版本？\n这会影响所有访问者。'))return;
  try{
    await request('/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({version,baseVersion:API.currentVersion})});
    await refreshShared(true);await showHistory();
    feedback('全员已切回指定历史版本','success');
  }catch(e){feedback('恢复失败：'+e.message,'error')}
}
async function initialize(){
  try{refreshScheduleAdvice()}catch(error){console.warn('排播建议核验尚未完成',error)}
  try{
    const res=await fetch('sync-config.json?_=20261020-dual',{cache:'no-store'});
    const conf=res.ok?await res.json():{};
    API.base=cleanBase(conf.apiBase);
    API.mirrorPath=typeof conf.mirrorPath==='string'&&/^data\/[\w.-]+\.json$/.test(conf.mirrorPath)?conf.mirrorPath:'data/current.json';
    API.gateways=Array.isArray(conf.apiFallbacks)?conf.apiFallbacks.map(cleanBase).filter(Boolean):[];
    API.activeBase='';
    API.enabled=!!(API.base||API.gateways.length);
    try{
      const cached=JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY)||'null');
      if(cached?.snapshot?.records?.length&&cached.version&&!API.localPreview){
        applySnapshot(cached.snapshot,cached.version,cached.updatedAt||'',{clearLegacyCache:false});
        API.snapshot=cached.snapshot;API.currentVersion=cached.version;API.updatedAt=cached.updatedAt||'';
        API.sourceKind='cache';
      }
    }catch(e){}
    // A same-origin public JSON is tried FIRST to serve mainland and global readers.
    await refreshPublishedMirror(true);
    if(API.enabled){
      await refreshShared(true);
    }else{
      safeStatus(API.mirrorLoaded?'公开数据可读 · 上传服务待连接':'当前显示内置历史记录',API.mirrorLoaded?'connected':'pending');
    }
    const interval=Math.max(30000,Number(conf.pollSeconds||45)*1000);
    setInterval(()=>{
      if(!document.hidden){
        refreshPublishedMirror();
        if(API.enabled)refreshShared();
      }
    },interval);
    document.addEventListener('visibilitychange',()=>{
      if(!document.hidden){refreshPublishedMirror();if(API.enabled)refreshShared()}
    });
    window.addEventListener('focus',()=>{
      refreshPublishedMirror();if(API.enabled)refreshShared();
    });
  }catch(error){
    safeStatus(API.snapshot?'已显示最后成功同步数据':'共享数据暂未更新','pending');
    text('sharedCurrentAt','目前仍可查看上次数据；上传连接正在恢复。');
  }
  updatePublishButton();
}
window.openExcelUploader=openExcelUploader;
window.closeExcelUploader=hideModal;
window.handleExcelFile=handleExcelFile;
window.recomputeExcelPreview=renderFilePreview;
window.publishExcel=publishExcel;
window.previewExcelLocally=previewExcelLocally;
window.exitExcelLocalPreview=exitExcelLocalPreview;
window.showExcelHistory=showHistory;
window.UrbanSync={api:API,initialize,refreshShared,refreshPublishedMirror,applySnapshot,mergeSnapshots,handleExcelFile};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
else initialize();
})();


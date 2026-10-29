// Urban Channel V2 public shared-data API (Cloudflare Workers + D1).
// Browser reads the Excel locally; only a strict, de-identified snapshot crosses the network.
// No authentication by product choice: anyone, including direct API clients, may publish or restore.
const SITE_ORIGIN = 'https://jasonz0829vip.github.io';
const MAX_BODY = 750000;
const MAX_RECORDS = 3000;
let initialized = false;
const iso = () => new Date().toISOString();
const int = (x, max = 100000000) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const money = x => typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000000000&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(String(x));
const moneySum = a => {const cents=a.reduce((n,v)=>n+Math.round(v*100),0);if(cents>100000000000)invalid('累计金额超出上限');return cents/100};
const arrSum = a => a.reduce((v,n)=>v+n,0);
function invalid(message, status=422){const e=new Error(message);e.status=status;throw e}
function cleanText(s,max=100){return String(s == null?'':s).trim().slice(0,max)}
function validateDate(s){
  if(typeof s!=='string'||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(s))return false;
  const d=new Date(s+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
function redactSource(source){
  if(!source || typeof source!=='object')return '原始表格';
  return {
    sheet:cleanText(source.sheet,70),
    valueCells:cleanText(source.valueCells,40),
    timeCells:cleanText(source.timeCells,40),
    totalCell:cleanText(source.totalCell,30),
    definition:'原始Excel对应时段新增扫码数'
  };
}
export function validateSnapshot(payload){
  if(!payload || typeof payload!=='object'||Array.isArray(payload))invalid('缺少规范化经营数据');
  if(!Array.isArray(payload.records)||payload.records.length===0||payload.records.length>MAX_RECORDS)invalid('播出场次为空或超过上限');
  const seen=new Set(),records=[];
  for(const input of payload.records){
    if(!input||typeof input!=='object')invalid('出现无效场次');
    const date=cleanText(input.date,12), program=cleanText(input.program,75), type=cleanText(input.type,6);
    if(!validateDate(date)||!program||!['首播','重播'].includes(type))invalid('节目、日期或首播重播类型错误');
    if(/[<>]/.test(program)||/[0-9]{11}/.test(program))invalid('节目名称中存在异常内容');
    const startTime=cleanText(input.startTime,6);
    if(startTime&&!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(startTime))invalid('开播记录时间格式不正确');
    if(!int(input.scans,10000000)||!int(input.orders,1000000))invalid('扫码或意向金订单数量无效');
    const first30=input.first30==null?null:input.first30,after30=input.after30==null?null:input.after30;
    if(first30!==null&&!int(first30,10000000))invalid('30分钟内扫码值无效');
    if(after30!==null&&!int(after30,10000000))invalid('后续跟踪扫码值无效');
    if(first30!==null&&after30!==null&&first30+after30!==input.scans)invalid('30分钟内扫码与后续跟踪之和不等于本场扫码');
    const key=[date,program,type,startTime].join('|');
    if(seen.has(key))invalid('场次重复：'+date+' '+program+' '+type);
    seen.add(key);
    let fiveMinute=null;
    if(input.fiveMinute != null){
      const f=input.fiveMinute,values=f.values;
      if(f.mode!=='increment'||!Array.isArray(values)||values.length!==6||values.some(v=>!int(v,10000000)))invalid('5分钟数据必须是六段独立非负整数增量');
      if(first30===null||arrSum(values)!==first30)invalid('5分钟六段之和与节目30分钟扫码不符');
      fiveMinute={mode:'increment',values:values.slice(),source:redactSource(f.source)};
    }
    const phone=input.phone==null?null:input.phone,group=input.group==null?null:input.group;
    if(phone!==null&&!int(phone,10000000)||group!==null&&!int(group,10000000))invalid('客户统计人数不是有效非负整数');
    records.push({date,program,type,startTime,scans:input.scans,orders:input.orders,first30,after30,phone,group,fiveMinute});
  }
  records.sort((a,b)=>a.date.localeCompare(b.date)||a.program.localeCompare(b.program,'zh-CN')||a.type.localeCompare(b.type,'zh-CN'));
  const nameSet=new Set(records.map(x=>x.program));
  const paymentSummary=[];
  if(payload.paymentSummary!=null && !Array.isArray(payload.paymentSummary))invalid('线路全款汇总格式错误');
  const paymentSet=new Set();
  for(const p of (payload.paymentSummary||[])){
    const program=cleanText(p.program,75);
    if(!nameSet.has(program)||paymentSet.has(program))invalid('全款汇总线路不匹配或重复：'+program);
    paymentSet.add(program);
    for(const field of ['amount','fullOrders','fullPersons']){
      if(!(field==='amount'?money(p[field]):int(p[field],1000000000)))invalid('全款金额、订单或人数不是有效数字：'+program);
    }
    paymentSummary.push({program,amount:p.amount,fullOrders:p.fullOrders,fullPersons:p.fullPersons,source:cleanText(p.source,130)});
  }
  const metrics=[];
  if(payload.metrics!=null&&!Array.isArray(payload.metrics))invalid('新增经营指标格式错误');
  const metricKeys=new Set();
  for(const m of (payload.metrics||[])){
    const key=cleanText(m.key,50),label=cleanText(m.label,45),unit=cleanText(m.unit,12);
    if(!/^[a-z][a-z0-9_]{1,45}$/.test(key)||!label||/手机号|身份证|姓名|微信号|证件|地址|客户列表/.test(label)||metricKeys.has(key))invalid('新指标不安全或重复');
    if(metrics.length>=20)invalid('新指标数量超出上限');
    metricKeys.add(key);
    const valuesByProgram={};
    if(!m.valuesByProgram||typeof m.valuesByProgram!=='object'||Array.isArray(m.valuesByProgram))invalid('新指标线路明细不正确');
    for(const [name,value] of Object.entries(m.valuesByProgram)){
      if(!nameSet.has(name)||typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000000000)invalid('新指标数值或线路无效：'+label);
      valuesByProgram[name]=Math.round(value*100)/100;
    }
    metrics.push({key,label,unit,valuesByProgram,source:cleanText(m.source,140),note:cleanText(m.note,180)});
  }
  // Optional aggregate-only extension. Existing JSON version storage needs no migration.
  let followUpSummary;
  if(payload.followUpSummary!=null){
    const data=payload.followUpSummary;
    if(data.schemaVersion!==1||!Array.isArray(data.rows)||data.rows.length>200)invalid('跟进汇总格式错误');
    const rows=[],anchors=new Set();
    for(const input of data.rows){
      const sourceProduct=cleanText(input.sourceProduct,120),sourceRow=input.sourceRow;
      if(!sourceProduct||/[<>]|[0-9]{11}/.test(sourceProduct)||!int(sourceRow,10000)||sourceRow===0||anchors.has(sourceProduct+'|'+sourceRow))invalid('跟进产品或批次标识无效');
      anchors.add(sourceProduct+'|'+sourceRow);
      const row={sourceProduct,sourceRow};
      for(const key of ['scanCount','paidByOrder','followingUp','notInterested','unclassifiedRemainder','paidAmount','otherConsumptionAmount']){
        const value=input[key];
        if(value!==null&&!(['paidAmount','otherConsumptionAmount'].includes(key)?money(value):int(value,1000000000)))invalid('跟进数值缺失或无效：'+key);
        row[key]=value;
      }
      const states=['paidByOrder','followingUp','notInterested','unclassifiedRemainder'];
      if(states.every(k=>row[k]!==null)&&row.scanCount!==null&&states.reduce((n,k)=>n+row[k],0)!==row.scanCount)invalid('跟进四类合计与扫码小计不一致');
      rows.push(row);
    }
    for(const key of ['paidAmount','otherConsumptionAmount'])moneySum(rows.map(r=>r[key]??0));
    followUpSummary={schemaVersion:1,rows};
  }
  const source={name:cleanText(payload.source?.name,100),hash:cleanText(payload.source?.hash,100),sheets:Math.min(100,Math.max(0,Number(payload.source?.sheets)||0)),notes:cleanText(payload.source?.notes,280)};
  // Future snapshots may add new programs or metrics but never client PII, formulas or raw cells.
  return {schemaVersion:2,source,records,paymentSummary,metrics,...(followUpSummary?{followUpSummary}:{}),sourceLastRecorded:records[records.length-1].date,
    totals:{sessions:records.length,programs:nameSet.size,scans:arrSum(records.map(r=>r.scans)),orders:arrSum(records.map(r=>r.orders)),
    amount:moneySum(paymentSummary.map(p=>p.amount))}};
}
async function ensureDb(env){
  if(initialized)return;
  if(!env.DB)invalid('D1数据库尚未绑定',503);
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tv_versions (version TEXT PRIMARY KEY, created_at TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT NOT NULL, session_count INTEGER NOT NULL, snapshot TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tv_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  ]);
  initialized=true;
}
function cors(request){
  const origin=request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin':origin===SITE_ORIGIN?SITE_ORIGIN: SITE_ORIGIN,
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,If-None-Match',
    'Access-Control-Max-Age':'600',
    'Vary':'Origin',
    'Cache-Control':'no-store, max-age=0',
    'X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
  };
}
function json(request,data,status=200,extra={}){
  return new Response(JSON.stringify(data),{status,headers:{...cors(request),'Content-Type':'application/json; charset=utf-8',...extra}});
}
async function readBody(request){
  const length=Number(request.headers.get('Content-Length')||0);
  if(length>MAX_BODY)invalid('上传后的脱敏数据超过大小限制',413);
  const reader=request.body?.getReader();
  if(!reader)invalid('请求内容为空',400);
  let text='',size=0;const decoder=new TextDecoder();
  while(true){
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.length;
    if(size>MAX_BODY){reader.cancel().catch(()=>{});invalid('上传后的数据超过750KB',413)}
    text+=decoder.decode(value,{stream:true});
  }
  text+=decoder.decode();
  try{return JSON.parse(text)}catch(e){invalid('上传数据不是合法JSON',400)}
}
async function getCurrentRow(db){
  return await db.prepare("SELECT value FROM tv_state WHERE key='current'").first();
}
async function currentVersion(db){const row=await getCurrentRow(db);return row?.value||null}
async function getSnapshot(db,version){
  if(!version)return null;
  return await db.prepare('SELECT version, created_at, file_name, file_hash, session_count, snapshot FROM tv_versions WHERE version=?').bind(version).first();
}
const shortFile=x=>cleanText(x,100).replace(/[\\\/<>"]/g,'_');
async function publish(request,env){
  const body=await readBody(request),snapshot=validateSnapshot(body.snapshot);
  const baseVersion=body.baseVersion==null?null:cleanText(body.baseVersion,90);
  const prev=await currentVersion(env.DB);
  if(prev!==baseVersion)return json(request,{ok:false,error:'另一位同事已经更新了数据，请重新加载最新版本再上传',currentVersion:prev},409);
  const previous=await getSnapshot(env.DB,prev);
  if(previous && snapshot.source.hash && previous.file_hash===snapshot.source.hash && previous.snapshot===JSON.stringify(snapshot))return json(request,{ok:true,unchanged:true,version:prev,message:'经营数据已是当前版本'});
  if(previous && snapshot.records.length < Math.ceil(previous.session_count/2) && body.confirmReplaceSmaller!==true)
    return json(request,{ok:false,error:'新Excel场次不足当前版本的一半，防止误上传覆盖，请在页面明确确认后再发布'},422);
  const version=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8),createdAt=iso();
  const insert=env.DB.prepare('INSERT INTO tv_versions (version, created_at, file_name, file_hash, session_count, snapshot) VALUES (?, ?, ?, ?, ?, ?)').bind(
    version,createdAt,shortFile(snapshot.source.name),snapshot.source.hash,snapshot.records.length,JSON.stringify(snapshot));
  const state=env.DB.prepare("INSERT INTO tv_state (key,value) VALUES ('current',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE tv_state.value=?")
    .bind(version,prev===null?'':prev);
  // Null initial state takes the INSERT route; D1 batches are atomic.
  const result=await env.DB.batch([insert,state]);
  if(result[1]?.meta?.changes===0){await env.DB.prepare('DELETE FROM tv_versions WHERE version=?').bind(version).run();return json(request,{ok:false,error:'数据版本已变化，请重新读取后发布'},409)}
  return json(request,{ok:true,version,updatedAt:createdAt,totals:snapshot.totals});
}
async function restore(request,env){
  const body=await readBody(request),version=cleanText(body.version,90);
  if(!/^[0-9T-Z-]{20,45}-[a-f0-9]{8}$/.test(version))invalid('恢复版本号不正确');
  const item=await getSnapshot(env.DB,version);
  if(!item)invalid('没有找到指定历史版本',404);
  const prev=await currentVersion(env.DB),base=body.baseVersion??null;
  if(prev!==base)return json(request,{ok:false,error:'有人更新了数据，请刷新后重试',currentVersion:prev},409);
  const change=await env.DB.prepare("INSERT INTO tv_state (key,value) VALUES ('current',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE tv_state.value=?").bind(version,prev??'').run();
  if(change.meta?.changes===0)return json(request,{ok:false,error:'其他人刚刚发布了新版本，请重新刷新后操作'},409);
  return json(request,{ok:true,version,updatedAt:item.created_at,restored:true});
}
export default {
 async fetch(request,env){
  try{
    const u=new URL(request.url),method=request.method;
    if(method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
    if(method==='GET'&&u.pathname==='/')return json(request,{ok:true,service:'都市频道共享周报',version:'2.1.1',capabilities:['followup-summary-v1','money-cents-v1'],hasDatabase:!!env.DB});
    if(!['/api/current','/api/versions','/api/publish','/api/restore'].includes(u.pathname))return json(request,{ok:false,error:'不存在该接口'},404);
    await ensureDb(env);
    if(method==='GET'&&u.pathname==='/api/current'){
      const version=await currentVersion(env.DB);
      if(!version)return json(request,{ok:true,version:null,snapshot:null});
      const row=await getSnapshot(env.DB,version);
      if(!row)return json(request,{ok:false,error:'找不到当前数据版本'},503);
      return json(request,{ok:true,version:row.version,updatedAt:row.created_at,snapshot:JSON.parse(row.snapshot)});
    }
    if(method==='GET'&&u.pathname==='/api/versions'){
      const rows=await env.DB.prepare('SELECT version, created_at, file_name, file_hash, session_count FROM tv_versions ORDER BY created_at DESC LIMIT 30').all();
      const current=await currentVersion(env.DB);
      return json(request,{ok:true,currentVersion:current,versions:rows.results||[]});
    }
    if(method==='POST'&&u.pathname==='/api/publish')return await publish(request,env);
    if(method==='POST'&&u.pathname==='/api/restore')return await restore(request,env);
    return json(request,{ok:false,error:'不支持的请求方法'},405);
  }catch(error){
    const status=error?.status||500;
    return json(request,{ok:false,error:status>=500?'共享服务暂时不可用，请稍后再试':String(error.message||'数据无法处理')},status);
  }
 }
};

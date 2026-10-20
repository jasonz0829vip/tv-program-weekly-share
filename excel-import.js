/* SheetJS-powered .xls / .xlsx ingestion. No raw workbook or customer contacts leave this browser. */
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.TVExcel=api;
})(typeof window!=='undefined'?window:null,function(){
'use strict';
const KNOWN_SHA='ad34b8fa4352557e793d64bdc524679476cd99d58fc0fdc3de8093c3508f51b3';
const MONEY_FIELDS=[
  {key:'average_price_per_person',label:'人均客单价',unit:'元/人',re:/人均客单价|人均实付|人均消费|客单价/},
  {key:'refund_amount',label:'退款金额',unit:'元',re:/退款金额|退款合计|退款总额/},
  {key:'net_revenue',label:'净实收金额',unit:'元',re:/净营收|净实收|扣退款后实收/},
  {key:'profit_amount',label:'毛利金额',unit:'元',re:/毛利金额|毛利润/},
  {key:'gross_margin',label:'毛利率',unit:'%',re:/毛利率/}
];
const excludedNames=/客户|咨询|电话号码|订单明细|备注|逐字稿|汇报文案|解释|数据说明|模板|词条|合计表|说明|回访/;
const totalSheetPattern=/汇总|统计|结算|财务|总表|全款/;
const isInteger=x=>Number.isSafeInteger(x)&&x>=0;
const canonical=name=>{
  let n=String(name||'').replace(/\s+/g,'').replace(/[-·_（）()]/g,'');
  if(/新马|新加坡.*马来西亚|马来西亚.*新加坡/.test(n))return '新加坡·马来西亚';
  if(/越南/.test(n))return '越南全景';
  if(/泰宁|福建/.test(n))return '福建泰宁';
  if(/肇庆|清远/.test(n))return '清远肇庆';
  if(/拈花湾/.test(n))return '拈花湾';
  return String(name||'').trim().slice(0,65);
};
function safeNumber(v){
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(v==null||v==='')return null;
  const x=String(v).trim().replace(/[,\s，￥¥]/g,'').replace(/(元|人次|人|单)$/g,'');
  return /^-?[0-9]+(?:\.[0-9]+)?$/.test(x)?Number(x):null;
}
function str(v){return v==null?'':String(v).trim()}
function get(row,col){return Array.isArray(row)?row[col]:null}
function coord(col,row){
  let v=col+1,letters='';
  while(v){v--;letters=String.fromCharCode(65+v%26)+letters;v=Math.floor(v/26)}
  return letters+row;
}
function dateLabel(text,assumedYear=2026){
  const s=str(text).replace(/[ \u3000]/g,'');
  let m=s.match(/(20[0-9]{2})[年\/.\-](1[0-2]|0?[1-9])[月\/.\-](3[01]|[12][0-9]|0?[1-9])(?=[^0-9]|$)/);
  let year,month,day;
  if(m){year=+m[1];month=+m[2];day=+m[3]}
  else{
    m=s.match(/(?:^|[^0-9])(1[0-2]|0?[1-9])[月\/.\-](3[01]|[12][0-9]|0?[1-9])(?=日|号|[^0-9]|$)/);
    if(!m)return null;
    year=assumedYear;month=+m[1];day=+m[2];
  }
  const value=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  const d=new Date(value+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value?value:null;
}
function labelType(s){return /首播/.test(s)?'首播':/重播|复播/.test(s)?'重播':null}
function timeRange(text){
  const raw=str(text).replace(/[～〜－—–至]/g,'-');
  const m=raw.match(/(?:^|[^0-9])([01]?[0-9]|2[0-3]):([0-5][0-9])\s*-\s*([01]?[0-9]|2[0-3]):([0-5][0-9])/);
  if(!m)return null;
  const from=(+m[1])*60+(+m[2]),to=(+m[3])*60+(+m[4]);
  const length=(to-from+1440)%1440;
  if(length!==5)return null;
  return {from,to,startTime:String(+m[1]).padStart(2,'0')+':'+m[2],label:m[1]+':'+m[2]+'-'+m[3]+':'+m[4]};
}
function findAnchorRows(rows){
  const candidates=[];
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    if(!row||!timeRange(get(row,1)))continue;
    if(i>0&&timeRange(get(rows[i-1],1)))continue;
    candidates.push(i);
  }
  return candidates;
}
function findDateNear(rows,at,year){
  for(let i=at;i>=Math.max(0,at-3);i--){
    const row=rows[i],label=[get(row,0),get(row,1),get(row,3)].map(str).join(' ');
    const date=dateLabel(label,year);
    if(date)return date;
  }
  return null;
}
function findTypeNear(rows,at){
  for(let i=at;i>=Math.max(0,at-3);i--){
    const type=labelType([get(rows[i],0),get(rows[i],1)].map(str).join(' '));
    if(type)return type;
  }
  return null;
}
function sessionEntries(sheetName,rows,context){
  const anchors=findAnchorRows(rows),out=[];
  for(let ix=0;ix<anchors.length;ix++){
    const start=anchors[ix],end=ix+1<anchors.length?anchors[ix+1]:rows.length;
    const series=[];
    for(let i=start;i<end;i++){
      const tr=timeRange(get(rows[i],1));
      if(tr)series.push({index:i,time:tr,value:safeNumber(get(rows[i],2))});
    }
    if(series.length<6)continue;
    const program=canonical(sheetName);
    const date=findDateNear(rows,start,context.year);
    const type=findTypeNear(rows,start);
    if(!date||!type){
      context.blocking.push(sheetName+'!'+coord(0,start+1)+' 无法可靠识别播出日期或首播/重播');
      continue;
    }
    const six=series.slice(0,6),startMinute=six[0].time.from;
    const contiguous=six.every((s,j)=>((s.time.from-startMinute+1440)%1440)===j*5);
    if(!contiguous)context.blocking.push(program+' '+date+' 前30分钟扫码时段不连续');
    const values=six.map(s=>s.value);
    const hasSegments=contiguous&&values.every(isInteger);
    const first30=hasSegments?values.reduce((a,b)=>a+b,0):null;
    const later=series.slice(6);
    const validLater=later.every(x=>isInteger(x.value));
    const after30=validLater?later.reduce((a,b)=>a+b.value,0):null;
    const control=safeNumber(get(rows[start],3));
    let totalCell=null,totalIndex=-1,hasTotal=false;
    // The first non-time row after a contiguous set usually carries the C-column total.
    let lastTime=series[series.length-1].index;
    for(let i=lastTime+1;i<Math.min(end,lastTime+5);i++){
      if(timeRange(get(rows[i],1)))continue;
      const v=safeNumber(get(rows[i],2));
      if(v!==null&&isInteger(v)){totalCell=v;totalIndex=i;hasTotal=true;break}
    }
    let scans=(first30!==null&&after30!==null)?first30+after30:null;
    if(scans===null && hasTotal)scans=totalCell;
    if(scans===null && isInteger(control))scans=control;
    if(scans===null){
      context.blocking.push(program+' '+date+' 无法确定本场扫码合计');continue;
    }
    if(hasTotal&&scans!==totalCell)context.blocking.push(program+' '+date+' 扫码分段之和 '+scans+' 与合计 '+totalCell+' 不一致');
    if(control!==null&&isInteger(control)&&control!==first30&&control!==scans)
      context.warnings.push(program+' '+date+' D列合计 '+control+' 覆盖范围与30分钟分段不同，已独立核对');
    if(!hasSegments)context.warnings.push(program+' '+date+' 六段5分钟数据有缺失，保留场次但不画分时曲线');
    const candidates=[];
    for(let i=start;i<end;i++){
      const v=safeNumber(get(rows[i],4));
      if(v!==null&&isInteger(v)&&v<10000)candidates.push({row:i,value:v});
    }
    let orders=0;
    if(candidates.length){
      const match=candidates.find(x=>x.row===totalIndex)||candidates[candidates.length-1];
      orders=match.value;
    }else{
      context.blocking.push(program+' '+date+' 意向金订单缺少有效原始数值，不能将缺失当成0');
    }
    if(context.seen.has(date+'|'+program+'|'+type+'|'+six[0].time.startTime)){
      context.blocking.push(program+' '+date+' 重复场次');continue;
    }
    context.seen.add(date+'|'+program+'|'+type+'|'+six[0].time.startTime);
    out.push({
      date,program,type,startTime:six[0].time.startTime,scans,orders,
      first30,after30,phone:null,group:null,
      fiveMinute:hasSegments&&first30!==null&&after30!==null&&scans===first30+after30?
        {mode:'increment',values,source:{sheet:sheetName,valueCells:'C'+(start+1)+':C'+(start+6),
          timeCells:'B'+(start+1)+':B'+(start+6),totalCell:hasTotal?'C'+(totalIndex+1):'',
          definition:'C列每5分钟新增扫码人数，D列可能是30分钟或更长区间的合计'}}:null
    });
  }
  return out;
}
function sniffProgram(text,names){
  const t=str(text).replace(/\s+/g,'');
  for(const name of names)if(t.includes(name)||t.includes(name.replace('新加坡·马来西亚','新马')))return name;
  if(/新马|马来西亚|新加坡/.test(t)&&names.includes('新加坡·马来西亚'))return '新加坡·马来西亚';
  if(/清远|肇庆/.test(t)&&names.includes('清远肇庆'))return '清远肇庆';
  if(/福建|泰宁/.test(t)&&names.includes('福建泰宁'))return '福建泰宁';
  if(/越南/.test(t)&&names.includes('越南全景'))return '越南全景';
  if(/拈花湾/.test(t)&&names.includes('拈花湾'))return '拈花湾';
  return null;
}
function recognizeMetrics(rows){
  const result=[];
  const maxCols=Math.min(36,Math.max(0,...rows.slice(0,4).map(r=>r?.length||0)));
  for(let col=0;col<maxCols;col++){
    const parts=rows.slice(0,4).map(r=>str(get(r,col))).filter(Boolean);
    const label=parts.join(' ');
    let def=MONEY_FIELDS.find(f=>f.re.test(label));
    // Future financial columns: recognize only safe, business-like numeric fields,
    // display them as provisional indicators without guessing a formula.
    if(!def&&col>=8){
      const candidate=parts.find(p=>/人均|客单|复购|毛利|净收|退款|营收|成交|支付|实付|咨询|有效|转化|订单|会员|留资|满意度|取消率|成本/.test(p));
      if(candidate&&candidate.length<28&&!/姓名|手机号|电话|证件|身份证|地址|客户姓名|联系人|微信|备注|客户列表/.test(candidate)){
        const unit=/%|比例|率/.test(candidate)?'%':/金额|营收|收入|客单|成本|实付|付款|人均/.test(candidate)?'元':/人数|人次|会员/.test(candidate)?'人':/订单|单数/.test(candidate)?'单':'数值';
        def={key:'custom_excel_col_'+col,label:candidate,unit,re:/.*/};
      }
    }
    if(def&&!result.some(r=>r.def.key===def.key))result.push({col,def});
  }
  return result;
}
function paymentData(rows,names,context){
  if(!rows.length)return {paymentSummary:[],metrics:[]};
  const matched=[];
  const metricsInfo=recognizeMetrics(rows);
  const groups=new Map();
  // Original workbook is organized in 3-row blocks with two separate rounds for 新马 and 越南.
  // Fall back to that positional mapping only when the known original seven-row signature is present.
  const signatureRows=[2,5,8,11,14,17,20];
  const signaturePrograms=['清远肇庆','新加坡·马来西亚','新加坡·马来西亚','福建泰宁','越南全景','越南全景','拈花湾'];
  const oldSignature=signatureRows.every(row=>{
    const arr=rows[row-1]||[];
    return safeNumber(get(arr,7))!==null&&safeNumber(get(arr,5))!==null&&safeNumber(get(arr,6))!==null;
  });
  for(let i=0;i<rows.length;i++){
    const row=rows[i]||[],amount=safeNumber(get(row,7)),order=safeNumber(get(row,5)),people=safeNumber(get(row,6));
    if(/(?:全部合计|总计|合计总额|总金额合计)/.test(row.slice(0,5).join(' ')))continue;
    if(!isInteger(amount)||!isInteger(order)||!isInteger(people))continue;
    let name=sniffProgram(row.slice(0,5).join(' '),names);
    if(!name){
      for(let n=i-1;n>=Math.max(0,i-3);n--){
        name=sniffProgram((rows[n]||[]).slice(0,5).join(' '),names);
        if(name)break;
      }
    }
    if(!name&&oldSignature){
      const index=signatureRows.indexOf(i+1);
      if(index>=0&&names.includes(signaturePrograms[index]))name=signaturePrograms[index];
    }
    if(!name){context.warnings.push('汇总数据!H'+(i+1)+' 有金额但无法确认归属线路，未纳入实付合计');continue}
    let p=groups.get(name);
    if(!p){p={program:name,amount:0,fullOrders:0,fullPersons:0,source:'汇总数据 F:G:H'};groups.set(name,p)}
    p.amount+=amount;p.fullOrders+=order;p.fullPersons+=people;
    matched.push({name,rowIndex:i,row,amount,order,people});
  }
  if(!matched.length)context.warnings.push('无法识别汇总数据中的完整实付金额和全款订单，金额将标记为待核验');
  const metrics=[];
  for(const {col,def} of metricsInfo){
    const accum=new Map();
    for(const r of matched){
      const value=safeNumber(get(r.row,col));
      if(value===null||!Number.isFinite(value)||value<0)continue;
      const weight=def.key==='average_price_per_person'?Math.max(1,r.people):/%|率/.test(def.unit)?Math.max(1,r.amount):1;
      let a=accum.get(r.name)||{weighted:0,weight:0};
      a.weighted+=value*(weight||1);a.weight+=(weight||1);accum.set(r.name,a);
    }
    if(accum.size){
      const valuesByProgram={};
      for(const [name,a] of accum)valuesByProgram[name]=Math.round(100*a.weighted/a.weight)/100;
      metrics.push({key:def.key,label:def.label,unit:def.unit,valuesByProgram,source:'Excel 汇总数据 '+coord(col,1)+' 列',
        note:def.key==='average_price_per_person'?'原表人均指标；多批次按付费人数加权，不能直接平均。':'新识别字段，按原表同线路数据汇总；如业务口径不明应核对后使用。'});
    }
  }
  return {paymentSummary:[...groups.values()],metrics};
}
function parseMatrices(matrices,options={}){
  const context={year:options.year||2026,warnings:[],blocking:[],seen:new Set()},records=[];
  const names=[];
  let totalRows=null;
  for(const [sheet,rows] of Object.entries(matrices)){
    if(!Array.isArray(rows))continue;
    if(totalSheetPattern.test(sheet)){if(!totalRows||/汇总数据/.test(sheet))totalRows=rows;continue}
    if(excludedNames.test(sheet))continue;
    const found=sessionEntries(sheet,rows,context);
    if(found.length){records.push(...found);names.push(canonical(sheet))}
  }
  if(!records.length)context.blocking.push('Excel中没有识别到完整的节目场次，请检查播出日期、首播/重播与5分钟时间行');
  const p=paymentData(totalRows||[],[...new Set(names)],context);
  if(totalRows===null)context.warnings.push('未找到财务汇总表，全款金额不会自动编造');
  records.sort((a,b)=>a.date.localeCompare(b.date)||a.program.localeCompare(b.program));
  const snapshot={schemaVersion:2,records,paymentSummary:p.paymentSummary,metrics:p.metrics,
    source:{name:'Excel文件',hash:options.sha256||'',sheets:Object.keys(matrices).length,notes:'浏览器内读取，上传到共享服务的仅为脱敏节目汇总'}};
  return {snapshot,warnings:context.warnings,blocking:context.blocking,recognizedSheets:[...new Set(names)]};
}
function knownSnapshot(seed,options={}){
  const records=seed.records.map(r=>({
    date:r.date,program:r.program,type:r.type,scans:r.scans,orders:r.orders,
    first30:r.first30,after30:r.after30,phone:r.phone,group:r.group,startTime:r.startTime,
    fiveMinute:r.fiveMinute?{mode:'increment',values:r.fiveMinute.values.slice(),source:{
      sheet:r.fiveMinute.source?.sheet||r.program,valueCells:r.fiveMinute.source?.valueCells||'',
      timeCells:r.fiveMinute.source?.timeCells||'',totalCell:r.fiveMinute.source?.totalCell||'',
      definition:'已核实原始文件中的六段5分钟新增扫码人数'}}:null
  }));
  return {snapshot:{schemaVersion:2,source:{name:'已核验原始Excel',hash:options.sha256||KNOWN_SHA,sheets:11,
    notes:'与已核实的原始电视节目表SHA256一致；16场及96个5分钟增量从经核验数据还原'},
    records,paymentSummary:seed.paymentSummary.map(p=>({...p})),metrics:[]},
    warnings:['当前Excel与已核验原始文件完全一致，使用已核验的16场数据和96段扫码增量。'],blocking:[],recognizedSheets:[...new Set(records.map(r=>r.program))]};
}
async function fileHash(buffer){
  if(!globalThis.crypto?.subtle)return '';
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function parseFile(file,seed,xlsx){
  if(!file||!/\.(xls|xlsx)$/i.test(file.name))throw new Error('请选择原始 .xls 或 .xlsx 文件');
  if(file.size>12*1024*1024)throw new Error('Excel超过12MB，暂不支持超大文件');
  const bytes=await file.arrayBuffer();
  const sha256=await fileHash(bytes);
  if(sha256===KNOWN_SHA && seed?.records?.length===16)return knownSnapshot(seed,{sha256});
  if(!xlsx?.read||!xlsx?.utils?.sheet_to_json)throw new Error('Excel解析组件未加载，请检查网络后重试');
  const book=xlsx.read(bytes,{type:'array',cellDates:false,cellText:true,cellNF:true});
  const matrices={};
  for(const name of book.SheetNames){
    const sheet=book.Sheets[name];
    matrices[name]=xlsx.utils.sheet_to_json(sheet,{header:1,raw:false,defval:null,blankrows:false});
  }
  let year=new Date(file.lastModified||Date.now()).getFullYear();
  const yyyy=file.name.match(/20[0-9]{2}/);
  if(yyyy)year=+yyyy[0];
  const parsed=parseMatrices(matrices,{year,sha256});
  parsed.snapshot.source.name='Excel上传（'+(file.name.toLowerCase().endsWith('.xlsx')?'xlsx':'xls')+'）';
  return parsed;
}
return {KNOWN_SHA,parseFile,parseMatrices,knownSnapshot,dateLabel,timeRange,canonical,recognizeMetrics};
});

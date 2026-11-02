/* Exact route aliases only. Source data stays unchanged; conflicts require review. */
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.UrbanIdentity=api;})(typeof window!=='undefined'?window:null,function(){
'use strict';
const official='意大利一地16日游';
const name=value=>['意大利一地',official].includes(String(value||'').trim())?official:value;
const key=r=>[r.date,name(r.program),r.type,r.startTime||''].join('|');
const signature=(r,kind)=>JSON.stringify(kind==='record'?[r.scans,r.orders,r.first30,r.after30,r.phone??null,r.group??null,r.fiveMinute?.values??null]:kind==='payment'?[r.amount,r.fullOrders,r.fullPersons]:[r.scanCount,r.paidByOrder,r.followingUp,r.notInterested,r.unclassifiedRemainder,r.paidAmount,r.otherConsumptionAmount??null]);
function normalize(snapshot){
 const conflicts=[];
 function rows(input,field,kind,identity){
  const result=[],seen=new Map(),bad=new Set();
  for(const original of input||[]){const r={...original,[field]:name(original[field])};
   if(r[field]!==official){result.push(r);continue;}
   const id=identity(r),previous=seen.get(id);
   if(!previous){seen.set(id,r);continue;}
   if(signature(previous,kind)!==signature(r,kind)&&!bad.has(id)){bad.add(id);conflicts.push(official+' '+id+' 数据冲突，待核对；该项暂不计入。');}
  }
  return result.concat([...seen].filter(([id])=>!bad.has(id)).map(([,r])=>r));
 }
 const records=rows(snapshot.records,'program','record',key);
 const paymentSummary=rows(snapshot.paymentSummary,'program','payment',r=>r.program);
 const followUpSummary=snapshot.followUpSummary?{...snapshot.followUpSummary,rows:rows(snapshot.followUpSummary.rows,'sourceProduct','followup',r=>r.sourceProduct+'|'+r.sourceRow)}:undefined;
 const metrics=(snapshot.metrics||[]).map(m=>{const values={};for(const [n,v]of Object.entries(m.valuesByProgram||{})){const canonical=name(n);if(Object.hasOwn(values,canonical)&&values[canonical]!==v){conflicts.push(official+' 指标冲突，待核对');delete values[canonical];}else values[canonical]=v;}return {...m,valuesByProgram:values};});
 return {snapshot:{...snapshot,records,paymentSummary,metrics,...(followUpSummary?{followUpSummary}:{})},conflicts};
}
function assertAliasCompatibility(base,incoming){
 const previousFollowUp=new Map((base.followUpSummary?.rows||[]).filter(r=>name(r.sourceProduct)===official).map(r=>[r.sourceRow,r]));
 for(const r of incoming.followUpSummary?.rows||[]){const prior=previousFollowUp.get(r.sourceRow);if(prior&&name(r.sourceProduct)===official&&prior.sourceProduct!==r.sourceProduct&&signature(prior,'followup')!==signature(r,'followup'))throw Error(official+' 跟进批次存在别名数据冲突，请核对后再发布');}
 for(const [field,kind,label,id]of [['records','record','program',key],['paymentSummary','payment','program',r=>name(r.program)]]){
  const old=new Map((base[field]||[]).filter(r=>name(r[label])===official).map(r=>[id(r),r]));
  for(const r of incoming[field]||[]){const prior=old.get(id(r));if(prior&&prior[label]!==r[label]&&signature(prior,kind)!==signature(r,kind))throw Error(official+' 同一场次或财务汇总存在别名数据冲突，请核对后再发布');}
 }
 const problems=[...normalize(base).conflicts,...normalize(incoming).conflicts];if(problems.length)throw Error(problems.join('；'));
}
return {name,key,normalize,assertAliasCompatibility};
});

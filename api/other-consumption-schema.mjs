// Aggregate whitelist only; raw orders, user IDs, labels and payment timestamps stay local.
export function validateOtherConsumption(value){
 const fail=message=>{const e=Error('其他消费汇总：'+message);e.status=422;throw e;};
 const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e9&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(String(x));
 const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
 const text=(x,max)=>{if(typeof x!=='string'||!x.trim()||x.length>max||/[<>]|[0-9]{11}/.test(x))fail('名称或类别无效');return x.trim();};
 const cents=x=>Math.round(x*100),sum=a=>a.reduce((n,x)=>n+cents(x.amount),0);
 const keys=['travel','hotel','dining','commerce','unclassified'],labels=['旅游','酒店','团餐','电商','未分类'];
 if(value?.schemaVersion!==1||!money(value.amount)||!money(value.summaryAmount)||!integer(value.orderCount)||!integer(value.blankSummaryBatches))fail('版本、金额或订单数无效');
 if(!Array.isArray(value.categories)||value.categories.length!==5||!Array.isArray(value.products)||value.products.length>1000)fail('分类或产品结构无效');
 const categories=keys.map((key,i)=>{const items=value.categories.filter(c=>c.key===key);if(items.length!==1||!money(items[0].amount)||!integer(items[0].orderCount))fail('分类重复或数值无效');return {key,label:labels[i],amount:items[0].amount,orderCount:items[0].orderCount};});
 const seen=new Set(),products=value.products.map(p=>{const name=text(p.name,160),rawCategory=text(p.rawCategory||'未填写',40);if(!keys.includes(p.category)||!money(p.amount)||!integer(p.orderCount)||p.orderCount===0)fail('产品类别或数值无效');const key=JSON.stringify([name,rawCategory]);if(seen.has(key))fail('产品重复');seen.add(key);return {name,rawCategory,category:p.category,amount:p.amount,orderCount:p.orderCount};});
 if(sum(categories)!==cents(value.amount)||sum(products)!==cents(value.amount)||categories.reduce((n,c)=>n+c.orderCount,0)!==value.orderCount||products.reduce((n,p)=>n+p.orderCount,0)!==value.orderCount)fail('分类、产品与总额不一致');
 for(const c of categories){const p=products.filter(p=>p.category===c.key);if(sum(p)!==cents(c.amount)||p.reduce((n,r)=>n+r.orderCount,0)!==c.orderCount)fail('分类与产品明细不一致');}
 const a=value.annualDinner;if(!money(a?.amount)||!integer(a.orderCount)||a.amount>value.amount||a.orderCount>value.orderCount)fail('年夜饭子集超出总量');
 const audit=(value.audit||[]);if(!Array.isArray(audit)||audit.length>10)fail('更正记录无效');
 const checkedAudit=audit.map(a=>{if(!integer(a.sourceRow)||a.sourceRow===0||!money(a.from)||!money(a.to))fail('更正数值无效');return {sourceRow:a.sourceRow,from:a.from,to:a.to,reason:text(a.reason,180)};});
 const sessionAudit=value.sessionAudit||[];if(!Array.isArray(sessionAudit)||sessionAudit.length>10)fail('意向金更正记录无效');
 const checkedSessionAudit=sessionAudit.map(a=>{if(!/^20\d{2}-\d{2}-\d{2}$/.test(a.date)||!['首播','重播'].includes(a.type)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(a.startTime)||!integer(a.from)||!integer(a.to))fail('意向金更正字段无效');return {program:text(a.program,75),date:a.date,type:a.type,startTime:a.startTime,from:a.from,to:a.to,reason:text(a.reason,180)};});
 const checks=value.checks||[];if(!Array.isArray(checks)||checks.length>2||checks.some(c=>!['scan_totals','intention_totals'].includes(c.key)||!integer(c.left)||!integer(c.right))||new Set(checks.map(c=>c.key)).size!==checks.length)fail('核对指标无效');
 const unknownSourceOrders=value.unknownSourceOrders??0;if(!integer(unknownSourceOrders)||unknownSourceOrders>value.orderCount)fail('未知来源订单数无效');
 return {schemaVersion:1,amount:value.amount,summaryAmount:value.summaryAmount,blankSummaryBatches:value.blankSummaryBatches,orderCount:value.orderCount,categories,products,annualDinner:{amount:a.amount,orderCount:a.orderCount},unknownCategories:[...new Set(products.filter(p=>p.category==='unclassified').map(p=>p.rawCategory))],unknownSourceOrders,checks:checks.map(c=>({key:c.key,left:c.left,right:c.right})),...(checkedAudit.length?{audit:checkedAudit}:{}),...(checkedSessionAudit.length?{sessionAudit:checkedSessionAudit}:{})};
}

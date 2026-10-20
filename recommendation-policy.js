/* 都市频道排播决策：独立纯函数，按成交产出优先，扫码及意向只作过程诊断。
   Input: all historical de-identified broadcasts and full-cycle paid totals.
   These are allocation/reference ratios, not per-session attribution or profit. */
(function(root,factory){
  const policy=factory();
  if(typeof module!=='undefined' && module.exports)module.exports=policy;
  if(root)root.UrbanRecommendation=policy;
})(typeof window!=='undefined'?window:null,function(){
'use strict';
const sum=(rows,k)=>rows.reduce((n,r)=>n+(Number(r[k])||0),0);
const value=x=>Number.isFinite(Number(x))&&Number(x)>=0?Number(x):null;
const money=x=>'¥'+Math.round(x).toLocaleString('zh-CN');
const fixed=(x,decimals=1)=>Number(x||0).toFixed(decimals);
function median(values){
  const a=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if(!a.length)return null;
  const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
}
function evaluate(broadcasts,paidRoutes){
  const groups=new Map();
  for(const r of (Array.isArray(broadcasts)?broadcasts:[])){
    if(!r||typeof r.program!=='string'||!r.program.trim())continue;
    let g=groups.get(r.program);
    if(!g){g={name:r.program,n:0,live:0,replay:0,scans:0,orders:0,latest:''};groups.set(r.program,g)}
    g.n++;
    if(r.type==='首播')g.live++;
    if(r.type==='重播')g.replay++;
    g.scans+=Number(r.scans)||0;
    g.orders+=Number(r.orders)||0;
    if(r.date>g.latest)g.latest=r.date;
  }
  const paidMap=new Map();
  for(const row of (Array.isArray(paidRoutes)?paidRoutes:[])){
    if(!row||typeof row.program!=='string')continue;
    const amount=value(row.amount),fullOrders=value(row.fullOrders),fullPersons=value(row.fullPersons);
    if(amount===null||fullOrders===null||fullPersons===null)continue;
    paidMap.set(row.program,{amount,fullOrders,fullPersons,source:String(row.source||'')});
  }
  const evaluated=[...groups.values()].filter(g=>g.n>0).map(g=>{
    const paid=paidMap.get(g.name)||null;
    return {...g,paid,
      avgScans:g.scans/g.n,
      avgOrders:g.orders/g.n,
      revenuePerBroadcast:paid?paid.amount/g.n:null,
      paidPerScan:paid&&g.scans>0?paid.amount/g.scans:null,
      paidOrdersPerBroadcast:paid?paid.fullOrders/g.n:null,
      paidPerPerson:paid&&paid.fullPersons>0?paid.amount/paid.fullPersons:null};
  });
  const known=evaluated.filter(g=>g.paid&&g.scans>0);
  const medianRevenue=median(known.map(g=>g.revenuePerBroadcast));
  const medianPerScan=median(known.map(g=>g.paidPerScan));
  const asOf=evaluated.reduce((latest,g)=>g.latest>latest?g.latest:latest,'');
  for(const g of evaluated){
    let tier='review',status='成交待核验';
    let why='未取得可核验的线路累计实付、全款订单和付费人数；不能仅凭扫码与意向金推荐增加播出。';
    let next='先补齐全款实付与订单数据，确认退款、成本及场次归因，再决定是否排播。';
    if(g.paid){
      const base='共'+g.n+'场，累计实付'+money(g.paid.amount)+'、全款'+g.paid.fullOrders+
        '单；按播次均摊'+money(g.revenuePerBroadcast)+'/场，按扫码规模折算'+money(g.paidPerScan===null?0:g.paidPerScan)+'/人次。';
      const lowYield=known.length>=3 && g.n>=2 &&
        g.revenuePerBroadcast<medianRevenue*0.60 &&
        g.paidPerScan!==null&&g.paidPerScan<medianPerScan*0.60;
      const weakIntent=g.n>=3 && g.avgOrders<1;
      const strongYield=known.length>=3 && g.n>=3 &&
        g.revenuePerBroadcast>=medianRevenue*1.5 &&
        g.paidPerScan!==null&&g.paidPerScan>=medianPerScan*0.85 &&
        g.paid.fullOrders>=5&&g.avgOrders>=2;
      if(lowYield){
        tier='pause';status='暂缓追加排播';
        why=base+'虽有场均'+fixed(g.avgScans)+'次扫码、'+fixed(g.avgOrders,2)+
          '单意向，但成交产出按播次和扫码规模折算均显著低于线路中位数，不能据此扩大播出。';
        next='先核查成交归因、实际客单价、退款、毛利和客服跟进。改善得到验证前不追加排播；若需要试播，应另行设定成本与成交门槛。';
      }else if(weakIntent){
        tier='pause';status='暂缓重播';
        why=base+'场均意向金仅'+fixed(g.avgOrders,2)+'单，最近的过程表现不足以支持加密重播。';
        next='先调整产品权益和转化链路，复盘后再决定是否恢复播出。';
      }else if(strongYield){
        tier='primary';status='优先续播';
        why=base+'实付均摊明显高于同组中位数，且全款订单有一定样本支撑；仍需监控最近场次波动。';
        next='可优先安排1场验证性续播，并记录实际成本、退款和新增全款表现，不直接放量。';
      }else{
        tier='observe';status=g.n<2?'样本不足':g.avgOrders>=3?'谨慎验证':'控制频次';
        why=base+'过程指标为场均扫码'+fixed(g.avgScans)+'次、场均意向'+fixed(g.avgOrders,2)+
          '单；仍需验证全款产出能否持续覆盖节目成本。';
        next=g.n<2?'先补足成交与播次样本，不据单次表现追加排期。':
          '仅保留低频、可核算成本的验证场次；核对真实成交和退款后再调整频次。';
      }
    }
    g.tier=tier;g.status=status;g.reason=why;g.next=next;
  }
  const rank={primary:3,observe:2,review:1,pause:0};
  evaluated.sort((a,b)=>rank[b.tier]-rank[a.tier]||
    (b.revenuePerBroadcast??-1)-(a.revenuePerBroadcast??-1)||
    b.paid?.fullOrders-a.paid?.fullOrders||
    a.name.localeCompare(b.name,'zh-CN'));
  return {items:evaluated,asOf,medianRevenuePerBroadcast:medianRevenue,medianRevenuePerScan:medianPerScan,
    definition:'实付为线路全周期累计。按播次均摊实付、按扫码规模折算实付，只是同口径经营比较，不是单场归因收入、用户转化率或净利润。'};
}
return {evaluate,median};
});
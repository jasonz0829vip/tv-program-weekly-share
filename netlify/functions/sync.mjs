// Public, no-login HTTPS relay for Chinese networks where *.workers.dev is inaccessible.
// Deploy as a NEW Netlify Free site; do not attach this to the existing FieldNotes site.
// It forwards only the four fixed endpoints to the same Cloudflare D1 database.
// The raw XLS/XLSX workbook and any contact fields are NEVER sent to this function.
const WORKER='https://tv-program-weekly-sync.jasonz0829vip.workers.dev';
const SITE='https://jasonz0829vip.github.io';
const allowed={
  current:'GET',
  versions:'GET',
  publish:'POST',
  restore:'POST'
};
const MAX_BODY=750000;
const cors={
  'Access-Control-Allow-Origin':SITE,
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Max-Age':'600',
  'Cache-Control':'no-store, max-age=0',
  'X-Content-Type-Options':'nosniff'
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
export default async function handler(request){
  const u=new URL(request.url);
  const name=u.pathname.split('/').filter(Boolean).at(-1);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!(name in allowed))return response({ok:false,error:'不存在该共享接口'},404);
  if(request.method!==allowed[name])return response({ok:false,error:'不支持的方法'},405);
  if(request.method==='POST'&&request.headers.get('Origin')!==SITE){
    return response({ok:false,error:'仅支持从都市频道网页发布'},403);
  }
  let body=undefined;
  if(request.method==='POST'){
    const size=Number(request.headers.get('Content-Length')||0);
    if(size>MAX_BODY)return response({ok:false,error:'汇总数据超过大小限制'},413);
    body=await request.arrayBuffer();
    if(body.byteLength>MAX_BODY)return response({ok:false,error:'汇总数据超过大小限制'},413);
    if(!/application\/json/i.test(request.headers.get('Content-Type')||''))return response({ok:false,error:'仅接收脱敏JSON'},415);
  }
  try{
    const cloud=await fetch(WORKER+'/api/'+name,{
      method:request.method,
      headers:request.method==='POST'?{'Content-Type':'application/json'}:{},
      body,
      signal:AbortSignal.timeout(14000),
      cache:'no-store'
    });
    if(cloud.headers.get('Content-Type')?.includes('application/json')){
      const payload=await cloud.text();
      if(payload.length>1000000)return response({ok:false,error:'共享返回数据超过上限'},502);
      return new Response(payload,{status:cloud.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
    }
    return response({ok:false,error:'共享源服务返回无效响应'},502);
  }catch(e){
    return response({ok:false,error:'共享源暂时不可用，请稍后重试'},503);
  }
}
export const config={
  path:['/api/current','/api/versions','/api/publish','/api/restore'],
  rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:30}
};

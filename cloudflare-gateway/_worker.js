// Independent zero-cost Cloudflare Pages endpoint for a dual-domain
// Netlify/Cloudflare upload relay. Never receives the raw workbook.
// Public write access is intentional for this dashboard.
const ORIGIN='https://jasonz0829vip.github.io';
const CLOUD='https://tv-program-weekly-sync.jasonz0829vip.workers.dev';
const ALLOW={current:'GET',versions:'GET',publish:'POST',restore:'POST'};
const MAX_BYTES=750000;
const cors={'Access-Control-Allow-Origin':ORIGIN,
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Max-Age':'600',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'};
function respond(body,status=200){
 return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8'}});
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    const name=path.slice(5);
    if(!Object.prototype.hasOwnProperty.call(ALLOW,name))return respond({ok:false,error:'未知接口'},404);
    if(ALLOW[name]!==request.method)return respond({ok:false,error:'不支持该请求方法'},405);
    if(request.method==='POST'&&request.headers.get('Origin')!==ORIGIN)return respond({ok:false,error:'只能从都市频道网页发起上传'},403);
    let data;
    if(request.method==='POST'){
      const length=Number(request.headers.get('Content-Length')||0);
      if(length>MAX_BYTES)return respond({ok:false,error:'脱敏汇总超过大小限制'},413);
      if(!/application\/json/.test(request.headers.get('Content-Type')||''))return respond({ok:false,error:'只接收脱敏JSON'},415);
      data=await request.arrayBuffer();
      if(data.byteLength>MAX_BYTES)return respond({ok:false,error:'脱敏汇总超过大小限制'},413);
    }
    try{
      const upstream=await fetch(CLOUD+'/api/'+name,{
        method:request.method,headers:request.method==='POST'?{'Content-Type':'application/json'}:{},
        body:data,signal:AbortSignal.timeout(12500),cache:'no-store'
      });
      if(!upstream.headers.get('Content-Type')?.includes('application/json'))return respond({ok:false,error:'源接口返回无效数据'},502);
      const responseText=await upstream.text();
      if(responseText.length>1000000)return respond({ok:false,error:'数据超限'},502);
      return new Response(responseText,{status:upstream.status,headers:{...cors,'Content-Type':'application/json;charset=utf-8'}});
    }catch(error){return respond({ok:false,error:'上游数据库暂时无法连接'},503)}
  }
};

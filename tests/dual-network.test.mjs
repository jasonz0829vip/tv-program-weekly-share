import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSnapshot} from '../api/worker.mjs';
import gateway,{config} from '../netlify/functions/sync.mjs';

const mirror=JSON.parse(readFileSync(new URL('../data/current.json',import.meta.url),'utf8'));
const conf=JSON.parse(readFileSync(new URL('../sync-config.json',import.meta.url),'utf8'));
const source=readFileSync(new URL('../shared-sync.js',import.meta.url),'utf8');
const workerOrigin='https://tv-program-weekly-sync.jasonz0829vip.workers.dev';
const allowedOrigin='https://jasonz0829vip.github.io';

test('Mainland-readable static JSON mirrors a full validated cloud version, never raw XLS/XLSX',()=>{
  assert.equal(mirror.ok,true);
  assert.equal(typeof mirror.version,'string');
  assert.ok(mirror.snapshot);
  const validated=validateSnapshot(mirror.snapshot);
  assert.equal(validated.totals.sessions,mirror.snapshot.records.length);
  assert.equal(validated.totals.programs,5);
  assert.equal(validated.totals.scans,1342);
  assert.equal(validated.totals.amount,489071);
  const serialized=JSON.stringify(mirror);
  assert.doesNotMatch(serialized,/(客户手机号|客户电话|full_client_detail|13800000000)/);
  assert.ok(!('workbook' in mirror)&&!('rawExcel' in mirror));
});

test('Original GitHub Pages URL and public mirror remain the primary read path',()=>{
  assert.equal(conf.mirrorPath,'data/current.json');
  assert.equal(conf.apiBase,workerOrigin);
  assert.ok(Array.isArray(conf.apiFallbacks));
  assert.match(source,/async function refreshPublishedMirror/);
  assert.match(source,/await refreshPublishedMirror\(true\)/);
  assert.match(source,/API\.gateways/);
  assert.match(source,/API\.online/);
  assert.match(source,/上传通道不可达/);
});

test('Alternate free gateway serves only approved endpoints and stays on same D1 source',async()=>{
  assert.deepEqual(config.path,['/api/current','/api/versions','/api/publish','/api/restore']);
  let destination='',invocations=0;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    destination=url;invocations++;
    assert.equal(init.method,'GET');
    return Response.json({ok:true,version:mirror.version,snapshot:mirror.snapshot},{status:200});
  };
  try{
    const result=await gateway(new Request('https://sample.netlify.app/api/current',{headers:{Origin:allowedOrigin}}));
    assert.equal(result.status,200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'),allowedOrigin);
    assert.equal((await result.json()).version,mirror.version);
    assert.equal(destination,workerOrigin+'/api/current');
    assert.equal(invocations,1);
    const forbidden=await gateway(new Request('https://sample.netlify.app/api/unknown'));
    assert.equal(forbidden.status,404);
    assert.equal(invocations,1);
  }finally{globalThis.fetch=original}
});

test('Gateway blocks cross-site POST and never proxies arbitrary URLs',async()=>{
  const req=new Request('https://sample.netlify.app/api/publish',{method:'POST',headers:{Origin:'https://another-site.example','Content-Type':'application/json'},body:'{}'});
  const result=await gateway(req);
  assert.equal(result.status,403);
  const opts=await gateway(new Request('https://sample.netlify.app/api/publish',{method:'OPTIONS'}));
  assert.equal(opts.status,204);
});

test('Worker proxy maintains optimistic version consistency for de-identified writes',async()=>{
  let actual;
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    actual={url,options};
    return Response.json({ok:true,version:'new-version'});
  };
  try{
    const payload={baseVersion:mirror.version,snapshot:mirror.snapshot};
    const result=await gateway(new Request('https://sample.netlify.app/api/publish',{
      method:'POST',
      headers:{Origin:allowedOrigin,'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }));
    assert.equal(result.status,200);
    assert.equal(actual.url,workerOrigin+'/api/publish');
    assert.equal(actual.options.method,'POST');
    const echoed=JSON.parse(new TextDecoder().decode(actual.options.body));
    assert.equal(echoed.baseVersion,mirror.version);
  }finally{globalThis.fetch=original}
});

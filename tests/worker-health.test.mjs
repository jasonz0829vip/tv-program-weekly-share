import {test} from 'node:test';
import assert from 'node:assert/strict';
import {waitForWorker} from '../scripts/worker-health.mjs';
test('new hostname TLS delay retries without bypassing certificate validation',async()=>{
  let calls=0;
  const result=await waitForWorker('https://example.test',{delayMs:0,fetcher:async()=>{
    if(++calls===1)throw new Error('TLS not ready');
    return {ok:true,json:async()=>({ok:true,version:null})};
  }});
  assert.equal(calls,2); assert.equal(result.version,null);
});
test('persistent unhealthy D1 fails deployment within bounded attempts',async()=>{
  let calls=0;
  await assert.rejects(waitForWorker('https://example.test',{attempts:2,delayMs:0,fetcher:async()=>{
    calls++; return {ok:false,status:503};
  }}),/did not become ready/);
  assert.equal(calls,2);
});

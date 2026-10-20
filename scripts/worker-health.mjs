// New workers.dev hostnames may need time for TLS activation. Never weaken TLS.
export async function waitForWorker(url, {attempts=12, delayMs=5000, fetcher=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  let last;
  for(let i=0;i<attempts;i++){
    try {
      const res=await fetcher(url+'/api/current',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!res.ok)throw new Error('Worker health HTTP '+res.status);
      const health=await res.json();
      if(!health.ok)throw new Error('Worker D1 health failed');
      return health;
    }catch(error){last=error; if(i+1<attempts)await sleep(delayMs);}
  }
  throw new Error('Worker HTTPS/D1 health did not become ready', {cause:last});
}

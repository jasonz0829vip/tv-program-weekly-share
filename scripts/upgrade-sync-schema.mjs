// Update only the existing service. Never provision, migrate, initialize, or publish a snapshot.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const sync=JSON.parse(readFileSync('sync-config.json','utf8'));
if(config.name!=='tv-program-weekly-sync'||!/^https:\/\/tv-program-weekly-sync\.[a-z0-9-]+\.workers\.dev$/.test(sync.apiBase))throw Error('Unexpected existing service; upgrade halted');
const wrangler=args=>execFileSync('npx',['--no-install','wrangler',...args],{encoding:'utf8',env:process.env,stdio:['ignore','pipe','pipe'],timeout:120000});
const read=async path=>{const res=await fetch(sync.apiBase+path,{signal:AbortSignal.timeout(15000)});if(!res.ok)throw Error('Existing service read failed: '+res.status);return res.json()};
const before=await read('/api/current');if(!before.ok||!before.version||!before.snapshot)throw Error('Existing initialized snapshot is required; no bootstrap permitted');
const list=JSON.parse(wrangler(['d1','list','--json']));
const databases=Array.isArray(list)?list:list.result||list.databases||[];
const database=databases.find(d=>d.name==='tv-program-weekly-data'),id=database?.uuid||database?.id;
if(!/^[a-f0-9-]{36}$/i.test(id||''))throw Error('Existing database missing; no database will be created');
config.d1_databases=[{binding:'DB',database_name:'tv-program-weekly-data',database_id:id}];writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2)+'\n');
wrangler(['deploy','--strict']);
let after,health;
for(let attempt=0;attempt<8;attempt++){try{health=await read('/');after=await read('/api/current');if(health.capabilities?.includes('followup-summary-v1'))break}catch{}if(attempt<7)await new Promise(r=>setTimeout(r,5000))}
if(!health?.capabilities?.includes('followup-summary-v1'))throw Error('Updated schema capability not confirmed');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(after.version!==before.version||hash(after.snapshot)!==hash(before.snapshot))throw Error('Shared snapshot changed during upgrade; inspect concurrent publishing before accepting');
console.log('Existing Worker upgraded; follow-up schema confirmed; shared version and snapshot unchanged.');

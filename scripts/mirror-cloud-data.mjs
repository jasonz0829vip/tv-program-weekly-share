// Mirror only the validated, de-identified Cloudflare D1 snapshot to the
// SAME GitHub Pages origin that already works for the public report.
// This is read-only publication. The Excel workbook and any client rows never leave the browser.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {validateSnapshot} from '../api/worker.mjs';

const config=JSON.parse(readFileSync(new URL('../sync-config.json',import.meta.url),'utf8'));
const endpoint=process.env.TV_SYNC_API||config.apiBase;
const outPath=new URL('../data/current.json',import.meta.url);
if(!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(endpoint||''))throw Error('Verified HTTPS cloud source is not configured');

const res=await fetch(endpoint+'/api/current',{cache:'no-store',signal:AbortSignal.timeout(18000)});
if(!res.ok)throw Error('Cloud source HTTP '+res.status+'; existing public snapshot will not be modified');
const cloud=await res.json();
if(!cloud?.ok||!cloud.version||!cloud.snapshot?.records?.length){
  throw Error('Cloud source returned no verified published version; previous public snapshot preserved');
}
const snapshot=validateSnapshot(cloud.snapshot);
if(snapshot.records.length!==cloud.snapshot.records.length)throw Error('Unexpected record loss during public validation');
snapshot.source.name='都市频道脱敏经营汇总';
snapshot.source.notes='此文件仅包含已核验的经营场次、线路、金额和指标。原始Excel、客户身份信息不公开。';
const release={
  ok:true,
  version:cloud.version,
  updatedAt:cloud.updatedAt,
  mirroredAt:new Date().toISOString(),
  snapshot
};
const previous=existsSync(outPath)?JSON.parse(readFileSync(outPath,'utf8')):null;
if(previous?.version===release.version){
  console.log('PUBLIC_MIRROR_UNCHANGED '+release.version+'; no GitHub Pages deployment needed');
  process.exit(0);
}
mkdirSync(dirname(outPath.pathname),{recursive:true});
const output=JSON.stringify(release,null,2)+'\n';
if(Buffer.byteLength(output)>750000)throw Error('Public mirror is unexpectedly large; review before publishing');
writeFileSync(outPath,output,'utf8');
console.log('PUBLIC_MIRROR_READY '+release.version+' sessions='+snapshot.records.length+
 ' routes='+snapshot.totals.programs+' scans='+snapshot.totals.scans+' bytes='+Buffer.byteLength(output));

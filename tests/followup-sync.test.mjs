import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const src=fs.readFileSync(new URL('../shared-sync.js',import.meta.url),'utf8');const body=src.slice(src.indexOf('function mergeSnapshots('),src.indexOf('function evaluateDraft('));
const row=(name,n)=>({sourceProduct:name,sourceRow:2,scanCount:n,paidByOrder:n,followingUp:0,notInterested:0,unclassifiedRemainder:0,paidAmount:n,otherConsumptionAmount:null});
const snap=rows=>({records:[],paymentSummary:[],metrics:[],source:{},...(rows?{followUpSummary:{schemaVersion:1,rows}}:{})});
const merge=(base,next,mode='merge')=>Function('API','SEED','sessionKey',body+';return mergeSnapshots;')({snapshot:base},{},JSON.stringify)(next,mode);
test('merge replaces same product batches rather than accumulating stale followups',()=>{const a=row('合成甲',2),b=row('合成乙',4),n=row('合成甲',3);assert.deepEqual(merge(snap([a,b]),snap([n])).followUpSummary.rows,[b,n])});
test('old import preserves known followup in merge and explicit replacement removes it',()=>{const base=snap([row('合成甲',2)]);assert.deepEqual(merge(base,snap()).followUpSummary,base.followUpSummary);assert.equal(merge(base,snap(),'replace').followUpSummary,undefined)});
test('snapshot application passes nullable followup before render refresh',()=>{const apply=src.slice(src.indexOf('function applySnapshot('),src.indexOf('function applySnapshot(')+5000);assert.ok(apply.indexOf('UrbanLines?.setFollowUp')>=0);assert.ok(apply.indexOf('UrbanLines?.setFollowUp')<apply.indexOf('render();'))});

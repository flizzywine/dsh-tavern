import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createProfileDataStore} from '../tavern-plugin/lib/profile-data-store.js'
import {createMvuDiagnosticStore} from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
const relative='diagnostics/mvu-'+createHash('sha256').update('s').digest('hex')
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'mvu-log-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const storage=createProfileDataStore({dataRoot:root,...options})
 return {root,storage,store:createMvuDiagnosticStore(storage,{flushDelayMs:0}),file:join(root,relative+'.jsonl')}
}
test('legacy logs remain readable and import once; readers retain count and dropped semantics',async t=>{
 const {root,storage}=await fixture(t)
 const store=createMvuDiagnosticStore(storage,{maxRecords:3,flushDelayMs:0})
 await storage.writeJson(relative+'.json',{version:1,sessionId:'s',dropped:4,records:[{n:0},{n:1}]})
 assert.equal((await store.read('s')).records.length,2)
 await Promise.all(Array.from({length:10},(_,n)=>store.record('s',{n:n+2,authorization:'PRIVATE',message:'Bearer PRIVATE'})))
 const result=await createMvuDiagnosticStore(createProfileDataStore({dataRoot:root}),{maxRecords:3}).read('s')
 assert.deepEqual(result.records.map(r=>r.n),[9,10,11]);assert.equal(result.dropped,13)
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/)
 assert.equal((await storage.readJson(relative+'.json')).records.length,2)
 assert.deepEqual((await store.read('other')).records,[])
})

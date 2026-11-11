import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
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

test('Windows deferred promotion remains readable and a later writer recovers all records',async t=>{
 const {root,store,file}=await fixture(t,{platform:'win32',sleep:async()=>{},rename:async()=>{throw Object.assign(new Error('busy'),{code:'EPERM'})}})
 await store.record('s',{n:0});await store.record('s',{n:1})
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1])
 const recovered=createMvuDiagnosticStore(createProfileDataStore({dataRoot:root}),{flushDelayMs:0})
 await recovered.record('s',{n:2})
 assert.deepEqual((await recovered.read('s')).records.map(r=>r.n),[0,1,2])
 assert.ok((await stat(file)).size>0)
})

test('failed flushes are observable and retry with newer buffered records in order',async t=>{
 const {storage}=await fixture(t)
 let failed=true
 const store=createMvuDiagnosticStore({...storage,appendText(...args){if(failed)return Promise.reject(Error('disk failed'));return storage.appendText(...args)}},{flushDelayMs:60000})
 t.after(()=>store.dispose())
 await store.record('s',{n:0})
 await assert.rejects(store.flush(),/disk failed/)
 const pending=await store.read('s')
 assert.equal(pending.persistence,'pending');assert.equal(pending.records[0].n,0)
 await store.record('s',{n:1});failed=false
 assert.deepEqual((await store.read('s')).records.map(r=>r.n),[0,1])
})

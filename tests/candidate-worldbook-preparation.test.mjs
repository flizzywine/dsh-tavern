import test from 'node:test'
import assert from 'node:assert/strict'
import {createCandidateWorldbookPreparation} from '../tavern-plugin/lib/domain/candidate-worldbook-preparation.js'

function harness(){
 let revision=1,resources='settings-1',calls=0,prepare=async()=>({context:'round '+revision,prefixContext:'fixed'})
 const cache=createCandidateWorldbookPreparation({version:async()=>({revision,resources}),prepare:async()=>{calls++;return prepare()},onError:()=>{}})
 return {cache,get calls(){return calls},set prepare(value){prepare=value},set resources(value){resources=value},change(source){revision++;cache.changed({sessionId:'s',_storageRevision:revision},{source})},external(){revision++}}
}

test('variables, body, resources, unknown revisions and rollback invalidate prepared state',async()=>{
 const h=harness();await h.cache.warm('s')
 for(const source of ['mvu.patch','body.commit','rollback','card.reload']){h.change(source);await h.cache.get('s')}
 assert.equal(h.calls,5)
 h.resources='settings-2';await h.cache.get('s');assert.equal(h.calls,6)
 h.external();h.change('candidate.mailbox.preparing');await h.cache.get('s');assert.equal(h.calls,7)
})

test('concurrent state changes cannot publish stale prepared output or replay template effects',async()=>{
 const h=harness();let release;h.prepare=()=>new Promise(resolve=>{release=resolve})
 const pending=h.cache.get('s');await new Promise(resolve=>setImmediate(resolve))
 h.change('mvu.patch');release({context:'old'})
 await assert.rejects(pending,{code:'CANDIDATE_CONTEXT_CHANGED'});assert.equal(h.calls,1)
 h.prepare=async()=>({context:'new'});assert.equal((await h.cache.get('s')).context,'new')
})

test('initialization normalizes settings before pinning template dependencies',async()=>{
 let resources='before-init',calls=0,connections=0
 const cache=createCandidateWorldbookPreparation({version:async()=>({revision:1,resources}),
  ready:async()=>{connections++;resources='initialized'},prepare:async()=>{calls++;return {context:resources}}})
 await cache.warm('s')
 assert.equal((await cache.get('s')).context,'initialized')
 assert.equal(calls,1);assert.equal(connections,1)
})

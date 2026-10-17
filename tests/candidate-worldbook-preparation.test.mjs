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

import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {applyListenerReactions} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-projection.js'

test('listener reaction is paragraph-local, speaker-safe and deterministic in replay',()=>{
 const base={oak:'calm',gary:'neutral'},state={cast:['oak','gary']}
 const ops=[{op:'event',value:{op:'reaction',id:'gary',value:'joy'}},{op:'event',value:{op:'reaction',id:'oak',value:'sad'}},{op:'event',value:{op:'reaction',id:'offstage',value:'joy'}}]
 const expected={oak:'calm',gary:'joy'}
 assert.deepEqual(applyListenerReactions(base,ops,state,'oak'),expected)
 assert.deepEqual(applyListenerReactions(base,ops,state,'oak'),expected)
 assert.deepEqual(applyListenerReactions(base,[],state,'gary'),base)
 assert.deepEqual(applyListenerReactions(base,ops,state,null),base)
 assert.deepEqual(base,{oak:'calm',gary:'neutral'})
})


test('recorded reaction is decoded only at its own paragraph boundary',()=>{
 const commands=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs')
 const raw={op:'actor.reaction.set',actor:'gary',emotion:'joy'},binding={commandSpecVersion:commands.version}
 const op=commands.recordOperation(raw,binding)
 assert.deepEqual(op,{op:'event',value:{op:'reaction',id:'gary',value:'joy'}})
 const base={oak:'calm',gary:'neutral'}, state={cast:['oak','gary']}
 assert.equal(applyListenerReactions(base,[op],state,'oak').gary,'joy')
 assert.equal(applyListenerReactions(base,[],state,'gary').gary,'neutral')
})

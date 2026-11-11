import test from 'node:test'
import assert from 'node:assert/strict'
import {createOptionalStage} from '../tavern-plugin/lib/optional-stage.js'

for(const phase of ['cards','foreground','start','services','requests'])test('failure in '+phase+' releases stage and revokes retained consumers',async()=>{
  let disposed=0
  const runtime={assets:{dialogueBubbles:{read:async()=>({enabled:true})}},
    cards:()=>({cardAssetBindings:{},cardZipTargets:{reserve:async()=>({path:'stage'})}}),
    foreground:()=>({preview:async()=>['stage']}),start:async()=>{},services(){},requests(){},dispose:async()=>{disposed++}}
  runtime[phase]=()=>{throw Error('init failed')}
  const stage=await createOptionalStage({}, {load:async()=>({createStageRuntime:()=>runtime}),warn(){}})
  const bubbles=stage.assets.dialogueBubbles
  const cards=stage.cards({}),foreground=stage.foreground({})
  await stage.start({});stage.services({});stage.requests({},{});
  assert.equal(stage.status(),'failed');assert.equal(disposed,1)
  assert.equal((await bubbles.read()).enabled,false)
  assert.deepEqual(await foreground.preview({}),[])
  await assert.rejects(cards.cardZipTargets.reserve(),{code:'STAGE_UNAVAILABLE'})
})

test('disabling during asynchronous start fences the old instance while allowing a new one',async()=>{
  let resolve,loads=0,stops=0
  const gate=new Promise(done=>resolve=done)
  const stage=await createOptionalStage({}, {enabled:false,load:async()=>({createStageRuntime(){
    const id=++loads
    return {assets:{dialogueBubbles:{read:async()=>({enabled:true})}},start:async()=>{if(id===1)await gate},services(){},requests(){},dispose:async()=>{stops++}}
  }}),warn(){}})
  await stage.start({});stage.services({});stage.requests({},{})
  const first=stage.enable();await new Promise(done=>setImmediate(done))
  await stage.disable();await stage.enable()
  assert.equal(stage.status(),'ready');assert.equal(loads,2)
  resolve();await first
  assert.equal(stage.status(),'ready');assert.equal(stops,1)
  await stage.dispose();assert.equal(stops,2)
  await assert.rejects(stage.enable(),{code:'STAGE_UNAVAILABLE'})
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createStageHandlers } from '../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js'

// The stage requests that only have a chat ask the card's switch in effect (cardStageSwitch), not the global stageToggles.
function handlers(switches) {
  const asked = [], projected = []
  const chat = { id:'chat', cardPath:'cards/a.json', messages:[], timeline:{ branchId:'main' }, _storageRevision:1 }
  const deps = {
    ctx:{ get:() => null }, asked, projected,
    cardStageSwitch:async (cardPath, key) => { asked.push([cardPath, key]); return switches[key] === true },
    readRoundView:async () => chat, readCardWorkspace:async () => ({ raw:{} }),
    requestPerformance:{ stage:(_name, run) => run() }, figureRuntimes:{ available:async () => false },
    cgGallery:{ project:(_args, run) => run() }, readStageProjection:async input => { projected.push(input.performanceEnabled); return {} },
    assetRuntime:{ revision:0 }, assetEngineSettings:{ read:() => ({ values:{ stageToggles:{ items:true, performance:true } } }) },
    stageDirector:{ get:async () => ({ token:null, modPerformances:[] }) }
  }
  return { ...createStageHandlers(deps), asked, projected }
}

test('a card switched off hides its items and performances even while the global switches are on', async () => {
  const off = handlers({ items:false, performance:false })
  assert.deepEqual(await off.getStageItems({ sessionId:'s', turn:1 }), { enabled:false, records:[], performances:[] })
  await off.getAssetPackPresentation({ sessionId:'s', turn:1 })
  assert.deepEqual(off.projected, [false])
  assert.deepEqual(off.asked, [['cards/a.json', 'items'], ['cards/a.json', 'performance']])
  const on = handlers({ items:true, performance:true })
  await on.getAssetPackPresentation({ sessionId:'s', turn:1 })
  assert.deepEqual(on.projected, [true])
  assert.equal((await on.getStageItems({ sessionId:'s', turn:1 })).enabled, true)
})

// Regression: mid-game the card's skin lost its art and drew its bare box until the stage was left and
// entered again. Reproduced in a debug slot: one figure write to a bound pack (自动选角 drawing a figure) rewrites the
// card's managed worldbook entry, the stage takes that as a new story context (a new branch under the same session and
// authority epoch), and its revocation destroyed every resource of the authority - also the skin bundle the card skin
// (useStageConfigSkin) holds under a key that does not change, so its Blob URLs were dead under it.
// The real store, director source, resource runner and resource owner run as the session binding drives them.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createFakeClock, runtimeSource, runtimePage, runtimeText} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/stage-runtime-store.cjs')
const {createStageDirectorSource} = require('../tavern-plugin/src/client/stage-director-source.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/stage-resource-runner.cjs')
const {createStageResourceOwner} = require('./helpers/stage-resources.cjs')

const settle = async (predicate, message) => {
  for (let i = 0; i < 400; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)) }
  assert.fail(message)
}

function stage(t) {
  const source = runtimeSource({sessionId:'session', turn:3}), clock = createFakeClock(), revoked = []
  const units = [{kind:'narration', text:'Page one'}]
  const target = {sessionId:'session', turn:3, sourceKey:'fixture-3', sourceDigest:'fixture-text', branchId:'fixture-branch'}
  const binding = {target, unitsDigest:'fixture-units-3'}, record = {complete:true, binding, baseline:{}, entries:[], end:{}, digest:'fixture-record-3'}
  const token = {sourceKey:target.sourceKey, branchId:target.branchId, generation:0, bindingKey:'fixture-binding-3', prefixRevision:1, digest:record.digest}
  const envelope = {phase:'done', revision:1, generation:0, target, token, binding, bindingKey:token.bindingKey, prefixRevision:1,
    complete:true, through:1, units, displayUnits:units, record, baseline:{}, entries:[]}
  const skin = {resource:true, kind:'bundle', identity:'pack:skins:agency:h', ref:{packId:'pack', kind:'skins', assetId:'agency'}, revision:'r', hash:'h', bundleKey:'skin-agency'}
  let serial = 0
  const owner = createStageResourceOwner({urls:{createObjectURL:() => 'blob:fixture-' + (++serial), revokeObjectURL:url => revoked.push(url)},
    service:{leaseMedia:async ({hash}) => ({ticket:hash, revision:'r', url:'/media/' + hash}),
      leaseBundle:async ({bundleKey}) => ({ticket:bundleKey, revision:'r', url:'/bundle/' + bundleKey + '/skin.json', resources:['/bundle/' + bundleKey + '/skin.json']}),
      releaseLease() {}},
    // A skin bundle asks for one multipart transfer first; 413 makes it read its files one by one (the fixture's one file).
    fetch:async url => url.includes('?bundle=1') ? new Response('', {status:413}) : new Response('{}', {headers:{'content-type':'application/json'}})})
  const resources = createStageResourceRunner({owner, clock, idle:async () => false, read:async () => ({status:'ready', directionToken:token,
    value:{state:{figureScale:{version:6, scene:0, hMax:150, rescales:0}, lighting:null},
      scene:{background:{resource:true, kind:'media', identity:'bg', ref:{packId:'pack'}, revision:'r', hash:'bg'}, skin:{document:{id:'agency'}, url:skin}},
      characters:[], avatars:[], audio:{music:null, soundscape:null}, widgets:[]}})})
  const director = createStageDirectorSource({clock, onEffect:resources.onEffect, watch:() => () => {}, read:async () => envelope})
  const store = createStageRuntimeStore({runEffect:(...args) => director.runEffect('session', ...args)})
  t.after(() => { store.dispose(); director.dispose(); resources.dispose() })
  const text = {...runtimeText(1, [runtimePage(1)]), units}
  return {source, store, owner, skin, revoked, text, authority:value => JSON.stringify([value.sessionId, value.authorityEpoch])}
}


test('a changed authority still revokes the old authority\'s resources', async t => {
  const h = stage(t)
  h.store.dispatch({type:'TURN_CHANGED', source:h.source, text:h.text})
  h.store.dispatch({type:'STAGE_OPEN', opened:true})
  await settle(() => h.store.getSnapshot().accepted.scene?.skin, 'the scene mounts with its skin')
  const held = await h.owner.acquire(h.skin, h.authority(h.source))
  h.store.dispatch({type:'TURN_CHANGED', source:{...h.source, authorityEpoch:2, branchId:'branch-2', generation:2}, text:h.text})
  await settle(() => h.revoked.includes(held.handle.url), 'the old authority\'s skin bundle is revoked')
  assert.equal(h.owner.isPrepared(h.skin, h.authority(h.source)), false)
  held.release()
})

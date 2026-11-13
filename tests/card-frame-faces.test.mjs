// A chat card frame's window.DshCardFaces.faces reads the card figures' faces the transcript bubbles show.
import {withVoiceCues} from './helpers/voice-cues-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {cardExtension, syntheticPack} from './fixtures/asset-packs/pack.mjs'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'}
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('./helpers/stage-resources.cjs')
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const bubbles = (await read('../tavern-plugin/packages/dsh-tavern-stage/src/client/bubbles.js'))
  .split('// @include-protocol figure-resolution.cjs').join(await read('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs'))
  .split('// @include bubble-line.cjs').join(withVoiceCues(await read('../tavern-plugin/src/client/bubble-line.cjs')))
  .replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
// The frames' faces sit ahead of the frame lifecycle (runtime/message-frame-lifecycle.js).
const lifecycle = await read('../tavern-plugin/src/client/runtime/message-frame-lifecycle.js')
const frameFaces = lifecycle.slice(0, lifecycle.indexOf('const TAVERN_FRAME_MAX_HEIGHT'))

function host(config, {session = {getSnapshot:() => ({source:{sessionId:'session', authorityEpoch:1}})}, cacheSession = 'session', owner: withOwner = true} = {}) {
  const requests = [], releases = [], prepared = [], selected = [], revisions = []
  const service = {async leaseMedia(args) { requests.push(args); return {revision:'r1', url:'/media/' + args.hash, ticket:args.hash} }, releaseLease:ticket => releases.push(ticket)}
  const owner = createStageResourceOwner({service, fetch:async () => new Response('image', {headers:{'content-type':'image/png'}}), urls:{createObjectURL:() => 'blob:lease', revokeObjectURL() {}}})
  const context = {packListeners:new Set(), queueMicrotask, packTransport:{service},
    stageSessions:{resourceOwner:withOwner ? owner : null, get:() => session},
    avatarCache:{get:() => null, ready:() => null, sessionId:cacheSession, select:id => { selected.push(id) }, revision:(pack, revision) => { revisions.push([pack, revision]) }, prepare:async (face, url, px) => { prepared.push({face, url, px}); return 'blob:cache:' + face.identity }},
    bubbleStore:{get:() => ({config})}, fetch:async url => new Response(url)}
  vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + '\n'
    + bubbles.slice(bubbles.indexOf('function bubbleMediaDescriptor'), bubbles.indexOf('// Transcript and stage pin the same')) + '\n'
    + bubbles.slice(bubbles.indexOf('const bubbleMediaPool'), bubbles.indexOf('// observe against the transcript')) + '\n' + frameFaces, context)
  return {context, requests, releases, prepared, selected, revisions, stop:() => owner.dispose()}
}

test('a chat card frame gets the face the transcript bubble shows, and nothing for a name without a figure', async () => {
  const pack = await syntheticPack(); pack.revision = 'r1'
  const character = cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}}, defaultAssetEngineSettings(), [pack]).characters[0]
  const h = host({characters:[character]})
  const faces = await h.context.bubbleCardFaceBlobs('session', [character.name, 'nobody', character.name])
  assert.deepEqual([...faces.map(row => row.name)], [character.name])
  assert.equal(await faces[0].blob.text(), 'blob:cache:' + character.avatarMedia.default.identity)
  // The descriptor the transcript row's avatar uses (useBubbleMedia → bubbleMediaDescriptor), leased once and released.
  assert.equal(h.prepared[0].face.identity, h.context.bubbleMediaDescriptor(character, 'calm', moods).identity)
  assert.equal(h.prepared[0].face.sessionId, 'session')
  assert.deepEqual(h.requests.map(row => row.hash), [character.avatarMedia.default.hash])
  assert.equal(h.releases.length, 1)
  h.stop()
})

test('a card without bubble settings gives a frame no faces', async () => {
  const h = host(null)
  assert.equal((await h.context.bubbleCardFaceBlobs('session', ['Alice'])).length, 0)
  h.stop()
})

test('with the stage off the frame binds the avatar cache itself and still gets the face', async () => {
  const pack = await syntheticPack(); pack.revision = 'r1'
  const character = cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}}, defaultAssetEngineSettings(), [pack]).characters[0]
  const h = host({characters:[character]}, {session:null, cacheSession:null, owner:false})
  const faces = await h.context.bubbleCardFaceBlobs('session', [character.name])
  assert.deepEqual([...faces.map(row => row.name)], [character.name])
  assert.deepEqual(h.selected, ['session'])
  assert.deepEqual(h.revisions, [[character.avatarMedia.default.ref.packId, 'r1']])
  h.stop()
})

test('with the stage up but its session not yet holding authority the face waits for it', async () => {
  const pack = await syntheticPack(); pack.revision = 'r1'
  const character = cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}}, defaultAssetEngineSettings(), [pack]).characters[0]
  let source = null; const listeners = new Set()
  const h = host({characters:[character]}, {session:{getSnapshot:() => ({source}), subscribe:listener => { listeners.add(listener); return () => listeners.delete(listener) }}})
  const asked = h.context.bubbleCardFaceBlobs('session', [character.name])
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(h.requests.length, 0)
  source = {sessionId:'session', authorityEpoch:1}; listeners.forEach(listener => listener())
  assert.equal((await asked).length, 1)
  assert.equal(listeners.size, 0)
  h.stop()
})
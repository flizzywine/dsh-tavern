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

function host(config, {session = {getSnapshot:() => ({source:{sessionId:'session', authorityEpoch:1}})}, bound = () => true, subscribe = () => () => {}} = {}) {
  const requests = [], releases = [], prepared = []
  const service = {async leaseMedia(args) { requests.push(args); return {revision:'r1', url:'/media/' + args.hash, ticket:args.hash} }, releaseLease:ticket => releases.push(ticket)}
  const owner = createStageResourceOwner({service, fetch:async () => new Response('image', {headers:{'content-type':'image/png'}}), urls:{createObjectURL:() => 'blob:lease', revokeObjectURL() {}}})
  const context = {packListeners:new Set(), queueMicrotask,
    stageSessions:{resourceOwner:owner, get:() => session},
    avatarCache:{get:() => null, ready:() => null, valid:bound, subscribe, prepare:async (face, url, px) => { prepared.push({face, url, px}); return 'blob:cache:' + face.identity }},
    bubbleStore:{get:() => ({config})}, fetch:async url => new Response(url)}
  vm.runInNewContext(bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings')) + '\n'
    + bubbles.slice(bubbles.indexOf('function bubbleMediaDescriptor'), bubbles.indexOf('// Transcript and stage pin the same')) + '\n'
    + bubbles.slice(bubbles.indexOf('const bubbleMediaPool'), bubbles.indexOf('// observe against the transcript')) + '\n' + frameFaces, context)
  return {context, requests, releases, prepared, stop:() => owner.dispose()}
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

test('a frame asking for faces before the stage is up gets them once the avatar cache and the stage session are ready', async () => {
  const pack = await syntheticPack(); pack.revision = 'r1'
  const character = cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}}, defaultAssetEngineSettings(), [pack]).characters[0]
  let bound = false, source = null; const cacheListeners = new Set(), sessionListeners = new Set()
  const h = host({characters:[character]}, {bound:() => bound,
    subscribe:listener => { cacheListeners.add(listener); return () => cacheListeners.delete(listener) },
    session:{getSnapshot:() => ({source}), subscribe:listener => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) }}})
  const asked = h.context.bubbleCardFaceBlobs('session', [character.name])
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(h.requests.length, 0)
  bound = true; cacheListeners.forEach(listener => listener())
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(h.requests.length, 0)
  source = {sessionId:'session', authorityEpoch:1}; sessionListeners.forEach(listener => listener())
  const faces = await asked
  assert.deepEqual([...faces.map(row => row.name)], [character.name])
  assert.equal(h.requests.length, 1)
  assert.equal(cacheListeners.size + sessionListeners.size, 0)
  h.stop()
})
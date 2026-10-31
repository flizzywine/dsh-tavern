import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageMusic} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/music.cjs')
test('unloading music releases subscriptions and fences a late decode', async () => {
  let resolveDecode, voices = 0, policy = 0, subscriptions = 0, reads = 0
  const context = {decodeAudioData:() => new Promise(resolve => {resolveDecode=resolve}),removeEventListener(){}}
  const player = createStageMusic({
    audio:{musicContext:() => context,musicVoice:() => {voices++},subscribe:() => {subscriptions++;return () => {subscriptions--}},get:() => ({music:1,muted:{}})},
    foreground:{subscribeAudio:() => {policy++;return () => {policy--}},clearTimeout(){}},
    AbortController,
    fetch:async () => {reads++;return {ok:true,arrayBuffer:async () => new ArrayBuffer(0)}},
  })
  player.subscribe(() => {})
  const done = player.play('track')
  for (let i=0;i<8 && !resolveDecode;i++) await Promise.resolve()
  assert.equal(typeof resolveDecode,'function')
  player.dispose();player.dispose()
  await done
  resolveDecode({duration:1,numberOfChannels:1,length:1})
  await Promise.resolve();await Promise.resolve()
  player.play('another')
  player.subscribe(() => {})
  assert.equal(voices,0)
  assert.equal(reads,1)
  assert.equal(policy,0)
  assert.equal(subscriptions,0)
  assert.equal(player.get().current,'')
})

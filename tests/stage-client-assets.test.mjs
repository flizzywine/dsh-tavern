import test from 'node:test'
import assert from 'node:assert/strict'
import {createTavernClientAssets, TAVERN_CLIENT_ASSET_PREFIX} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
import {readStageClientChunk, registerStageClientAssets} from '../tavern-plugin/packages/dsh-tavern-stage/lib/client-assets.js'
const url = TAVERN_CLIENT_ASSET_PREFIX + 'skin-overlay.mjs'

test('stage owns its executable chunk across repeated registration and disposal', async () => {
  const assets = createTavernClientAssets()
  assert.equal(await assets.read(url), undefined)
  for (let cycle = 0; cycle < 2; cycle++) {
    const stop = registerStageClientAssets(assets)
    const result = await assets.read(url)
    assert.equal(result.mediaType, 'text/javascript; charset=utf-8')
    assert.match(result.body.toString(), /export \{createSkinOverlayPlayer,createDecorativeScript\}/)
    // The stage client itself is the stage's asset too: the core imports it only for a session that needs the stage.
    const client = await assets.read(TAVERN_CLIENT_ASSET_PREFIX + 'stage-client.mjs')
    assert.equal(client.mediaType, 'text/javascript; charset=utf-8')
    assert.match(client.body.toString(), /\nexport default stageClientPlugin;\n?$/)
    assert.throws(() => registerStageClientAssets(assets), /already registered/)
    stop(); stop()
    assert.equal(await assets.read(url), undefined)
    assert.equal(await assets.read(TAVERN_CLIENT_ASSET_PREFIX + 'stage-client.mjs'), undefined)
  }
  for (const name of ['../skin-overlay.mjs','%2e%2e/skin-overlay.mjs','constructor','__proto__']) {
    assert.equal(await assets.read(TAVERN_CLIENT_ASSET_PREFIX + name), undefined)
  }
})

test('a lazy chunk reads by its asset name, the same bytes the registry serves', async () => {
  const chunk = await readStageClientChunk('skin-overlay.mjs')
  assert.ok(Object.isFrozen(chunk))
  assert.equal(chunk.mediaType, 'text/javascript; charset=utf-8')
  const assets = createTavernClientAssets()
  const stop = registerStageClientAssets(assets)
  assert.deepEqual((await assets.read(url)).body, chunk.body)
  stop()
  // Only the lazy chunks: the stage client itself and any other name are not chunks.
  for (const name of ['stage-client.mjs','../skin-overlay.mjs','constructor','__proto__']) assert.equal(await readStageClientChunk(name), undefined)
})

test('a disposed asset read cannot publish old code into a new registration', async () => {
  const assets = createTavernClientAssets()
  let finish
  const stop = assets.register('test.mjs', {mediaType:'text/javascript; charset=utf-8',read:() => new Promise(resolve => {finish = resolve})})
  const pending = assets.read(TAVERN_CLIENT_ASSET_PREFIX + 'test.mjs')
  stop()
  const next = assets.register('test.mjs', {mediaType:'text/javascript; charset=utf-8',read:async () => Buffer.from('new')})
  stop()
  finish(Buffer.from('old'))
  assert.equal(await pending, undefined)
  assert.equal((await assets.read(TAVERN_CLIENT_ASSET_PREFIX + 'test.mjs')).body.toString(), 'new')
  next()
})

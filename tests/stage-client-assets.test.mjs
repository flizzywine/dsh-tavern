import test from 'node:test'
import assert from 'node:assert/strict'
import {createTavernClientAssets, TAVERN_CLIENT_ASSET_PREFIX} from '../tavern-plugin/lib/domain/tavern-client-assets.js'
const url = TAVERN_CLIENT_ASSET_PREFIX + 'skin-overlay.mjs'

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

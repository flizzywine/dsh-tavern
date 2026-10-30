import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('retained pure layered sprite manifest subset matches the maintained parser without renderer code', async () => {
  const source = await readFile(new URL('../../../src/client/layered-sprite.cjs', import.meta.url), 'utf8')
  const subset = await readFile(new URL('../src/shared/layered-sprite.cjs', import.meta.url), 'utf8')
  assert.equal(subset, source.slice(0, source.indexOf('function layeredSpriteAtlas(')) + 'module.exports = { layeredSpriteManifest, layeredSpriteMapAssets, layeredSpriteAssets, layeredSpriteState };\n')
})

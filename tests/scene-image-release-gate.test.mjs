import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TAVERN_RELEASE_CAPABILITIES } from '../tavern-plugin/lib/domain/release-capabilities.js'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

test('scene images are available through the release capability', () => {
  assert.equal(TAVERN_RELEASE_CAPABILITIES.sceneImages, true)
})

test('closed scene images do not start a runtime or mount client request sources', () => {
  assert.match(server, /TAVERN_RELEASE_CAPABILITIES\.sceneImages \? createSceneIllustrations/)
  assert.match(server, /TAVERN_RELEASE_CAPABILITIES\.sceneImages && req\.method === 'GET' && pathname === '\/api\/dsh-tavern\/scene-image'/)
  assert.match(client, /sceneImagesEnabled && settled && projection/)
  assert.match(client, /state\.sceneImages \? React\.createElement\(SceneImageSettings/)
  assert.match(client, /releaseCapabilities\.sceneImages \? React\.createElement\(SceneImageAction/)
})

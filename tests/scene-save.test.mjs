import assert from 'node:assert/strict'
import test from 'node:test'
import { sceneSaveKeyMap } from '../tavern-plugin/lib/domain/scene-save.js'
import { computeSceneTarget } from '../tavern-plugin/lib/domain/scene-illustration.js'
import { sceneSlotKey, SCENE_EXTRA_SLOTS } from '../tavern-plugin/lib/domain/scene-slots.js'
import { buildGameSave, readGameSave } from '../tavern-plugin/lib/domain/game-save.js'

test('存档中的首图、所有新增插图和历史正文图片都映射到新游戏', () => {
  const chat = { id: 'old', messages: [{ role: 'assistant', turn: 1, text: 'new body' }] }
  const history = { ...chat, messages: [{ role: 'assistant', turn: 1, text: 'old body' }] }
  const files = [chat, history].flatMap(state => Array.from({ length: SCENE_EXTRA_SLOTS + 1 }, (_, slot) => {
    const key = sceneSlotKey(computeSceneTarget(state, 1).key, slot)
    return { path: key + '.json', content: JSON.stringify({ key, slot }) }
  }))
  const save = readGameSave(buildGameSave({ chat, revisions: [{ revision: 1, state: history }], session: {},
    scene: { files, worldbooks: [], attachments: [] } }))
  const map = sceneSaveKeyMap([save.chat, ...save.revisions.map(item => item.state)], 'new')
  for (const [stateIndex, state] of [chat, history].entries()) {
    for (let slot = 0; slot <= SCENE_EXTRA_SLOTS; slot++) {
      const file = save.scene.files[stateIndex * (SCENE_EXTRA_SLOTS + 1) + slot]
      const old = JSON.parse(file.content)
      const expected = sceneSlotKey(computeSceneTarget({ ...state, id: 'new' }, 1).key, slot)
      assert.equal(map.get(old.key), expected)
      assert.equal(map.get(file.path.slice(0, -5)) + '.json', expected + '.json')
    }
  }
})

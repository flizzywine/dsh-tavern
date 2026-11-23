import test from 'node:test'
import assert from 'node:assert/strict'
import { publicBodyMaterials } from '../tavern-plugin/lib/domain/body-generation-materials.js'

const materials = { gameId: 'game', target: { kind: 'generate', operationId: 'op', revision: 123 },
  input: { raw: 'input', projected: 'processed input' }, card: { name: '角色' }, persona: { name: '玩家' },
  cardContext: '<character_card>\n人物设定\n</character_card>', worldbook: { context: '世界书' },
  beforeState: { variables: { hp: 1 } }, generationState: { variables: { hp: 2 }, messageVariables: { n: 3 }, posture: '状态' }, history: [] }

test('public materials expose prepared state and separate context, not transaction internals', () => {
  const dto = publicBodyMaterials(materials)
  assert.deepEqual(dto.state, { variables: { hp: 2 }, messageVariables: { n: 3 }, status: '状态' })
  assert.equal(dto.reason, 'normal')
  assert.deepEqual(dto.input, { raw: 'input', text: 'processed input' })
  assert.deepEqual(dto.context.map(item => item.kind), ['character', 'worldbook'])
  assert.equal(dto.target, undefined)
  assert.equal(dto.beforeState, undefined)
  dto.state.variables.hp = 0
  assert.equal(materials.generationState.variables.hp, 2)
  assert.equal(publicBodyMaterials({ ...materials, target: { kind: 'failed' } }).reason, 'retry')
})

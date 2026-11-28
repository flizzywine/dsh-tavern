import assert from 'node:assert/strict'
import test from 'node:test'

import { migrateCardSnapshots } from '../tavern-plugin/lib/domain/live-card-update.js'
import { validateMvuLimits } from '../tavern-plugin/lib/domain/mvu-limits.js'
import { createMvuWriteGate } from '../tavern-plugin/lib/domain/mvu-write-gate.js'
import { createPluginVariableWriter } from '../tavern-plugin/lib/domain/plugin-variables.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

// Every host write of MVU variables passes the card's write gate (tavern-plugin/lib/domain/mvu-write-gate.js).
const card = { 好感: 10, 体力: '2/3', 资质: 1, $meta: { limits: { 好感: { min: 0, max: 100, clamp: true }, 体力: { meter: true }, 资质: { min: 0, integer: true } } } }
const gateOf = (ownedPaths = []) => createMvuWriteGate({ limits: validateMvuLimits(card).normalized, ownedPaths })
const floor = statData => ({ stat_data: statData, schema: {} })

function adapterHarness({ owned = [], start = { 好感: 10, 体力: '2/3', 资质: 1 } } = {}) {
  let chat = { id: 'chat', sessionId: 's', mode: 'story', mvu: { enabled: true, owner: 'official' }, tavernHelperLifecycleRevision: 0,
    messages: [{ role: 'assistant', greeting: true, swipeId: 0, variables: [floor({ 好感: 10, 体力: '2/3', 资质: 1 })] },
      { role: 'user', text: '继续' }, { role: 'assistant', turn: 1, swipeId: 0, variables: [floor(structuredClone(start))] }] }
  const records = []
  const adapter = createTavernScriptHostAdapter({
    resolveChat: async () => structuredClone(chat), writeChat: async value => { chat = structuredClone(value) },
    readCard: async () => ({}), worldBooks: { bound: async () => null }, scriptDispatch: {},
    diagnostics: { record: async (_id, value) => { records.push(value) } },
    variableGate: async () => gateOf(owned)
  })
  return { adapter, records, saved: () => chat.messages[2].variables[0].stat_data }
}

test('page scripts and the panel: a break saves nothing and names it, a clamp limit saves the value brought back', async () => {
  const { adapter, records, saved } = adapterHarness({ owned: ['/资质'] })
  await assert.rejects(adapter.updateVariables('s', { type: 'message', message_id: 2 }, floor({ 好感: 10, 体力: '4/3', 资质: 1 })),
    error => error.code === 'DSH_MVU_WRITE_REJECTED' && /体力/.test(error.message))
  assert.equal(saved().体力, '2/3')
  assert.equal(records.at(-1).stage, 'variable-write-rejected')
  // A rule-owned path: a page script may not write it, the player's panel may.
  await assert.rejects(adapter.updateVariables('s', { type: 'message', message_id: 2 }, floor({ 好感: 10, 体力: '2/3', 资质: 2 })), /归规则管/)
  const panel = await adapter.updateVariables('s', { type: 'message', message_id: 2 }, floor({ 好感: 130, 体力: '2/2', 资质: 2 }), undefined, undefined, undefined, 'panel')
  assert.deepEqual(saved(), { 好感: 100, 体力: '2/2', 资质: 2 })
  assert.deepEqual(panel.clamped, [{ path: '/stat_data/好感', from: 130, to: 100 }])
  // An old bad value elsewhere does not block a fix of another.
  const old = adapterHarness({ start: { 好感: 10, 体力: '2/3', 资质: 1.5 } })
  await old.adapter.updateVariables('s', { type: 'message', message_id: 2 }, floor({ 好感: 20, 体力: '2/3', 资质: 1.5 }), undefined, undefined, undefined, 'panel')
  assert.equal(old.saved().好感, 20)
})

test('setChatMessages: data and swipes_data replace a floor\'s variables through the same gate', async () => {
  const { adapter, saved } = adapterHarness()
  await assert.rejects(adapter.updateMessages('s', [{ message_id: 2, data: floor({ 好感: 10, 体力: '2/3', 资质: 0.5 }) }]), /整数/)
  await assert.rejects(adapter.updateMessages('s', [{ message_id: 2, swipes_data: [floor({ 好感: 10, 体力: '9/3', 资质: 1 })] }]), /体力/)
  assert.equal(saved().资质, 1)
})

test('plugins write as plugin: refused the rule-owned paths and checked against the limits', async () => {
  let row = { role: 'assistant', turn: 3, swipeId: 0, variables: [floor({ 好感: 10, 体力: '2/3', 资质: 1 })] }
  const writer = createPluginVariableWriter({
    readState: async () => ({ sessionId: 's', _storageRevision: 1, messages: [{ role: 'user' }, row] }),
    readSlice: async () => ({ chat: { id: 'chat', _storageRevision: 1, messages: [structuredClone(row)] } }),
    activity: () => null, generating: () => false, currentKey: async () => 'k',
    patch: async (_id, _revision, changes) => { row = { ...row, variables: changes[0].value }; return {} },
    gate: async () => gateOf(['/资质'])
  })
  const material = { sessionId: 's', index: 1, turn: 3, key: 'k' }
  await assert.rejects(writer(material, floor({ 好感: 10, 体力: '2/3', 资质: 5 })), /归规则管/)
  await writer(material, floor({ 好感: -4, 体力: '3/3', 资质: 1 }))
  assert.deepEqual(row.variables[0].stat_data, { 好感: 0, 体力: '3/3', 资质: 1 })
})

test('card update migration: meter joins current and cap into one value, and the result passes the gate as migration', () => {
  const defaults = { 资质保证: '0/9', $meta: { limits: { 资质保证: { meter: true, max: 9 } } } }
  const chat = { messages: [{ variables: [{ stat_data: { 当前资质保证: 3, 资质保证上限: 5 }, schema: { properties: { 当前资质保证: {}, 资质保证上限: {} } } }] }] }
  const plan = { id: 'qa-meter', operations: [{ op: 'meter', current: '/当前资质保证', cap: '/资质保证上限', path: '/资质保证' }] }
  assert.equal(migrateCardSnapshots(chat, defaults, [plan]), 1)
  assert.deepEqual(chat.messages[0].variables[0].stat_data, { 资质保证: '3/5' })
  assert.equal(chat.messages[0].variables[0].schema.properties.当前资质保证, undefined)

  const broken = { messages: [{ variables: [{ stat_data: { 当前资质保证: 3, 资质保证上限: 12 }, schema: {} }] }] }
  assert.throws(() => migrateCardSnapshots(broken, defaults, [plan]), /变量没有保存：.*资质保证/)
})


import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createIncrementalJsonState} from '../tavern-plugin/lib/domain/incremental-json-state.js'
import {diffJson} from '../tavern-plugin/lib/domain/json-mutation.js'
import {createNativeConversationStorage} from '../tavern-plugin/lib/domain/native-conversation-storage.js'

function tree() {
  const blocks = new Map()
  return createIncrementalJsonState({
    write: async value => {
      const json = JSON.stringify(value)
      const ref = createHash('sha256').update(json).digest('hex')
      blocks.set(ref, json)
      return ref
    },
    read: async ref => JSON.parse(blocks.get(ref))
  })
}

const pointer = path => path.length ? '/' + path.map(part => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : ''

test('diffJson keeps changes inside the lossless JSON contract', async () => {
  const before = {regenRecovery: null, values: {kept: 1, missing: 'old', nan: 1, when: null}}
  const after = {
    regenRecovery: {phase: 'committed', projection: {data: {source: {kind: 'model', trace: undefined}}}},
    values: {kept: 1, missing: undefined, nan: NaN, when: new Date('2020-01-01T00:00:00.000Z')}
  }
  const changes = diffJson(before, after)
  const state = tree()
  const root = await state.create(before)
  const wire = changes.map(change => ({
    ...change,
    op: change.op === 'delete' ? 'remove' : change.op,
    path: pointer(change.path)
  }))
  const applied = await state.apply(root, wire)
  assert.deepEqual(await state.get(applied.nextRoot), JSON.parse(JSON.stringify(after)))
})

test('diffJson reports values JSON cannot serialize at all instead of leaking a storage code', () => {
  assert.throws(() => diffJson({}, {big: 1n}), /可序列化/)
})

test('native storage accepts a first write with values JSON cannot express', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'native-json-values-'))
  t.after(() => rm(dataRoot, {recursive: true, force: true}))
  const storage = createNativeConversationStorage({dataRoot})
  const chat = {
    id: 'c', sessionId: 's', _storageRevision: 1, mode: 'story',
    messages: [{role: 'assistant', turn: 1, text: 'body', source: {kind: 'model', trace: undefined}}],
    variables: {gold: NaN}
  }
  await storage.create('c', chat)
  const saved = (await storage.read('c')).chat
  assert.deepEqual(saved.messages[0].source, {kind: 'model'})
  assert.equal(saved.variables.gold, null)
})

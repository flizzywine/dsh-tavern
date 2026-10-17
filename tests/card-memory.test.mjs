import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCardMemory } from '../tavern-plugin/packages/dsh-tavern-card-memory/index.js'

async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'tavern-memory-中文 空格-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return { dataRoot, memory: createCardMemory({ dataRoot }), chat: { id: 'card-editor', mode: 'card', cardPath: 'cards/中文 卡片.json', sessionId: 'session-a' } }
}

test('real Mnemon preferences persist, deduplicate, replace and remove across sessions', async t => {
  const { dataRoot, memory, chat } = await fixture(t)
  await memory.preference(chat, { action: 'add', content: '保留原卡结构，不重写开场白' })
  await memory.preference(chat, { action: 'add', content: '保留原卡结构，不重写开场白' })
  const reopened = createCardMemory({ dataRoot })
  assert.deepEqual((await reopened.search({ ...chat, sessionId: 'new' })).preferences, ['保留原卡结构，不重写开场白'])
  await reopened.preference(chat, { action: 'replace', oldText: '保留原卡结构，不重写开场白', content: '只改用户指定字段' })
  await assert.rejects(reopened.preference(chat, { action: 'remove', oldText: '保留原卡结构，不重写开场白' }), /偏好已改变/)
  await reopened.preference(chat, { action: 'remove', oldText: '只改用户指定字段' })
  assert.deepEqual((await reopened.search(chat)).preferences, [])
})

test('card-specific errors never leak to other cards; shared experience is searchable and can be archived', async t => {
  const { dataRoot, memory, chat } = await fixture(t)
  const privateRow = await memory.experience(chat, { title: '中文状态栏空白', problem: '本卡金币字段错了', status: 'unverified' })
  const sharedRow = await memory.experience(chat, { scope: 'shared', title: '状态栏验证流程', problem: '静态校验不足', solution: '浏览器实测', status: 'unverified' })
  const other = { ...chat, cardPath: 'cards/另一张.json' }
  const reopened = createCardMemory({ dataRoot })
  const found = await reopened.search(other, '状态栏')
  assert.deepEqual(found.experiences.map(row => row.id), [sharedRow.document.id])
  await assert.rejects(reopened.experience(other, { id: privateRow.document.id, title: '越界更新' }))
  await assert.rejects(reopened.experience(other, { action: 'archive', id: privateRow.document.id }))
  await reopened.experience(other, { scope: 'shared', action: 'archive', id: sharedRow.document.id })
  assert.deepEqual((await reopened.search(other, '状态栏')).experiences, [])
  assert.equal((await reopened.search(chat, '金币')).experiences[0].id, privateRow.document.id)
})

test('validation failures are deduplicated and successful static checks do not invent a verified fix', async t => {
  const { memory, chat } = await fixture(t)
  const failure = { valid: false, errors: [{ path: '/data', message: '人物卡 data 必须是对象' }] }
  await Promise.all([memory.recordValidation(chat, chat.cardPath, failure), memory.recordValidation(chat, chat.cardPath, failure)])
  await memory.recordValidation(chat, chat.cardPath, { valid: true, errors: [] })
  const rows = (await memory.search(chat, '对象')).experiences
  assert.equal(rows.length, 1)
  assert.equal(JSON.parse(rows[0].content).status, 'unverified')
  assert.equal(JSON.parse(rows[0].content).recordedBy, 'tavern_validate_card')
  await assert.rejects(memory.experience(chat, { title: '已修复', status: 'runtime-verified' }), /验证依据/)
})

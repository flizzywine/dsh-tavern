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

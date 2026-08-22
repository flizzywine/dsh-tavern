import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createBoundaryPromptModule, normalizeBoundaryPromptFilename } from '../tavern-plugin/lib/domain/boundary-prompts.js'

async function harness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-boundary-'))
  const chats = new Map([
    ['play-1', { id: 'chat-1', sessionId: 'play-1', mode: 'story', updatedAt: 0 }],
    ['card-1', { id: 'chat-2', sessionId: 'card-1', mode: 'card', updatedAt: 0 }]
  ])
  let clock = 123
  const module = createBoundaryPromptModule({
    directory,
    defaults: [{ filename: 'DeepSeek-V4-Flash-推荐.md', text: '默认推荐提示' }],
    readChat: async (sessionId) => chats.has(sessionId) ? structuredClone(chats.get(sessionId)) : undefined,
    writeChat: async (chat) => { chats.set(chat.sessionId, structuredClone(chat)) },
    now: () => clock++
  })
  return {
    module,
    chats,
    directory,
    cleanup: async () => { await rm(directory, { recursive: true, force: true }) }
  }
}

test('一个 Markdown 文件就是一个方案，正文按原样保存', async () => {
  const value = await harness()
  try {
    const text = '  第一段\n\n第二段  '
    const file = await value.module.write({ name: '自用方案', text })
    assert.equal(file.filename, '自用方案.md')
    assert.equal(file.text, text)
    assert.equal(await readFile(path.join(value.directory, '自用方案.md'), 'utf8'), text)
    assert.deepEqual(new Set((await value.module.list()).map((item) => item.filename)), new Set(['DeepSeek-V4-Flash-推荐.md', '自用方案.md']))
  } finally { await value.cleanup() }
})

test('内置推荐文件首次创建、默认关闭，删除后不会自动重建', async () => {
  const value = await harness()
  try {
    assert.deepEqual(await value.module.selection('play-1'), { enabled: false, filename: '', file: null, lastInjection: null })
    assert.equal((await value.module.read('DeepSeek-V4-Flash-推荐.md')).text, '默认推荐提示')
    await value.module.remove('DeepSeek-V4-Flash-推荐.md')
    assert.equal(await value.module.read('DeepSeek-V4-Flash-推荐.md'), null)
  } finally { await value.cleanup() }
})

test('同名文件必须明确覆盖，且只允许安全 Markdown 文件名', async () => {
  const value = await harness()
  try {
    await value.module.write({ name: '方案一', text: '第一版' })
    await assert.rejects(value.module.write({ name: '方案一', text: '第二版' }), /明确覆盖/)
    const changed = await value.module.write({ filename: '方案一.md', text: '第二版', overwrite: true })
    assert.equal(changed.text, '第二版')
    assert.throws(() => normalizeBoundaryPromptFilename('../escape.md'), /不合法/)
    assert.throws(() => normalizeBoundaryPromptFilename('方案.json'), /Markdown/)
  } finally { await value.cleanup() }
})

test('当前会话选择一个文件后，全部模型任务解析同一正文', async () => {
  const value = await harness()
  try {
    const file = await value.module.write({ name: '全局方案', text: '全局提示' })
    await value.module.select({ sessionId: 'play-1', enabled: true, filename: file.filename })
    assert.deepEqual(await value.module.resolve({ sessionId: 'play-1', operation: 'body' }), { filename: file.filename, text: '全局提示' })
    assert.deepEqual(await value.module.resolve({ sessionId: 'play-1', operation: 'candidate' }), { filename: file.filename, text: '全局提示' })
    await value.module.select({ sessionId: 'card-1', enabled: true, filename: file.filename })
    assert.equal((await value.module.resolve({ sessionId: 'card-1', operation: 'card' })).text, '全局提示')
  } finally { await value.cleanup() }
})

test('删除已选择文件后会话自动停止注入', async () => {
  const value = await harness()
  try {
    const file = await value.module.write({ name: '临时方案', text: '临时提示' })
    await value.module.select({ sessionId: 'play-1', enabled: true, filename: file.filename })
    await value.module.remove(file.filename)
    assert.equal(await value.module.resolve({ sessionId: 'play-1', operation: 'body' }), null)
    assert.deepEqual(await value.module.selection('play-1'), { enabled: false, filename: '', file: null, lastInjection: null })
  } finally { await value.cleanup() }
})

test('记录实际注入的文件和任务', async () => {
  const value = await harness()
  try {
    const file = await value.module.write({ name: '记录方案', text: '记录提示' })
    await value.module.select({ sessionId: 'play-1', enabled: true, filename: file.filename })
    await value.module.recordInjection({ sessionId: 'play-1', filename: file.filename, operation: 'candidate', turn: 7 })
    assert.deepEqual((await value.module.selection('play-1')).lastInjection, { filename: file.filename, operation: 'candidate', turn: 7, at: 125 })
  } finally { await value.cleanup() }
})

test('用户直接修改文件后，下一次解析读取最新正文', async () => {
  const value = await harness()
  try {
    const file = await value.module.write({ name: '外部编辑', text: '旧内容' })
    await value.module.select({ sessionId: 'play-1', enabled: true, filename: file.filename })
    await writeFile(path.join(value.directory, file.filename), '用户直接修改的新内容')
    assert.equal((await value.module.resolve({ sessionId: 'play-1' })).text, '用户直接修改的新内容')
  } finally { await value.cleanup() }
})

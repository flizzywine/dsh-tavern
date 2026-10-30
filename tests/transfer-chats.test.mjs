import assert from 'node:assert/strict'
import test from 'node:test'

import { createTransferChats } from '../tavern-plugin/lib/domain/transfer-chats.js'

// Games as the conversation registry lists them, plus one imported SillyTavern line.
const SESSIONS = [
  { id: 'chat-story', sessionId: 'session-story', title: '作家 · 第 3 章', cardName: '作家', mode: 'story', requestMode: 'tavern', updatedAt: 3 },
  { id: 'chat-untitled', sessionId: 'session-untitled', title: '', cardName: '侦探', mode: 'story', requestMode: 'tavern', updatedAt: 2 },
  { id: 'chat-no-card', sessionId: 'session-no-card', cardName: '', mode: 'story', requestMode: 'tavern', updatedAt: 1 },
  { id: 'chat-st', sessionId: 'session-st', title: '导入的 SillyTavern 线', cardName: '作家', mode: 'story', requestMode: 'sillytavern', updatedAt: 0 }
]

const CHATS = {
  'chat-story': {
    id: 'chat-story',
    messages: [
      { role: 'user', content: '第三章开始' },
      { role: 'assistant', content: '夜里下起了雨。' },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '他把信折好。' },
      { role: 'assistant', content: '灯灭了。' }
    ]
  },
  'chat-no-card': { id: 'chat-no-card', messages: [] }
}

function saveBytes(name) {
  return Buffer.from('DSHSAVE:' + name + '\u0000binary', 'utf8')
}

function environment(options = {}) {
  const exports = []
  const imports = []
  const chats = options.chats || CHATS
  const deps = {
    async listSessions() { return options.sessions || SESSIONS },
    async readChat(chatId) {
      if (options.readChat) return await options.readChat(chatId)
      return chats[chatId]
    },
    async exportSave(sessionId, exportOptions) {
      exports.push({ sessionId, options: exportOptions })
      if (sessionId === 'session-broken') throw new Error('场景配图读取失败')
      const bytes = saveBytes(sessionId)
      const filename = options.filename ? options.filename(sessionId) : '作家_第_3_章.dshsave'
      return { filename, base64: bytes.toString('base64'), bytes: bytes.length, revisions: 2, images: 1 }
    },
    async importSave(args) {
      imports.push(args)
      return { chatId: 'chat-imported', sessionId: 'session-imported', cardPath: 'cards/作家.json', title: '作家 · 第 3 章（导入）', revisions: 2, images: 1 }
    }
  }
  return { deps, exports, imports }
}

test('list 过滤 SillyTavern 对话并带上轮次与人物卡', async () => {
  const { deps } = environment()
  const chats = createTransferChats(deps)
  const items = await chats.list()

  assert.deepEqual(items.map(item => item.key), ['chat-story', 'chat-untitled', 'chat-no-card'])
  assert.deepEqual(items[0], { key: 'chat-story', title: '作家 · 第 3 章', meta: '3 轮 · 作家', bytes: 0 })
  // 读不到对话：轮次未知，标题回退到人物卡。
  assert.deepEqual(items[1], { key: 'chat-untitled', title: '侦探', meta: '轮次未知 · 侦探', bytes: 0 })
  // 既没有标题也没有人物卡。
  assert.deepEqual(items[2], { key: 'chat-no-card', title: '未命名对话', meta: '0 轮', bytes: 0 })
  assert.equal(items.some(item => item.key === 'chat-st'), false)
})

test('list 在对话记录抛错时不假装知道轮次', async () => {
  const { deps } = environment({ readChat: () => { throw new Error('对话文件损坏') } })
  const items = await createTransferChats(deps).list()
  assert.equal(items[0].meta, '轮次未知 · 作家')
})

test('collect 用 base64 还原出与导出一致的 Buffer，并保留文件名', async () => {
  const { deps, exports } = environment()
  const chats = createTransferChats(deps)
  const items = await chats.collect(['chat-story'])

  assert.equal(items.length, 1)
  assert.equal(items[0].key, 'chat-story')
  assert.equal(items[0].title, '作家 · 第 3 章')
  assert.equal(items[0].fileName, '作家_第_3_章.dshsave')
  assert.deepEqual(items[0].content, saveBytes('session-story'))
  assert.equal(Buffer.isBuffer(items[0].content), true)
  // 带图片导出，并且走的是这一局的 sessionId。
  assert.deepEqual(exports, [{ sessionId: 'session-story', options: { images: true, embedWorldbook: true, embedPreset: true } }])
})

test('collect 把「包里已带世界书」的取舍交给存档导出：不内嵌开局世界书', async () => {
  const { deps, exports } = environment()
  await createTransferChats(deps).collect(['chat-story'], { embedWorldbook: false })
  assert.deepEqual(exports, [{ sessionId: 'session-story', options: { images: true, embedWorldbook: false, embedPreset: true } }])
})

test('collect 补上缺少的 .dshsave 后缀并按 key 顺序去重', async () => {
  const { deps } = environment({ filename: () => '第三章 存档' })
  const exported = await createTransferChats(deps).collect(['chat-untitled', 'chat-untitled', 'chat-no-card'])
  assert.deepEqual(exported.map(item => item.fileName), ['第三章 存档.dshsave', '第三章 存档.dshsave'])
  assert.deepEqual(exported.map(item => item.key), ['chat-untitled', 'chat-no-card'])
})

test('collect 失败时错误里带上对话标题', async () => {
  const { deps } = environment({
    sessions: [{ id: 'chat-broken', sessionId: 'session-broken', title: '作家 · 第 3 章', cardName: '作家', requestMode: 'tavern' }]
  })
  await assert.rejects(createTransferChats(deps).collect(['chat-broken']), /导出「作家 · 第 3 章」失败：场景配图读取失败/)
})

test('importOne 把内容转回 base64 交给 importSave，并返回新的对话编号', async () => {
  const { deps, imports } = environment()
  const content = saveBytes('session-story')
  const result = await createTransferChats(deps).importOne({ title: '作家 · 第 3 章', content })

  assert.deepEqual(imports, [{ fileB64: content.toString('base64'), latestOnly: false }])
  assert.deepEqual(result, { chatId: 'chat-imported', sessionId: 'session-imported', title: '作家 · 第 3 章（导入）' })
})

test('importOne 失败时错误里带上对话标题', async () => {
  const { deps } = environment()
  deps.importSave = async () => { throw new Error('存档包已损坏') }
  await assert.rejects(createTransferChats(deps).importOne({ title: '作家 · 第 3 章', content: Buffer.from('x') }),
    /导入「作家 · 第 3 章」失败：存档包已损坏/)
})

test('未知 key 报错，SillyTavern 对话也按不存在处理', async () => {
  const { deps } = environment()
  const chats = createTransferChats(deps)
  await assert.rejects(chats.collect(['chat-missing']), /对话不存在：chat-missing/)
  await assert.rejects(chats.collect(['chat-st']), /对话不存在：chat-st/)
  await assert.rejects(chats.collect(['chat-story', 'chat-missing']), /对话不存在：chat-missing/)
})

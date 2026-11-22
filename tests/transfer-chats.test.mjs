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

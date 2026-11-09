import assert from 'node:assert/strict'
import test from 'node:test'
import { regenerationFrameKey } from '../tavern-plugin/lib/domain/regeneration-frame-cache.js'

function base() {
  return {
    chat: {
      id: 'chat', sessionId: 'session', posture: '门内', ledger: { chapter: 1 },
      messages: [{ role: 'assistant', text: '旧正文' }],
      foregroundFrames: { old: { text: '冻结材料' } },
      settleStatus: 'done', _storageRevision: 3
    },
    history: [{ role: 'assistant', greeting: true, text: '开场' }, { role: 'user', text: '推门' }],
    target: { role: 'assistant', turn: 2, text: '旧正文', sourceText: '旧正文', swipes: ['旧正文'], swipeId: 0, variables: [{ hp: 8 }] },
    card: { name: '角色', description: '卡面' },
    preset: { middle: [{ role: 'system', content: '预设' }] },
    worldBook: { view: { entries: [{ ref: 'a', content: '世界书' }] } },
    pluginSections: [{ owner: 'fixture', text: '插件段落' }],
    globals: { mood: '晴' },
    settings: { storyGenerationMode: 'host' },
    extensions: { regexScripts: [] },
    prompts: ['story', 'script-story'],
    userText: '推门',
    turn: 3,
    branchId: 'main',
    targetAssistantIndex: 2
  }
}

test('缓存键忽略目标正文和逐次记账，保留请求材料', () => {
  const first = base()
  const second = base()
  second.target.text = '新正文'
  second.target.sourceText = '新正文'
  second.target.swipes = ['新正文']
  second.chat.messages = [{ role: 'assistant', text: '新正文' }]
  second.chat.foregroundFrames = { newer: { text: '新的冻结材料' } }
  second.chat.settleStatus = 'running'
  second.chat._storageRevision = 9
  assert.equal(regenerationFrameKey(first), regenerationFrameKey(second))
})

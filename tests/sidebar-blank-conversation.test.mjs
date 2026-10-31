import test from 'node:test'
import assert from 'node:assert/strict'
import vm from './fixtures/client-vm.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

function blankFixture(options = {}) {
  const calls = []
  const errors = []
  const ctx = vm.createContext({
    workspaceId: options.workspaceId ?? 'workspace-play',
    playWorkspaceIdRef: { current: options.prewarmWorkspaceId ?? '' },
    props: {
      conversationHost: {
        connectWorkspace: options.create
          ? id => options.create(id, calls)
          : async id => { calls.push(['connect', id]); return 'blank-session' },
      },
      sessions: { clear() { calls.push(['clear']) } },
    },
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    setError: message => { errors.push(message) },
  })
  vm.runInContext(sourceFunction(source, 'openBlankConversation'), ctx)
  return { ctx, calls, errors }
}

function deleteFixture() {
  const calls = []
  const ctx = vm.createContext({
    current: 'session-open',
    uiMode: 'play',
    requestMode: 'dsh',
    history: [],
    groupOfMode: () => 'play',
    setMenuSession() {}, setBusy() {}, setError() {},
    askConfirm: async () => true,
    call: async method => {
      calls.push([method])
      return method === 'prepareDeleteChats' ? { results: [{ ok: true }] } : {}
    },
    props: {
      archiveSession: async id => { calls.push(['archive', id]) },
      sessions: { clear() { calls.push(['clear']) } },
    },
    isMissingSessionArchiveError: () => false,
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    openBlankConversation: async () => { calls.push(['blank']) },
    openPicker: () => { calls.push(['picker']) },
    refresh: async () => {},
  })
  vm.runInContext(source.slice(source.indexOf('async function deleteConversation'), source.indexOf('async function forkConversation')), ctx)
  return { ctx, calls }
}

test('删掉当前仅剩的对话时回到空白会话，而不是只清空主视图', async () => {
  const { ctx, calls } = deleteFixture()
  await ctx.deleteConversation({ sessionId: 'session-open', chatId: 'chat-1', cardName: '测试卡' }, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChat'], ['blank'], ['picker']])
})

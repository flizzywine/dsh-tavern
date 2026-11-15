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
    activeHistory: [],
    setMenuSession() {}, setBusy() {}, setError() {},
    askConfirm: async () => true,
    rpc: async (method, args) => {
      calls.push([method])
      return { results: args.chatIds.map(chatId => ({ chatId, ok: true })) }
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
  vm.runInContext(sourceFunction(source, 'changeConversationArchive'), ctx)
  // deleteTavernChats and the removal marks it keeps, shared by every deletion path
  vm.runInContext(source.slice(source.indexOf('const ARCHIVE_CONCURRENCY'), source.indexOf('function tavernCardPathKey')), ctx)
  // (removeChat, the shared removal deleteConversation calls, sits right before it)
  vm.runInContext(source.slice(source.indexOf('async function removeChat'), source.indexOf('async function forkConversation')), ctx)
  return { ctx, calls }
}

test('删掉当前仅剩的对话时回到空白会话，而不是只清空主视图', async () => {
  const { ctx, calls } = deleteFixture()
  await ctx.deleteConversation({ sessionId: 'session-open', chatId: 'chat-1', cardName: '测试卡' }, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChats'], ['blank'], ['picker']])
})

test('归档当前对话后切到仍在历史中的对话', async () => {
  const { ctx, calls } = deleteFixture()
  ctx.activeHistory = [{ sessionId: 'session-open' }, { sessionId: 'session-next' }]
  await ctx.changeConversationArchive({ sessionId: 'session-open' }, true)
  assert.deepEqual(calls, [['archive', 'session-open'], ['clear'], ['open', 'session-next']])
})

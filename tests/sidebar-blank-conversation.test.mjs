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

const deletionHandlers = ['changeConversationArchive', 'leaveUnavailableConversation', 'removeChat', 'deleteConversation',
  'archiveSelectedConversations', 'deleteSelectedConversations'].map(name => sourceFunction(source, name)).join('\n')

function deleteFixture({ archive, deleteChats } = {}) {
  const calls = []
  const errors = []
  let openSessionId = 'session-open'
  const ctx = vm.createContext({
    current: 'session-open',
    activeHistory: [],
    archivedHistory: [],
    archivedSessions: new Set(),
    selectedChats: [],
    busy: false,
    setMenuSession() {}, setBusy() {}, setDeleteNotice() {},
    setError: message => errors.push(message),
    setSelectedChats: ids => { ctx.selectedChats = ids },
    tavernMainSessionId: () => openSessionId,
    askConfirm: async () => true,
    rpc: async (method, args) => {
      calls.push([method])
      if (method === 'deleteChats' && deleteChats) await deleteChats(args.chatIds, id => { openSessionId = id })
      return { results: args.chatIds.map(chatId => ({ chatId, ok: true })) }
    },
    props: {
      archiveSession: async id => { calls.push(['archive', id]); await archive?.(id) },
      sessions: { clear() { calls.push(['clear']) } },
    },
    isMissingSessionArchiveError: () => false,
    openSessionWhenReady: async id => { calls.push(['open', id]) },
    openBlankConversation: async () => { calls.push(['blank']) },
    openPicker: () => { calls.push(['picker']) },
    refresh: async () => {},
  })
  // deleteTavernChats and the removal marks it keeps, shared by every deletion path
  vm.runInContext(source.slice(source.indexOf('const ARCHIVE_CONCURRENCY'), source.indexOf('function tavernCardPathKey')), ctx)
  vm.runInContext(deletionHandlers, ctx)
  return { ctx, calls, errors }
}

const currentItem = { sessionId: 'session-open', chatId: 'chat-1', cardName: '测试卡' }
const nextItem = { sessionId: 'session-next', chatId: 'chat-2', cardName: '另一张卡' }

test('删掉当前仅剩的对话时回到空白会话，而不是只清空主视图', async () => {
  const { ctx, calls } = deleteFixture()
  await ctx.deleteConversation(currentItem, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChats'], ['clear'], ['blank'], ['picker']])
})

test('归档当前对话后切到仍在历史中的对话', async () => {
  const { ctx, calls } = deleteFixture()
  ctx.activeHistory = [currentItem, nextItem]
  await ctx.changeConversationArchive(currentItem, true)
  assert.deepEqual(calls, [['archive', 'session-open'], ['clear'], ['open', 'session-next']])
})

test('批量归档部分失败时，当前对话继续显示，失败项可重试', async () => {
  const { ctx, calls, errors } = deleteFixture({ archive(id) { if (id === currentItem.sessionId) throw new Error('归档失败') } })
  ctx.activeHistory = [currentItem, nextItem]
  ctx.selectedChats = [currentItem.chatId, nextItem.chatId]
  await ctx.archiveSelectedConversations(true)
  assert.deepEqual(calls, [['archive', 'session-open'], ['archive', 'session-next']])
  assert.deepEqual(Array.from(ctx.selectedChats), [currentItem.chatId])
  assert.match(errors.at(-1), /测试卡：归档失败/)
})

test('批量删除时归档失败的对话仍可作为下一局', async () => {
  const { ctx, calls, errors } = deleteFixture({ archive(id) { if (id === nextItem.sessionId) throw new Error('归档失败') } })
  const items = [currentItem, nextItem]
  ctx.activeHistory = items
  ctx.selectedChats = items.map(item => item.chatId)
  await ctx.deleteSelectedConversations(items)
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['archive', 'session-next'], ['deleteChats'], ['clear'], ['open', 'session-next']])
  assert.deepEqual(Array.from(ctx.selectedChats), [nextItem.chatId])
  assert.match(errors.at(-1), /另一张卡：归档失败/)
})

test('当前对话已归档但删除请求失败时，切到下一局并显示失败原因', async () => {
  const { ctx, calls, errors } = deleteFixture({ deleteChats() { throw new Error('删除超时') } })
  ctx.activeHistory = [currentItem, nextItem]
  await ctx.deleteConversation(currentItem, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChats'], ['clear'], ['open', 'session-next']])
  assert.equal(errors.at(-1), '删除超时')
})

test('删除期间已切到其他对话时，保留当前主视图', async () => {
  const { ctx, calls } = deleteFixture({ deleteChats(_, switchTo) { switchTo(nextItem.sessionId) } })
  ctx.activeHistory = [currentItem, nextItem]
  await ctx.deleteConversation(currentItem, '测试对话')
  assert.deepEqual(calls, [['prepareDeleteChats'], ['archive', 'session-open'], ['deleteChats']])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'

const summarize = messages => messages.map(({ role, turn, greeting }) => ({ role, turn, greeting }))

// `to` is inclusive, matching native-conversation-storage.readWindow.
const project = (messages, from, to, revision = 1) => projectStoryTranscript({
  chat: { messages: messages.slice(from, to + 1) },
  from,
  to,
  messageCount: messages.length,
  revision
}, summarize(messages))

test('稀疏、缺失、重复、非单调 turn 回退到 index 键', () => {
  const messages = [
    { role: 'assistant', turn: 5, text: 'a' },
    { role: 'assistant', text: 'b' },
    { role: 'assistant', turn: 3, text: 'c' },
    { role: 'assistant', turn: 3, text: 'd' },
    { role: 'assistant', turn: 0, text: 'e' },
    { role: 'assistant', turn: '7', text: 'f' },
    { role: 'assistant', turn: 2.5, text: 'g' },
    { role: 'assistant', turn: -1, text: 'h' },
    { role: 'assistant', turn: 5, text: 'i' }
  ]

  const projection = project(messages, 0, 8)

  assert.equal(projection.floorCount, 9)
  assert.deepEqual(projection.messages.map(entry => entry.floorNo), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.deepEqual(projection.messages.map(entry => entry.key), [
    'index:0', 'index:1', 'index:2', 'index:3', 'index:4',
    'index:5', 'index:6', 'index:7', 'index:8'
  ])
  assert.deepEqual(projection.messages.map(entry => entry.legacyTurn), [5, null, 3, 3, null, null, null, null, 5])
})

test('普通对话在内置开场正文后显示作用于开场的插件补充内容', async t => {
  const source = name => readFile(new URL('../tavern-plugin/src/client/features/' + name, import.meta.url), 'utf8')
  const [data, list, extensions] = await Promise.all([
    source('story-transcript-data.js'), source('story-transcript-list.js'), source('plugin-extensions.js'),
  ])
  const view = {key:'continuation', render: input => input.greeting && input.gameId === 'game' ? '已读的续段对白' : null}
  const dom = new JSDOM('<main></main>', {pretendToBeVisual:true})
  const previous = {window: globalThis.window, document: globalThis.document, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT}
  Object.assign(globalThis, {window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true})
  const main = dom.window.document.querySelector('main')
  const root = createRoot(main)
  t.after(async () => {
    await act(async () => root.unmount())
    Object.assign(globalThis, previous)
    dom.window.close()
  })
  const context = vm.createContext({
    React, window:dom.window, document:dom.window.document,
    DshUi:{Tooltip:props => props.children, IconCopyOutlineRegular:'i', IconEditOutlineRegular:'i', IconBranchOutlineRegular:'i'},
    useTavernTurnView: () => ({view:null, after:[view]}),
    tavernPluginBoundary: () => props => props.children,
    bubbleCastLines: () => [],
  })
  const renderer = extensions.slice(extensions.indexOf('function TavernTurnPluginView('), extensions.indexOf('function tavernPluginStatusSection('))
  vm.runInContext(data + '\n' + list + '\n' + renderer, context)
  const feature = context.createTavernStoryTranscriptFeature({markdown: text => text})
  const transcript = project([
    {role:'assistant', greeting:true, turn:1, text:'原来的序章'},
    {role:'user', turn:2, text:'下一步'},
    {role:'assistant', turn:2, text:'普通回复'},
  ], 0, 2)
  await act(async () => root.render(React.createElement(feature.StoryTranscriptList, {transcript, sessionId:'game', view:{mode:'story'}})))
  assert.match(main.textContent, /原来的序章已读的续段对白/)
  assert.equal(main.textContent.match(/已读的续段对白/g)?.length, 1)
  assert.match(main.textContent, /普通回复/)
})

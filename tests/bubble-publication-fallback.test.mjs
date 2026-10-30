// 每段正文都经过对白气泡/舞台的渲染。气泡出错时，正文要以普通 Markdown 留下，错误报到错误面板。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const fragment = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

test('气泡渲染抛错时退回普通 Markdown，正文不消失', async t => {
  const dom = new JSDOM('<div id="root"></div>')
  const previous = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  let root
  t.after(async () => {
    if (root) await act(() => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  const reports = []
  const context = vm.createContext({ React, Object,
    tavernErrorHub: { report: (label, error) => reports.push([label, error.message]) },
    BubblePublication() { throw new Error('bubble failed') },
    TavernColoredMarkdown: props => React.createElement('p', { id: 'story' }, props.text) })
  vm.runInContext(fragment('let tavernStageBoundaryClass = null', '\n\t\t}\n') + '\n\t\t}', context)
  const Safe = vm.runInContext(fragment('function BubbleSafePublication(props)', 'let bubblePublicationMemo') + '; BubbleSafePublication', context)
  root = createRoot(document.getElementById('root'), { onCaughtError() {} })
  await act(() => root.render(React.createElement(Safe, { text: '她走进客舱。', sessionId: 's', voiceScope: '2:0' })))
  assert.equal(document.getElementById('story').textContent, '她走进客舱。')
  assert.deepEqual(reports, [['对白气泡', 'bubble failed']])
})

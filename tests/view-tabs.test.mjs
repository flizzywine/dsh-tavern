import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import test from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import {
  DEFAULT_VIEW_TABS, VIEW_TAB_RESIDENT, applyTavernSettingsPatch, presentTavernSettings, readViewTabs, viewTabs
} from '../tavern-plugin/lib/domain/tavern-settings.js'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const moduleSource = await readFile(new URL('../tavern-plugin/src/client/modules/view-tabs.js', import.meta.url), 'utf8')

const TAB_ENTRIES = [
  { id: 'chat', label: '对话' },
  { id: 'trajectory', label: '轨迹' },
  { id: 'dsh-tavern:full-context', label: '完整上下文' },
  { id: 'dsh-tavern:gallery', label: '画廊' },
  { id: 'dsh-tavern:polish', label: '精修' }
]

test('顶部标签默认 4 个，对话固定首位；保存、读取与恢复默认都守住这条', () => {
  assert.deepEqual([...DEFAULT_VIEW_TABS.items], ['chat', 'trajectory', 'dsh-tavern:gallery', 'dsh-tavern:polish'])
  assert.equal(VIEW_TAB_RESIDENT, 'chat')
  assert.deepEqual(presentTavernSettings({}, {}).viewTabs, { items: [...DEFAULT_VIEW_TABS.items] })

  // 对话不在清单里时补到首位；排在后面时挪回首位。
  assert.deepEqual(viewTabs({ items: ['dsh-tavern:gallery'] }).items, ['chat', 'dsh-tavern:gallery'])
  assert.deepEqual(viewTabs({ items: ['dsh-tavern:gallery', 'chat', 'trajectory'] }).items, ['chat', 'dsh-tavern:gallery', 'trajectory'])
  // 去重、截断、非法值。
  assert.deepEqual(viewTabs({ items: ['chat', 'chat', 'dsh-tavern:gallery'] }).items, ['chat', 'dsh-tavern:gallery'])
  assert.equal(viewTabs({ items: Array.from({ length: 30 }, (_, index) => 'dsh-tavern:page-' + index) }).items.length, 24)
  for (const bad of [null, [], { items: 'chat' }, { items: ['bad id'] }, { items: [1] }]) assert.throws(() => viewTabs(bad), /无效的顶部标签设置/)
  assert.deepEqual(readViewTabs({ items: ['bad id'] }), { items: [...DEFAULT_VIEW_TABS.items] })

  // 只有对话也被允许：对话不能被移除。
  assert.deepEqual(viewTabs({ items: [] }).items, ['chat'])
  let document = applyTavernSettingsPatch({}, { viewTabs: { items: ['chat', 'dsh-tavern:gallery'] } })
  assert.deepEqual(document.viewTabs, { items: ['chat', 'dsh-tavern:gallery'] })
  assert.deepEqual(presentTavernSettings(document, {}).viewTabs, { items: ['chat', 'dsh-tavern:gallery'] })
  document = applyTavernSettingsPatch(document, { viewTabs: null })
  assert.equal(Object.hasOwn(document, 'viewTabs'), false)
  assert.deepEqual(presentTavernSettings(document, {}).viewTabs, { items: [...DEFAULT_VIEW_TABS.items] })
})

function loadModule(extra = {}) {
  const context = vm.createContext(Object.assign({ React }, extra))
  vm.runInContext(moduleSource + '\nthis.api = { tavernViewTabItems, tavernViewTabEntries, tavernViewTabPlan, applyTavernViewTabRow, TavernViewTabsSettings, tavernViewTabCatalog };', context)
  return context.api
}

function tabRow(dom, labels = ['对话', '轨迹', '完整上下文', '画廊', '精修'], active = '画廊') {
  const row = dom.window.document.createElement('div')
  row.setAttribute('data-conversation-tabs', '')
  for (const label of labels) {
    const button = dom.window.document.createElement('button')
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', label === active ? 'true' : 'false')
    button.textContent = label
    row.appendChild(button)
  }
  dom.window.document.body.appendChild(row)
  return row
}

const styleOf = row => Array.from(row.querySelectorAll('button[role="tab"]')).map(button => ({
  label: button.textContent,
  id: button.getAttribute('data-tavern-view-tab'),
  display: button.style.display,
  order: button.style.order
}))

test('客户端标签行按设置的清单显示与排序，隐藏当前标签时切回第一个可见标签', () => {
  const api = loadModule()
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true })
  try {
    // 默认隐藏完整上下文，其余标签按配置排序。
    let row = tabRow(dom)
    assert.equal(api.applyTavernViewTabRow(row, TAB_ENTRIES, [...DEFAULT_VIEW_TABS.items]), 4)
    assert.deepEqual(styleOf(row).map(item => [item.id, item.display, item.order]), [
      ['chat', '', '0'], ['trajectory', '', '1'], ['dsh-tavern:full-context', 'none', ''], ['dsh-tavern:gallery', '', '2'], ['dsh-tavern:polish', '', '3']
    ])

    // 只留对话 + 完整上下文，并把画廊藏起来（它正被选中）。
    let clicked = 0
    row.querySelectorAll('button[role="tab"]')[0].addEventListener('click', () => { clicked += 1 })
    assert.equal(api.applyTavernViewTabRow(row, TAB_ENTRIES, ['chat', 'dsh-tavern:full-context']), 2)
    assert.deepEqual(styleOf(row).map(item => item.display === 'none' ? null : item.id).filter(Boolean), ['chat', 'dsh-tavern:full-context'])
    assert.equal(clicked, 1, '当前「画廊」被隐藏后切回「对话」')

    // 开发者工具关闭时宿主不画「轨迹」：按钮少一个也要对齐正确。
    row = tabRow(dom, ['对话', '完整上下文', '画廊', '精修'])
    api.applyTavernViewTabRow(row, TAB_ENTRIES, [...DEFAULT_VIEW_TABS.items])
    assert.deepEqual(styleOf(row).map(item => item.id), ['chat', 'dsh-tavern:full-context', 'dsh-tavern:gallery', 'dsh-tavern:polish'])
  } finally { dom.window.close() }
})

test('客户端清单读取时也把对话补到首位，旧配置或手改配置不会把它删掉', () => {
  const api = loadModule()
  const json = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(json(api.tavernViewTabItems(null)), [...DEFAULT_VIEW_TABS.items])
  assert.deepEqual(json(api.tavernViewTabItems({ items: ['dsh-tavern:gallery', 'chat'] })), ['chat', 'dsh-tavern:gallery'])
  assert.deepEqual(json(api.tavernViewTabItems({ items: [] })), ['chat'])
})

test('客户端默认值与服务端一致，标签名称从槽位读（宿主的名称是函数）', () => {
  const declaration = client.match(/const TAVERN_VIEW_TABS_DEFAULT = (.*?);\n/)[1]
  const value = vm.runInNewContext('(' + declaration + ')', { Object })
  assert.deepEqual(JSON.parse(JSON.stringify(value)), JSON.parse(JSON.stringify(DEFAULT_VIEW_TABS)))

  const api = loadModule()
  const entries = api.tavernViewTabEntries({
    entries: () => [
      { options: { id: 'chat', label: () => '对话' } },
      { options: { id: 'trajectory', label: '轨迹' } },
      { options: { id: 'dsh-tavern:gallery' } },
      { options: {} }
    ]
  })
  assert.deepEqual(JSON.parse(JSON.stringify(entries)), [
    { id: 'chat', label: '对话' },
    { id: 'trajectory', label: '轨迹' },
    { id: 'dsh-tavern:gallery', label: 'gallery' }
  ])
})

test('设置里的顶部标签：对话锁定首位不可移除，其余可排序/移除/恢复默认', async t => {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true })
  const previous = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => { Object.assign(globalThis, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act }); dom.window.close() })

  const saved = []
  let value = { headerItems: { display: 'icon-text', items: ['dsh-tavern:status'] }, viewTabs: { items: TAB_ENTRIES.map(entry => entry.id) } }
  const listeners = new Set()
  const displayPreferences = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot: () => value,
    async save(patch) {
      saved.push(JSON.parse(JSON.stringify(patch)))
      value = { ...value, viewTabs: { items: viewTabs(patch.viewTabs).items } }
      listeners.forEach(listener => listener())
      return value
    }
  }
  const api = loadModule({ displayPreferences })
  const root = createRoot(dom.window.document.querySelector('main'))
  await act(async () => root.render(React.createElement(api.TavernViewTabsSettings)))
  const press = node => act(async () => { node.click(); await new Promise(resolve => setTimeout(resolve, 0)) })

  const rows = () => [...dom.window.document.querySelectorAll('.dsh-tavern-view-tab-row')]
  assert.deepEqual(rows().map(row => row.querySelector('.dsh-tavern-view-tab-name strong').textContent), ['对话', '轨迹', '完整上下文', '画廊', '精修'])
  // 对话：固定标记，没有上移/下移/移除。
  assert.equal(rows()[0].querySelector('.dsh-tavern-view-tab-lock').textContent, '固定')
  assert.equal(rows()[0].querySelectorAll('button').length, 0)
  // 第二行不能上移（对话永远第一）。
  assert.equal(rows()[1].querySelector('[aria-label="上移"]').disabled, true)

  // 移除「画廊」。
  const remove = rows()[3].querySelector('[aria-label="移除"]')
  await press(remove)
  assert.deepEqual(saved.at(-1), { viewTabs: { items: ['chat', 'trajectory', 'dsh-tavern:full-context', 'dsh-tavern:polish'] } })
  assert.deepEqual(rows().map(row => row.querySelector('.dsh-tavern-view-tab-name strong').textContent), ['对话', '轨迹', '完整上下文', '精修'])
  const chip = [...dom.window.document.querySelectorAll('.dsh-tavern-view-tab-chip')].find(node => node.textContent.includes('画廊'))
  assert.ok(chip, '移除的标签出现在「可添加的标签」里')

  // 加回「画廊」到末尾。
  await press(chip)
  assert.deepEqual(saved.at(-1), { viewTabs: { items: ['chat', 'trajectory', 'dsh-tavern:full-context', 'dsh-tavern:polish', 'dsh-tavern:gallery'] } })

  // 上移「完整上下文」到「轨迹」前面。
  await press(rows()[2].querySelector('[aria-label="上移"]'))
  assert.deepEqual(saved.at(-1), { viewTabs: { items: ['chat', 'dsh-tavern:full-context', 'trajectory', 'dsh-tavern:polish', 'dsh-tavern:gallery'] } })

  // 恢复默认标签。
  const reset = [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === '恢复默认标签')
  await press(reset)
  assert.deepEqual(saved.at(-1), { viewTabs: { items: [...DEFAULT_VIEW_TABS.items] } })
  await act(async () => root.unmount())
})

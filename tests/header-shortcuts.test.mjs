import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'
import { DEFAULT_HEADER_ITEMS, applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')

// the default top bar has only 导出 (the fork's ⋯ menu), no 酒馆状态 button.
test('顶栏默认值与改动前一致：只有导出，图标加文字', () => {
  assert.deepEqual({ display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] }, { display: 'icon-text', items: ['header:export'] })
  assert.deepEqual(presentTavernSettings({}, {}).headerItems, { display: 'icon-text', items: ['header:export'] })
})

test('非法顶栏设置被拒绝', () => {
  for (const bad of [
    { display: 'large', items: [] },
    { display: 'icon', items: 'dsh-tavern:status' },
    { display: 'icon', items: ['dsh-tavern:status', 'bad id'] },
    { display: 'icon', items: [1] },
    { display: 'icon', items: [null] },
    []
  ]) assert.throws(() => applyTavernSettingsPatch({}, { headerItems: bad }), /无效的顶栏设置/)
  assert.throws(() => applyTavernSettingsPatch({}, { headerItems: { items: [{ id: 'dsh-tavern:status' }] } }), /无效的顶栏设置/)
})

test('传 null 恢复默认顶栏', () => {
  let document = applyTavernSettingsPatch({}, { headerItems: { display: 'icon', items: ['dsh-tavern:cards'] } })
  assert.deepEqual(document.headerItems, { display: 'icon', items: ['dsh-tavern:cards'] })
  document = applyTavernSettingsPatch(document, { headerItems: null })
  assert.equal(Object.hasOwn(document, 'headerItems'), false)
  assert.deepEqual(presentTavernSettings(document, {}).headerItems, { display: 'icon-text', items: ['header:export'] })
  // 存档里损坏的值不会让读取失败。
  assert.deepEqual(presentTavernSettings({ headerItems: { display: 'nope', items: ['bad id'] } }, {}).headerItems, { display: 'icon-text', items: ['header:export'] })
})

test('getDisplayPreferences 一并返回顶栏设置与顶部标签', async () => {
  const handlers = createSettingsHandlers({ readTavernSettings: async () => ({ hideContextAndReasoning: false, headerItems: { display: 'icon', items: ['header:export'] }, viewTabs: { items: ['chat', 'dsh-tavern:polish'] } }) })
  const preferences = await handlers.getDisplayPreferences({})
  assert.deepEqual(preferences, { hideContextAndReasoning: false, headerItems: { display: 'icon', items: ['header:export'] }, viewTabs: { items: ['chat', 'dsh-tavern:polish'] } })
})

test('客户端顶栏默认值与服务端一致，设置在首次读取前就用默认值', async () => {
  const declaration = client.match(/const TAVERN_HEADER_DEFAULT = (.*?);\n/)[1]
  const value = vm.runInNewContext('(' + declaration + ')', { Object })
  assert.deepEqual({ display: value.display, items: [...value.items] }, { display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] })
  assert.match(client, /function useTavernHeaderItems\(\)[\s\S]*?TAVERN_HEADER_DEFAULT/)

  const dom = new JSDOM('<html><body></body></html>')
  const source = client.match(/const displayPreferences = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0].replace('const displayPreferences = ', '')
  const store = vm.runInNewContext(source, {
    document: dom.window.document,
    window: dom.window,
    tavernViewTabItems: value => value && Array.isArray(value.items) ? ['chat'].concat(value.items.filter(id => id !== 'chat')) : ['chat'],
    rpc: async () => ({ hideContextAndReasoning: true, headerItems: { display: 'icon', items: ['dsh-tavern:cards'] }, viewTabs: { items: ['chat', 'dsh-tavern:gallery'] } }),
    // the store also drives the 调试视图 classes (debug.js); the shipped default is read before the first load.
    createDebugMigration: () => async () => {}, applyDebug() {}, TAVERN_HEADER_DEFAULT: value
  })
  assert.equal(store.snapshot(), null, '第一次读取前没有快照，顶栏回落到默认值')
  const stop = store.start()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot().headerItems)), { display: 'icon', items: ['dsh-tavern:cards'] })
  assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot().viewTabs)), { items: ['chat', 'dsh-tavern:gallery'] })
  stop()
  dom.window.close()
})

// the fork settings layout keeps 顶栏配置 last in 高级 (02951363b); the header also opens it as 顶栏设置.
test('默认对小白无感：开始页没有图钉，「⋯」只在有按钮收起时出现，配置放在显示与交互', () => {
  assert.doesNotMatch(client, /dsh-tavern-start-pin/)
  assert.doesNotMatch(client, /dsh-tavern-header-divider/)
  assert.match(client, /foldedEntries\.length \? h\("div", \{ className: "dsh-tavern-more-actions dsh-tavern-header-more" \}/)
  assert.match(client.slice(client.indexOf('group("显示与交互"'), client.indexOf('group("高级"')), /HeaderItemsSettings/)
})

test('空间不足时从尾部收起页面，酒馆状态和导出永不收起', () => {
  const source = client.match(/function tavernHeaderFold\(ids[\s\S]*?\n\t\t\}/)[0]
  const fold = vm.runInNewContext('(' + source + ')')
  const width = value => value
  // 都放得下时不收起任何按钮。
  assert.deepEqual(Array.from(fold(['a', 'b'], width, 400, { gap: 2 })), [])
  // 从尾部连续收起。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c', 'd', 'e'], () => 100, 300, { gap: 2, moreWidth: 34 })), ['c', 'd', 'e'])
  // 固定按钮不参与收起，也不会挡住它前面的页面。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c'], id => (id === 'c' ? 100 : 100), 250, { gap: 2, moreWidth: 34, fixed: ['c'] })), ['b'])
  assert.deepEqual(Array.from(fold(['dsh-tavern:status', 'dsh-tavern:cards', 'dsh-tavern:worldbooks', 'header:export'], () => 100, 260, { gap: 2, moreWidth: 34, fixed: ['dsh-tavern:status', 'header:export'] })), ['dsh-tavern:cards', 'dsh-tavern:worldbooks'])
})

// 手机上固定上限：与标题长短无关，不会随当前渲染数量来回变。
function sliceFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, '未找到 ' + name)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error('未闭合：' + name)
}

test('手机上最多保留三个快捷入口，导出优先，其余进 ⋮', () => {
  const fold = vm.runInNewContext('(' + sliceFunction(client, 'tavernHeaderMobileFold') + ')', { TAVERN_HEADER_MOBILE_LIMIT: 3 })
  // 三个以内不动，也不出现 ⋮。
  assert.deepEqual(Array.from(fold(['dsh-tavern:status', 'header:export', 'dsh-tavern:cards'], 3)), [])
  // 超过三个：导出 + 清单里前两个留下，其余全折。
  assert.deepEqual(
    Array.from(fold(['dsh-tavern:status', 'header:export', 'dsh-tavern:cards', 'dsh-tavern:worldbooks'], 3)),
    ['dsh-tavern:worldbooks']
  )
  // 没有导出时按顺序保留前三个。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c', 'd'], 3)), ['d'])
  // 上限传 0 视为「用默认上限」，不会让整排图标消失。
  assert.deepEqual(Array.from(fold(['a', 'b'], 0)), [])
  // 显式传 1 时只留一个，其余进 ⋮。
  assert.deepEqual(Array.from(fold(['a', 'b'], 1)), ['b'])
})

test('手机顶栏的布局约束：角落按钮留座、宿主动作组保持自然宽度', () => {
  // 预算变量写在标题行上，JS 读它折算槽位；数值是 390px 实测（mobile-layout-browser 断言），标题行不再留 44px 右内边距。
  assert.match(css, /\[class\*="_titleRow"\] \{\s*--dsh-tavern-header-fixed: 142px;/)
  assert.match(client, /const TAVERN_HEADER_MOBILE_CHROME = 142;/)
  // a phone play session has no corner button and folds 全屏 into ⋯ (fork-phone-play-browser measures it).
  assert.match(css, /html\.dsh-fork-phone-play [^{]*\[class\*="_titleRow"\] \{\s*--dsh-tavern-header-fixed: 58px;/)
  assert.match(client, /const TAVERN_HEADER_MOBILE_CHROME_PHONE_PLAY = 58;/)
  // 0.2.x 的 headerActions 是 display:contents 插槽，侧栏开关/文件/全屏都在里面；
  // 容器压窄会让固定尺寸按钮互相覆盖，因此保持自然宽度，让标题区收缩。
  assert.match(css, /\[class\*="_headerActions"\] \{\s*flex: none; min-width: 0; gap: 0;/)
  assert.doesNotMatch(css, /--dsh-tavern-header-fixed: 156px;/)
  // dsh-web-mobile 隐藏 titleRow 的 corner 时，酒馆要放回宿主右侧栏按钮，并隐藏重复的文件按钮。
  assert.match(css, /\[data-mobile-nav="frame"\][\s\S]{0,240}\[data-conversation-header-corner\][\s\S]{0,80}display: flex !important;/)
  assert.match(css, /\[data-mobile-nav="frame"\][\s\S]{0,300}\[data-mobile-nav="files"\]\s*\{\s*display: none !important;/)
  // 手机判定与上限要暴露给夹具。
  assert.match(client, /function useTavernMobileHeader\(\)/)
  assert.match(client, /"data-tavern-header-limit": mobile \? mobileLimit : ""/)
  // ⋮ 在手机上竖排三点。
  assert.match(client, /mobile \? "M12 5h\.01M12 12h\.01M12 19h\.01"/)
})


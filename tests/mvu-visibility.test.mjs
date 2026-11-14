import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MVU_HIDDEN_SENTINEL,
  describeMvuHiddenChange,
  extractCardMvuVisibility,
  formatMvuHiddenValue,
  maskMvuHelperMessageRow,
  maskMvuReceipt,
  maskMvuStatDataForDisplay,
  maskMvuStatDataForEditor,
  maskTavernReadVariablesResultText,
  matchMvuVisibilityRule,
  normalizeMvuVisibility,
  restoreHiddenMvuStatData,
  validateMvuVisibility
} from '../tavern-plugin/lib/domain/mvu-visibility.js'
import { generatePanel, planMvuApply, surveyMvuCard, surveyText } from '../tavern-plugin/lib/domain/mvu-card-apply.js'
import { checkMvuCard } from '../tavern-plugin/lib/domain/mvu-card-check.js'
import { createMvuReceiptIndex } from '../tavern-plugin/lib/domain/mvu-receipt-index.js'
import { clientControls } from './fixtures/native-controls.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEARCH_ROOTS = [path.join(root, 'tavern-plugin/node_modules'), path.join(root, 'node_modules')]
function loadPackage(name) {
  let failure = null
  for (const base of SEARCH_ROOTS) {
    try { return createRequire(path.join(base, 'noop.js'))(name) } catch (error) { failure = error }
  }
  throw new Error('缺少测试依赖 ' + name + '：' + (failure && failure.message))
}

const VISIBILITY_FIXTURE = {
  '/人物/*/好感度': {
    mode: 'tiered',
    trend: true,
    tiers: [
      [0, '戒备'],
      [30, '疏离'],
      [60, '熟稔'],
      [85, '信赖']
    ]
  },
  '/人物/*/暗恋度': {
    mode: 'trend',
    placeholder: '？？？',
    largeDelta: 10
  },
  '/全局/黑化值': {
    mode: 'masked',
    placeholder: '未知',
    revealWhen: { path: '/结局/真相揭晓', equals: true }
  }
}

test('规则校验与通配路径匹配：支持模式 1/2/3、元组解包与 revealWhen 预留保留', () => {
  const checked = validateMvuVisibility({
    '/stat_data/人物/*/好感度': VISIBILITY_FIXTURE['/人物/*/好感度'],
    '人物/*/暗恋度': { mode: 'masked', trend: true },
    '/全局/黑化值': VISIBILITY_FIXTURE['/全局/黑化值'],
    '/人物/特殊角色/好感度': 'masked'
  })
  assert.deepEqual(checked.errors, [])
  assert.equal(checked.normalized['/人物/*/暗恋度'].mode, 'trend')
  assert.deepEqual(checked.normalized['/全局/黑化值'].revealWhen, { path: '/结局/真相揭晓', equals: true })

  // Exact match overrides wildcard on the same leaf
  assert.equal(matchMvuVisibilityRule(checked.normalized, '/人物/林雪/好感度').rule.mode, 'tiered')
  assert.equal(matchMvuVisibilityRule(checked.normalized, '/人物/特殊角色/好感度').rule.mode, 'masked')

  // Upstream MVU [value, "description"] tuple leaf /0 inherits parent rule
  const tupleMatch = matchMvuVisibilityRule(checked.normalized, '/stat_data/人物/林雪/好感度/0')
  assert.equal(tupleMatch.rule.mode, 'tiered')
  assert.equal(tupleMatch.tupleIndex, 0)

  // Formatting scalar and tuple values
  const tieredRule = checked.normalized['/人物/*/好感度']
  assert.equal(formatMvuHiddenValue(15, tieredRule), '戒备')
  assert.equal(formatMvuHiddenValue([65, '好感度说明'], tieredRule), '熟稔')
  assert.equal(formatMvuHiddenValue(92, tieredRule), '信赖')

  // Invalid rules report exact field paths
  const invalid = validateMvuVisibility({ '/坏档位': { mode: 'tiered', tiers: [] } })
  assert.equal(invalid.errors.length, 1)
  assert.match(invalid.errors[0].message, /tiers/)
})

test('三种模式在变量回执中的脱敏语义：纯迷雾、迷雾+趋势、模糊档位（含同档升温与跨档跳变）与新增对象深脱敏', () => {
  const rules = normalizeMvuVisibility(VISIBILITY_FIXTURE)

  // Mode 1: masked -> no direction, no numbers
  const maskedChange = describeMvuHiddenChange('20', '45', 'set', rules['/全局/黑化值'])
  assert.equal(maskedChange.text, '已发生变化')
  assert.equal(maskedChange.direction, null)
  assert.equal(maskedChange.before, '未知')
  assert.equal(maskedChange.after, '未知')

  // Mode 2: trend -> direction + magnitude tier, no base or exact delta
  const minorUp = describeMvuHiddenChange('40', '45', 'set', rules['/人物/*/暗恋度'])
  assert.equal(minorUp.text, '略有上升 ↑')
  assert.equal(minorUp.direction, 'up')
  assert.equal(minorUp.strength, 'minor')

  const majorDown = describeMvuHiddenChange('40', '25', 'set', rules['/人物/*/暗恋度'])
  assert.equal(majorDown.text, '大幅下降 ↓↓')
  assert.equal(majorDown.direction, 'down')
  assert.equal(majorDown.strength, 'major')

  // Mode 3: tiered -> same tier vs crossed tier
  const sameTier = describeMvuHiddenChange('62', '68', 'set', rules['/人物/*/好感度'])
  assert.equal(sameTier.crossed, false)
  assert.equal(sameTier.text, '熟稔（略有上升 ↑）')

  const crossedTier = describeMvuHiddenChange('55', '63', 'set', rules['/人物/*/好感度'])
  assert.equal(crossedTier.crossed, true)
  assert.equal(crossedTier.beforeTier, '疏离')
  assert.equal(crossedTier.afterTier, '熟稔')
  assert.equal(crossedTier.text, '疏离 → 熟稔 ↑')

  // Full receipt masking including newly inserted NPC object and tuple /0+/1 deduplication
  const rawReceipt = {
    version: 1,
    status: 'updated',
    summary: '',
    changes: [
      { operation: 'set', path: '/stat_data/状态/金币', before: '100', after: '150' },
      { operation: 'set', path: '/stat_data/人物/林雪/好感度/0', before: '55', after: '63' },
      { operation: 'set', path: '/stat_data/人物/林雪/好感度/1', before: '旧描述', after: '新描述' },
      { operation: 'set', path: '/stat_data/人物/林雪/暗恋度', before: '12', after: '25' },
      { operation: 'set', path: '/stat_data/全局/黑化值', before: '10', after: '30' },
      { operation: 'insert', path: '/stat_data/人物/苏晴', before: '（不存在）', after: JSON.stringify({ 好感度: 40, 暗恋度: 15, 身份: '学妹' }) }
    ],
    sideEffects: []
  }
  const masked = maskMvuReceipt(rawReceipt, rules)
  const serialized = JSON.stringify(masked)
  // Raw hidden numbers never leak anywhere in masked receipt
  assert.doesNotMatch(serialized, /"55"|"63"|"12"|"25"|"10"|"30"|":40|":15|旧描述|新描述/)
  assert.equal(masked.changes[0].after, '150')
  assert.equal(masked.changes[1].path, '/stat_data/人物/林雪/好感度')
  assert.equal(masked.changes[1].hidden.text, '疏离 → 熟稔 ↑')
  assert.equal(masked.changes[2].hidden.text, '大幅上升 ↑↑')
  assert.equal(masked.changes[3].hidden.text, '已发生变化')
  assert.deepEqual(JSON.parse(masked.changes[4].after), { 好感度: '疏离', 暗恋度: '？？？', 身份: '学妹' })

  // Receipt index caches and invalidates cleanly when card visibility changes
  let activeVis = null
  const index = createMvuReceiptIndex({ visibilityOf: () => activeVis })
  const chat = {
    id: 'c1',
    _storageRevision: 1,
    tavernHelperLifecycleRevision: 0,
    messages: [{ role: 'assistant', turn: 1, mvu: { receipt: rawReceipt } }]
  }
  const plainOut = index(chat, { busy: false })
  assert.equal(plainOut[0].receipt.changes[1].after, '63')
  activeVis = rules
  const maskedOut = index(chat, { busy: false }, { baseRevision: 1, indices: [] })
  assert.equal(maskedOut[0].receipt.changes[1].hidden.text, '疏离 → 熟稔 ↑')
})

test('制卡写入、标准面板生成与卡片静态校验支持隐藏属性且不产生百分比进度条泄露', async () => {
  const { JSDOM } = loadPackage('jsdom')
  const raw = {
    spec: 'chara_card_v3',
    data: {
      name: '学园物语',
      first_mes: '放学后的教室。',
      alternate_greetings: [],
      character_book: { entries: [] },
      extensions: { regex_scripts: [] }
    }
  }
  const plan = planMvuApply(raw, {
    variables: {
      状态: { 体力: 80 },
      人物: { 林雪: { 好感度: 65, 暗恋度: 20 } },
      全局: { 黑化值: 15 }
    },
    rules: '按剧情交互增减好感度与体力。',
    visibility: VISIBILITY_FIXTURE
  })
  Object.assign(raw.data, plan.fields)
  for (const op of plan.rawOperations) {
    if (op.path.endsWith('/regex_scripts')) raw.data.extensions.regex_scripts = op.value
    if (op.path.endsWith('/dsh_tavern')) raw.data.extensions.dsh_tavern = op.value
  }
  for (const op of plan.worldbook) raw.data.character_book.entries.push({ ...op.entry, keys: op.entry.primaryKeys })

  assert.deepEqual(plan.summary.visibility, ['/人物/*/好感度', '/人物/*/暗恋度', '/全局/黑化值'])
  assert.deepEqual(checkMvuCard(raw.data), { errors: [], warnings: [] })
  assert.deepEqual(extractCardMvuVisibility(raw)['/全局/黑化值'].revealWhen, { path: '/结局/真相揭晓', equals: true })
  assert.match(surveyText(surveyMvuCard(raw)), /隐藏属性：\/人物\/\*\/好感度\(tiered\)、\/人物\/\*\/暗恋度\(trend\)、\/全局\/黑化值\(masked\)/)

  // Generated panel renders bar ONLY for visible 体力, NOT for hidden 好感度/暗恋度/黑化值
  const html = generatePanel({}, {
    状态: { 体力: 80 },
    人物: { 林雪: { 好感度: 65, 暗恋度: 20 } },
    全局: { 黑化值: 15 }
  }, extractCardMvuVisibility(raw))
  assert.match(html, /data-mvu-width="\/状态\/体力"/)
  assert.doesNotMatch(html, /data-mvu-width="\/人物\/林雪\/好感度"/)
  assert.doesNotMatch(html, /data-mvu-width="\/全局\/黑化值"/)

  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  const w = dom.window
  const state = { 状态: { 体力: 80 }, 人物: { 林雪: { 好感度: 65, 暗恋度: 20 } }, 全局: { 黑化值: 15 } }
  Object.assign(w, {
    Mvu: { getMvuData: () => ({ stat_data: state }), events: {} },
    tavern_events: {}, waitGlobalInitialized: async () => {}, eventOn: () => {}
  })
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(w.document.querySelector('[data-mvu="/状态/体力"]').textContent, '80')
  assert.equal(w.document.querySelector('[data-mvu="/人物/林雪/好感度"]').textContent, '熟稔')
  assert.equal(w.document.querySelector('[data-mvu="/人物/林雪/暗恋度"]').textContent, '？？？')
  assert.equal(w.document.querySelector('[data-mvu="/全局/黑化值"]').textContent, '未知')
})

test('MVU 变量面板：字段页显示只读锁标、JSON 页显示占位符、编辑公开变量保存时原样保留隐藏真值', async () => {
  const { JSDOM } = loadPackage('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:41661/' })
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true
  })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })

  const React = loadPackage('react')
  const { createRoot } = loadPackage('react-dom/client')
  const act = React.act || loadPackage('react-dom/test-utils').act
  const visSource = readFileSync(path.join(root, 'tavern-plugin/lib/domain/mvu-visibility.js'), 'utf8').replace(/\r?\nexport \{[\s\S]*\}\r?\n?$/, '\n')
  const editorSource = readFileSync(path.join(root, 'tavern-plugin/lib/domain/mvu-variable-editor.js'), 'utf8').replace(/\r?\nexport \{[\s\S]*\}\r?\n?$/, '\n')
  const panelSource = readFileSync(path.join(root, 'tavern-plugin/src/client/modules/mvu-variables.js'), 'utf8')
  const controls = clientControls(React)
  const factory = new Function('React', 'rpc', 'liveTavernView', ...Object.keys(controls), visSource + '\n' + editorSource + '\n' + panelSource + '\nreturn { TavernMvuVariables };')

  const calls = []
  const { TavernMvuVariables } = factory(React, async (method, args, sessionId) => {
    calls.push({ method, args, sessionId })
    return { updated: true }
  }, { invalidate() {} }, ...Object.values(controls))

  const view = {
    latestAssistantTurn: 2,
    mvuVisibility: VISIBILITY_FIXTURE,
    tavernHelper: {
      mvuEnabled: true,
      lifecycleRevision: 3,
      turnMessageIds: { 2: 0 },
      messages: [{
        message_id: 0, role: 'assistant', swipe_id: 0,
        variables: {
          stat_data: {
            金币: 100,
            人物: { 林雪: { 好感度: 68, 暗恋度: 35 } },
            全局: { 黑化值: 42 }
          },
          schema: { type: 'object', properties: {} }
        }
      }]
    }
  }

  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const reactRoot = createRoot(host)
  await act(async () => { reactRoot.render(React.createElement(TavernMvuVariables, { sessionId: 's1', view })) })
  try {
    const toggle = Array.from(host.querySelectorAll('button')).find(b => /MVU 变量/.test(b.textContent))
    await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })

    // Open nested <details> so all fields are visible
    host.querySelectorAll('details').forEach(d => { d.open = true })
    assert.doesNotMatch(host.textContent, /68|35|42/)
    assert.match(host.textContent, /🔒 熟稔/)
    assert.match(host.textContent, /🔒 ？？？/)
    assert.match(host.textContent, /🔒 未知/)

    // Switch to JSON tab: hidden values are replaced with MVU_HIDDEN_SENTINEL
    const jsonTab = Array.from(host.querySelectorAll('[role="tab"]')).find(b => b.textContent === 'JSON')
    await act(async () => { jsonTab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    const textarea = host.querySelector('textarea')
    assert.ok(textarea)
    assert.doesNotMatch(textarea.value, /68|35|42/)
    assert.match(textarea.value, /\$mvu_hidden\$/)

    // Edit visible 金币 in JSON while even attempting to tamper with 黑化值; save restores true hidden numbers
    const nextJson = JSON.stringify({
      金币: 250,
      人物: { 林雪: { 好感度: MVU_HIDDEN_SENTINEL, 暗恋度: MVU_HIDDEN_SENTINEL } },
      全局: { 黑化值: 999 }
    }, null, 2)
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, nextJson)
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const save = Array.from(host.querySelectorAll('button')).find(b => b.textContent === '保存修改')
    await act(async () => { save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 10)) })

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].args.variables.stat_data, {
      金币: 250,
      人物: { 林雪: { 好感度: 68, 暗恋度: 35 } },
      全局: { 黑化值: 42 }
    })
  } finally {
    await act(async () => { reactRoot.unmount() })
    host.remove()
  }
})

test('展示帧上下文与前台工具回显脱敏：不修改原始结算对象且精确遮罩隐藏路径', () => {
  const rawRow = {
    message_id: 1,
    role: 'assistant',
    swipe_id: 0,
    variables: {
      stat_data: { 体力: 90, 人物: { 林雪: { 好感度: 72, 暗恋度: 18 } } },
      display_data: { 体力: 90, 人物: { 林雪: { 好感度: 72, 暗恋度: 18 } } }
    }
  }
  const maskedRow = maskMvuHelperMessageRow(rawRow, VISIBILITY_FIXTURE)
  // Original row stays untouched for official MVU settlement sandbox
  assert.equal(rawRow.variables.stat_data.人物.林雪.好感度, 72)
  assert.equal(maskedRow.variables.stat_data.体力, 90)
  assert.equal(maskedRow.variables.stat_data.人物.林雪.好感度, '熟稔')
  assert.equal(maskedRow.variables.stat_data.人物.林雪.暗恋度, '？？？')
  assert.equal(maskedRow.variables.display_data.人物.林雪.好感度, '熟稔')

  // Display frame script write-back containing masked display strings restores authoritative numbers
  const restoredFromDisplay = restoreHiddenMvuStatData(
    { 体力: 75, 人物: { 林雪: { 好感度: '熟稔', 暗恋度: '？？？' } } },
    rawRow.variables.stat_data,
    VISIBILITY_FIXTURE,
    { lockHidden: false }
  )
  assert.deepEqual(restoredFromDisplay, { 体力: 75, 人物: { 林雪: { 好感度: 72, 暗恋度: 18 } } })

  // Foreground tavern_read_variables UI process log masks hidden leaf values
  const singleRead = JSON.stringify({ available: true, action: 'read', path: '/人物/林雪/好感度', found: true, type: 'number', value: 72, nextCursor: null })
  const maskedSingle = JSON.parse(maskTavernReadVariablesResultText(singleRead, VISIBILITY_FIXTURE))
  assert.equal(maskedSingle.value, '熟稔')
  assert.equal(maskedSingle.hidden, true)

  const dirRead = JSON.stringify({
    available: true, action: 'read', path: '/人物/林雪', found: true, type: 'object',
    entries: [
      { path: '/人物/林雪/好感度', type: 'number', value: 72 },
      { path: '/人物/林雪/地点', type: 'string', value: '天台' }
    ]
  })
  const maskedDir = JSON.parse(maskTavernReadVariablesResultText(dirRead, VISIBILITY_FIXTURE))
  assert.equal(maskedDir.entries[0].value, '熟稔')
  assert.equal(maskedDir.entries[1].value, '天台')
})

test('客户端变量回执弹窗与气泡回执渲染三种隐藏模式，无原始数值泄露', () => {
  const visSource = readFileSync(path.join(root, 'tavern-plugin/lib/domain/mvu-visibility.js'), 'utf8').replace(/\r?\nexport \{[\s\S]*\}\r?\n?$/, '\n')
  const receiptUiSource = readFileSync(path.join(root, 'tavern-plugin/src/client/variable-receipt.js'), 'utf8')
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const ReactMock = { createElement: h, useState: v => [v, () => {}] }
  const { VariableReceipt } = new Function('React', visSource + '\n' + receiptUiSource + '\nreturn { VariableReceipt };')(ReactMock)

  function textOf(node) {
    if (Array.isArray(node)) return node.map(textOf).join(' ')
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'function') return ''
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return textOf(node.type(Object.assign({}, node.props, { children: node.children })))
      return textOf(node.children)
    }
    return String(node)
  }

  const receipt = {
    status: 'updated',
    changes: [
      { operation: 'set', path: '/stat_data/人物/林雪/好感度', before: '58', after: '64' },
      { operation: 'set', path: '/stat_data/人物/苏晴/好感度', before: '62', after: '66' },
      { operation: 'set', path: '/stat_data/人物/林雪/暗恋度', before: '30', after: '15' },
      { operation: 'set', path: '/stat_data/全局/黑化值', before: '10', after: '28' }
    ]
  }
  const tree = VariableReceipt({ receipt, visibility: VISIBILITY_FIXTURE, sessionId: 's', turn: 2, latest: false, busy: false })
  const rendered = textOf(tree)
  assert.doesNotMatch(rendered, /58|64|62|66|30|15|10|28/)
  assert.match(rendered, /疏离.*→.*熟稔.*↑/)
  assert.match(rendered, /熟稔.*略有上升 ↑/)
  assert.match(rendered, /大幅下降 ↓↓/)
  assert.match(rendered, /已发生变化/)
})


test('revealWhen {path, equals} shows a hidden value once the variable it names holds that value', () => {
  const visibility = validateMvuVisibility({ '/幕后/暗处': { mode: 'masked', revealWhen: { path: '/幕后/看见', equals: true } } }).normalized
  const hidden = { 幕后: { 看见: false, 暗处: { q1: 2 } } }, seen = { 幕后: { 看见: true, 暗处: { q1: 2 } } }
  assert.equal(maskMvuStatDataForDisplay(hidden, visibility).幕后.暗处, '？？？')
  assert.deepEqual(maskMvuStatDataForDisplay(seen, visibility).幕后.暗处, { q1: 2 })
  assert.equal(maskMvuReceipt({ changes: [{ path: '/stat_data/幕后/暗处/q1', before: '1', after: '2', operation: 'replace' }] }, visibility).changes[0].after, '？？？', 'a receipt has no variables to read the condition from: it stays masked')
})
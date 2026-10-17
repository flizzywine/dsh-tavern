import assert from 'node:assert/strict'
import test from 'node:test'

import { planMvuApply } from '../tavern-plugin/lib/domain/mvu-card-apply.js'
import { checkMvuCard } from '../tavern-plugin/lib/domain/mvu-card-check.js'

const card = () => ({
  spec: 'chara_card_v3',
  data: {
    first_mes: '雨夜，事务所。', alternate_greetings: ['清晨，码头。'],
    character_book: { entries: [{ comment: '人物', keys: ['甲'], content: '甲是侦探。' }] },
    extensions: { regex_scripts: [{ id: 'old', scriptName: '美化', findRegex: '/美化前/g', replaceString: 'b' }] }
  }
})
function apply(raw, plan) {
  Object.assign(raw.data, plan.fields)
  for (const op of plan.rawOperations) raw.data.extensions.regex_scripts = op.value
  for (const op of plan.worldbook) {
    if (op.op === 'add') raw.data.character_book.entries.push({ ...op.entry, keys: op.entry.primaryKeys })
    else Object.assign(raw.data.character_book.entries[Number(op.ref.slice(6))], op.patch)
  }
  return raw
}

test('首次写入：每个开场追加初值与入口，世界书加两条，正则加面板与隐藏，开场正文不动，结果通过校验', () => {
  const raw = card()
  const plan = planMvuApply(raw, {
    variables: { 时间: { 时段: '夜' }, 状态: { 体力: 60 }, 线索: [] },
    openings: [null, { 时间: { 时段: '晨' } }],
    rules: '体力：受伤 -10~-30。',
    panel: { title: '侦探手记', sections: [{ title: '状态', fields: [{ path: '/状态/体力', kind: 'bar' }, { path: '/线索', kind: 'list' }] }] }
  })
  apply(raw, plan)
  assert.match(raw.data.first_mes, /^雨夜，事务所。\n\n<initvar>\n\{\n {2}"\$meta": \{\n {4}"strictSet": true[\s\S]*"时段": "夜"[\s\S]*<\/initvar>\n\n<mvu-status\/>$/)
  assert.match(raw.data.alternate_greetings[0], /^清晨，码头。[\s\S]*"时段": "晨"[\s\S]*"体力": 60/)
  const [, rules, init] = raw.data.character_book.entries
  assert.equal(rules.comment, '[mvu_update]状态更新规则')
  assert.equal(rules.constant, true)
  assert.match(rules.content, /体力：受伤[\s\S]*mvu_submit_update/)
  assert.equal(init.enabled, false)
  assert.deepEqual(raw.data.extensions.regex_scripts.map(rule => rule.id), ['old', 'dsh-mvu-status-view', 'dsh-mvu-hide-marker'])
  assert.match(raw.data.extensions.regex_scripts[1].replaceString, /^```html\n<!doctype html>[\s\S]*侦探手记[\s\S]*data-mvu-width="\/状态\/体力"/)
  assert.deepEqual(plan.summary, { openings: 2, variables: ['/时间/时段', '/状态/体力', '/线索'], rules: 'added', panel: 'generated', removed: { openings: 0, entries: 0, regex: 0 } })
  assert.deepEqual(checkMvuCard(raw.data), { errors: [], warnings: [] })
})

test('生成的标准面板读取变量、随更新刷新，进度条、列表和空值可用', async () => {
  const { JSDOM } = await import('jsdom')
  const { generatePanel } = await import('../tavern-plugin/lib/domain/mvu-card-apply.js')
  const html = generatePanel({}, { 地点: { 名称: '' }, 状态: { 体力: 50 }, 线索: ['旧烟盒'] })
  const dom = new JSDOM(html, { runScripts: 'outside-only' })
  const handlers = new Map(), w = dom.window
  let state = { 地点: { 名称: '事务所' }, 状态: { 体力: 50 }, 线索: ['旧烟盒'] }
  Object.assign(w, {
    Mvu: { getMvuData: () => ({ stat_data: state }), events: { VARIABLE_INITIALIZED: 'init', VARIABLE_UPDATE_ENDED: 'update' } },
    tavern_events: {}, waitGlobalInitialized: async () => {}, eventOn: (name, callback) => handlers.set(name, callback)
  })
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1])
  await new Promise(resolve => setImmediate(resolve))
  const q = selector => w.document.querySelector(selector)
  assert.equal(q('[data-mvu="/地点/名称"]').textContent, '事务所')
  assert.equal(q('[data-mvu-width="/状态/体力"]').style.width, '50%')
  state = { 地点: { 名称: '' }, 状态: { 体力: 80 }, 线索: [] }
  handlers.get('update')()
  assert.equal(q('[data-mvu="/地点/名称"]').textContent, '未明确')
  assert.equal(q('[data-mvu-width="/状态/体力"]').style.width, '80%')
  assert.deepEqual([...w.document.querySelectorAll('li')].map(li => li.textContent), ['无'])
})

test('概览一次列出开场、世界书、正则与脚本，并标出可能的旧状态协议', async () => {
  const { surveyMvuCard, surveyText } = await import('../tavern-plugin/lib/domain/mvu-card-apply.js')
  const raw = card()
  raw.data.character_book.entries.push({ comment: '状态栏格式', content: '每轮回复末尾输出 <status>…</status>', constant: true })
  raw.data.extensions.regex_scripts.push({ id: 'st', scriptName: '状态栏美化', findRegex: '/<status>([\\s\\S]*?)<\\/status>/g', replaceString: '<div>$1</div>' })
  const text = surveyText(surveyMvuCard(raw))
  assert.match(text, /开场 2 个：\n- \/data\/first_mes · 7字 · 开头：雨夜，事务所。\n- \/data\/alternate_greetings\/0/)
  assert.match(text, /- entry:1 状态栏格式 · 常驻 · \d+字 \[状态输出\]/)
  assert.match(text, /- \/data\/extensions\/regex_scripts\/1 状态栏美化 · 查找 .* \[状态输出\/HTML\]/)
  assert.match(text, /脚本 0 个/)
  const converted = apply(raw, planMvuApply(raw, { variables: { 体力: 1 }, rules: 'r' }))
  assert.match(surveyText(surveyMvuCard(converted)), /有<initvar> · 有<mvu-status\/>[\s\S]*现有变量：\/体力/)
})

test('remove 在同一次写入里删掉开场旧状态块、旧说明条目和旧正则，编号不因删除错位', () => {
  const raw = card()
  raw.data.first_mes += '\n\n<状态>体力:60</状态>'
  raw.data.alternate_greetings[0] += '\n<状态>体力:80</状态>'
  raw.data.character_book.entries.push({ comment: '状态栏格式', content: '每轮输出 <状态>' })
  raw.data.extensions.regex_scripts.push({ id: 'st', scriptName: '状态栏', findRegex: '/<状态>/g', replaceString: '' })
  const plan = planMvuApply(raw, { variables: { 体力: 60 }, rules: '规则', remove: { fromOpenings: '\\n*<状态>[\\s\\S]*?</状态>', entries: ['entry:1'], regex: ['st'] } })
  assert.deepEqual(plan.worldbook.map(op => op.op + ':' + (op.ref || '')), ['add:', 'add:', 'delete:entry:1'])
  assert.deepEqual(plan.rawOperations[0].value.map(rule => rule.id), ['old', 'dsh-mvu-status-view', 'dsh-mvu-hide-marker'])
  assert.match(plan.fields.first_mes, /^雨夜，事务所。\n\n<initvar>/)
  assert.doesNotMatch(plan.fields.alternate_greetings[0], /<状态>/)
  assert.deepEqual(plan.summary.removed, { openings: 2, entries: 1, regex: 1 })
  assert.throws(() => planMvuApply(raw, { remove: { fromOpenings: '<不存在>' } }), /都没有匹配，未保存/)
  assert.throws(() => planMvuApply(raw, { remove: { regex: ['nope'] } }), /正则不存在/)
})

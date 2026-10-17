import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'
import { validateCardText } from '../tavern-plugin/lib/domain/card-validation.js'

const root = new URL('../presets/tavern/skills/', import.meta.url)
const format = await readFile(new URL('card-to-mvu/references/mvu-format.md', root), 'utf8')
const panel = format.match(/```html\n([\s\S]*?)\n```/)[1]
const regexScripts = JSON.parse(format.match(/```json\n(\[[\s\S]*?\])\n```/)[1].replace('（面板 HTML）', () => panel.replace(/\n/g, '\\n').replace(/"/g, '\\"')))

for (const name of ['card-to-mvu', 'edit-card', 'create-card']) test(`${name} 可由 Tavern 内置目录读取，引用资源齐全且默认可调用`, async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read(name)
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\n([\s\S]*?)\n---/)[1])
  assert.equal(metadata.name, name)
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 500)
  for (const [, relative] of skill.content.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)) {
    assert.ok((await readFile(new URL(relative, new URL(name + '/', root)), 'utf8')).length > 0)
  }
  assert.doesNotMatch(skill.content, /tavern_card_draft|mvu_appearance|convert_to_mvu/)
})

test('格式约定里的面板模板读取变量、随更新刷新，进度条和列表可用', async () => {
  const dom = new JSDOM(panel, { runScripts: 'outside-only' })
  const handlers = new Map(), w = dom.window
  let state = { 地点: { 名称: '事务所' }, 状态: { 体力: 50 }, 线索: ['旧烟盒'] }
  Object.assign(w, {
    Mvu: { getMvuData: () => ({ stat_data: state }), events: { VARIABLE_INITIALIZED: 'init', VARIABLE_UPDATE_ENDED: 'update' } },
    tavern_events: { CHAT_CHANGED: 'chat' }, waitGlobalInitialized: async () => {}, eventOn: (name, callback) => handlers.set(name, callback)
  })
  w.eval(panel.match(/<script>([\s\S]*?)<\/script>/)[1])
  await new Promise(resolve => setImmediate(resolve))
  const q = selector => w.document.querySelector(selector)
  assert.equal(q('[data-mvu="/地点/名称"]').textContent, '事务所')
  assert.equal(q('[data-mvu-width]').style.width, '50%')
  assert.deepEqual([...w.document.querySelectorAll('li')].map(li => li.textContent), ['旧烟盒'])
  state = { 地点: { 名称: '码头' }, 状态: { 体力: 80 }, 线索: [] }
  handlers.get('update')()
  assert.equal(q('[data-mvu="/地点/名称"]').textContent, '码头')
  assert.equal(q('[data-mvu-width]').style.width, '80%')
  assert.equal(w.document.querySelectorAll('li').length, 0)
  assert.ok(handlers.has('chat') && handlers.has('init'))
})

function card(patch = () => {}) {
  const state = { $meta: { strictSet: true }, 地点: { 名称: '事务所' }, 状态: { 体力: 62 }, 线索: [] }
  const greeting = (text, value = state) => text + '\n\n<initvar>\n' + JSON.stringify(value, null, 2) + '\n</initvar>\n\n<mvu-status/>'
  const data = {
    name: '沈清岚', first_mes: greeting('雨夜事务所。'), alternate_greetings: [greeting('雨夜现场。', { ...state, 地点: { 名称: '老闸区' } })],
    character_book: { entries: [{ comment: '[mvu_update]状态更新规则', content: '按正文更新地点', enabled: true, constant: true, keys: [] }] },
    extensions: { regex_scripts: structuredClone(regexScripts) }
  }
  patch(data)
  return validateCardText(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data }))
}
const messages = report => report.errors.concat(report.warnings).map(item => item.path + ' ' + item.message).join('\n')

test('按格式约定写的 MVU 卡校验通过', () => {
  const report = card()
  assert.equal(report.valid, true, messages(report))
  assert.equal(report.warnings.length, 1, messages(report))
})

test('校验指出 MVU 卡常见格式错误的位置', () => {
  let report = card(data => { data.first_mes = data.first_mes.replace('"名称": "事务所"', '"名称": "事务所"]]') })
  assert.equal(report.valid, false)
  assert.match(messages(report), /\/data\/first_mes <initvar> 不是有效 JSON\/YAML/)
  report = card(data => { data.extensions.regex_scripts = [] })
  assert.match(report.errors.map(item => item.message).join(), /没有把它替换成面板的正则/)
  report = card(data => { data.extensions.regex_scripts[0].replaceString = data.extensions.regex_scripts[0].replaceString.replace('function render() {', 'function render() {{') })
  assert.match(report.errors.map(item => item.message).join(), /面板脚本语法错误/)
  report = card(data => { data.extensions.regex_scripts[0].replaceString += '<b>$1</b><span data-mvu="/不存在"></span>'; data.extensions.regex_scripts[1].findRegex = '/(/' })
  assert.match(messages(report), /含 "\$1"/)
  assert.match(messages(report), /引用的变量路径在初值中不存在：\/不存在/)
  assert.match(messages(report), /regex_scripts\/1\/findRegex 正则无法编译/)
  report = card(data => { data.alternate_greetings[0] = data.alternate_greetings[0].replace('"线索": []', '"线索": [], "天气": "雨"'); data.character_book.entries = [] })
  assert.equal(report.valid, true)
  assert.match(messages(report), /\/data\/first_mes 初值缺少其他开场有的字段：\/天气/)
  assert.match(messages(report), /没有 \[mvu_update\] 条目/)
})

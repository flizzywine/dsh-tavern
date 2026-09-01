import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { parse } from 'yaml'
import { createTavernSkillModule } from '../tavern-plugin/lib/domain/tavern-skills.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { constantWorldBookContext, mvuUpdateRulesFromWorldBook } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

const root = new URL('../presets/tavern/skills/', import.meta.url)
const backgroundRoot = new URL('../presets/tavern-background/skills/', import.meta.url)
const skillRoot = new URL('tavern-card-to-mvu/', root)
const recipe = await readFile(new URL('references/mvu-recipe.md', skillRoot), 'utf8')
const statusHtml = await readFile(new URL('assets/status.html', skillRoot), 'utf8')

test('转换 Skill 可由 Tavern 内置目录读取，引用资源齐全且默认可调用', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('tavern-card-to-mvu')
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\n([\s\S]*?)\n---/)[1])
  assert.equal(metadata.name, 'tavern-card-to-mvu')
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 500)
  assert.notEqual(metadata['disable-model-invocation'], true)
  assert.notEqual(metadata['user-invocable'], false)
  for (const [, relative] of skill.content.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)) {
    assert.ok((await readFile(new URL(relative, skillRoot), 'utf8')).length > 0)
  }
})

test('转换 Skill 清理副本内重复的候选项生成机制并保留无关内容', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('tavern-card-to-mvu')
  assert.match(skill.content, /候选项生成提示、按钮、正则、HTML 与 Helper 脚本/)
  assert.match(skill.content, /只清理[^\n]*候选项生成[^\n]*保留[^\n]*无关/)
  assert.match(skill.content, /DSH Tavern 内置候选项/)
  assert.match(skill.content, /不存在第二套候选项生成机制/)
})

test('转换 Skill 直接移除旧协议，不向前台追加迁移说明或新行文规则', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('tavern-card-to-mvu')
  assert.match(skill.content, /直接删除旧状态与候选项协议/)
  assert.match(skill.content, /不写一段“只写剧情正文”或“不再输出[^”]+”作为替代说明/)
  assert.match(skill.content, /新人物登场[^\n]*原卡已有[^\n]*原样保留[^\n]*转换过程不新增/)
})

test('转换 Skill 将随机人物迁移为当前对话专属人物库', async () => {
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: root.pathname })
  const skill = await skills.read('tavern-card-to-mvu')
  assert.match(skill.content, /当前对话[^\n]*人物库/)
  assert.match(skill.content, /同一张卡[^\n]*新对话/)
  assert.match(skill.content, /tavern-character-design/)
  assert.match(skill.content, /在场[^\n]*false[^\n]*不展示/)
})

test('人物设计是后台专用的独立内置 Skill', async () => {
  const cardSkillNames = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  const backgroundSkillNames = (await readdir(backgroundRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  assert.equal(cardSkillNames.includes('tavern-character-design'), false)
  assert.deepEqual(backgroundSkillNames, ['tavern-character-design'])
  const skills = createTavernSkillModule({ directory: new URL('../data/skills/', import.meta.url).pathname, builtInDirectory: backgroundRoot.pathname })
  const skill = await skills.read('tavern-character-design')
  assert.equal(skill.source, 'builtin')
  const metadata = parse(skill.content.match(/^---\n([\s\S]*?)\n---/)[1])
  assert.equal(metadata.name, 'tavern-character-design')
  assert.equal(metadata['user-invocable'], false)
  assert.match(skill.content, /提前储备/)
  assert.match(skill.content, /尚未登场人物/)
  assert.match(skill.content, /可设计字段/)
  assert.match(skill.content, /纯运行状态/)
  assert.match(skill.content, /当前变量、变量模板与 Schema、人物卡 `\[mvu_update\]` 规则/)
  assert.match(skill.content, /派生字段和只读字段/)
  assert.match(skill.content, /character_design_read/)
  assert.match(skill.content, /character_design_save/)
  assert.match(skill.content, /人物档案是完整设计的源，MVU 变量是面向结算与展示的投影/)
  assert.match(skill.content, /不使用“未明确”“未知”“待定”/)
  assert.match(skill.content, /不设固定数量上限/)
  assert.doesNotMatch(skill.content, /仅在卡片已有人物库/)
  assert.match(skill.content, /mvu_submit_update/)
  assert.match(skill.content, /不[^\n]*前台正文 Agent/)
})

test('Skill 配方可构造可导入卡，规则分流、状态显示及模型历史隔离均有效', () => {
  const entries = JSON.parse(recipe.match(/```json\n([\s\S]*?)\n```/)[1])
  const regexCode = recipe.match(/```js\n([\s\S]*?)\n```/)[1]
  const regex = vm.runInNewContext(regexCode + '\nJSON.stringify(statusRegex)', { statusHtml })
  const card = { spec: 'chara_card_v3', spec_version: '3.0', data: {
    name: '转换配方测试', description: '{{char}} 与 {{user}} 的旅途。',
    first_mes: '你站在门口。\n\n<mvu-status/>',
    character_book: { name: '状态', entries },
    extensions: { tavern_helper: { scripts: [], variables: {} }, regex_scripts: JSON.parse(regex) }
  } }
  const prep = createCardPreparation({ id: () => 'skill-recipe-test', now: () => 1 })
  const workspace = prep.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify(card) } })
  const exported = prep.present({ card: workspace, as: 'sillytavern-v3' })
  assert.deepEqual(exported.data.character_book, card.data.character_book)
  const extensions = inspectCardExtensions(exported)
  assert.ok(extensions.mvuResources.some(resource => resource.enabled))
  const worldBook = { view: inspectWorldBookDocument(exported) }
  assert.equal(constantWorldBookContext({ worldBook }).context, '')
  assert.deepEqual(mvuUpdateRulesFromWorldBook(worldBook), [entries[1].content])
  const initial = JSON.parse(entries[0].content)
  assert.equal(initial.人物库.$meta.extensible, true)
  assert.equal(initial.人物库.$meta.template.状态.在场, false)
  assert.equal(initial.人物库.$meta.template.设计.性格, '')
  assert.equal(initial.玩家.位置, '门口')
  const layers = projectReplyLayers(card.data.first_mes, { regexScripts: extensions.regexScripts, placement: 2, depth: 0 })
  assert.equal(layers.sessionText.trim(), '你站在门口。')
  const index = layers.displayParts.findIndex(part => part.content?.includes('Mvu.getMvuData'))
  assert.ok(index >= 0)
  const result = projectPersistentStatusView([
    { role: 'assistant', turn: 1, displayRuntime: { frames: [{ partIndex: index, mvuViewUsed: true }] } }
  ], [{ turn: 1, parts: layers.displayParts }])
  assert.ok(result.statusView?.content.includes('Mvu.getMvuData'))
})

test('通用状态模板重新读取变量并刷新 DOM，支持新增与恢复且跳过内部字段', async () => {
  function node() {
    return { textContent: '', children: [], replaceChildren() { this.children = [] }, append(...children) { this.children.push(...children) } }
  }
  const nodes = { notice: node(), values: node() }
  const handlers = new Map()
  let data = { 玩家: { 位置: '门口' }, 人物: { $meta: { extensible: true } }, __internal: '隐藏' }
  const sandbox = {
    document: { getElementById(id) { return nodes[id] }, createElement: node },
    waitGlobalInitialized: async () => {},
    Mvu: { events: { VARIABLE_INITIALIZED: 'init', VARIABLE_UPDATE_ENDED: 'update' }, getMvuData(options) {
      assert.equal(options.type, 'message'); assert.equal(options.message_id, 'latest')
      return { stat_data: data }
    } },
    tavern_events: { MESSAGE_UPDATED: 'message', SAME_EVENT: 'update' },
    eventOn(event, callback) { assert.equal(handlers.has(event), false); handlers.set(event, callback) }
  }
  vm.runInNewContext(statusHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1], sandbox)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(nodes.values.children.map(item => item.textContent), ['玩家 · 位置', '门口'])
  data = { 玩家: { 位置: '大厅' }, 人物: { 新人物: { 姓名: '<img src=x onerror=alert(1)>' } }, 人物库: {
    预备人物: { 姓名: '暂不展示', 状态: { 在场: false } },
    登场人物: { 姓名: '林晴', 状态: { 在场: true } }
  } }
  handlers.get('update')()
  assert.deepEqual(nodes.values.children.map(item => item.textContent), [
    '玩家 · 位置', '大厅', '人物 · 新人物 · 姓名', '<img src=x onerror=alert(1)>',
    '人物库 · 登场人物 · 姓名', '林晴', '人物库 · 登场人物 · 状态 · 在场', 'true'
  ])
  data = { 玩家: { 位置: '门口' } }
  handlers.get('message')()
  assert.deepEqual(nodes.values.children.map(item => item.textContent), ['玩家 · 位置', '门口'])
  data = undefined
  handlers.get('init')()
  assert.equal(nodes.values.children.length, 0)
  assert.ok(nodes.notice.textContent)
})

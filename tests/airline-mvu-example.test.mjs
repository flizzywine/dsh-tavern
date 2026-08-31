import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCard, cardName, initialVariables, updateRules } from '../examples/airline-mvu/card-source.mjs'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { inspectCardExtensions } from '../tavern-plugin/lib/domain/card-extension-reading.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'
import { constantWorldBookContext, mvuUpdateRulesFromWorldBook } from '../tavern-plugin/lib/domain/worldbook-recall.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { projectPersistentStatusView } from '../tavern-plugin/lib/domain/persistent-status-view.js'

test('航空 MVU 卡可导入导出，并与可读源保持一致', () => {
  const card = buildCard();
  assert.deepEqual(JSON.parse(readFileSync(new URL('../examples/airline-mvu/card.json', import.meta.url))), card)
  const prep = createCardPreparation({ id: () => 'airline-test', now: () => 1 })
  const workspace = prep.create({ kind: 'import', payload: { kind: 'text', text: JSON.stringify(card) } })
  assert.equal(prep.project(workspace).name, cardName)
  assert.deepEqual(prep.present({ card: workspace, as: 'sillytavern-v3' }).data.character_book, card.data.character_book)
  assert.ok(inspectCardExtensions(card).mvuResources.some(item => item.enabled))
})

test('初始化不进入剧情，更新规则只进入后台，初始集合允许新增人物和任务', () => {
  const worldBook = { view: inspectWorldBookDocument(buildCard()) }
  assert.equal(constantWorldBookContext({ worldBook }).context, '')
  assert.deepEqual(mvuUpdateRulesFromWorldBook(worldBook), [updateRules])
  assert.equal(initialVariables.人物.$meta.extensible, true)
  assert.equal(initialVariables.任务.$meta.extensible, true)
  assert.equal(initialVariables.人物.澹台矜.年龄, 23)
})

test('开场只在显示层挂载状态模板，模型历史不含模板与占位符', () => {
  const card = buildCard(), extensions = inspectCardExtensions(card)
  const result = projectReplyLayers(card.data.first_mes, { regexScripts: extensions.regexScripts, placement: 2, depth: 0 })
  assert.match(result.sessionText, /舱内广播/)
  assert.doesNotMatch(result.sessionText, /airline-status|<script>|<html|Mvu\./)
  const viewIndex = result.displayParts.findIndex(part => part.content?.includes('Mvu.getMvuData'))
  assert.ok(viewIndex >= 0)
  const promoted = projectPersistentStatusView([
    { role: 'assistant', turn: 1, displayRuntime: { frames: [{ partIndex: viewIndex, mvuViewUsed: true }] } }
  ], [{ turn: 1, parts: result.displayParts }])
  assert.ok(promoted.statusView?.content.includes('Mvu.getMvuData'))
  assert.ok(promoted.projections[0].parts.some(part => (part.content || part.text).includes('舱内广播')))
  assert.ok(promoted.projections[0].parts.every(part => !part.content?.includes('Mvu.getMvuData')))
})

test('展示模板只读，动态文字通过 textContent 展示，没有外链和轮询', () => {
  const view = readFileSync(new URL('../examples/airline-mvu/status.html', import.meta.url), 'utf8')
  assert.doesNotMatch(view, /innerHTML|replaceVariables|updateVariablesWith|setInterval|https?:\/\//)
  assert.match(view, /VARIABLE_UPDATE_ENDED/)
  assert.match(view, /Object.values\(tavern_events\)/)
})

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cardOpeningChoices } from '../tavern-plugin/lib/domain/card-openings.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { renderTavernHelperVariableMacros } from '../tavern-plugin/lib/domain/tavern-helper-variable-macros.js'
import { createTavernMvuRuntime, readMvuWorldBookInitialState } from '../tavern-plugin/lib/domain/tavern-mvu-runtime.js'

const cardPath = process.env.DSH_TAVERN_LIGHTHOUSE_CARD
  || path.join(homedir(), '.dsh/profile-data/tavern/data/resources/cards/灯火阑珊.json')

test('真实《灯火阑珊》通过现有卡片投影完成 MVU 多 swipe 初始化', { skip: !existsSync(cardPath) }, async () => {
  const workspace = JSON.parse(await readFile(cardPath, 'utf8'))
  const cards = createCardPreparation({ id: () => 'lighthouse', now: () => 0 })
  const card = cards.project(workspace)
  const extensions = cards.present({ card: workspace, as: 'card-extensions' })
  const openings = cardOpeningChoices(card)

  assert.equal(card.name, '灯火阑珊')
  assert.ok(openings.length > 1, '真实卡应保留多个开场 swipe')
  assert.deepEqual(extensions.helperScripts.map(item => item.name), [
    'MVU',
    '灯火阑珊-变量结构',
    '灯火阑珊-动态世界书管理',
    '开场白索引',
    '变量守卫'
  ])
  assert.match(extensions.helperScripts[0].content, /MagicalAstrogy\/MagVarUpdate\/artifact\/bundle\.js/)

  const macroContext = { userName: '王辰', charName: card.name }
  const worldBook = readMvuWorldBookInitialState(card.character_book, macroContext)
  const initialized = await createTavernMvuRuntime().initializeChat({
    swipes: openings.map(item => item.text),
    selectedSwipeId: 0,
    baseStatData: worldBook.statData,
    initializedLorebooks: worldBook.initializedLorebooks,
    macroContext
  })

  assert.equal(initialized.variables.length, openings.length)
  assert.deepEqual(initialized.variables[0].initialized_lorebooks, { [card.character_book.name]: [] })
  assert.ok(initialized.variables.filter(item => Object.keys(item.stat_data).length > 0).length >= openings.length - 1)
  assert.deepEqual(Object.keys(initialized.variables[0].stat_data).slice(0, 3), ['世界时钟', '世界地图', '世界图志'])
  assert.ok(initialized.diagnostics.every(item => Number.isInteger(item.swipeId)), '损坏开场初值必须定位到具体 swipe')

  const currentVariableEntry = card.character_book.entries.find(item => String(item.content).includes('{{format_message_variable::stat_data}}'))
  assert.ok(currentVariableEntry, '真实卡应包含当前 MVU 状态注入条目')
  const rendered = renderTavernHelperVariableMacros(currentVariableEntry.content, {
    message: initialized.variables[0]
  })
  assert.doesNotMatch(rendered.text, /\{\{format_message_variable/)
  assert.match(rendered.text, /世界时钟:/)
  assert.match(rendered.text, /世界地图:/)
})

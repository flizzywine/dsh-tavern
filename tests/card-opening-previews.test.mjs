import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { projectCardOpeningPreviews } from '../tavern-plugin/lib/domain/card-opening-previews.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createTavernMvuRuntime } from '../tavern-plugin/lib/domain/tavern-mvu-runtime.js'

const lighthouseCardPath = process.env.DSH_TAVERN_LIGHTHOUSE_CARD
  || path.join(homedir(), '.dsh/profile-data/tavern/data/resources/cards/灯火阑珊.json')

test('开局预览执行人物卡正则并为每个 swipe 投影对应的 MVU 变量', async () => {
  const card = {
    name: '测试卡',
    first_mes: '第一幕 <UpdateVariable>hp: 10</UpdateVariable>',
    alternate_greetings: ['第二幕 <visual_cards>[]</visual_cards>'],
    character_book: { name: '测试世界书', entries: [] }
  }
  const extensions = {
    regexScripts: [
      {
        id: 'update-ui', name: '变量 UI', enabled: true,
        findRegex: '/<UpdateVariable>([\\s\\S]*?)<\\/UpdateVariable>/gi',
        replaceString: '<section class="variable-ui">$1</section>', placement: [2]
      },
      {
        id: 'status-ui', name: '状态栏 UI', enabled: true,
        findRegex: '/<visual_cards>([\\s\\S]*?)<\\/visual_cards>/gi',
        replaceString: '```html\n<div class="status-ui"></div>\n```', placement: [2]
      }
    ],
    mvuResources: [{ enabled: true }]
  }
  const runtime = {
    async initializeChat(input) {
      assert.deepEqual(input.swipes, [card.first_mes, card.alternate_greetings[0]])
      return {
        swipeId: 0,
        swipes: input.swipes,
        variables: [{ stat_data: { hp: 10 } }, { stat_data: { hp: 20 } }],
        diagnostics: [], events: []
      }
    }
  }

  const result = await projectCardOpeningPreviews({
    card,
    extensions,
    runtime,
    userName: '玩家'
  })

  assert.equal(result.openings.length, 2)
  assert.match(result.openings[0].projection.parts[0].content, /class="variable-ui"/)
  assert.match(result.openings[1].projection.parts[0].content, /class="status-ui"/)
  assert.deepEqual(result.openings[0].helperContext.messages[0].variables, { stat_data: { hp: 10 } })
  assert.deepEqual(result.openings[1].helperContext.messages[0].variables, { stat_data: { hp: 20 } })
  assert.equal(result.openings[0].helperContext.messages[0].swipe_id, 0)
  assert.equal(result.openings[1].helperContext.messages[0].swipe_id, 1)
})

test('普通人物卡无需伪造 MVU Helper 上下文', async () => {
  const result = await projectCardOpeningPreviews({
    card: { name: '普通卡', first_mes: '你好，{{user}}。', alternate_greetings: [] },
    extensions: { regexScripts: [], mvuResources: [] },
    runtime: { async initializeChat() { throw new Error('不应初始化 MVU') } },
    userName: '小明'
  })

  assert.equal(result.openings[0].projection.parts[0].content.includes('你好，小明。'), true)
  assert.equal(result.openings[0].helperContext, null)
})

test('真实《灯火阑珊》的 15 条开局全部生成 UI 与对应变量上下文', { skip: !existsSync(lighthouseCardPath) }, async () => {
  const workspace = JSON.parse(await readFile(lighthouseCardPath, 'utf8'))
  const cards = createCardPreparation({ id: () => 'lighthouse', now: () => 0 })
  const result = await projectCardOpeningPreviews({
    card: cards.project(workspace),
    extensions: cards.present({ card: workspace, as: 'card-extensions' }),
    runtime: createTavernMvuRuntime(),
    userName: '王辰'
  })

  assert.equal(result.openings.length, 15)
  assert.ok(result.openings.every(function (opening) {
    return opening.projection.parts.some(function (part) {
      return /cultivation-var-update|\.load\(/.test(String(part.content || ''))
    })
  }))
  assert.deepEqual(result.openings.map(function (opening) {
    return opening.helperContext.messages[0].swipe_id
  }), Array.from({ length: 15 }, function (_, index) { return index }))
})

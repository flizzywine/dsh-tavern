import assert from 'node:assert/strict'
import test from 'node:test'

import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

function card() {
  return {
    name: '阿芙拉',
    description: '{{char}} 是银发佣兵。',
    personality: '谨慎而直接。',
    scenario: '{{user}} 在旅店遇见 {{char}}。',
    mes_example: '{{char}} 对 {{user}} 说：跟紧我。',
    system_prompt: '保持冷静。',
    post_history_instructions: '避免替玩家决定。',
    character_book: {
      entries: [
        { keys: ['黑麦镇'], content: '黑麦镇常年下雨。', constant: true, enabled: true },
        { keys: ['钟楼'], content: '钟楼藏着失踪商队的线索。', enabled: true },
        { keys: ['无关'], content: '遥远王都的资料。', enabled: true },
        { keys: ['旧矿井'], content: '矿井已经封闭。', enabled: true },
        { keys: ['河港'], content: '河港停着三艘货船。', enabled: true }
      ]
    }
  }
}

function chat(messages = [{ role: 'assistant', text: '开场', greeting: true }]) {
  return {
    id: 'chat-1',
    mode: 'story',
    messages,
    posture: '阿芙拉站在窗边，右手按着剑柄。',
    guides: [{ id: 'g1', text: '多写动作，少写解释。' }]
  }
}

test('正文首轮只选择必要世界书并完整替换人物卡模板变量', async () => {
  const calls = []
  const planner = createContextPlanner({
    prompt,
    callModel: async (options) => {
      calls.push(options)
      return '{"ids":["wb-1"]}'
    }
  })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat(),
    userText: '去钟楼看看',
    sessionId: 'session-1',
    nativeTurn: 2,
    scriptReference: { order: 7, text: '两人沿石阶进入钟楼。' }
  })

  assert.equal(calls.length, 1)
  assert.match(calls[0].system, /世界书条目检索器/)
  assert.match(result.text, /黑麦镇常年下雨/)
  assert.match(result.text, /钟楼藏着失踪商队的线索/)
  assert.doesNotMatch(result.text, /遥远王都/)
  assert.match(result.text, /阿芙拉 是银发佣兵/)
  assert.match(result.text, /你 在旅店遇见 阿芙拉/)
  assert.doesNotMatch(result.text, /文风示例|跟紧我/)
  assert.doesNotMatch(result.text, /\{\{char\}\}|\{\{user\}\}/)
  assert.match(result.text, /本轮剧本参考 · 第 8 块/)
  assert.doesNotMatch(result.text, /故事设定 · 人物卡|名字: 阿芙拉/)
  assert.match(result.text, /Guide ＞ 剧本 ＞ 世界一致性 ＞ 本轮演出指引/)
  assert.doesNotMatch(result.text, /以玩家指令为准|否定、撤销或暗中改写玩家行动/)
  assert.match(result.text, /让故事自然贴近剧本/)
  assert.match(result.text, /遣词造句/)
  assert.doesNotMatch(result.text, /不要为通顺牺牲剧本/)
  assert.match(result.text, /【本轮演出指引 · 用户期望看到的演出】/)
  assert.match(result.text, /不能把它当作上一段正文/)
  assert.ok(result.text.indexOf('【本轮演出指引 · 用户期望看到的演出】') > result.text.indexOf('【本轮剧本参考'))
  assert.ok(result.audit.totalChars > 0)
  assert.ok(result.audit.included.some((item) => item.kind === 'world-book'))
})

test('自由故事首轮仍注入人物卡文风示例', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat(),
    userText: '留在旅店交谈',
    sessionId: 'session-1',
    nativeTurn: 2,
    scriptReference: null
  })

  assert.match(result.text, /文风示例/)
  assert.match(result.text, /阿芙拉 对 你 说：跟紧我/)
})

test('后续正文不重复首轮人物卡细节，但保留姿势、Guide 和特殊指令', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat([
      { role: 'assistant', text: '开场', greeting: true },
      { role: 'user', text: '走近窗边' },
      { role: 'assistant', text: '雨水敲打窗棂。' }
    ]),
    userText: '询问线索',
    sessionId: 'session-1',
    nativeTurn: 3
  })

  assert.doesNotMatch(result.text, /银发佣兵/)
  assert.doesNotMatch(result.text, /谨慎而直接/)
  assert.match(result.text, /右手按着剑柄/)
  assert.match(result.text, /多写动作/)
  assert.match(result.text, /避免替玩家决定/)
})

test('自由故事候选按稳定到动态的顺序注入完整人物卡约束', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const task = '候选任务：只输出 JSON。'
  const result = await planner.plan({
    purpose: 'candidate',
    card: card(),
    chat: chat(),
    task,
    scriptWindow: null
  })

  assert.equal(result.text.split(task).length - 1, 1)
  assert.doesNotMatch(result.text, /小说续写引擎/)
  assert.match(result.text, /名字: 阿芙拉/)
  assert.match(result.text, /银发佣兵|谨慎而直接|旅店遇见|跟紧我/)
  assert.match(result.text, /保持冷静|避免替玩家决定/)
  assert.match(result.text, /多写动作/)
  assert.match(result.text, /黑麦镇常年下雨/)
  assert.doesNotMatch(result.text, /钟楼藏着失踪商队的线索/)
  assert.equal(result.audit.included.some((item) => item.kind === 'card'), true)
  assert.ok(result.text.indexOf('候选任务') < result.text.indexOf('黑麦镇常年下雨'))
  assert.ok(result.text.indexOf('谨慎而直接') < result.text.indexOf('黑麦镇常年下雨'))
  assert.ok(result.text.indexOf('保持冷静') < result.text.indexOf('黑麦镇常年下雨'))
  assert.ok(result.text.indexOf('黑麦镇常年下雨') < result.text.indexOf('多写动作'))
  assert.ok(result.text.indexOf('多写动作') < result.text.indexOf('右手按着剑柄'))
})

test('剧本候选注入人物卡但排除文风示例，剧本块放在动态上下文末尾', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const task = '剧本候选任务：只输出 JSON。'
  const result = await planner.plan({
    purpose: 'candidate',
    card: card(),
    chat: Object.assign(chat(), { mode: 'script' }),
    task,
    scriptWindow: {
      title: '银铃', cursor: 1, total: 3, ended: false,
      chunks: [{ id: 'chunk-2', order: 1, text: '两人沿石阶走近钟楼。' }]
    }
  })

  assert.match(result.text, /名字: 阿芙拉|谨慎而直接|保持冷静/)
  assert.doesNotMatch(result.text, /文风示例|跟紧我/)
  assert.ok(result.text.indexOf('剧本候选任务') < result.text.indexOf('谨慎而直接'))
  assert.ok(result.text.indexOf('谨慎而直接') < result.text.indexOf('黑麦镇常年下雨'))
  assert.ok(result.text.indexOf('黑麦镇常年下雨') < result.text.indexOf('多写动作'))
  assert.ok(result.text.indexOf('多写动作') < result.text.indexOf('右手按着剑柄'))
  assert.ok(result.text.indexOf('右手按着剑柄') < result.text.indexOf('两人沿石阶走近钟楼'))
  assert.match(result.stableText, /剧本候选任务|名字: 阿芙拉|谨慎而直接|保持冷静|黑麦镇常年下雨/)
  assert.doesNotMatch(result.stableText, /多写动作|右手按着剑柄|两人沿石阶走近钟楼/)
  assert.match(result.dynamicText, /多写动作|右手按着剑柄|两人沿石阶走近钟楼/)
  assert.doesNotMatch(result.dynamicText, /剧本候选任务|名字: 阿芙拉|谨慎而直接|保持冷静/)
})

test('世界书模型失败时用关键词确定性回退，不阻断正文规划', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => { throw new Error('模型不可用') }, logger: { error() {} } })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat(),
    userText: '调查旧矿井',
    sessionId: 'session-1',
    nativeTurn: 9
  })

  assert.match(result.text, /矿井已经封闭/)
  assert.ok(result.audit.warnings.some((item) => item.code === 'WORLD_BOOK_MODEL_FAILED'))
})

test('卡片设定与素材抽取也通过同一规划 interface', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const revision = await planner.plan({
    purpose: 'revision',
    card: card(),
    scriptInfo: { title: '银铃', chunkCount: 3 },
    worldBookOverview: {
      name: '黑麦镇世界书', entryCount: 2,
      entries: [
        { ref: 'wb-0', keys: ['黑麦镇'], comment: '', enabled: true, constant: true, chars: 9 },
        { ref: 'wb-1', keys: ['钟楼'], comment: '', enabled: true, constant: false, chars: 14 }
      ]
    }
  })
  assert.match(revision.text, /人物卡设定对话/)
  assert.match(revision.text, /剧本《银铃》/)
  assert.match(revision.text, /世界书目录.*2 条/s)
  assert.match(revision.text, /wb-1.*钟楼/s)
  assert.match(revision.text, /tavern_read_worldbook/)
  assert.match(revision.text, /tavern_update_card.*worldBook.*update.*add.*delete.*rename/s)
  assert.doesNotMatch(revision.text, /钟楼藏着失踪商队的线索/)

  const extraction = await planner.plan({
    purpose: 'extract',
    chat: { extract: { player: '旅行者', draft: { name: '阿芙拉' } } },
    extractPrepared: { cursorBefore: 0, total: 1, window: [{ title: '素材', text: '阿芙拉拔剑。' }] }
  })
  assert.match(extraction.text, /玩家身份/)
  assert.match(extraction.text, /人物卡可提炼字段/)
  assert.match(extraction.text, /阿芙拉拔剑/)
})

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
        { keys: ['河港'], content: '河港停着三艘货船。', enabled: true },
        { keys: ['废案'], content: '停用条目不应出现。', constant: true, enabled: false }
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

test('正文只注入召回模块准备的世界书上下文，并解析人物卡环境宏', async () => {
  const planner = createContextPlanner({ prompt })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat(),
    userText: '去钟楼看看',
    sessionId: 'session-1',
    nativeTurn: 2,
    scriptReference: { order: 7, text: '两人沿石阶进入钟楼。' },
    worldBookContext: '黑麦镇常年下雨。\n钟楼藏着失踪商队的线索。'
  })

  assert.match(result.text, /黑麦镇常年下雨/)
  assert.match(result.text, /钟楼藏着失踪商队的线索/)
  assert.doesNotMatch(result.text, /遥远王都/)
  assert.doesNotMatch(result.text, /停用条目/)
  assert.match(result.text, /银发佣兵|表示玩家|谨慎而直接|保持冷静|避免替玩家决定/)
  assert.doesNotMatch(result.text, /旅店遇见|文风示例|跟紧我/)
  assert.doesNotMatch(result.text, /\{\{char\}\}|\{\{user\}\}/)
  assert.match(result.text, /本轮剧本参考 · 第 8 块/)
  assert.doesNotMatch(result.text, /故事设定 · 人物卡|名字: 阿芙拉/)
  assert.match(result.text, /Guide ＞ 剧本 ＞ 世界一致性 ＞ 本轮演出指引/)
  assert.doesNotMatch(result.text, /以玩家指令为准|否定、撤销或暗中改写玩家行动/)
  assert.match(result.text, /让故事自然贴近剧本/)
  assert.match(result.text, /遣词造句/)
  assert.doesNotMatch(result.text, /不要为通顺牺牲剧本/)
  assert.ok(result.audit.totalChars > 0)
  assert.ok(result.audit.included.some((item) => item.kind === 'world-book'))
})

test('游戏稳定前缀只保留名称、场景、文风示例和常驻世界书', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const current = chat()
  current.macroState = { userName: '叶天邪', local: {}, global: {} }
  const result = await planner.plan({
    purpose: 'play-card-snapshot',
    card: card(),
    chat: current,
    worldBookContext: '{{char}} 的故乡黑麦镇常年下雨。',
    worldBookLabel: '常驻世界书'
  })

  assert.match(result.text, /名字: 阿芙拉/)
  assert.match(result.text, /叶天邪 在旅店遇见 阿芙拉|文风示例/)
  assert.match(result.text, /【常驻世界书】\n阿芙拉 的故乡黑麦镇常年下雨/)
  assert.doesNotMatch(result.text, /银发佣兵|谨慎而直接|保持冷静|避免替玩家决定|多写动作|右手按着剑柄/)
  assert.doesNotMatch(result.text, /\{\{user\}\}/)
})

test('每轮注入不把失败宏留给 DSH 再次解析', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const currentCard = card()
  currentCard.system_prompt = '世界书带{{if}}宏按阶段门控。'
  const result = await planner.plan({
    purpose: 'body',
    card: currentCard,
    chat: chat(),
    worldBookContext: ''
  })

  assert.match(result.text, /世界书带if宏按阶段门控/)
  assert.doesNotMatch(result.text, /\{\{|\}\}/)
})

test('游戏稳定前缀注入人物卡文风示例', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const result = await planner.plan({
    purpose: 'play-card-snapshot',
    card: card(),
    chat: chat()
  })

  assert.match(result.text, /文风示例/)
  assert.match(result.text, /阿芙拉 对 你 说：跟紧我/)
})

test('每轮正文注入角色描述、性格、系统提示和历史后指令', async () => {
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

  assert.match(result.text, /银发佣兵/)
  assert.match(result.text, /谨慎而直接/)
  assert.match(result.text, /保持冷静/)
  assert.match(result.text, /右手按着剑柄/)
  assert.match(result.text, /多写动作/)
  assert.match(result.text, /避免替玩家决定/)
  assert.doesNotMatch(result.text, /旅店遇见|文风示例|跟紧我/)
})

test('展示正则移走可见正文后，下一轮仍注入内部源文本保持连续', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat([
      { role: 'user', text: '进入校园' },
      { role: 'assistant', text: '\u00a0', sourceText: '【时间】：09:00\n叶天邪走进校门。' }
    ]),
    userText: '继续前进',
    sessionId: 'session-1',
    nativeTurn: 3
  })

  assert.match(result.text, /上一轮正文源文本/)
  assert.match(result.text, /叶天邪走进校门/)
})

test('自由故事候选按稳定到动态的顺序注入完整人物卡约束，但不自行注入世界书', async () => {
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
  assert.doesNotMatch(result.text, /黑麦镇常年下雨/)
  assert.doesNotMatch(result.text, /钟楼藏着失踪商队的线索/)
  assert.equal(result.audit.included.some((item) => item.kind === 'card'), true)
  assert.ok(result.text.indexOf('候选任务') < result.text.indexOf('谨慎而直接'))
  assert.ok(result.text.indexOf('保持冷静') < result.text.indexOf('多写动作'))
  assert.ok(result.text.indexOf('多写动作') < result.text.indexOf('右手按着剑柄'))
})

test('命运候选在进入后台 Agent 前解析默认值宏但保留人物卡原始 HTML', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const fate = card()
  fate.system_prompt = '当前阶段（{{getvar::stage || 1}}）。\n<style>.panel{color:red}</style><div class="panel">阶段 {{.stage}}</div>'
  const current = Object.assign(chat(), {
    macroState: { userName: 'User', local: { stage: 2 }, global: {} }
  })
  const before = structuredClone(current.macroState)

  const result = await planner.plan({
    purpose: 'candidate',
    card: fate,
    chat: current,
    task: '生成候选项',
    scriptWindow: null
  })

  assert.match(result.text, /当前阶段（2）/)
  assert.doesNotMatch(result.text, /\{\{/)
  assert.match(result.text, /<style>\.panel\{color:red\}<\/style><div class="panel">阶段 2<\/div>/)
  assert.deepEqual(current.macroState, before)
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
  assert.ok(result.text.indexOf('谨慎而直接') < result.text.indexOf('多写动作'))
  assert.ok(result.text.indexOf('多写动作') < result.text.indexOf('右手按着剑柄'))
  assert.ok(result.text.indexOf('右手按着剑柄') < result.text.indexOf('两人沿石阶走近钟楼'))
  assert.match(result.stableText, /剧本候选任务|名字: 阿芙拉|谨慎而直接|保持冷静/)
  assert.doesNotMatch(result.stableText, /多写动作|右手按着剑柄|两人沿石阶走近钟楼/)
  assert.match(result.dynamicText, /多写动作|右手按着剑柄|两人沿石阶走近钟楼/)
  assert.doesNotMatch(result.dynamicText, /剧本候选任务|名字: 阿芙拉|谨慎而直接|保持冷静/)
})

test('没有召回结果时，正文规划器不会回退读取人物卡内的世界书', async () => {
  const planner = createContextPlanner({ prompt })
  const result = await planner.plan({
    purpose: 'body',
    card: card(),
    chat: chat(),
    userText: '去钟楼看看',
    sessionId: 'session-1',
    nativeTurn: 9
  })

  assert.doesNotMatch(result.text, /黑麦镇常年下雨|钟楼藏着失踪商队的线索/)
})

test('候选项不会根据最近剧情自行触发世界书', async () => {
  const planner = createContextPlanner({ prompt })
  const result = await planner.plan({
    purpose: 'candidate',
    card: card(),
    chat: chat([{ role: 'assistant', text: '众人已经来到钟楼门前。' }]),
    task: '生成候选项',
    scriptWindow: null
  })

  assert.doesNotMatch(result.text, /钟楼藏着失踪商队的线索|遥远王都|停用条目/)
})

test('卡片工作台在同一规划 interface 中组合人物卡、世界书和资料', async () => {
  const planner = createContextPlanner({ prompt, callModel: async () => '{"ids":[]}' })
  const result = await planner.plan({
    purpose: 'card',
    card: card(),
    workspace: { player: '旅行者', draft: {}, sourcePaths: ['materials/素材.md'], mountedResources: [{ kind: 'card', path: 'cards/另一张卡.json', label: '另一张卡' }, { kind: 'source', path: 'materials/长篇小说.md', label: '长篇小说' }, { kind: 'script', path: 'scripts/银铃/剧本.txt', label: '银铃剧本' }] },
    sourcePrepared: { cursorBefore: 0, total: 1, window: [{ title: '素材', text: '阿芙拉拔剑。' }] },
    scriptInfo: { title: '银铃', chunkCount: 3 },
    worldBookOverview: {
      name: '黑麦镇世界书', entryCount: 2,
      entries: [
        { ref: 'entry:0', keys: ['黑麦镇'], comment: '', enabled: true, constant: true, chars: 9 },
        { ref: 'entry:1', keys: ['钟楼'], comment: '', enabled: true, constant: false, chars: 14 }
      ]
    }
  })
  assert.doesNotMatch(result.text, /You are a helpful software engineer assistant/)
  assert.match(result.text, /剧本《银铃》/)
  assert.match(result.text, /当前人物卡 · 字段目录/)
  assert.match(result.text, /description: \d+ 字/)
  assert.match(result.text, /tavern_read_card/)
  assert.doesNotMatch(result.text, /银发佣兵|谨慎而直接|保持冷静/)
  assert.match(result.text, /人物卡.*另一张卡.*path=cards\/另一张卡\.json/s)
  assert.match(result.text, /资料.*长篇小说.*path=materials\/长篇小说\.md/s)
  assert.match(result.text, /剧本.*银铃剧本.*path=scripts\/银铃\/剧本\.txt/s)
  assert.match(result.text, /世界书目录.*2 条/s)
  assert.match(result.text, /entry:1.*钟楼/s)
  assert.match(result.text, /tavern_read_worldbook/)
  assert.match(result.text, /tavern_update_worldbook.*update.*add.*delete/s)
  assert.match(result.text, /玩家身份/)
  assert.match(result.text, /\{\{user\}\}/)
  assert.match(result.text, /阿芙拉拔剑/)
  assert.doesNotMatch(result.text, /钟楼藏着失踪商队的线索/)
})

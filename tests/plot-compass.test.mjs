import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassPin,
  applyPlotCompassStepToggle,
  buildPlotCompassMaterial,
  extractDormantWorldbookHooks,
  mergePlotCompassUpdate,
  parsePlotCompassSubmission,
  plotCompassCompactionNote,
  readPlotCompass
} from '../tavern-plugin/lib/domain/plot-compass.js'
import { createPlotCompassService } from '../tavern-plugin/lib/domain/plot-compass-service.js'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import { foregroundFrameInputs } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { extractForegroundStoryChoices } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { forkConversationChat } from '../tavern-plugin/lib/domain/conversation-fork.js'
import { prompt } from '../tavern-plugin/lib/prompt-catalog.js'

const require = createRequire(import.meta.url)
const candidateTabs = require('../tavern-plugin/packages/dsh-presentation-protocol/src/candidate-tabs.cjs')

const SAMPLE_CARD = {
  name: '沈清弦',
  tags: ['古风权谋', '悬疑'],
  description: '{{char}}是执掌诏狱的镇抚使，与{{user}}表面政敌实则暗藏旧约。',
  personality: '冷峻缜密，善于设局试探。',
  scenario: '雨夜诏狱密谈。',
  system_prompt: '',
  post_history_instructions: ''
}

function sampleSubmission() {
  return {
    playArchetypes: ['权谋博弈', '情感修罗场'],
    situationDigest: '{{user}}与{{char}}在诏狱就旧案密信对峙，窗外暗哨已动。',
    shortTerm: [
      {
        id: 'st-probe',
        tag: '掀牌试探',
        title: '半真半假亮出密信残页',
        direction: '反客为主',
        summary: '逼{{char}}在暗哨汇报前表态站队。',
        beats: [
          { text: '故意露出火漆印记试探{{char}}眼神', done: false },
          { text: '借外间脚步声逼她当场藏起你', done: false }
        ],
        sourceHook: '伏笔回收'
      },
      {
        id: 'st-bell',
        tag: '暗查钟楼',
        title: '脱身夜探废钟楼暗格',
        direction: '支线切入',
        summary: '顺着{{char}}怀表刻痕先去废钟楼取证。',
        beats: [
          { text: '假意妥协换取离狱手令', done: false },
          { text: '子时潜入旧城废钟楼核对密账', done: false }
        ],
        sourceHook: '世界书暗线'
      }
    ],
    midTerm: [
      {
        id: 'mt-alliance',
        tag: '双面盟约',
        title: '诏狱内外的影子同盟',
        direction: '双面结盟渗透',
        summary: '与{{char}}维持政敌假象，暗中联手反查内阁黑手。',
        entryHook: '在密信一事上留一线余地，向她抛出互换情报的筹码',
        milestones: [
          { text: '达成口头密约并交换信物', done: false },
          { text: '联手做局拔除内阁眼线', done: false }
        ],
        stakes: '获镇抚司暗桩支持，一旦败露将被两党同诛',
        sourceHook: '数值临界'
      },
      {
        id: 'mt-rival',
        tag: '借刀逼宫',
        title: '引东厂介入搅浑诏狱',
        direction: '祸水东引',
        summary: '故意放风引第三方势力入局，打破{{char}}的掌控。',
        entryHook: '将密信拓本暗投第三方渠道',
        milestones: [
          { text: '挑起东厂与镇抚司争权', done: false },
          { text: '趁乱劫走核心证人', done: false }
        ],
        stakes: '迅速掌握主动权，但与{{char}}信任彻底破裂'
      }
    ],
    longTerm: [
      {
        id: 'lt-overturn',
        tag: '颠覆旧朝',
        title: '携手掀翻棋盘共掌新局',
        tone: '权谋共犯与破局',
        vision: '查清十年前灭门真相，与{{char}}彻底清算内阁旧党，重塑朝局【终局机密剧透】。',
        prerequisites: ['建立稳固影子同盟', '拿到废钟楼先帝遗诏'],
        toneGuidance: '保持政敌外壳下的默契试探与宿命羁绊，草蛇灰线铺垫十年前旧案暗流'
      },
      {
        id: 'lt-retire',
        tag: '抽身江湖',
        title: '假死脱身远走江南',
        tone: '金蝉脱壳归隐',
        vision: '借朝堂大乱双双假死销声匿迹，泛舟江南【终局机密剧透】。',
        prerequisites: ['攒够脱身死契与盘缠', '斩断旧主追踪线索'],
        toneGuidance: '在高压权谋中穿插对自由与倦怠的微妙共鸣'
      }
    ]
  }
}

test('解析多路线提交、宏替换、单层重摇保留其他层级锚定与偏离归档', () => {
  const chat = { mode: 'story', macroState: { userName: '陆沉' } }
  const parsed = parsePlotCompassSubmission(sampleSubmission(), { scope: 'all', card: SAMPLE_CARD, chat })
  assert.deepEqual(parsed.playArchetypes, ['权谋博弈', '情感修罗场'])
  assert.match(parsed.situationDigest, /陆沉与沈清弦/)
  assert.match(parsed.shortTerm[0].summary, /沈清弦/)

  let compass = mergePlotCompassUpdate(null, parsed, { scope: 'all', turn: 3, now: 1000 })
  compass = applyPlotCompassPin(compass, { horizon: 'shortTerm', routeId: 'st-bell', now: 1100 })
  compass = applyPlotCompassPin(compass, { horizon: 'longTerm', routeId: 'lt-overturn', now: 1100 })
  compass = applyPlotCompassCustomArchetypes(compass, ['克苏鲁权谋'], { now: 1200 })
  assert.equal(compass.pinned.shortTerm, 'st-bell')
  assert.equal(compass.pinned.longTerm, 'lt-overturn')
  assert.equal(compass.playArchetypes[0], '克苏鲁权谋')

  // 单层重摇 midTerm：shortTerm 与 longTerm 的路线和锚定保持原样
  const rerolledMid = parsePlotCompassSubmission({
    ...sampleSubmission(),
    midTerm: [
      { tag: '新篇章A', title: '废钟楼秘辛调查', summary: '深入调查钟楼旧档', milestones: [{ text: '破解暗格机关' }] },
      { tag: '新篇章B', title: '诏狱劫囚风云', summary: '雨夜联手转移证人', milestones: [{ text: '伪造暴毙卷宗' }] }
    ]
  }, { scope: 'midTerm', card: SAMPLE_CARD, chat })
  const afterMidReroll = mergePlotCompassUpdate(compass, rerolledMid, { scope: 'midTerm', turn: 4, now: 1300 })
  assert.equal(afterMidReroll.pinned.shortTerm, 'st-bell')
  assert.equal(afterMidReroll.pinned.longTerm, 'lt-overturn')
  assert.equal(afterMidReroll.midTerm[0].title, '废钟楼秘辛调查')

  // 全局演进时原锚定今期路线因玩家自由行动偏离，自动记录到 archived
  const diverged = parsePlotCompassSubmission({
    ...sampleSubmission(),
    shortTerm: [
      { id: 'st-new-1', tag: '城门突围', title: '连夜策马出城', summary: '玩家直接打晕狱卒冲出诏狱', beats: [{ text: '夺马冲过西直门' }] },
      { id: 'st-new-2', tag: '反劫镇抚', title: '挟持沈清弦同行', summary: '带她一同撤往城外据点', beats: [{ text: '封住哨笛迫其同行' }] }
    ],
    divergedNote: '玩家直接劫狱突围，原定假意妥协潜入废钟楼方案已分流'
  }, { scope: 'all', card: SAMPLE_CARD, chat })
  const afterDiverge = mergePlotCompassUpdate(afterMidReroll, diverged, { scope: 'all', turn: 5, now: 1400 })
  assert.equal(afterDiverge.pinned.shortTerm, null)
  assert.equal(afterDiverge.archived.length, 1)
  assert.equal(afterDiverge.archived[0].title, '脱身夜探废钟楼暗格')
  assert.match(afterDiverge.archived[0].reason, /劫狱突围/)
})

test('未触发世界书暗线扫描：过滤常驻、已触发及脚本条目，仅提取休眠静态设定钩子', () => {
  const entries = [
    { title: '基础世界观', constant: true, enabled: true, content: '大周朝廷由内阁与镇抚司分权制衡，常驻背景设定。' },
    { title: '已触发酒楼情报', constant: false, enabled: true, primaryKeys: ['醉仙楼'], content: '醉仙楼掌柜实为前朝暗探，已在上一轮触发。' },
    { title: '[mvu_update]变量更新规则', constant: false, enabled: true, content: '<% updateVariables() %> 内部脚本规则不应暴露给剧情规划' },
    { title: '废钟楼先帝遗诏暗线', constant: false, enabled: true, primaryKeys: ['废钟楼', '怀表'], content: '旧城废钟楼顶层铜钟内壁藏有十年前先帝密诏与镇抚使父亲冤案名册。' },
    { title: '停用设定', constant: false, enabled: false, primaryKeys: ['废弃'], content: '这条世界书已被关闭，不应提取。' }
  ]
  const chat = {
    mode: 'story',
    lastWorldBookRecall: { activated: [{ title: '已触发酒楼情报' }] },
    messages: [{ role: 'assistant', turn: 2, text: '沈清弦指尖摩挲着一块刻有古旧纹章的怀表。' }]
  }
  const hooks = extractDormantWorldbookHooks(entries, chat)
  assert.equal(hooks.length, 1)
  assert.equal(hooks[0].title, '废钟楼先帝遗诏暗线')
  assert.deepEqual(hooks[0].keys, ['废钟楼', '怀表'])

  const material = buildPlotCompassMaterial({ chat, card: SAMPLE_CARD, worldbookEntries: entries, scope: 'all', guidance: '想走悬疑探案分支' })
  assert.match(material, /<dormant_worldbook_hooks>[\s\S]*废钟楼先帝遗诏暗线/)
  assert.doesNotMatch(material, /updateVariables/)
})

test('防抢跑漏斗注入：未锚定时零正文注入；锚定后正文隐去终局剧透，候选走动态段不污染稳定前缀，压缩保留伏笔', async () => {
  const planner = createContextPlanner({ prompt })
  const parsed = parsePlotCompassSubmission(sampleSubmission(), { scope: 'all', card: SAMPLE_CARD, chat: { mode: 'story' } })
  const unpinnedCompass = mergePlotCompassUpdate(null, parsed, { scope: 'all', turn: 2 })

  // 1. 未点亮任何路线时：正文 0 注入，但候选项可获得今期路线标签做灵感分流
  const unpinnedChat = { id: 'c1', mode: 'story', plotCompass: unpinnedCompass, messages: [] }
  const bodyPlanUnpinned = await planner.plan({ purpose: 'body', card: SAMPLE_CARD, chat: unpinnedChat, worldBookContext: '' })
  assert.doesNotMatch(bodyPlanUnpinned.text, /<plot_compass>/)
  assert.equal(plotCompassCompactionNote(unpinnedChat), '')

  const candidatePlanUnpinned = await planner.plan({ purpose: 'candidate', card: SAMPLE_CARD, chat: unpinnedChat, task: prompt('candidate-story'), constantWorldBookContext: '' })
  assert.doesNotMatch(candidatePlanUnpinned.stableText, /plot_compass/, '绝不能写入后台稳定前缀以免击穿缓存')
  assert.match(candidatePlanUnpinned.dynamicText, /<plot_compass_candidates>[\s\S]*掀牌试探[\s\S]*暗查钟楼/)

  // 2. 点亮今期 + 中期 + 长期路线后：正文注入暗流基调但严禁暴露长期 vision 中的终局剧透
  let pinnedCompass = applyPlotCompassPin(unpinnedCompass, { horizon: 'shortTerm', routeId: 'st-bell' })
  pinnedCompass = applyPlotCompassPin(pinnedCompass, { horizon: 'midTerm', routeId: 'mt-alliance' })
  pinnedCompass = applyPlotCompassPin(pinnedCompass, { horizon: 'longTerm', routeId: 'lt-overturn' })
  const pinnedChat = { id: 'c1', mode: 'story', plotCompass: pinnedCompass, messages: [] }

  const bodyPlanPinned = await planner.plan({ purpose: 'body', card: SAMPLE_CARD, chat: pinnedChat, worldBookContext: '' })
  assert.match(bodyPlanPinned.text, /<plot_compass>/)
  assert.match(bodyPlanPinned.text, /保持政敌外壳下的默契试探与宿命羁绊/, '应包含无剧透 toneGuidance')
  assert.doesNotMatch(bodyPlanPinned.text, /终局机密剧透/, '严禁将长期结局剧透注入前台正文')

  const frameInputs = foregroundFrameInputs(bodyPlanPinned, '我收起密信', '我收起密信', null, pinnedChat)
  const compassInput = frameInputs.find(item => item.source?.sectionKind === 'plot-compass')
  assert.ok(compassInput, 'foregroundFrameInputs 应保留 plot-compass 段落')
  assert.equal(compassInput.kind, 'foreground.current-state')

  const compactionNote = plotCompassCompactionNote(pinnedChat)
  assert.match(compactionNote, /诏狱内外的影子同盟/)
  assert.doesNotMatch(compactionNote, /终局机密剧透/)
})

test('候选项 routeTag 透传与徽章分离：UI 显示路线微标，点击发送的对白文本纯净无标签污染', () => {
  const rawReply = [
    '沈清弦按住腰间绣春刀，目光落在你袖口。',
    '<story_choices>',
    JSON.stringify({
      actors: [
        {
          name: '沈清弦',
          actions: ['沈清弦逼近一步扣住你的手腕追问密信来源', '沈清弦吹灭烛火示意隔墙有耳'],
          routeTags: ['掀牌试探', '双面盟约']
        },
        {
          name: '我',
          actions: ['我将怀表推到案几中央换取离狱手令', '我故意提高嗓音引外间暗哨推门', '我借替她拂去肩头雨水试探她反应'],
          routeTags: ['暗查钟楼', '借刀逼宫', '顺势升温']
        }
      ],
      event: '诏狱走廊突然传来东厂番子的脚步声',
      eventRouteTag: '借刀逼宫',
      scene: '转场至子时雨停后的旧城废钟楼下',
      sceneRouteTag: '暗查钟楼',
      featured: [
        {
          actors: ['沈清弦', '我'],
          event: false,
          scene: false,
          routeTag: '双面盟约',
          text: '沈清弦吹灭烛火压低声音警告隔墙有耳，我顺势将密信残页塞进她掌心达成试探默契'
        },
        {
          actors: ['我', '沈清弦'],
          event: false,
          scene: true,
          routeTag: '暗查钟楼',
          text: '我以怀表刻痕换得沈清弦默许放行，转场潜入子时旧城废钟楼查验暗格'
        }
      ]
    }),
    '</story_choices>'
  ].join('\n')

  const extracted = extractForegroundStoryChoices(rawReply, { card: SAMPLE_CARD, chat: { mode: 'story' } })
  assert.ok(Array.isArray(extracted.choices))
  const featured = extracted.choices.find(item => item.type === 'featured' && item.routeTag === '双面盟约')
  assert.ok(featured)

  const badges = candidateTabs.candidateChoiceBadges(featured, { tabKind: 'featured', hasTabs: true })
  assert.deepEqual(badges[0], { kind: 'route', label: '双面盟约' })

  const sentText = candidateTabs.formatCandidateChoiceText(featured)
  assert.doesNotMatch(sentText, /双面盟约/, '发送给正文的玩家输入不得混入路线标签')
  assert.match(sentText, /沈清弦吹灭烛火/)
})

test('后台剧情罗盘服务、步骤勾选、时间线跨轮保留与回滚恢复、分叉继承完整闭环', async () => {
  const timeline = createStoryTimeline()
  let chat = {
    id: 'chat-compass',
    sessionId: 'sess-compass',
    _storageRevision: 1,
    mode: 'story',
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    messages: [
      { role: 'user', turn: 1, text: '大人深夜传唤所为何事？' },
      { role: 'assistant', turn: 1, text: '沈清弦将一封火漆密信推过桌面。' }
    ]
  }
  chat = timeline.apply({ chat, intent: { kind: 'ensure' } }).chat

  let agentCalls = 0
  const service = createPlotCompassService({
    store: {
      chatForSession: async () => structuredClone(chat),
      readChat: async () => structuredClone(chat),
      updateChat: async (_id, mutator) => {
        const next = await mutator(structuredClone(chat))
        if (next) chat = next
        return structuredClone(chat)
      },
      readCard: async () => SAMPLE_CARD,
      readScript: async () => null
    },
    worldBooks: {
      bound: async () => ({ view: { entries: [] } }),
      constantContext: async () => ''
    },
    scripts: null,
    prompt,
    selection: () => ({ provider: 'mock', model: 'mock-planner' }),
    runAgent: async input => {
      agentCalls++
      assert.equal(input.task, 'plot-compass')
      assert.equal(input.ownPrefix, true)
      assert.equal(input.persistent, false)
      const response = JSON.parse(await input.onToolCall({
        name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
        arguments: sampleSubmission()
      }))
      assert.equal(response.ok, true)
      return { text: '', traceSessionId: 'trace-compass-1' }
    }
  })

  const generated = await service.generate({ sessionId: 'sess-compass', scope: 'all', wait: true })
  assert.equal(agentCalls, 1)
  assert.equal(generated.status, 'done')
  assert.equal(generated.plotCompass.shortTerm.length, 2)
  assert.equal(generated.plotCompassTask.traceSessionId, 'trace-compass-1')

  // 点亮路线 + 勾选第一个节拍
  const afterPin = await service.pin({ sessionId: 'sess-compass', horizon: 'shortTerm', routeId: 'st-bell' })
  assert.equal(afterPin.pinned.shortTerm, 'st-bell')
  const afterStep = await service.toggleStep({ sessionId: 'sess-compass', horizon: 'shortTerm', routeId: 'st-bell', stepIndex: 0 })
  assert.equal(afterStep.shortTerm.find(r => r.id === 'st-bell').beats[0].done, true)

  // 验证时间线：新回合提交不清空 plotCompass，但回滚到更早快照可精确恢复当时状态
  const beforeTurn2 = structuredClone(chat)
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 2, userText: '继续推进' } })
  chat = begun.chat
  chat.messages.push({ role: 'user', turn: 2, text: '继续推进' }, { role: 'assistant', turn: 2, text: '第二轮正文' })
  const committed = timeline.complete({
    chat,
    operationId: begun.value.operationId,
    basedOn: begun.value.basedOn,
    outcome: { status: 'success' }
  })
  chat = committed.chat
  chat._storageRevision = 2
  assert.equal(readPlotCompass(chat.plotCompass).pinned.shortTerm, 'st-bell', '新轮正文提交后罗盘必须保留')

  // 第 2 轮后改绑另一条路线，再回滚第 2 轮，应恢复到第 2 轮前的 st-bell
  await service.pin({ sessionId: 'sess-compass', horizon: 'shortTerm', routeId: 'st-probe', exact: true })
  assert.equal(readPlotCompass(chat.plotCompass).pinned.shortTerm, 'st-probe')

  const rolled = timeline.apply({ chat, intent: { kind: 'turn.rollback', beforeChat: beforeTurn2 } })
  chat = rolled.chat
  assert.equal(readPlotCompass(chat.plotCompass).pinned.shortTerm, 'st-bell', '回滚回合应还原当时的剧情罗盘状态')

  // 验证会话分叉：继承 plotCompass 路线但剥离临时 plotCompassTask
  chat.plotCompassTask = { status: 'running', scope: 'all' }
  const forked = forkConversationChat(chat, { chatId: 'chat-fork', sessionId: 'sess-fork', lastNativeTurn: 1 })
  assert.equal(forked.plotCompassTask, undefined)
  assert.equal(readPlotCompass(forked.plotCompass).pinned.shortTerm, 'st-bell')
})

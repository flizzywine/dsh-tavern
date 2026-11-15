import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'
import {
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  applyPlotCompassAutoProgress,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassPin,
  applyPlotCompassPreferences,
  applyPlotCompassStepToggle,
  buildPlotCompassMaterial,
  buildPlotCompassProgressPrompt,
  extractDormantWorldbookHooks,
  extractSceneFreezeSnapshot,
  extractStoryProseForGrounding,
  isPlotCompassEnabled,
  mergePlotCompassUpdate,
  parsePlotCompassProgressOutcome,
  parsePlotCompassSubmission,
  plotCompassBodySection,
  plotCompassCandidateSection,
  plotCompassCompactionNote,
  plotCompassWorldbookScanText,
  readPlotCompass,
  verifyCompassEvidenceInText
} from '../tavern-plugin/lib/domain/plot-compass.js'
import { prepareWorldBookRecall } from '../tavern-plugin/lib/domain/worldbook-recall.js'
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
  const unpinnedChat = { id: 'c1', mode: 'story', backgroundTasks: { plotCompass: true }, plotCompass: unpinnedCompass, messages: [] }
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
  const pinnedChat = { id: 'c1', mode: 'story', backgroundTasks: { plotCompass: true }, plotCompass: pinnedCompass, messages: [] }

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
    backgroundTasks: { plotCompass: true },
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

test('前端浏览器真实挂载：剧情罗盘侧栏面板与底部操作栏按钮无作用域报错并完成交互闭环', async t => {
  const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)

  const errors = []
  const calls = []
  page.on('pageerror', error => errors.push(error.message))

  const parsed = parsePlotCompassSubmission(sampleSubmission(), { scope: 'all', card: SAMPLE_CARD, chat: { mode: 'story' } })
  let currentCompass = mergePlotCompassUpdate(null, parsed, { scope: 'all', turn: 2, now: 1000 })
  let currentTask = { status: 'done', scope: 'all', error: '' }
  let compassEnabled = false

  await page.route('http://tavern.test/**', async route => {
    const url = route.request().url()
    if (!url.includes('/api/dsh-tavern/')) {
      return route.fulfill({
        contentType: 'text/html',
        body: '<main id="sidebar"></main><div id="dock"></div><div id="compass-tab"></div>'
      })
    }
    const method = new URL(url).pathname.split('/').at(-1)
    const args = route.request().postDataJSON() || {}
    calls.push({ method, args })
    if (method === 'setPlotCompassEnabled') {
      compassEnabled = args.enabled !== false
      if (!compassEnabled && currentTask.status === 'running') {
        currentTask = { status: 'idle', scope: 'all', error: '' }
      }
      return route.fulfill({ json: { ok: true, enabled: compassEnabled, backgroundTasks: { plotCompass: compassEnabled }, plotCompass: currentCompass, plotCompassTask: currentTask } })
    }
    if (method === 'pinPlotCompassRoute') {
      currentCompass = applyPlotCompassPin(currentCompass, { horizon: args.horizon, routeId: args.routeId })
      return route.fulfill({ json: { ok: true, plotCompass: currentCompass } })
    }
    if (method === 'generatePlotCompass') {
      currentTask = { status: 'running', scope: args.scope || 'all', error: '' }
      return route.fulfill({ json: { ok: true, status: 'running', scope: args.scope || 'all' } })
    }
    const responses = {
      listCards: { cards: [] },
      getCardOrganization: { organization: { groups: [], assignments: {} } },
      listSessions: { sessions: [{ sessionId: 'game', chatId: 'chat', mode: 'story', cardName: '沈清弦' }] },
      getUpdateStatus: { status: { phase: 'idle', host: 'cli' } },
      getHostCompatibility: {},
      confirmSessionPatch: {},
      gameMode: args.op === 'list' ? { modes: [] } : { mode: null },
      syncSession: { sync: { activity: { busy: false, phase: 'idle' }, task: null, tasks: { candidate: null, background: null } } },
      getSession: {
        view: {
          mode: 'story',
          latestAssistantTurn: 2,
          latestAssistantMessageId: 'reply-2',
          activity: { busy: false },
          plotCompass: currentCompass,
          plotCompassEnabled: compassEnabled,
          plotCompassTask: currentTask,
          tavernHelper: { messages: [] }
        }
      },
      getActiveInterfaceSkin: { css: '' },
      getTavernSettings: { settings: {} },
      getChoices: { candidates: null },
      loadSessionPreviews: { previews: {} }
    }
    await route.fulfill({ json: { ok: true, ...(responses[method] || {}) } })
  })

  await page.goto('http://tavern.test/')
  await page.addScriptTag({ content: await browserReactScript() })
  await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
  await page.addScriptTag({ content: clientSource })

  await page.evaluate(() => {
    const slots = {}, tabs = {}, openedTabs = [], noop = () => () => {}
    window.__openedTabs = openedTabs
    const sessionState = { current: 'game', byId: { game: { id: 'game' } } }
    const ctx = {
      inject() { return { dispose() {} } },
      get() {},
      provide() {},
      effect(run, label) {
        if ([
          'dsh-tavern: Tavern workspace browser',
          'dsh-tavern: candidate dock actions',
          'dsh-tavern: plot compass tab'
        ].includes(label)) return run()
        return () => {}
      },
      slots: {
        inject(_name, run) { return run() },
        register(spec, component) { slots[spec.id || spec.name] = component; return () => {} }
      },
      sessions: {
        subagentAddress: () => null,
        refresh: async () => {},
        list: { subscribe: noop, getSnapshot: () => sessionState },
        binding: () => null
      },
      workspaces: {},
      betterSidebar: {
        registerTab(descriptor) { tabs[descriptor.id] = descriptor; return () => {} },
        openTab(seed, scope) { openedTabs.push({ seed, scope }) }
      },
      tavernSessionSignals: { subscribe: noop }
    }
    window.client.apply(ctx)
    const React = modules.react
    const createRoot = modules['react-dom/client'].createRoot
    createRoot(document.querySelector('#sidebar')).render(React.createElement(slots['sidebar.workspaces'], {
      wide: true,
      useSessions: select => select(sessionState),
      useWorkspaces: select => select({ items: [] }),
      renderSlot: () => null
    }))
    createRoot(document.querySelector('#dock')).render(React.createElement(slots['dsh-tavern-candidate-actions'], {
      sessionId: 'game',
      useSession: select => select({ running: false }),
      useInput: select => select({ draft: '' }),
      useChat: select => select({ legacy: { nodes: [{ kind: 'assistant', messageId: 'reply-2' }] } })
    }))
    // Mount the actual registered Plot Compass sidebar tab (including empty scope fallback!)
    const CompassComponent = tabs['dsh-tavern:plot-compass'].component
    createRoot(document.querySelector('#compass-tab')).render(React.createElement(CompassComponent, { scope: {} }))
  })

  // 0. 默认关闭态：显示关闭说明卡片并隐藏底部操作栏按钮
  await page.locator('.dsh-tavern-compass-disabled-card').waitFor()
  assert.equal(await page.locator('.dsh-tavern-compass-dock-btn').count(), 0)
  await page.getByRole('button', { name: '开启剧情罗盘' }).click()
  assert.ok(calls.some(c => c.method === 'setPlotCompassEnabled' && c.args.enabled === true))

  // 1. 验证侧栏面板正常渲染路线卡片，无 ctx is not defined 等任何 pageerror
  await page.getByText('半真半假亮出密信残页').waitFor()
  assert.deepEqual(errors, [])

  // 2. 点击底部操作栏的剧情罗盘按钮，能正常打开侧栏标签页
  await page.locator('.dsh-tavern-compass-dock-btn').click()
  const opened = await page.evaluate(() => window.__openedTabs)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].seed.type, 'dsh-tavern:plot-compass')

  // 3. 点亮一条今期路线，底部按钮同步变为锚定态
  await page.getByRole('button', { name: '点亮此路线' }).first().click()
  await page.getByText('★ 已锚定').waitFor()
  assert.ok(calls.some(c => c.method === 'pinPlotCompassRoute' && c.args.horizon === 'shortTerm'))

  // 4. 切换到中期/长期 Tab 均正常渲染
  await page.getByRole('tab', { name: /中期/ }).click()
  await page.getByText('诏狱内外的影子同盟').waitFor()
  await page.getByRole('tab', { name: /长期/ }).click()
  await page.getByText('携手掀翻棋盘共掌新局').waitFor()

  // 5. 再次通过顶栏开关关闭剧情罗盘：触发 setPlotCompassEnabled(false)，隐藏底部 dock 按钮并保留路线提示
  await page.locator('#compass-tab .dsh-tavern-settings-switch').click()
  await page.locator('.dsh-tavern-compass-disabled-card').waitFor()
  assert.ok(calls.some(c => c.method === 'setPlotCompassEnabled' && c.args.enabled === false))
  assert.equal(await page.locator('.dsh-tavern-compass-dock-btn').count(), 0)
  assert.deepEqual(errors, [])
})

test('真实 DSH 原生后台运行时：plotCompassService.generate 正常序列化事件并调用 plot_compass_submit 收束回合', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  const runtime = await createBackgroundNativeRuntime(process.env.DSH_BOOT_MODULE, {
    residentOptions: {
      backgroundTools: [{ name: 'other_bg_tool', description: 'Other tool', parameters: { type: 'object' } }]
    },
    modelResponse: (input, n) => {
      assert.deepEqual(input.tools.map(tool => tool.name), [PLOT_COMPASS_SUBMIT_TOOL_NAME])
      return [{
        type: 'tool-call',
        id: 'compass-call-' + n,
        name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
        arguments: JSON.stringify(sampleSubmission())
      }]
    }
  })
  t.after(() => runtime.dispose())

  let chat = {
    id: 'chat-native',
    sessionId: 'scene-parent',
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    messages: [
      { role: 'user', turn: 1, text: '大人深夜传唤所为何事？' },
      { role: 'assistant', turn: 1, text: '沈清弦将一封火漆密信推过桌面。' }
    ]
  }
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
    selection: () => ({ provider: 'scene-fixture', model: 'fixture-text' }),
    runAgent: input => runtime.runBackground(input)
  })

  const result = await service.generate({ sessionId: 'scene-parent', scope: 'all', guidance: '多一点悬疑反转', wait: true })
  assert.equal(result.status, 'done')
  assert.equal(result.plotCompassTask.error, '')
  assert.equal(result.plotCompass.shortTerm.length, 2)
  assert.equal(result.plotCompass.midTerm.length, 2)
  assert.equal(result.plotCompass.longTerm.length, 2)
  assert.equal(runtime.requests.length, 1, '提交成功后应立即 concludeTurn，不再额外追问一轮')
  assert.match(JSON.stringify(runtime.requests[0].messages), /多一点悬疑反转/)
})

test('回合结算后自动勾选节拍，且点亮的今期路线节拍全部走完时自动续推下一幕今期路线', async () => {
  let chat = {
    id: 'chat-auto-step',
    sessionId: 'sess-auto-step',
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    messages: [
      { role: 'user', turn: 1, text: '大人深夜传唤所为何事？' },
      { role: 'assistant', turn: 1, text: '沈清弦将一封火漆密信推过桌面。' }
    ]
  }
  const initialParsed = parsePlotCompassSubmission(sampleSubmission(), { scope: 'all', card: SAMPLE_CARD, chat })
  chat.plotCompass = applyPlotCompassPin(
    mergePlotCompassUpdate(null, initialParsed, { scope: 'all', turn: 1, now: 1000 }),
    { horizon: 'shortTerm', routeId: 'st-bell', now: 1000 }
  )

  let modelStepCalls = 0
  let nextWaveGenerated = 0
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
    worldBooks: { bound: async () => ({ view: { entries: [] } }), constantContext: async () => '' },
    scripts: null,
    prompt,
    selection: () => ({ provider: 'mock', model: 'mock-bg' }),
    callModel: async opts => {
      modelStepCalls++
      assert.equal(opts.background, true)
      if (modelStepCalls === 1) {
        return JSON.stringify({ completed: ['shortTerm:st-bell:0'] })
      }
      return JSON.stringify({ completed: ['shortTerm:st-bell:1', 'midTerm:mt-alliance:0'] })
    },
    runAgent: async input => {
      nextWaveGenerated++
      assert.equal(input.task, 'plot-compass')
      assert.match(input.taskText, /Refresh scope: "shortTerm"|Target refresh scope: "shortTerm"/)
      await input.onToolCall({
        name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
        arguments: {
          ...sampleSubmission(),
          shortTerm: [
            { id: 'st-next-1', tag: '钟楼对账', title: '查验铜钟内壁密诏', summary: '顺着暗格取出先帝遗诏', beats: [{ text: '拓印密诏名单' }] },
            { id: 'st-next-2', tag: '伏击反制', title: '设伏反抓尾随暗哨', summary: '解决跟来的内阁眼线', beats: [{ text: '引暗哨入钟楼死角' }] }
          ]
        }
      })
      return { text: '', traceSessionId: 'trace-next-short' }
    }
  })

  // 第 2 轮结算完成（模拟 settlement-run 只传表头切片 latest + turn）
  chat.messages.push(
    { role: 'user', turn: 2, text: '我假意应下条件换取离狱手令' },
    { role: 'assistant', turn: 2, text: '沈清弦冷眼看了你片刻，终究将黑铁离狱手令掷在桌上。' }
  )
  const headerSliceTurn2 = { id: chat.id, sessionId: chat.sessionId, mode: 'story', plotCompass: chat.plotCompass }
  assert.equal(await service.hasTrackableSteps(headerSliceTurn2, 2, chat.sessionId), true)
  const out2 = await service.syncTurnProgress({ sessionId: chat.sessionId, chat: headerSliceTurn2, turn: 2 })
  assert.equal(out2.newlyCompletedCount, 1)
  assert.equal(out2.pinnedShortCompleted, false)
  const bellAfterTurn2 = readPlotCompass(chat.plotCompass).shortTerm.find(r => r.id === 'st-bell')
  assert.deepEqual(bellAfterTurn2.beats.map(b => b.done), [true, false])
  assert.equal(nextWaveGenerated, 0, '尚未走完全部节拍时不提前刷新今期路线')

  // 第 3 轮结算完成：第 2 个节拍也达成（2/2 全满），自动触发下一幕 shortTerm 推演！
  chat.messages.push(
    { role: 'user', turn: 3, text: '子时潜入废钟楼打开暗格' },
    { role: 'assistant', turn: 3, text: '你在子时攀上旧城废钟楼，撬开铜钟暗格摸到了那册泛黄密账。' }
  )
  const headerSliceTurn3 = { id: chat.id, sessionId: chat.sessionId, mode: 'story', plotCompass: chat.plotCompass }
  const out3 = await service.syncTurnProgress({ sessionId: chat.sessionId, chat: headerSliceTurn3, turn: 3 })
  assert.equal(out3.pinnedShortCompleted, true)
  const pendingNextJob = service.wait(chat.id)
  if (pendingNextJob) await pendingNextJob

  assert.equal(nextWaveGenerated, 1, '点亮今期路线全部节拍完成后应自动推演下一幕今期路线')
  const evolved = readPlotCompass(chat.plotCompass)
  assert.equal(evolved.shortTerm[0].title, '查验铜钟内壁密诏')
  assert.equal(evolved.midTerm.find(r => r.id === 'mt-alliance').milestones[0].done, true, '同步勾选的中期里程碑在今期单层续推后完好保留')
})

test('剧情罗盘关闭后停止一切注入与自动演进，并保留原有路线供重新开启恢复', async () => {
  const initialParsed = parsePlotCompassSubmission(sampleSubmission(), { scope: 'all', card: SAMPLE_CARD, chat: { mode: 'story' } })
  const seededCompass = applyPlotCompassPin(
    mergePlotCompassUpdate(null, initialParsed, { scope: 'all', turn: 2, now: 1000 }),
    { horizon: 'shortTerm', routeId: 'st-bell', now: 1000 }
  )
  let chat = {
    id: 'chat-toggle',
    sessionId: 'sess-toggle',
    mode: 'story',
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    plotCompass: seededCompass,
    plotCompassTask: { status: 'idle', scope: 'all', error: '' },
    messages: [
      { role: 'user', turn: 2, text: '测试' },
      { role: 'assistant', turn: 2, text: '回应' }
    ]
  }

  // 未配置 backgroundTasks 时默认关闭：零注入且不可推演
  assert.equal(isPlotCompassEnabled(chat), false)
  assert.equal(plotCompassBodySection(chat), null)
  assert.equal(plotCompassCandidateSection(chat), null)
  assert.equal(plotCompassCompactionNote(chat), '')

  let aborted = false
  let modelCalls = 0
  let releaseGenerate
  let markAgentStarted
  const agentStarted = new Promise(resolve => { markAgentStarted = resolve })
  const gate = new Promise(resolve => { releaseGenerate = resolve })
  const statusEvents = []
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
    worldBooks: { bound: async () => ({ view: { entries: [] } }), constantContext: async () => '' },
    scripts: null,
    prompt,
    selection: () => ({ provider: 'mock', model: 'mock-bg' }),
    callModel: async () => { modelCalls++; return '{}' },
    runAgent: async input => {
      markAgentStarted()
      if (input.signal) {
        if (input.signal.aborted) {
          aborted = true
          releaseGenerate()
        } else {
          input.signal.addEventListener('abort', () => {
            aborted = true
            releaseGenerate()
          }, { once: true })
        }
      }
      await gate
      return { text: '', traceSessionId: 'trace-aborted' }
    },
    onStatus: (sid, patch) => statusEvents.push({ sid, patch })
  })

  // 显式开启后，提示词注入与推演功能激活
  const firstOn = await service.setEnabled({ sessionId: 'sess-toggle', enabled: true })
  assert.equal(firstOn.enabled, true)
  assert.equal(isPlotCompassEnabled(chat), true)
  assert.ok(plotCompassBodySection(chat))
  assert.ok(plotCompassCandidateSection(chat))
  assert.ok(plotCompassCompactionNote(chat))

  // 启动一次推演后再立即关闭开关：进行中的后台任务应被中止且任务态归位 idle，原有路线数据保留
  const started = await service.generate({ sessionId: 'sess-toggle', scope: 'all' })
  assert.equal(started.status, 'running')
  await agentStarted
  const offRes = await service.setEnabled({ sessionId: 'sess-toggle', enabled: false })
  assert.equal(offRes.enabled, false)
  assert.equal(chat.backgroundTasks.plotCompass, false)
  assert.equal(aborted, true, '关闭剧情罗盘时应中止进行中的推演任务')
  assert.equal(chat.plotCompassTask.status, 'idle')
  assert.equal(isPlotCompassEnabled(chat), false)
  assert.equal(readPlotCompass(chat.plotCompass).pinned.shortTerm, 'st-bell', '关闭开关不应删除已保存路线与锚点')

  // 关闭期间零提示词注入、零紧凑归档提示、零自动演进、拒绝手动操控
  assert.equal(plotCompassBodySection(chat), null)
  assert.equal(plotCompassCandidateSection(chat), null)
  assert.equal(plotCompassCompactionNote(chat), '')
  assert.equal(await service.hasTrackableSteps(chat, 2, 'sess-toggle'), false)
  const syncOff = await service.syncTurnProgress({ sessionId: 'sess-toggle', chat, turn: 2 })
  assert.equal(syncOff, null)
  const compactOff = await service.autoEvolveAfterCompaction('sess-toggle')
  assert.equal(compactOff, null)
  assert.equal(modelCalls, 0)
  await assert.rejects(() => service.generate({ sessionId: 'sess-toggle', scope: 'all' }), /已关闭/)
  await assert.rejects(() => service.pin({ sessionId: 'sess-toggle', horizon: 'shortTerm', routeId: 'st-bell' }), /已关闭/)
  await assert.rejects(() => service.toggleStep({ sessionId: 'sess-toggle', horizon: 'shortTerm', routeId: 'st-bell', stepIndex: 0 }), /已关闭/)
  await assert.rejects(() => service.setArchetypes({ sessionId: 'sess-toggle', archetypes: ['悬疑'] }), /已关闭/)

  // 重新开启后完整恢复原有路线与提示词注入能力
  const onRes = await service.setEnabled({ sessionId: 'sess-toggle', enabled: true })
  assert.equal(onRes.enabled, true)
  assert.equal(isPlotCompassEnabled(chat), true)
  assert.equal(readPlotCompass(chat.plotCompass).pinned.shortTerm, 'st-bell')
  assert.ok(plotCompassBodySection(chat))
  assert.ok(plotCompassCandidateSection(chat))
  assert.ok(statusEvents.length >= 2)
})

test('因果来源、世界内载体化预兆、最新回合定格与被动受困状态检测正确组装且无剧透', async () => {
  const parsed = parsePlotCompassSubmission({
    playArchetypes: ['悬疑调查'],
    situationDigest: '沈清弦重伤未醒，地牢四周布防森严',
    shortTerm: [
      {
        id: 'st-observe',
        tag: '暗中观察',
        title: '借昏睡伺机窥听狱卒换防',
        causalBasis: '左肩贯通伤与手腕铁锁限制，只宜靠听觉摸清外间动静',
        summary: '暂忍痛楚不动声色，记下看守交接暗号',
        beats: [{ text: '屏息辨认门外换防脚步', done: false }]
      },
      {
        id: 'st-probe',
        tag: '言语试探',
        title: '以密信暗号惊动看守主事',
        summary: '抛出只有线人知晓的旧年暗号',
        beats: [{ text: '借索水之机点出暗号', done: false }]
      }
    ],
    midTerm: [
      {
        id: 'mt-omen',
        tag: '黑市传闻',
        title: '城南鬼市暗账浮出水面',
        causalBasis: '密信残角上的印泥来自鬼市',
        summary: '追查鬼市私盐暗账链',
        diegeticOmen: '狱卒低声抱怨南城昨晚又封了三家米铺',
        milestones: [{ text: '脱困后夜探南城粮行', done: false }]
      },
      {
        id: 'mt-alt',
        tag: '外援破局',
        title: '线人设法劫囚改线',
        summary: '城外旧部按约定日落行动',
        milestones: [{ text: '听见城西钟响作为接应信号', done: false }]
      }
    ],
    longTerm: [
      {
        id: 'lt-omen',
        tag: '掀翻棋盘',
        title: '重审十年前旧案洗雪全族',
        vision: '终局推翻幕后主使并重定朝纲',
        prerequisites: ['拿到鬼市暗账原件', '说服沈清弦作证'],
        toneGuidance: '暗处积蓄星火，在看似绝境处埋下反证线头',
        diegeticOmen: '窗外遥遥传来更夫口中念叨的旧朝童谣'
      },
      {
        id: 'lt-alt',
        tag: '隐遁江湖',
        title: '烧毁名册远走海疆',
        vision: '舍弃过往身份远遁海外',
        prerequisites: ['凑齐渡海路引']
      }
    ]
  }, { scope: 'all', card: SAMPLE_CARD, chat: { mode: 'story' } })

  assert.equal(parsed.shortTerm[0].causalBasis, '左肩贯通伤与手腕铁锁限制，只宜靠听觉摸清外间动静')
  assert.equal(parsed.midTerm[0].diegeticOmen, '狱卒低声抱怨南城昨晚又封了三家米铺')
  assert.equal(parsed.longTerm[0].diegeticOmen, '窗外遥遥传来更夫口中念叨的旧朝童谣')

  const longMidPadding = '铺垫描写'.repeat(600)
  const chat = {
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    posture: '双腕被玄铁铐锁在石柱上，左肩渗血未止',
    ledger: { location: '诏狱丙字牢房', npcs: [{ name: '沈清弦', relation: '对峙', condition: '守在栅门外冷眼旁观' }], items: [{ name: '半截炭笔' }] },
    messages: [
      { role: 'user', turn: 1, text: '我尝试挣开绳索' },
      { role: 'assistant', turn: 1, text: longMidPadding + '\n末尾定格：铁链紧扣腕骨，狱卒落锁转身离开，唯余半截炭笔落在草堆旁。' }
    ],
    plotCompass: mergePlotCompassUpdate(null, parsed, { scope: 'all', turn: 1, now: 100 })
  }
  chat.plotCompass = applyPlotCompassPin(chat.plotCompass, { horizon: 'shortTerm', routeId: 'st-observe' })
  chat.plotCompass = applyPlotCompassPin(chat.plotCompass, { horizon: 'midTerm', routeId: 'mt-omen' })
  chat.plotCompass = applyPlotCompassPin(chat.plotCompass, { horizon: 'longTerm', routeId: 'lt-omen' })

  const body = plotCompassBodySection(chat)
  assert.ok(body.text.includes('Causal anchor: 左肩贯通伤与手腕铁锁限制'))
  assert.ok(body.text.includes('狱卒低声抱怨南城昨晚又封了三家米铺'))
  assert.ok(body.text.includes('窗外遥遥传来更夫口中念叨的旧朝童谣'))
  assert.ok(!body.text.includes('终局推翻幕后主使并重定朝纲'), '世界内风声与基调不得泄漏终局剧透')

  const cand = plotCompassCandidateSection(chat)
  assert.ok(cand.text.includes('狱卒低声抱怨南城昨晚又封了三家米铺'))

  const snap = extractSceneFreezeSnapshot(chat)
  assert.equal(snap.passiveConstraint, true)
  assert.ok(snap.text.includes('唯余半截炭笔落在草堆旁'))

  const material = buildPlotCompassMaterial({ chat, card: SAMPLE_CARD, scope: 'shortTerm' })
  assert.ok(material.includes('<latest_scene_snapshot>'))
  assert.ok(material.includes('唯余半截炭笔落在草堆旁'))
  assert.ok(material.includes('处于受困 / 受制'))
})

test('回合核验识别前提失效(lapsed)路线：自动归档并解除点亮后触发新今期路线推演', async () => {
  const baseCompass = mergePlotCompassUpdate(null, parsePlotCompassSubmission({
    playArchetypes: ['权谋博弈'],
    situationDigest: '酒楼密会前的最后半个时辰',
    shortTerm: [
      {
        id: 'st-tea',
        tag: '茶楼暗访',
        title: '按约潜入望月茶楼二楼雅间',
        causalBasis: '对方仍未识破主角化名，愿在茶楼单独接头',
        summary: '赴茶楼雅间套话',
        beats: [{ text: '登楼入座观察屏风后的人影', done: false }]
      },
      {
        id: 'st-guard',
        tag: '先手布防',
        title: '提前在茶楼外街角安排眼线',
        summary: '在外围布眼线防埋伏',
        beats: [{ text: '打发旧部守住后门巷口', done: false }]
      }
    ],
    midTerm: [
      { id: 'mt-1', tag: '稳步查案', title: '查清漕运账目', summary: '追查账册', milestones: [{ text: '拿到盐引簿', done: false }] },
      { id: 'mt-2', tag: '掀桌反击', title: '公开实名弹劾', summary: '当庭参奏', milestones: [{ text: '联名御史递折', done: false }] }
    ],
    longTerm: [
      { id: 'lt-1', tag: '清流柱石', title: '重整朝堂法度', vision: '肃清朝纲', prerequisites: ['定案'] },
      { id: 'lt-2', tag: '远走高飞', title: '功成身退归隐', vision: '退出风波', prerequisites: ['脱身'] }
    ]
  }, { scope: 'all', chat: { mode: 'story' } }), { scope: 'all', turn: 1, now: 100 })
  const pinnedCompass = applyPlotCompassPin(baseCompass, { horizon: 'shortTerm', routeId: 'st-tea' })

  const parsedOutcome = parsePlotCompassProgressOutcome(
    JSON.stringify({
      completed: [],
      lapsed: [{ horizon: 'shortTerm', routeId: 'st-tea', reason: '主角当街炸毁茶楼并公开身份撤离' }]
    }),
    ['shortTerm:st-tea:0'],
    [{ horizon: 'shortTerm', routeId: 'st-tea' }]
  )
  assert.equal(parsedOutcome.lapsed.length, 1)

  const applied = applyPlotCompassAutoProgress(pinnedCompass, parsedOutcome, { turn: 2, now: 200 })
  assert.equal(applied.newlyLapsedCount, 1)
  assert.equal(applied.pinnedShortLapsed, true)
  assert.equal(applied.compass.pinned.shortTerm, null)
  assert.equal(applied.compass.shortTerm.some(r => r.id === 'st-tea'), false)
  assert.match(applied.compass.archived.at(-1).reason, /前提失效：主角当街炸毁茶楼/)

  // 测试 service.syncTurnProgress 在锚定今期路线 lapsed 后自动重演 shortTerm
  let chat = {
    id: 'chat-lapsed',
    sessionId: 'sess-lapsed',
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    messages: [
      { role: 'user', turn: 1, text: '先去茶楼附近看看' },
      { role: 'assistant', turn: 1, text: '茶楼已点亮灯笼。' },
      { role: 'user', turn: 2, text: '我不进茶楼了，直接纵火烧楼引出官兵后趁乱出城！' },
      { role: 'assistant', turn: 2, text: '烈焰吞没了整座望月茶楼，主角借着黑烟与嘈杂已纵马冲出西门。' }
    ],
    plotCompass: pinnedCompass
  }

  let replanGuidance = ''
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
    worldBooks: { bound: async () => ({ view: { entries: [] } }), constantContext: async () => '' },
    scripts: null,
    prompt,
    selection: () => ({ provider: 'mock', model: 'mock-planner' }),
    callModel: async ({ messages }) => {
      assert.ok(messages[0].content.includes('<active_routes>'))
      return JSON.stringify({
        completed: [],
        lapsed: [{ horizon: 'shortTerm', routeId: 'st-tea', reason: '望月茶楼已焚毁且主角已出城，茶楼接头前提作废' }]
      })
    },
    runAgent: async input => {
      replanGuidance = input.taskText || ''
      await input.onToolCall({
        name: PLOT_COMPASS_SUBMIT_TOOL_NAME,
        arguments: {
          playArchetypes: ['权谋博弈'],
          situationDigest: '茶楼火起惊动全城，主角出西门连夜遁走',
          shortTerm: [
            { id: 'st-escape-1', tag: '城外避锋', title: '沿运河官道借商船隐匿', causalBasis: '主角刚冲出西门，河港夜船可掩护去向', summary: '搭夜航货船甩开追兵', beats: [{ text: '买通船老大藏身底舱', done: false }] },
            { id: 'st-escape-2', tag: '反杀追兵', title: '在乱石坡设伏截杀先锋', causalBasis: '追兵仓促出城队列分散', summary: '抓一名活口审问幕后动向', beats: [{ text: '放过哨骑只锁死断后副将', done: false }] }
          ],
          midTerm: baseCompass.midTerm,
          longTerm: baseCompass.longTerm
        }
      })
      return { text: '' }
    }
  })

  const syncOutcome = await service.syncTurnProgress({ sessionId: 'sess-lapsed', chat, turn: 2 })
  assert.equal(syncOutcome.pinnedShortLapsed, true)
  const pendingReplan = service.wait(chat.id)
  if (pendingReplan) await pendingReplan
  assert.match(replanGuidance, /按约潜入望月茶楼二楼雅间.*不再成立/)
  assert.equal(readPlotCompass(chat.plotCompass).shortTerm[0].id, 'st-escape-1')
  assert.ok(readPlotCompass(chat.plotCompass).archived.some(a => a.title === '按约潜入望月茶楼二楼雅间' && a.reason.includes('前提失效')))
})

test('推进节奏、微调引导、离屏depiction、端锚定阶段角色与点亮路线唤醒绿灯世界书条目', async () => {
  const submitted = parsePlotCompassSubmission({
    playArchetypes: ['权谋博弈'],
    situationDigest: '沈清弦在钟楼暗室与玩家对峙',
    shortTerm: [
      {
        id: 'st-secret',
        tag: '借令查档',
        title: '夜间借玄铁密诏调阅盐铁司暗卷',
        causalBasis: '沈清弦袖中露出的半枚虎符印记与暗卷有关',
        summary: '潜入盐铁司密库核对失踪船队账册',
        beats: [{ text: '趁换班潜入盐铁司密库', done: false }]
      },
      {
        id: 'st-alt',
        tag: '当面拆招',
        title: '反将沈清弦一军套问钟楼异响',
        causalBasis: '二人此刻独处钟楼暗室',
        summary: '言语逼迫交底',
        beats: [{ text: '直指对方袖口水迹质问来意', done: false }]
      }
    ],
    midTerm: [
      {
        id: 'mt-salt',
        tag: '盐铁黑账',
        title: '追查沉船与私盐银两去向',
        causalBasis: '密卷指向三年前沉船案',
        summary: '循线索撕开京兆尹与漕帮利益网',
        entryHook: '在盐铁司密库翻出加盖朱印的沉船名录',
        milestones: [
          { text: '核对沉船名录', done: true },
          { text: '暗访知情老吏', done: false },
          { text: '当庭对质抉择去留', done: false },
          { text: '尘埃落定重定盟约', done: false }
        ],
        stakes: '扳倒幕后主使或反遭反噬',
        diegeticOmen: '渡口茶馆昨夜传出漕帮连夜转移私账的风声'
      },
      {
        id: 'mt-alt',
        tag: '借刀除害',
        title: '暗中促成皇城司与漕帮火并',
        causalBasis: '两股势力本就因码头税银积怨已久',
        summary: '坐山观虎斗后再收拾残局',
        entryHook: '向皇城司密报渡口夜船动向',
        milestones: [{ text: '递出匿名密报', done: false }, { text: '坐收渔利', done: false }],
        stakes: '见血最快但易失控'
      }
    ],
    longTerm: [
      {
        id: 'lt-reform',
        tag: '革新朝局',
        title: '彻底清洗盐铁旧弊',
        tone: '风雪夜行',
        prerequisites: ['查清私盐账目', '稳住中立派系'],
        vision: '二人最终联手推动新政',
        toneGuidance: '暗流之下隐约透出制度动摇的冷冽与克制微光',
        diegeticOmen: '茶楼说书人新添了一段旧年盐税失踪案的隐喻唱词'
      },
      {
        id: 'lt-seclude',
        tag: '焚卷归隐',
        title: '销毁黑账携密退出棋局',
        tone: '烟波江上',
        prerequisites: ['拿到实证筹码', '备好江南退路'],
        vision: '远离庙堂风波另起炉灶',
        toneGuidance: '偶见孤舟远影与倦鸟归林的疏离质感'
      }
    ]
  }, {})

  let compass = mergePlotCompassUpdate(null, submitted, { scope: 'all', turn: 2 })
  compass = applyPlotCompassPin(compass, { horizon: 'shortTerm', routeId: 'st-secret' })
  compass = applyPlotCompassPin(compass, { horizon: 'midTerm', routeId: 'mt-salt' })
  compass = applyPlotCompassPreferences(compass, {
    pace: 'foreshadow',
    blindBox: true,
    customDirective: '本轮多写雨夜审讯里的微表情交锋，暂勿直接翻开账册'
  })

  const chat = {
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    plotCompass: compass,
    messages: [{ role: 'user', turn: 3, text: '先去廊檐下避雨喘口气' }],
    worldBookReads: {}
  }

  // 1. 验证 pace、customDirective、端锚定阶段角色（milestones[1] => 冲突升级 (rising)）、离屏 depiction 注入
  const sectionForeshadow = plotCompassBodySection(chat)
  assert.ok(sectionForeshadow.text.includes('只铺垫 / Foreshadow-Only'))
  assert.ok(sectionForeshadow.text.includes('冲突升级 (rising)'))
  assert.ok(sectionForeshadow.text.includes('Off-screen ripple depiction'))
  assert.ok(sectionForeshadow.text.includes('本轮多写雨夜审讯里的微表情交锋'))

  // 切换到 climax + 推进到倒数第二节点（核心抉择拐点 hardest）
  compass = applyPlotCompassStepToggle(compass, { horizon: 'midTerm', routeId: 'mt-salt', stepIndex: 1 })
  compass = applyPlotCompassPreferences(compass, { pace: 'climax' })
  chat.plotCompass = compass
  const sectionClimax = plotCompassBodySection(chat)
  assert.ok(sectionClimax.text.includes('尽快引爆 / Escalate to Climax'))
  assert.ok(sectionClimax.text.includes('核心抉择拐点 (hardest)'))

  // 2. 验证 plotCompassWorldbookScanText 纯净提取点亮路线文本并能唤醒休眠绿灯世界书条目
  const scanSnippet = plotCompassWorldbookScanText(chat)
  assert.ok(scanSnippet.includes('玄铁密诏'))
  assert.ok(scanSnippet.includes('盐铁司'))
  // 确保不含通用系统指导词（防止指令词误触绿灯）
  assert.ok(!scanSnippet.includes('Active Plot Compass'))
  assert.ok(!scanSnippet.includes('Off-screen ripple depiction'))

  const worldBook = {
    view: {
      entries: [
        {
          ref: 'wb-salt-edict',
          title: '玄铁密诏设定',
          primaryKeys: ['玄铁密诏'],
          content: '玄铁密诏乃先帝遗留密令，凭半枚虎符方可开启盐铁司底库暗格。',
          constant: false,
          enabled: true,
          scanDepth: 4
        },
        {
          ref: 'wb-unrelated-prompt',
          title: '误触防护测试',
          primaryKeys: ['Off-screen ripple depiction'],
          content: '若指令词泄漏进扫描文本则会错误触发。',
          constant: false,
          enabled: true,
          scanDepth: 4
        }
      ]
    }
  }
  const recalledWithCompass = prepareWorldBookRecall({
    worldBook,
    chat,
    turn: 3,
    userText: '先去廊檐下避雨喘口气',
    scanText: scanSnippet
  })
  assert.deepEqual(recalledWithCompass.refs, ['wb-salt-edict'])

  // 禁用罗盘后，扫描文本立即归零，不再触发
  const disabledChat = { ...chat, backgroundTasks: { plotCompass: false } }
  assert.equal(plotCompassWorldbookScanText(disabledChat), '')
})

test('自动进度核验原文证据句校验 (Grounding)：剥离思维链/MVU，拒收虚构或仅在思考中的进度并保持旧格式兼容', async () => {
  const sampleProseRaw = [
    '<thinking>下一步主角打算潜入密库盗取银票，但这一轮还没行动。</thinking>',
    '<konatan_planning>{"plan":"找线人陈二套话"}</konatan_planning>',
    '<UpdateVariable>{"silver": 20}</UpdateVariable>',
    '暴雨敲打着窗棂。主角没有贸然动身，只是将那半块刻着梅花纹的旧木牌推到烛火旁，轻声试探沈清弦的来历。'
  ].join('\n')

  const stripped = extractStoryProseForGrounding(sampleProseRaw)
  assert.ok(!stripped.includes('潜入密库'))
  assert.ok(!stripped.includes('找线人陈二套话'))
  assert.ok(stripped.includes('梅花纹的旧木牌'))

  assert.equal(verifyCompassEvidenceInText(sampleProseRaw, '将那半块刻着梅花纹的旧木牌推到烛火旁'), true)
  assert.equal(verifyCompassEvidenceInText(sampleProseRaw, '潜入密库盗取银票'), false)
  assert.equal(verifyCompassEvidenceInText(sampleProseRaw, '找线人陈二套话'), false)

  const outcome = parsePlotCompassProgressOutcome(
    JSON.stringify({
      completed: [
        { key: 'shortTerm:st-1:0', evidence: '半块刻着梅花纹的旧木牌推到烛火旁' },
        { key: 'shortTerm:st-1:1', evidence: '潜入密库盗取银票' },
        { key: 'shortTerm:st-1:2', evidence: '' }
      ],
      lapsed: []
    }),
    ['shortTerm:st-1:0', 'shortTerm:st-1:1', 'shortTerm:st-1:2'],
    [],
    { proseText: sampleProseRaw }
  )
  assert.deepEqual(outcome.completed, ['shortTerm:st-1:0'])
  assert.equal(outcome.rejectedCompleted.length, 2)
  assert.equal(outcome.rejectedCompleted[0].reason, 'evidence_not_grounded_in_prose')
  assert.equal(outcome.rejectedCompleted[1].reason, 'missing_evidence')

  // 验证 service.setPreferences 与 service.syncTurnProgress 结合原文证据过滤端到端生效
  let chat = {
    id: 'chat-grounding',
    sessionId: 'sess-grounding',
    mode: 'story',
    backgroundTasks: { plotCompass: true },
    cardPath: 'cards/shen.json',
    cardName: '沈清弦',
    messages: [
      { role: 'user', turn: 1, text: '亮出木牌试试他反应' },
      { role: 'assistant', turn: 1, sourceText: sampleProseRaw, text: sampleProseRaw }
    ],
    plotCompass: mergePlotCompassUpdate(null, parsePlotCompassSubmission({
      playArchetypes: ['悬疑调查'],
      shortTerm: [
        {
          id: 'st-1',
          tag: '试探来历',
          title: '借旧木牌投石问路',
          causalBasis: '主角手中有旧木牌',
          summary: '试探身份',
          beats: [
            { text: '亮出梅花旧木牌试探反应', done: false },
            { text: '潜入密库盗取银票', done: false }
          ]
        },
        {
          id: 'st-2',
          tag: '借茶脱身',
          title: '先告辞另寻线人',
          causalBasis: '窗外雨大可顺势收手',
          summary: '避其锋芒',
          beats: [{ text: '起身道别退出屋檐', done: false }]
        }
      ],
      midTerm: [
        { id: 'mt-1', tag: '追源', title: '查木牌出处', causalBasis: '木牌带编号', summary: '顺藤摸瓜', entryHook: '查档', milestones: [{ text: '核实工坊印记', done: false }], stakes: '险与利' },
        { id: 'mt-2', tag: '反客为主', title: '约见线人陈二', causalBasis: '旧街茶坊离此不远', summary: '收集外围证词', entryHook: '夜访茶坊', milestones: [{ text: '套出陈二口风', done: false }], stakes: '易打草惊蛇' }
      ],
      longTerm: [
        { id: 'lt-1', tag: '真相', title: '揭开旧案', tone: '抽丝剥茧', prerequisites: ['核实印记'], vision: '水落石出', toneGuidance: '保持悬念' },
        { id: 'lt-2', tag: '焚档止损', title: '把旧案埋进灰烬', tone: '风雨如晦', prerequisites: ['封口线人'], vision: '各退一步', toneGuidance: '维持压抑克制' }
      ]
    }, {}), { scope: 'all', turn: 0 })
  }

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
    worldBooks: { bound: async () => ({ view: { entries: [] } }), constantContext: async () => '' },
    scripts: null,
    prompt,
    selection: () => ({ provider: 'mock', model: 'mock-verifier' }),
    callModel: async () => JSON.stringify({
      completed: [
        { key: 'shortTerm:st-1:0', evidence: '半块刻着梅花纹的旧木牌推到烛火旁' },
        { key: 'shortTerm:st-1:1', evidence: '潜入密库盗取银票' }
      ],
      lapsed: []
    })
  })

  const updatedPrefs = await service.setPreferences({
    sessionId: 'sess-grounding',
    pace: 'foreshadow',
    blindBox: true,
    customDirective: '少说多做，细写眼神试探'
  })
  assert.equal(updatedPrefs.pace, 'foreshadow')
  assert.equal(updatedPrefs.blindBox, true)
  assert.equal(updatedPrefs.customDirective, '少说多做，细写眼神试探')

  const syncRes = await service.syncTurnProgress({ sessionId: 'sess-grounding', chat, turn: 1 })
  assert.equal(syncRes.newlyCompletedCount, 1)
  const latestShort = readPlotCompass(chat.plotCompass).shortTerm[0]
  assert.equal(latestShort.beats[0].done, true)
  assert.equal(latestShort.beats[1].done, false)
})

test('前端浏览器交互：推进节奏三档切换、盲盒防剧透遮罩/临时查看与微调引导编辑器闭环', async () => {
  const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const compass = parsePlotCompassSubmission({
    playArchetypes: ['权谋博弈'],
    situationDigest: '御书房外暴雨如注',
    shortTerm: [
      {
        id: 'st-ui-1',
        tag: '借令调档',
        title: '趁乱查验盐铁密卷',
        causalBasis: '值夜内侍已去传膳',
        summary: '秘密核查失踪船队底册',
        beats: [{ text: '撬开底库紫檀木柜', done: false }]
      },
      {
        id: 'st-ui-2',
        tag: '正门对质',
        title: '堵住内侍套问上谕口径',
        causalBasis: '值夜内侍正经过游廊',
        summary: '当场探听风向',
        beats: [{ text: '拦住内侍寒暄试探', done: false }]
      }
    ],
    midTerm: [
      {
        id: 'mt-ui-1',
        tag: '盐铁迷案',
        title: '掀开漕帮私账链条',
        causalBasis: '密卷指向漕帮',
        summary: '逐层收网',
        entryHook: '在底册中找到朱印编号',
        milestones: [
          { text: '核对底册编号', done: false },
          { text: '逼问主事供词', done: false },
          { text: '当庭掀桌摊牌', done: false }
        ],
        stakes: '得罪门阀还是步步高升',
        diegeticOmen: '渡口茶肆昨夜贴出紧急封港告示'
      },
      {
        id: 'mt-ui-2',
        tag: '稳住暗线',
        title: '保住旧部不被清洗',
        causalBasis: '东厂已开始调卷',
        summary: '暗中换人顶替',
        entryHook: '向沈清弦递出平安符',
        milestones: [{ text: '调换值守名单', done: false }, { text: '销毁副册', done: false }],
        stakes: '欠下人情债'
      }
    ],
    longTerm: [
      {
        id: 'lt-ui-1',
        tag: '共掌权柄',
        title: '并肩重构秩序',
        tone: '暗涌微光',
        prerequisites: ['拿到盐铁暗账'],
        vision: '改写旧规',
        toneGuidance: '保持克制而锐利的锋芒'
      },
      {
        id: 'lt-ui-2',
        tag: '远遁江南',
        title: '携款抽身离京',
        tone: '江南烟雨',
        prerequisites: ['清理京中产业'],
        vision: '全身而退',
        toneGuidance: '保留几分抽离感'
      }
    ]
  }, {})

  let currentCompass = applyPlotCompassPin(mergePlotCompassUpdate(null, compass, { scope: 'all', turn: 2 }), { horizon: 'shortTerm', routeId: 'st-ui-1' })
  const calls = []
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', err => pageErrors.push(String(err)))

    await page.route('http://tavern.test/**', async route => {
      const url = route.request().url()
      if (url === 'http://tavern.test/') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<div id="compass-tab"></div>' })
      }
      const method = new URL(url).pathname.split('/').at(-1)
      const args = route.request().postDataJSON() || {}
      calls.push({ method, args })
      if (method === 'setPlotCompassPreferences') {
        currentCompass = applyPlotCompassPreferences(currentCompass, {
          pace: args.pace,
          blindBox: args.blindBox,
          customDirective: args.customDirective
        })
        return route.fulfill({ json: { ok: true, plotCompass: currentCompass } })
      }
      const responses = {
        listSessions: { sessions: [{ sessionId: 'game', chatId: 'chat', mode: 'story', cardName: '沈清弦' }] },
        getSession: {
          view: {
            mode: 'story',
            latestAssistantTurn: 2,
            latestAssistantMessageId: 'reply-2',
            activity: { busy: false },
            plotCompass: currentCompass,
            plotCompassEnabled: true,
            plotCompassTask: { status: 'idle', scope: 'all', error: '' },
            tavernHelper: { messages: [] }
          }
        },
        getTavernSettings: { settings: {} },
        getChoices: { candidates: null },
        syncSession: { sync: { activity: { busy: false, phase: 'idle' } } }
      }
      await route.fulfill({ json: { ok: true, ...(responses[method] || {}) } })
    })

    await page.goto('http://tavern.test/')
    await page.addScriptTag({ content: await browserReactScript() })
    await page.addScriptTag({ content: `window.__ModuleLoader__={load(d){window.client=d.factory(name=>name==='react'?modules.react:{});}};` })
    await page.addScriptTag({ content: clientSource })

    await page.evaluate(() => {
      const tabs = {}
      const noop = () => () => {}
      const sessionState = { current: 'game', byId: { game: { id: 'game' } } }
      const ctx = {
        inject() { return { dispose() {} } },
        get() {},
        provide() {},
        effect(run, label) {
          if (['dsh-tavern: Tavern workspace browser', 'dsh-tavern: plot compass tab'].includes(label)) return run()
          return () => {}
        },
        slots: {
          inject(_name, run) { return run() },
          register() { return () => {} }
        },
        sessions: {
          subagentAddress: () => null,
          refresh: async () => {},
          list: { subscribe: noop, getSnapshot: () => sessionState },
          binding: () => null
        },
        workspaces: {},
        betterSidebar: {
          registerTab(descriptor) { tabs[descriptor.id] = descriptor; return () => {} },
          openTab() {}
        },
        tavernSessionSignals: { subscribe: noop }
      }
      window.client.apply(ctx)
      const React = modules.react
      const createRoot = modules['react-dom/client'].createRoot
      const CompassComponent = tabs['dsh-tavern:plot-compass'].component
      createRoot(document.querySelector('#compass-tab')).render(React.createElement(CompassComponent, { scope: {} }))
    })

    await page.getByRole('button', { name: '只铺垫' }).waitFor({ timeout: 5000 })

    // 1. 切换推进节奏到「尽快引爆」
    await page.getByRole('button', { name: '尽快引爆' }).click()
    await page.waitForFunction(() => document.querySelector('.dsh-tavern-compass-pace-btn.is-active')?.textContent === '尽快引爆')
    assert.ok(calls.some(c => c.method === 'setPlotCompassPreferences' && c.args.pace === 'climax'))

    // 2. 开启盲盒防剧透：具体步骤与摘要被遮罩，可点击临时查看剧透展开后再收起
    await page.getByText('秘密核查失踪船队底册').waitFor()
    await page.getByRole('button', { name: '👁 明牌模式' }).click()
    await page.getByRole('button', { name: '👀 临时查看此卡剧透' }).first().waitFor()
    assert.equal(await page.getByText('秘密核查失踪船队底册').count(), 0)
    await page.getByRole('button', { name: '👀 临时查看此卡剧透' }).first().click()
    await page.getByText('秘密核查失踪船队底册').waitFor()
    await page.getByRole('button', { name: '🙈 收起剧透（恢复盲盒遮罩）' }).first().click()
    await page.getByRole('button', { name: '👀 临时查看此卡剧透' }).first().waitFor()

    // 3. 切到「中期」查看端锚定阶段标签（入线 / 抉择 / 高潮），切回明牌校验展示
    await page.getByRole('button', { name: /盲盒防剧透：开/ }).click()
    await page.getByRole('tab', { name: /中期/ }).click()
    await page.getByText('抉择', { exact: true }).first().waitFor()
    await page.getByText('高潮', { exact: true }).first().waitFor()

    // 4. 点「✏️ 微调引导」并提交文本
    await page.getByRole('button', { name: '✏️ 微调引导' }).click()
    const directiveInput = page.getByPlaceholder(/微调后台软引导/)
    await directiveInput.fill('这一章多给双人暗号对戏')
    await page.getByRole('button', { name: '应用' }).click()
    await page.getByText('这一章多给双人暗号对戏').waitFor()
    assert.ok(calls.some(c => c.method === 'setPlotCompassPreferences' && c.args.customDirective === '这一章多给双人暗号对戏'))

    assert.deepEqual(pageErrors, [])
  } finally {
    await browser.close()
  }
})






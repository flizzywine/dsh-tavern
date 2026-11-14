import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { createBackgroundNativeRuntime } from './fixtures/background-native-runtime.mjs'
import {
  PLOT_COMPASS_SUBMIT_TOOL_NAME,
  applyPlotCompassCustomArchetypes,
  applyPlotCompassPin,
  applyPlotCompassStepToggle,
  buildPlotCompassMaterial,
  extractDormantWorldbookHooks,
  isPlotCompassEnabled,
  mergePlotCompassUpdate,
  parsePlotCompassSubmission,
  plotCompassBodySection,
  plotCompassCandidateSection,
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
  let compassEnabled = true

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

  // 5. 关闭剧情罗盘：触发 setPlotCompassEnabled(false)，隐藏底部 dock 按钮并保留路线提示，随后可一键重新开启
  await page.locator('#compass-tab .dsh-tavern-settings-switch').click()
  await page.locator('.dsh-tavern-compass-disabled-card').waitFor()
  assert.ok(calls.some(c => c.method === 'setPlotCompassEnabled' && c.args.enabled === false))
  assert.equal(await page.locator('.dsh-tavern-compass-dock-btn').count(), 0)

  await page.getByRole('button', { name: '开启剧情罗盘' }).click()
  await page.getByText('半真半假亮出密信残页').waitFor()
  assert.ok(calls.some(c => c.method === 'setPlotCompassEnabled' && c.args.enabled === true))
  await page.locator('.dsh-tavern-compass-dock-btn').waitFor()
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

  assert.equal(isPlotCompassEnabled(chat), true)
  assert.ok(plotCompassBodySection(chat))
  assert.ok(plotCompassCandidateSection(chat))
  assert.ok(plotCompassCompactionNote(chat))

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




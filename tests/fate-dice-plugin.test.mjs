import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { evaluateOutcome, extractVariableModifier, rollCheck, rollExpression } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/dice-engine.js'
import { heuristicAssess, judgeActionDifficulty } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/difficulty-judge.js'
import { buildTurnInjection } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/prompt-builder.js'
import { apply as applyFateDicePlugin, inject as fateDiceInject, name as fateDiceName } from '../tavern-plugin/packages/dsh-tavern-fate-dice/lib/index.js'
import { buildFateDiceClient } from '../tavern-plugin/packages/dsh-tavern-fate-dice/build.mjs'
import { pluginManifestProblem } from '../tavern-plugin/lib/domain/plugin-manifest.js'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { createPluginData } from '../tavern-plugin/lib/domain/plugin-data.js'
import { createNarrativeDamper, defaultNarrativeDamperConfig } from '../tavern-plugin/lib/domain/narrative-damper.js'

const require = createRequire(import.meta.url)
let cordis = null
try { cordis = require('@deepseek-ai/cordis') } catch {}

const tick = () => new Promise(resolve => setTimeout(resolve, 15))

test('dice-engine：2d6 / d20 / d100 五档判定、自由表达式与变量修正提取', () => {
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [6, 6], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [1, 1], modifier: 4, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [4, 4], modifier: 0, difficulty: 'moderate' }).tier, 'costly')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [5, 5], modifier: 0, difficulty: 'moderate' }).tier, 'success')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [2, 3], modifier: 0, difficulty: 'moderate' }).tier, 'failure')

  assert.equal(evaluateOutcome({ rule: 'd20', dice: [20], modifier: -3, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [1], modifier: 5, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [11], modifier: 1, difficulty: 'moderate' }).tier, 'costly')

  assert.equal(evaluateOutcome({ rule: 'd100', dice: [4], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [97], modifier: 2, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [65], modifier: 0, difficulty: 'moderate' }).tier, 'costly')

  const rolled = rollCheck({ rule: '2d6', check: '潜行检定', difficulty: 'hard', modifier: 2, hidden: true }, () => 4)
  assert.equal(rolled.check, '潜行')
  assert.deepEqual(rolled.dice, [4, 4])
  assert.equal(rolled.total, 10)
  assert.equal(rolled.hidden, true)

  const expr = rollExpression('3d8+2', () => 5)
  assert.equal(expr.expression, '3d8+2')
  assert.deepEqual(expr.dice, [5, 5, 5])
  assert.equal(expr.total, 17)
  assert.throws(() => rollExpression('abc'), /无效/)

  const vars = { stat_data: { 主角: { 敏捷: 16, 感知: 65, $meta: { 敏捷: 99 } } } }
  const extracted = extractVariableModifier(vars, '/主角/敏捷, 感知')
  assert.equal(extracted.modifier, 4)
  assert.equal(extracted.matched.length, 2)
})

test('difficulty-judge：Gemini / Jev 协议判定与不可用时启发式回退', async () => {
  const geminiStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() {
      return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
    },
    async judgeDecision() {
      return {
        provider: 'gemini',
        judgeTier: 'digest',
        retriedSafetyFallback: true,
        answers: {
          needs_check: { type: 'noul', probability: 0.88 },
          difficulty_tier: { type: 'choice', choice: 'hard' },
          check_category: { type: 'choice', choice: 'insight' },
          situation_edge: { type: 'score', score: 3 }
        }
      }
    }
  }
  const gRes = await judgeActionDifficulty({ tavern: geminiStub, gameId: 'g1', input: '偷偷观察对方袖口是不是藏了武器' })
  assert.equal(gRes.shouldRoll, true)
  assert.equal(gRes.difficulty, 'hard')
  assert.equal(gRes.check, '察觉')
  assert.equal(gRes.hidden, true)
  assert.equal(gRes.edgeBonus, 2)
  assert.equal(gRes.retriedSafetyFallback, true)

  const jevStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() {
      return { available: true, provider: 'jev', model: 'jev-1.13.0', capabilities: { noul: true, choice: false, score: false } }
    },
    async judgeDecision() {
      return {
        provider: 'jev',
        judgeTier: 'full',
        answers: {
          needs_check: { type: 'noul', probability: 0.72 },
          high_difficulty: { type: 'noul', probability: 0.85 },
          favorable_edge: { type: 'noul', probability: 0.15 },
          hidden_perception: { type: 'noul', probability: 0.2 }
        }
      }
    }
  }
  const jRes = await judgeActionDifficulty({ tavern: jevStub, gameId: 'g1', input: '正面劈砍重甲骑士' })
  assert.equal(jRes.shouldRoll, true)
  assert.equal(jRes.difficulty, 'extreme')
  assert.equal(jRes.edgeBonus, -1)
  assert.equal(jRes.hidden, false)

  const downStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() { return { available: false, reason: 'NOT_CONFIGURED' } }
  }
  const hChat = await judgeActionDifficulty({ tavern: downStub, gameId: 'g1', input: '嗯，我知道了。' })
  assert.equal(hChat.shouldRoll, false)
  assert.equal(hChat.source, 'heuristic')

  const hStealth = await judgeActionDifficulty({ tavern: downStub, gameId: 'g1', input: '我趁守卫转身时尝试强行撬开铁门锁。' })
  assert.equal(hStealth.shouldRoll, true)
  assert.equal(hStealth.difficulty, 'hard')
})

test('prompt-builder：生成不含泄密点数（暗骰）的正文注入块', () => {
  const openText = buildTurnInjection({
    rule: '2d6', check: '说服', difficultyLabel: '中等', dice: [5, 4], modifier: 1, total: 10, target: 7, tier: 'success', tierLabel: '成功', hidden: false, attempt: '劝降守卫'
  })
  assert.match(openText, /说服检定/)
  assert.match(openText, /【成功】/)
  assert.equal(openText.includes('暗骰约束'), false)

  const hiddenText = buildTurnInjection({
    rule: 'd100', check: '察觉', difficultyLabel: '困难', dice: [38], modifier: 0, total: 38, target: 40, tier: 'success', tierLabel: '成功', hidden: true
  })
  assert.match(hiddenText, /暗骰约束/)
})

test('端到端集成：在真实 Plugin API + 叙事阻尼器中完成 R18 脱敏定难、真骰注入、落盘与预投消费', { skip: !cordis }, async t => {
  const damperConfig = {
    ...defaultNarrativeDamperConfig(),
    enabled: false,
    provider: 'gemini',
    model: 'gemini-decision-1',
    desensitizeR18: true
  }
  const sentPrompts = []
  const damper = createNarrativeDamper({
    getConfig: async () => damperConfig,
    credentials: () => ({ async resolve(name) { return name.includes('GEMINI') ? { value: 'k-test', source: 'file' } : null } }),
    fetch: async (_url, init) => {
      const req = JSON.parse(init.body)
      sentPrompts.push(req.input)
      // 模拟遇到敏感词拒绝：直到进入纯结构摘要（digest）才放行，测试 R18 语义分级脱敏闭环
      if (!req.input.includes('【判定素材 · 结构化脱敏摘要')) {
        return { ok: false, status: 400, async json() { return { error: { code: 'prohibited_content', message: 'blocked' } } } }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            answers: {
              needs_check: { type: 'noul', noul: 0.92 },
              difficulty_tier: { type: 'choice', choice: 'moderate' },
              check_category: { type: 'choice', choice: 'physical' },
              situation_edge: { type: 'score', score: 2 }
            }
          }
        }
      }
    }
  })

  const root = new cordis.Context()
  t.after(() => root.registry?.clear?.())

  const files = new Map()
  const store = {
    async readJson(path) { return files.has(path) ? structuredClone(files.get(path)) : undefined },
    async updateJson(path, updater) {
      const next = await updater(files.has(path) ? structuredClone(files.get(path)) : undefined)
      if (next !== undefined) files.set(path, structuredClone(next))
      return next
    },
    async remove(path) { files.delete(path) },
    async version(path) { return files.has(path) ? 1 : undefined },
    async writeJson(path, value) { files.set(path, structuredClone(value)) }
  }
  const data = createPluginData({ store })
  const identities = new Map([[fateDiceName, { runtimeName: fateDiceName, origin: 'global' }]])
  const publishedEvents = []
  const latestTurns = new Map([['g-1', { sessionId: 'g-1', chatId: 'c-1', turn: 1, key: 'v1', text: '房间昏暗，门已被反锁。', source: '房间昏暗，门已被反锁。', card: { path: '/cards/a.json', name: 'A' }, variables: { stat_data: { 敏捷: 14 } } }]])

  let api
  await root.plugin({
    name: 'dsh-tavern-test-host',
    apply(ctx) {
      api = createTavernPluginApi({
        ctx,
        data,
        runningUserPlugins: identities,
        resolveGame: async id => id === 'g-1' ? { sessionId: 'g-1', chatId: 'c-1', cardPath: '/cards/a.json' } : null,
        currentKey: async (id, turn) => {
          const item = latestTurns.get(id)
          return item && item.turn === turn ? item.key : null
        },
        readLatestSettledTurn: async id => latestTurns.get(id) || null,
        readPendingTurn: async () => null,
        readTurn: async (id, turn) => {
          const item = latestTurns.get(id)
          return item && item.turn === turn ? item : null
        },
        publishState: (gameId, owner, name) => { publishedEvents.push({ gameId, owner, name }) },
        media: { issue: async () => {} },
        cardPathOf: async () => '/cards/a.json',
        decisionJudge: {
          status: () => damper.judgeStatus(),
          judge: input => damper.judge(input)
        }
      })
      ctx.provide('tavern', api.service)
    }
  })

  await root.plugin({ name: fateDiceName, inject: fateDiceInject, apply: applyFateDicePlugin })
  await tick()

  // 1. 测试自动模式 + R18 语义脱敏降级 + 实时动画状态广播 + 结算绑定版本存盘
  const turnInput = '我按住她揉搓她的乳头，强行把她身上的钥匙抢过来。'
  const ctxRes = await api.turnContext({ gameId: 'g-1', turn: 2, input: turnInput })
  assert.equal(ctxRes.length, 1)
  assert.match(ctxRes[0].text, /【本轮客观检定已由系统掷骰裁定/)
  assert.match(ctxRes[0].text, /体魄检定/)
  assert.equal(sentPrompts.at(-1).includes('乳头'), false, 'R18 送审最终走纯结构摘要，绝不泄露原文高敏词')

  assert.ok(publishedEvents.some(ev => ev.name === 'live-roll'))
  const liveState = await api.pluginState('g-1', fateDiceName, 'live-roll')
  assert.ok(liveState && liveState.roll.retriedSafetyFallback === true)
  assert.equal(liveState.roll.judgeTier, 'digest')

  // 更新最新已结算回合并触发 turnSettled -> saveTurnData 落盘
  latestTurns.set('g-1', { sessionId: 'g-1', chatId: 'c-1', turn: 2, key: 'v2', text: '钥匙抢到手。', source: '钥匙抢到手。', card: { path: '/cards/a.json', name: 'A' }, variables: {} })
  await api.turnSettled('g-1')
  await tick()

  const readTurnRes = await api.callHandler('fate-dice:read-turn', { gameId: 'g-1', turn: 2 })
  assert.equal(readTurnRes.textVersion, 'v2')
  assert.equal(readTurnRes.roll.check, '体魄')

  const statusRes = await api.callHandler('fate-dice:status', { gameId: 'g-1' })
  assert.equal(statusRes.summary.total, 1)
  assert.equal(statusRes.judgeStatus.available, true)

  // 2. 测试发前手投锁定流：预览 -> 锁定 -> turnContext 直接消费
  const previewRes = await api.callHandler('fate-dice:preview', { gameId: 'g-1', input: '翻窗溜进二楼走廊' })
  assert.equal(previewRes.shouldRoll, true)

  const lockRes = await api.callHandler('fate-dice:roll-and-lock', {
    gameId: 'g-1',
    input: '翻窗溜进二楼走廊',
    rule: 'd20',
    check: '潜行',
    difficulty: 'hard',
    modifier: 2,
    hidden: false
  })
  assert.equal(lockRes.roll.rule, 'd20')

  const beforeCalls = sentPrompts.length
  const lockedCtx = await api.turnContext({ gameId: 'g-1', turn: 3, input: '翻窗溜进二楼走廊' })
  assert.equal(sentPrompts.length, beforeCalls, '已锁定预投结果应直接消费，不再重复请求决策模型')
  assert.equal(lockedCtx.length, 1)
  assert.match(lockedCtx[0].text, /潜行检定/)
  assert.match(lockedCtx[0].text, /1d20|d20/)

  // 3. 测试自由骰盘
  const free = await api.callHandler('fate-dice:free-roll', { gameId: 'g-1', expression: '2d6+1' })
  assert.equal(free.result.expression, '2d6+1')
  assert.equal(free.result.dice.length, 2)
})

test('插件包清单与浏览器 client.js 装载校验', async () => {
  const pkg = JSON.parse(await readFile(new URL('../tavern-plugin/packages/dsh-tavern-fate-dice/package.json', import.meta.url), 'utf8'))
  assert.equal(pluginManifestProblem(pkg), '')
  const buildCheck = await buildFateDiceClient({ check: true })
  assert.equal(buildCheck.changed, false)

  const clientSource = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-fate-dice/client.js', import.meta.url), 'utf8')
  let descriptor = null
  const ReactStub = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: init => [init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: init => ({ current: init })
  }
  vm.runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load(desc) { descriptor = desc } } },
    console
  })
  assert.equal(descriptor.id, 'dsh-tavern-fate-dice')
  const exported = descriptor.factory(mod => mod === 'react' ? ReactStub : {})
  assert.equal(exported.name, 'dsh-tavern-fate-dice')
  assert.equal(typeof exported.apply, 'function')

  const registered = []
  exported.apply({
    inject(_deps, cb) {
      cb({
        tavernUi: {
          registerComposerSlot(item) { registered.push(['slot', item.id]); return () => {} },
          registerComposerAction(item) { registered.push(['action', item.id]); return () => {} },
          registerTurnView(item) { registered.push(['turn', item.id]); return () => {} },
          registerStatusSection(item) { registered.push(['status', item.id]); return () => {} }
        }
      })
    }
  })
  assert.deepEqual(registered, [
    ['slot', 'fate-dice-live'],
    ['action', 'fate-dice-pad'],
    ['turn', 'fate-dice-turn'],
    ['status', 'fate-dice-status']
  ])
  assert.equal(exported.__test.formatRollSummary({ check: '潜行', hidden: true }), '潜行暗骰 · 等待揭晓')
  assert.equal(exported.__test.formatRollSummary({ check: '潜行', dice: [4, 5], modifier: 1, total: 10, tierLabel: '成功', hidden: false }), '潜行检定 · [4+5]+1=10 · 成功')
})

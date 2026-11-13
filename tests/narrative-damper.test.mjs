import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import {
  DAMPER_KEY_REFS,
  clampMvuSubmissionOperations,
  clampMvuSubmissionOperationsWithReport,
  createNarrativeDamper,
  defaultNarrativeDamperConfig,
  desensitizeForDecisionJudge,
  nextPlainDamperState,
  readDamperStateSnapshot,
  settlementBudgetRuleText
} from '../tavern-plugin/lib/domain/narrative-damper.js'
import { maskMvuReceipt } from '../tavern-plugin/lib/domain/mvu-visibility.js'
import { projectStoryTranscript } from '../tavern-plugin/lib/domain/story-transcript.js'
import { createStoryTranscriptReader, storyTranscriptMessageFields } from '../tavern-plugin/lib/domain/story-transcript-reader.js'
import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'

function createMemoryCredentials(initialEnv = {}) {
  const stored = new Map()
  const env = new Map(Object.entries(initialEnv))
  return {
    stored,
    async resolve(name) {
      if (stored.has(name)) return { value: stored.get(name), source: 'file' }
      if (env.has(name)) return { value: env.get(name), source: 'env' }
      return null
    },
    async describe(name) {
      if (stored.has(name)) return { configured: true, source: 'file' }
      if (env.has(name)) return { configured: true, source: 'env' }
      return { configured: false, source: null }
    },
    async set(name, value) {
      stored.set(name, value)
    },
    async unset(name) {
      stored.delete(name)
    }
  }
}

test('叙事阻尼器设置：默认值、合法补丁保存与非法 URL/参数拦截', () => {
  const initial = presentTavernSettings({}, {}).narrativeDamper
  assert.deepEqual(initial, defaultNarrativeDamperConfig())
  assert.equal(initial.enabled, false)
  assert.equal(initial.provider, 'gemini')
  assert.equal(initial.model, 'gemini-decision-1')

  let doc = applyTavernSettingsPatch({}, {
    narrativeDamper: {
      enabled: true,
      mode: 'strict',
      godmodeThreshold: 0.68,
      timeoutMs: 3200
    }
  })
  const presented = presentTavernSettings(doc, {}).narrativeDamper
  assert.equal(presented.enabled, true)
  assert.equal(presented.mode, 'strict')
  assert.equal(presented.godmodeThreshold, 0.68)
  assert.equal(presented.timeoutMs, 3200)

  // Reject insecure HTTP non-loopback custom endpoint
  assert.throws(() => applyTavernSettingsPatch(doc, {
    narrativeDamper: { provider: 'gemini-compatible', baseUrl: 'http://evil.example.com', enabled: true }
  }), /HTTPS|回环/)

  // Allow HTTPS custom endpoint and loopback HTTP endpoint
  doc = applyTavernSettingsPatch(doc, {
    narrativeDamper: { provider: 'gemini-compatible', baseUrl: 'https://proxy.example.com', enabled: true }
  })
  assert.equal(presentTavernSettings(doc, {}).narrativeDamper.baseUrl, 'https://proxy.example.com')

  doc = applyTavernSettingsPatch(doc, {
    narrativeDamper: { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:8787', model: 'gpt-6-luna', enabled: true }
  })
  assert.equal(presentTavernSettings(doc, {}).narrativeDamper.baseUrl, 'http://127.0.0.1:8787')
})

test('叙事阻尼器 RPC：密钥安全存储不回显明文、环境变量引用识别与未保存地址防泄露测试保护', async () => {
  let doc = {}
  const creds = createMemoryCredentials({ CUSTOM_GEMINI_ENV: 'env-secret-123' })
  const calls = []
  const damper = createNarrativeDamper({
    getConfig: async () => presentTavernSettings(doc, {}).narrativeDamper,
    credentials: () => creds,
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return {
        ok: true,
        status: 200,
        async json() {
          return { answers: { probe: { type: 'noul', noul: 0.98, confidence: 0.98 } }, usage: { total_input_tokens: 24, total_output_tokens: 0 } }
        }
      }
    }
  })

  const handlers = createSettingsHandlers({
    narrativeDamper: damper,
    readTavernSettings: async () => presentTavernSettings(doc, {}),
    updateTavernSettings: async patch => {
      doc = applyTavernSettingsPatch(doc, patch)
      return presentTavernSettings(doc, {})
    },
    str: v => String(v ?? '')
  })

  const savedKey = await handlers.setNarrativeDamperKey({ provider: 'gemini', value: 'AIzaSyTestSecretKey999' })
  assert.equal(JSON.stringify(savedKey).includes('AIzaSyTestSecretKey999'), false)
  assert.equal(savedKey.credential.configured, true)
  assert.equal(savedKey.credential.source, 'stored')
  assert.equal(creds.stored.get(DAMPER_KEY_REFS.gemini), 'AIzaSyTestSecretKey999')

  const probeOk = await handlers.testNarrativeDamperConnection()
  assert.equal(probeOk.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/decisions')
  assert.equal(calls[0].headers['x-goog-api-key'], 'AIzaSyTestSecretKey999')

  // Unsaved custom baseUrl must not exfiltrate stored credential during connection test
  const mismatch = await handlers.testNarrativeDamperConnection({
    config: {
      ...defaultNarrativeDamperConfig(),
      provider: 'gemini-compatible',
      baseUrl: 'https://untrusted.example.com'
    }
  })
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.error.code, 'DAMPER_KEY_URL_MISMATCH')

  // Recognized environment variable reference switches keyName and clears stored secret
  const refSaved = await handlers.setNarrativeDamperKey({ provider: 'gemini', value: 'CUSTOM_GEMINI_ENV' })
  assert.equal(refSaved.credential.configured, true)
  assert.equal(refSaved.credential.source, 'env')
  assert.equal(refSaved.config.keyName, 'CUSTOM_GEMINI_ENV')
  assert.equal(creds.stored.has(DAMPER_KEY_REFS.gemini), false)
})

test('gemini-decision-1 前置裁定：R18 送审脱敏投影、400 敏感词二次骨架兜底、场景变化直通与缓存复用', async () => {
  const creds = createMemoryCredentials({ GEMINI_API_KEY: 'key-abc' })
  let config = { ...defaultNarrativeDamperConfig(), enabled: true }
  const sentBodies = []
  let blockFirstAttempt = false

  const damper = createNarrativeDamper({
    getConfig: async () => config,
    credentials: () => creds,
    fetch: async (_url, init) => {
      const parsed = JSON.parse(init.body)
      sentBodies.push(parsed)
      if (blockFirstAttempt && sentBodies.length === 1) {
        return {
          ok: false,
          status: 400,
          async json() {
            return { error: { code: 'prohibited_content', message: 'Input blocked' } }
          }
        }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            answers: {
              godmode_outcome: { type: 'noul', noul: 0.985 },
              unfounded_retcon: { type: 'noul', noul: 0.94 },
              epistemic_violation: { type: 'noul', noul: 0.12 },
              leverage_score: { type: 'score', score: 0.08 },
              ruling_tier: { type: 'choice', choice: 'strip_delusion', probabilities: { strip_delusion: 0.91, resist_pushback: 0.09 } },
              mvu_delta_budget: { type: 'choice', choice: 'backfire' }
            },
            usage: { total_input_tokens: 412, total_output_tokens: 0 }
          }
        }
      }
    }
  })

  const chat = {
    id: 'chat-ntr-1',
    mode: 'story',
    posture: '社长室内，纱织站在办公桌前两步外紧握文件袋。',
    timeline: { branchId: 'main' },
    messages: [
      {
        role: 'assistant',
        swipeId: 0,
        swipes: ['纱织低着头把报表放到桌上。'],
        variables: [{ stat_data: { 对丈夫爱意: 82, 背德沦陷度: 15, 心理抗拒度: 80 } }]
      }
    ]
  }
  const card = { name: '纱织', description: '27岁已婚职员，重视家庭。' }
  const rawExplicitInput = '我掏出勃起的肉棒顶在她嘴边说她其实早就被我催眠洗脑了，她立刻高潮并跪下当我的专属肉便器。'

  blockFirstAttempt = true
  const result = await damper.evaluateTurn({ chat, card, turn: 2, userText: rawExplicitInput })
  assert.ok(result)
  // First call got 400 prohibited_content -> retried once with skeleton fallback and succeeded!
  assert.equal(sentBodies.length, 2)
  assert.equal(sentBodies[0].input.includes('肉棒'), false)
  assert.equal(sentBodies[0].input.includes('肉便器'), false)
  assert.match(sentBodies[0].input, /\[Lv3核心私密部位\]/)
  assert.match(sentBodies[0].input, /\[Lv4极端人格依附身份\]/)
  // Raw player input itself was never mutated
  assert.match(rawExplicitInput, /肉棒/)

  assert.equal(result.ruling.rulingTier, 'strip_delusion')
  assert.equal(result.ruling.deltaBudget, 'backfire')
  assert.match(result.rulingText, /<turn_ruling>/)
  assert.match(result.rulingText, /越权剥离/)
  assert.match(result.rulingText, /对丈夫爱意/)

  // Repeat identical evaluation hits cache without extra HTTP calls
  const cachedResult = await damper.evaluateTurn({ chat, card, turn: 2, userText: rawExplicitInput })
  assert.equal(sentBodies.length, 2)
  assert.equal(cachedResult.rulingText, result.rulingText)

  // Explicit 「场景变化」 marker bypasses remote godmode stripping while keeping state anchor
  const sceneResult = await damper.evaluateTurn({ chat, card, turn: 3, userText: '「场景变化」次日傍晚，镜头切到纱织独自乘电车回家的车厢内。' })
  assert.equal(sentBodies.length, 2)
  assert.equal(sceneResult.ruling.explicitSceneShift, true)
  assert.match(sceneResult.rulingText, /显式场景转换放行/)
})

test('后台 MVU 结算 Delta Clamp：按配额钳制关系/防线跳变并放行金钱与回合计数', () => {
  const currentVariables = {
    stat_data: {
      白石凛: { 好感度: 15, 羞耻防线: 85, 背德沦陷: 10 },
      系统: { 金钱: 5000, 回合数: 3 }
    }
  }
  const wildSubmission = {
    operations: [
      { op: 'replace', path: '/stat_data/白石凛/好感度', value: 95 },
      { op: 'delta', path: '/stat_data/白石凛/背德沦陷', value: 70 },
      { op: 'replace', path: '/stat_data/白石凛/羞耻防线', value: 5 },
      { op: 'delta', path: '/stat_data/系统/金钱', value: -1200 },
      { op: 'delta', path: '/stat_data/系统/回合数', value: 1 }
    ]
  }

  // 1) backfire: positive approach cannot increase (dropped when clamped to 0), guard cannot drop!
  const backfireClamped = clampMvuSubmissionOperations(wildSubmission, currentVariables, {
    mode: 'balanced',
    deltaBudget: 'backfire',
    clampMvuDelta: true
  })
  assert.deepEqual(backfireClamped.operations, [
    { op: 'delta', path: '/stat_data/系统/金钱', value: -1200 },
    { op: 'delta', path: '/stat_data/系统/回合数', value: 1 }
  ])

  // 2) frozen: max +1 on approach, max -1 on guard
  const frozenClamped = clampMvuSubmissionOperations(wildSubmission, currentVariables, {
    mode: 'balanced',
    deltaBudget: 'frozen',
    clampMvuDelta: true
  })
  assert.deepEqual(frozenClamped.operations, [
    { op: 'replace', path: '/stat_data/白石凛/好感度', value: 16 },
    { op: 'delta', path: '/stat_data/白石凛/背德沦陷', value: 1 },
    { op: 'replace', path: '/stat_data/白石凛/羞耻防线', value: 84 },
    { op: 'delta', path: '/stat_data/系统/金钱', value: -1200 },
    { op: 'delta', path: '/stat_data/系统/回合数', value: 1 }
  ])

  // 3) breakthrough in strict mode: capped at ±8
  const strictBreakthrough = clampMvuSubmissionOperations(wildSubmission, currentVariables, {
    mode: 'strict',
    deltaBudget: 'breakthrough',
    clampMvuDelta: true
  })
  assert.deepEqual(strictBreakthrough.operations, [
    { op: 'replace', path: '/stat_data/白石凛/好感度', value: 23 },
    { op: 'delta', path: '/stat_data/白石凛/背德沦陷', value: 8 },
    { op: 'replace', path: '/stat_data/白石凛/羞耻防线', value: 77 },
    { op: 'delta', path: '/stat_data/系统/金钱', value: -1200 },
    { op: 'delta', path: '/stat_data/系统/回合数', value: 1 }
  ])
  assert.match(settlementBudgetRuleText({ mode: 'strict', deltaBudget: 'breakthrough' }), /±8/)
})

test('无 MVU 普通人物卡：楼层四维惯性状态演进与回退恢复', () => {
  const chat = { id: 'plain-1', mode: 'story', messages: [] }
  const initial = readDamperStateSnapshot(chat)
  assert.equal(initial.kind, 'plain-fallback')
  assert.deepEqual(initial.data, { intimacy_trust: 20, psychological_guard: 70, arousal_or_tension: 10, leverage_depth: 0 })

  const afterGodmode = nextPlainDamperState(initial.data, { mode: 'balanced', rulingTier: 'strip_delusion', deltaBudget: 'backfire', leverageScore: 0.1 })
  assert.equal(afterGodmode.intimacy_trust, 16)
  assert.equal(afterGodmode.psychological_guard, 76)

  chat.messages.push({ role: 'user', text: '口胡' }, { role: 'assistant', text: '推开', damperState: [afterGodmode] })
  assert.deepEqual(readDamperStateSnapshot(chat).data, afterGodmode)

  const afterBreakthrough = nextPlainDamperState(afterGodmode, { mode: 'balanced', rulingTier: 'conflicted_half_step', deltaBudget: 'breakthrough', leverageScore: 2.7 })
  assert.ok(afterBreakthrough.intimacy_trust > afterGodmode.intimacy_trust)
  assert.ok(afterBreakthrough.psychological_guard < afterGodmode.psychological_guard)
  chat.messages.push({ role: 'user', text: '有效伏笔' }, { role: 'assistant', text: '动摇', damperState: [afterBreakthrough] })
  assert.deepEqual(readDamperStateSnapshot(chat).data, afterBreakthrough)

  // Rollback removes last round -> automatically rewinds to afterGodmode!
  chat.messages.splice(-2, 2)
  assert.deepEqual(readDamperStateSnapshot(chat).data, afterGodmode)
})

test('前端构建产物：设置面板注册「叙事阻尼器」section', async () => {
  const mainSource = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
  const builtClient = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(mainSource, /id:\s*"dsh-tavern-narrative-damper"/)
  assert.match(builtClient, /dsh-tavern-narrative-damper/)
  assert.match(builtClient, /getNarrativeDamperSettings/)
  assert.match(builtClient, /testNarrativeDamperConnection/)
  assert.match(builtClient, /StoryFloorDamperPill/)
  assert.match(builtClient, /DamperReceiptSummary/)
  assert.equal(desensitizeForDecisionJudge('普通日常对话'), '普通日常对话')
})

test('未生效原因留痕与 MVU 钳制明细报告（含隐藏变量可见性脱敏）', async () => {
  const emptyCreds = createMemoryCredentials({})
  let enabled = true
  const damper = createNarrativeDamper({
    getConfig: async () => ({ ...defaultNarrativeDamperConfig(), enabled, timeoutMs: 300 }),
    credentials: () => emptyCreds,
    fetch: async () => { throw new Error('should not send without key') }
  })
  const chat = { id: 'chat-no-key', mode: 'story', messages: [] }
  const card = { name: '白石凛' }
  const bypassed = await damper.evaluateTurn({ chat, card, turn: 2, userText: '我握住她的手。' })
  assert.ok(bypassed)
  assert.equal(bypassed.ruling, null)
  assert.equal(bypassed.rulingText, '')
  assert.equal(bypassed.outcome.status, 'bypassed')
  assert.equal(bypassed.outcome.code, 'DAMPER_NO_KEY')
  assert.equal(damper.activeRuling('chat-no-key', 2).outcome.code, 'DAMPER_NO_KEY')

  // Turning damper off clears stale active ruling for subsequent regenerations
  enabled = false
  const offRes = await damper.evaluateTurn({ chat, card, turn: 2, userText: '我握住她的手。' })
  assert.equal(offRes, null)
  assert.equal(damper.activeRuling('chat-no-key', 2), null)

  // Clamping report + visibility masking
  const currentVariables = {
    stat_data: {
      白石凛: { 好感度: 15, 背德沦陷: 10, 隐藏真意: 20 }
    }
  }
  const submission = {
    operations: [
      { op: 'replace', path: '/stat_data/白石凛/好感度', value: 85 },
      { op: 'delta', path: '/stat_data/白石凛/背德沦陷', value: 40 },
      { op: 'delta', path: '/stat_data/白石凛/隐藏真意', value: 50 }
    ]
  }
  const { report } = clampMvuSubmissionOperationsWithReport(submission, currentVariables, {
    mode: 'balanced',
    rulingTier: 'resist_pushback',
    deltaBudget: 'backfire',
    leverageScore: 0.4,
    clampMvuDelta: true
  })
  assert.equal(report.clampedCount, 3)
  assert.equal(report.clamped[0].dropped, true)
  assert.equal(report.clamped[0].requestedDelta, 70)

  const masked = maskMvuReceipt({
    version: 1,
    status: 'updated',
    changes: [],
    sideEffects: [],
    failures: [],
    damper: report
  }, { '/stat_data/白石凛/隐藏真意': 'masked' })
  assert.equal(masked.damper.clamped[0].hidden, undefined)
  assert.equal(masked.damper.clamped[2].hidden, true)
  assert.equal(masked.damper.clamped[2].before, undefined)
})

test('故事窗口读取保留 narrativeDamper 与 damperState，前端楼层渲染状态胶囊、详情面板与变量回执摘要', async t => {
  assert.ok(storyTranscriptMessageFields.includes('narrativeDamper'))
  assert.ok(storyTranscriptMessageFields.includes('damperState'))

  const savedChat = {
    id: 'chat-ui-1',
    sessionId: 'sess-ui-1',
    mode: 'story',
    _storageRevision: 9,
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '开场白' },
      { role: 'user', text: '越权行动' },
      {
        role: 'assistant',
        turn: 2,
        text: '流式生成中…',
        placeholder: true,
        narrativeDamper: [{
          status: 'applied',
          source: 'model',
          mode: 'balanced',
          rulingTier: 'strip_delusion',
          deltaBudget: 'backfire',
          leverageScore: 0.12,
          godmode: 0.96,
          retcon: 0.82,
          epistemic: 0.05,
          godmodeThreshold: 0.72,
          latencyMs: 280
        }]
      },
      { role: 'user', text: '试探推进' },
      {
        role: 'assistant',
        turn: 3,
        text: '她微微退开半步。',
        narrativeDamper: [{
          status: 'applied',
          source: 'model',
          mode: 'strict',
          rulingTier: 'resist_pushback',
          deltaBudget: 'frozen',
          leverageScore: 0.6,
          godmode: 0.15,
          retcon: 0.05,
          epistemic: 0.02,
          godmodeThreshold: 0.64,
          latencyMs: 310
        }],
        mvu: {
          pending: false,
          modified: true,
          receipt: {
            version: 1,
            status: 'updated',
            changes: [{ path: '/stat_data/白石凛/好感度', before: '15', after: '16', operation: 'replace' }],
            sideEffects: [],
            failures: [],
            damper: {
              mode: 'strict',
              rulingTier: 'resist_pushback',
              deltaBudget: 'frozen',
              leverageScore: 0.6,
              clampEnabled: true,
              clampedCount: 2,
              clamped: [
                { path: '/stat_data/白石凛/好感度', operation: 'replace', before: '15', requestedAfter: '90', after: '16', requestedDelta: 75, clampedDelta: 1, dropped: false },
                { path: '/stat_data/白石凛/秘密动摇', operation: 'delta', before: '10', requestedAfter: '50', after: '11', requestedDelta: 40, clampedDelta: 1, dropped: false }
              ]
            }
          }
        }
      },
      { role: 'user', text: '普通卡互动' },
      {
        role: 'assistant',
        turn: 4,
        text: '她轻声回应。',
        damperState: [{ intimacy_trust: 25, psychological_guard: 66, arousal_or_tension: 15, leverage_depth: 4 }],
        narrativeDamper: [{
          status: 'applied',
          source: 'model',
          mode: 'balanced',
          rulingTier: 'conflicted_half_step',
          deltaBudget: 'micro_step',
          leverageScore: 1.9,
          godmode: 0.1,
          retcon: 0.0,
          epistemic: 0.0,
          plainState: {
            before: { intimacy_trust: 20, psychological_guard: 70, arousal_or_tension: 10, leverage_depth: 0 },
            after: { intimacy_trust: 25, psychological_guard: 66, arousal_or_tension: 15, leverage_depth: 4 }
          }
        }]
      },
      { role: 'user', text: '未配密钥回合' },
      {
        role: 'assistant',
        turn: 5,
        text: '正常放行回复。',
        narrativeDamper: [{
          status: 'bypassed',
          code: 'DAMPER_NO_KEY',
          message: '尚未配置决策模型 API Key',
          model: 'gemini-decision-1',
          latencyMs: 2
        }]
      }
    ]
  }

  const reader = createStoryTranscriptReader({
    readSessionMap: async () => ({ 'sess-ui-1': 'chat-ui-1' }),
    readWindow: async () => null,
    readRecentSummaries: async () => null,
    readChat: async () => savedChat,
    messageFields: storyTranscriptMessageFields
  })
  const loaded = await reader('sess-ui-1')
  assert.ok(loaded?.storyTranscript)
  assert.equal(loaded.storyTranscript.messages[2].message.narrativeDamper[0].rulingTier, 'strip_delusion')
  assert.equal(loaded.storyTranscript.messages[6].message.damperState[0].intimacy_trust, 25)

  // Mount actual React UI in JSDOM
  const [visSource, damperUiSource, refreshSource, dataSource, listSource, varReceiptSource] = await Promise.all([
    readFile(new URL('../tavern-plugin/lib/domain/mvu-visibility.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/src/client/features/narrative-damper-status.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/src/client/modules/session-refresh-controller.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/src/client/features/story-transcript-data.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/src/client/features/story-transcript-list.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/src/client/variable-receipt.js', import.meta.url), 'utf8')
  ])

  const dom = new JSDOM('<main></main><div id="receipt-root"></div>', { pretendToBeVisual: true })
  const prevGlobals = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const roots = []
  t.after(async () => {
    for (const r of roots) await act(async () => r.unmount())
    Object.assign(globalThis, { window: prevGlobals.window, document: prevGlobals.document, IS_REACT_ACT_ENVIRONMENT: prevGlobals.act })
    dom.window.close()
  })

  const icon = name => () => React.createElement('svg', { 'data-icon': name })
  const mvuReceiptTurn3 = savedChat.messages[4].mvu.receipt
  const context = vm.createContext({
    React,
    AbortController,
    console,
    window: dom.window,
    document: dom.window.document,
    CustomEvent: dom.window.CustomEvent,
    DshUi: {
      MarkdownText: props => React.createElement('span', null, props.text),
      Tooltip: props => props.children,
      IconEditOutlineRegular: icon('edit'),
      IconBranchOutlineRegular: icon('branch'),
      IconCopyOutlineRegular: icon('copy'),
      IconCheckOutlineRegular: icon('check'),
      writeClipboard: async () => true
    },
    useLiveTavernView: () => ({
      view: {
        mode: 'story',
        mvuVisibility: { '/stat_data/白石凛/秘密动摇': 'masked' },
        mvuReceipts: { '3': mvuReceiptTurn3 }
      }
    }),
    tavernMvuReceiptForTurn: (view, turn) => view?.mvuReceipts?.[String(turn)] || null,
    tavernProjectionForTurn: () => null,
    tavernLatestProjectionTurn: () => 0
  })

  vm.runInContext(visSource.replace(/\r?\nexport \{[\s\S]*\}\r?\n?$/, '\n'), context)
  vm.runInContext(damperUiSource, context)
  vm.runInContext(refreshSource, context)
  vm.runInContext(dataSource, context)
  vm.runInContext(listSource, context)
  vm.runInContext(varReceiptSource, context)

  const feature = context.createTavernStoryTranscriptFeature({ rpc: async () => ({}) })
  const transcript = projectStoryTranscript({
    chat: { messages: savedChat.messages },
    from: 0,
    to: savedChat.messages.length - 1,
    messageCount: savedChat.messages.length,
    revision: 9
  })

  const mainRoot = createRoot(dom.window.document.querySelector('main'))
  roots.push(mainRoot)
  await act(async () => {
    mainRoot.render(React.createElement(feature.StoryTranscriptList, {
      sessionId: 'sess-ui-1',
      transcript,
      showDamperStatus: true,
      view: { mode: 'story', mvuVisibility: { '/stat_data/白石凛/秘密动摇': 'masked' } }
    }))
  })

  const pills = [...dom.window.document.querySelectorAll('.dsh-tavern-damper-pill')]
  // Floor 1 greeting has no pill; Floors 2, 3, 4, 5 each have one pill!
  assert.equal(pills.length, 4)
  assert.match(pills[0].textContent, /阻尼 · 越权剥离/)
  assert.match(pills[1].textContent, /阻尼 · 防线受阻 0\.6 · 钳制 2 项/)
  assert.match(pills[2].textContent, /阻尼 · 半步拉扯 1\.9/)
  assert.match(pills[3].textContent, /阻尼 · 未配密钥/)

  // Click Floor 3 pill (MVU clamped) + Floor 4 pill (plain 4D state) + Floor 5 pill (bypassed)
  await act(async () => {
    pills[1].click()
    pills[2].click()
    pills[3].click()
  })
  const panels = [...dom.window.document.querySelectorAll('.dsh-tavern-damper-panel')]
  assert.equal(panels.length, 3)
  // Floor 3 panel shows visible clamped stat numbers and masks hidden stat numbers!
  assert.match(panels[0].textContent, /配额：防线冻结（±1）/)
  assert.match(panels[0].textContent, /15 → 16/)
  assert.match(panels[0].textContent, /数值隐藏/)
  assert.equal(panels[0].textContent.includes('50'), false)
  // Floor 4 panel shows 4D plain inertia evolution
  assert.match(panels[1].textContent, /通用四维惯性状态演进/)
  assert.match(panels[1].textContent, /20 → 25/)
  assert.match(panels[1].textContent, /\+5/)
  // Floor 5 panel shows clear missing API Key guidance
  assert.match(panels[2].textContent, /尚未配置 API Key/)

  // Turning showDamperStatus off hides all pills and panels
  await act(async () => {
    mainRoot.render(React.createElement(feature.StoryTranscriptList, {
      sessionId: 'sess-ui-1',
      transcript,
      showDamperStatus: false,
      view: { mode: 'story' }
    }))
  })
  assert.equal(dom.window.document.querySelectorAll('.dsh-tavern-damper-pill').length, 0)

  // VariableReceipt dialog also renders DamperReceiptSummary with hidden masking
  const receiptRoot = createRoot(dom.window.document.querySelector('#receipt-root'))
  roots.push(receiptRoot)
  await act(async () => {
    receiptRoot.render(React.createElement(context.VariableReceipt, {
      receipt: mvuReceiptTurn3,
      visibility: { '/stat_data/白石凛/秘密动摇': 'masked' },
      sessionId: 'sess-ui-1',
      turn: 3
    }))
  })
  const varDamper = dom.window.document.querySelector('.fork-var-damper')
  assert.ok(varDamper)
  assert.match(varDamper.textContent, /叙事阻尼配额 · 防线冻结（±1）/)
  assert.match(varDamper.textContent, /已钳制 2 项跳变/)
  assert.equal(varDamper.textContent.includes('50'), false)
})


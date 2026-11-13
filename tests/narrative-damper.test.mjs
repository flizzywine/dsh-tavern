import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DAMPER_KEY_REFS,
  clampMvuSubmissionOperations,
  createNarrativeDamper,
  defaultNarrativeDamperConfig,
  desensitizeForDecisionJudge,
  nextPlainDamperState,
  readDamperStateSnapshot,
  settlementBudgetRuleText
} from '../tavern-plugin/lib/domain/narrative-damper.js'
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

test('前端构建产物：设置面板独立注册「叙事阻尼器」section，不依赖舞台模块', async () => {
  const mainSource = await readFile(new URL('../tavern-plugin/src/client/main.js', import.meta.url), 'utf8')
  const builtClient = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  assert.match(mainSource, /id:\s*"dsh-tavern-narrative-damper"/)
  assert.match(builtClient, /dsh-tavern-narrative-damper/)
  assert.match(builtClient, /getNarrativeDamperSettings/)
  assert.match(builtClient, /testNarrativeDamperConnection/)
  assert.equal(desensitizeForDecisionJudge('普通日常对话'), '普通日常对话')
})

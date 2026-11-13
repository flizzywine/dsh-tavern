import { createHash } from 'node:crypto'
import { currentVariableSnapshot } from './read-variables.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

const error = (code, message = code) => Object.assign(new Error(message), { code })

export const DAMPER_PROVIDERS = Object.freeze({
  gemini: Object.freeze({ model: 'gemini-decision-1', keyName: 'GEMINI_API_KEY', protocol: 'gemini' }),
  'gemini-compatible': Object.freeze({ model: 'gemini-decision-1', keyName: 'GEMINI_API_KEY', protocol: 'gemini' }),
  jev: Object.freeze({ model: 'jev-1.13.0', keyName: 'TYPESAFE_API_KEY', protocol: 'jev' }),
  openai: Object.freeze({ model: 'gpt-6-luna', keyName: 'OPENAI_API_KEY', protocol: 'openai' }),
  'openai-compatible': Object.freeze({ model: 'gpt-6-luna', keyName: 'OPENAI_API_KEY', protocol: 'openai' })
})

// Stored in the host credential store under dedicated damper keys; never written to settings.json or returned to clients.
export const DAMPER_KEY_REFS = Object.freeze({
  gemini: 'DSH_TAVERN_DAMPER_GEMINI_KEY',
  'gemini-compatible': 'DSH_TAVERN_DAMPER_GEMINI_COMPAT_KEY',
  jev: 'DSH_TAVERN_DAMPER_JEV_KEY',
  openai: 'DSH_TAVERN_DAMPER_OPENAI_KEY',
  'openai-compatible': 'DSH_TAVERN_DAMPER_COMPATIBLE_KEY'
})

export const DAMPER_KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const DAMPER_MODES = Object.freeze(['balanced', 'strict'])
// 判定模式：roleplay 承认「受控角色」边界（越权代笔/天眼即违规）；author 为写作模式，
// 作者拥有全知视角与任意角色落笔权，只有「与既有正史矛盾的吃书」才构成不可追认的冲突。
export const DAMPER_JUDGE_MODES = Object.freeze(['roleplay', 'author'])

export const DEFAULT_PLAIN_DAMPER_STATE = Object.freeze({
  intimacy_trust: 20,
  psychological_guard: 70,
  arousal_or_tension: 10,
  leverage_depth: 0
})

export function defaultNarrativeDamperConfig() {
  return {
    enabled: false,
    showTurnStatus: true,
    mode: 'balanced',
    judgeMode: 'roleplay',
    provider: 'gemini',
    model: 'gemini-decision-1',
    baseUrl: '',
    keyName: 'GEMINI_API_KEY',
    godmodeThreshold: 0.72,
    desensitizeR18: true,
    clampMvuDelta: true,
    fallbackStateForPlainCards: true,
    timeoutMs: 2500,
    preamble: ''
  }
}

function validCustomBaseUrl(rawUrl) {
  let url
  try { url = new URL(str(rawUrl)) } catch { return false }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname)
  return (url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
    && !url.username && !url.password && !url.search && !url.hash
}

export function normalizeNarrativeDamperConfig(value) {
  const defaults = defaultNarrativeDamperConfig()
  const raw = object(value)
  const provider = Object.hasOwn(DAMPER_PROVIDERS, raw.provider) ? raw.provider : defaults.provider
  const providerDefaults = DAMPER_PROVIDERS[provider]
  const customEndpoint = provider === 'gemini-compatible' || provider === 'openai-compatible'
  const threshold = Number(raw.godmodeThreshold)
  const timeoutMs = Number(raw.timeoutMs)
  const keyName = typeof raw.keyName === 'string' && DAMPER_KEY_NAME.test(raw.keyName.trim())
    ? raw.keyName.trim()
    : providerDefaults.keyName
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim().slice(0, 160)
    : providerDefaults.model
  const baseUrl = customEndpoint && typeof raw.baseUrl === 'string' && validCustomBaseUrl(raw.baseUrl.trim())
    ? raw.baseUrl.trim()
    : ''
  return {
    enabled: raw.enabled === true,
    showTurnStatus: raw.showTurnStatus !== false,
    mode: DAMPER_MODES.includes(raw.mode) ? raw.mode : defaults.mode,
    judgeMode: DAMPER_JUDGE_MODES.includes(raw.judgeMode) ? raw.judgeMode : defaults.judgeMode,
    provider,
    model,
    baseUrl,
    keyName,
    godmodeThreshold: Number.isFinite(threshold) ? Math.min(0.95, Math.max(0.5, Math.round(threshold * 100) / 100)) : defaults.godmodeThreshold,
    desensitizeR18: raw.desensitizeR18 !== false,
    clampMvuDelta: raw.clampMvuDelta !== false,
    fallbackStateForPlainCards: raw.fallbackStateForPlainCards !== false,
    timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 300 && timeoutMs <= 30000 ? timeoutMs : defaults.timeoutMs,
    preamble: typeof raw.preamble === 'string' ? raw.preamble.slice(0, 2000) : ''
  }
}

export function validateNarrativeDamperConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('DAMPER_INVALID_CONFIG', '叙事阻尼器设置格式无效')
  const raw = object(value)
  if (Object.hasOwn(raw, 'enabled') && typeof raw.enabled !== 'boolean') throw error('DAMPER_INVALID_CONFIG', '启用开关须为布尔值')
  if (Object.hasOwn(raw, 'mode') && !DAMPER_MODES.includes(raw.mode)) throw error('DAMPER_INVALID_CONFIG', '阻尼模式无效')
  if (Object.hasOwn(raw, 'judgeMode') && !DAMPER_JUDGE_MODES.includes(raw.judgeMode)) throw error('DAMPER_INVALID_CONFIG', '判定模式无效')
  if (Object.hasOwn(raw, 'provider') && !Object.hasOwn(DAMPER_PROVIDERS, raw.provider)) throw error('DAMPER_INVALID_CONFIG', '决策模型提供方无效')
  const provider = Object.hasOwn(DAMPER_PROVIDERS, raw.provider) ? raw.provider : 'gemini'
  const customEndpoint = provider === 'gemini-compatible' || provider === 'openai-compatible'
  if (Object.hasOwn(raw, 'model') && (typeof raw.model !== 'string' || !raw.model.trim() || raw.model.trim().length > 160)) {
    throw error('DAMPER_INVALID_CONFIG', '决策模型名称不能为空')
  }
  if (Object.hasOwn(raw, 'keyName') && raw.keyName !== '' && (typeof raw.keyName !== 'string' || !DAMPER_KEY_NAME.test(raw.keyName))) {
    throw error('DAMPER_INVALID_CONFIG', '环境变量名称格式无效')
  }
  if (customEndpoint) {
    if (raw.enabled === true && !validCustomBaseUrl(raw.baseUrl)) {
      throw error('DAMPER_INVALID_CONFIG', '自定义接口地址须为有效的 HTTPS 地址或本地回环 HTTP 地址')
    }
    if (Object.hasOwn(raw, 'baseUrl') && raw.baseUrl !== '' && !validCustomBaseUrl(raw.baseUrl)) {
      throw error('DAMPER_INVALID_CONFIG', '自定义接口地址须为有效的 HTTPS 地址或本地回环 HTTP 地址')
    }
  } else if (Object.hasOwn(raw, 'baseUrl') && raw.baseUrl !== '') {
    throw error('DAMPER_INVALID_CONFIG', '官方固定端点无需填写自定义接口地址')
  }
  if (Object.hasOwn(raw, 'godmodeThreshold')) {
    const t = Number(raw.godmodeThreshold)
    if (!Number.isFinite(t) || t < 0.5 || t > 0.95) throw error('DAMPER_INVALID_CONFIG', '越权判定阈值须在 0.50 至 0.95 之间')
  }
  if (Object.hasOwn(raw, 'timeoutMs')) {
    const ms = Number(raw.timeoutMs)
    if (!Number.isSafeInteger(ms) || ms < 300 || ms > 30000) throw error('DAMPER_INVALID_CONFIG', '超时时间须为 300–30000 毫秒的整数')
  }
  for (const flag of ['desensitizeR18', 'clampMvuDelta', 'fallbackStateForPlainCards', 'showTurnStatus']) {
    if (Object.hasOwn(raw, flag) && typeof raw[flag] !== 'boolean') throw error('DAMPER_INVALID_CONFIG', '布尔开关参数无效')
  }
  if (Object.hasOwn(raw, 'preamble') && (typeof raw.preamble !== 'string' || raw.preamble.length > 2000)) {
    throw error('DAMPER_INVALID_CONFIG', '附加说明最多 2000 字')
  }
  return normalizeNarrativeDamperConfig(raw)
}

function fixedDamperUrl(provider) {
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/decisions'
  if (provider === 'jev') return 'https://api.typesafe.ai/v1/systemone'
  if (provider === 'openai') return 'https://api.openai.com/v1/decisions'
  return ''
}

export function damperEndpointUrl(config) {
  if (config.provider === 'gemini-compatible') {
    if (!validCustomBaseUrl(config.baseUrl)) return ''
    const base = config.baseUrl.replace(/\/+$/, '').replace(/\/v1beta(?:\/decisions)?$/, '')
    return new URL(base + '/v1beta/decisions').href
  }
  if (config.provider === 'openai-compatible') {
    if (!validCustomBaseUrl(config.baseUrl)) return ''
    const base = config.baseUrl.replace(/\/+$/, '').replace(/\/v1(?:\/decisions)?$/, '')
    return new URL(base + '/v1/decisions').href
  }
  return fixedDamperUrl(config.provider)
}

// Transient semantic scale projection applied ONLY to the decision model's input copy.
// The foreground story LLM still receives 100% of the player's original uncensored prose.
const R18_SCALE_PROJECTIONS = Object.freeze([
  [/肉便器|母狗|性奴|RBQ|专属玩物|精盆|泄欲工具/gi, '[Lv4极端人格依附身份]'],
  [/轮奸|强奸|迷奸|奸污|凌辱|调教|恶堕|淫堕|催眠洗脑/gi, '[Lv4高压越界控制行为]'],
  [/内射|中出|颜射|口爆|深喉|口交|乳交|足交|肛交|插入|抽插|挺入|贯穿|吞吐|含住|舔舐|骑乘|后入|交合|做爱|性交|操弄|肏/gi, '[Lv3重度亲密接触动作]'],
  [/勃起|肉棒|阴茎|巨根|龟头|睾丸|阴蒂|蜜穴|小穴|花穴|嫩穴|阴道|子宫|菊穴|肛门|精液|浓精|淫水|爱液|蜜汁|潮吹/gi, '[Lv3核心私密部位]'],
  [/高潮|绝顶|痉挛|失神|淫荡|发情|春药|媚药|催情|呻吟|娇喘|浪叫|求饶/gi, '[Lv3情绪与生理峰值状态]'],
  [/裸体|全裸|脱光|内裤|底裤|胖次|胸罩|文胸|内衣|黑丝|丝袜|乳头|乳晕|乳房|酥胸|巨乳|臀部|大腿内侧/gi, '[Lv2贴身敏感部位]'],
  [/把柄|威胁|胁迫|要挟|勒索|裸照|视频威胁/gi, '[外部筹码牵制]'],
  [/出轨|偷情|戴绿帽|绿帽|背叛丈夫|背叛男友|寝取/gi, '[伴侣关系背离]']
])

export function desensitizeForDecisionJudge(text) {
  let output = str(text)
  for (const [pattern, replacement] of R18_SCALE_PROJECTIONS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

// Second-chance structural abstraction if the provider's input safety filter still rejects the text.
export function skeletonizeForSafetyFallback({ stateSnapshot, posture, userText }) {
  const safeState = desensitizeForDecisionJudge(JSON.stringify(stateSnapshot || {})).slice(0, 1600)
  const safePosture = desensitizeForDecisionJudge(str(posture)).slice(0, 240)
  const projectedInput = desensitizeForDecisionJudge(str(userText))
    // Mask remaining concrete nouns between verbs/pronouns only when needed, keeping modal/outcome markers intact.
    .replace(/[\u4e00-\u9fa5A-Za-z]{0,2}(?:逼迫|强行|按住|锁门|撕开|解开|跪下)[\u4e00-\u9fa5A-Za-z]{0,2}/g, '[强势肢体越界尝试]')
  return [
    '【当前状态快照】' + safeState,
    safePosture ? '【现场位置状态】' + safePosture : '',
    '【本轮受控角色输入企图（已做尺度标签化）】' + projectedInput.slice(0, 1200)
  ].filter(Boolean).join('\n')
}

export function isExplicitSceneShiftInput(userText) {
  return /^\s*(?:「场景变化」|【场景变化】|\[场景变化\]|\(场景变化\)|（场景变化）)/u.test(str(userText))
}

export function readDamperStateSnapshot(chat, { excludeAssistantIndex = -1, fallbackForPlain = true } = {}) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (let index = messages.length - 1; index >= 0; index--) {
    if (index === excludeAssistantIndex) continue
    const message = messages[index]
    if (!message || message.role === 'tavern-helper') continue
    const swipeId = Math.max(0, Number(message.swipeId) || 0)
    const stat = message.variables?.[swipeId]?.stat_data
    if (stat && typeof stat === 'object' && !Array.isArray(stat) && Object.keys(stat).length > 0) {
      return { kind: 'mvu', data: stat }
    }
  }
  const chatLevelMvu = currentVariableSnapshot({ ...(chat || {}), messages: [] })?.snapshot
  if (chatLevelMvu && typeof chatLevelMvu === 'object' && !Array.isArray(chatLevelMvu) && Object.keys(chatLevelMvu).length > 0) {
    return { kind: 'mvu', data: chatLevelMvu }
  }
  if (!fallbackForPlain) return { kind: 'none', data: null }
  for (let index = messages.length - 1; index >= 0; index--) {
    if (index === excludeAssistantIndex) continue
    const message = messages[index]
    if (!message || message.role !== 'assistant') continue
    const swipeId = Math.max(0, Number(message.swipeId) || 0)
    const entry = Array.isArray(message.damperState) ? message.damperState[swipeId] ?? message.damperState[0] : message.damperState
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return {
        kind: 'plain-fallback',
        data: {
          intimacy_trust: clampRange(Number(entry.intimacy_trust ?? DEFAULT_PLAIN_DAMPER_STATE.intimacy_trust), 0, 100),
          psychological_guard: clampRange(Number(entry.psychological_guard ?? DEFAULT_PLAIN_DAMPER_STATE.psychological_guard), 0, 100),
          arousal_or_tension: clampRange(Number(entry.arousal_or_tension ?? DEFAULT_PLAIN_DAMPER_STATE.arousal_or_tension), 0, 100),
          leverage_depth: clampRange(Number(entry.leverage_depth ?? DEFAULT_PLAIN_DAMPER_STATE.leverage_depth), 0, 100)
        }
      }
    }
  }
  return { kind: 'plain-fallback', data: { ...DEFAULT_PLAIN_DAMPER_STATE } }
}

function clampRange(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function nextPlainDamperState(previous, ruling) {
  const base = { ...DEFAULT_PLAIN_DAMPER_STATE, ...object(previous) }
  if (!ruling || typeof ruling !== 'object') return base
  const strict = ruling.mode === 'strict'
  const author = ruling.judgeMode === 'author'
  const budget = str(ruling.deltaBudget)
  const tier = str(ruling.rulingTier)
  let trustDelta = 0
  let guardDelta = 0
  let tensionDelta = 0
  let leverageDelta = 0
  if (budget === 'backfire' || tier === 'strip_delusion' || tier === 'resist_pushback') {
    if (author && budget !== 'backfire') {
      // 写作模式下不存在「被冒犯的受控角色」，设定冲突只冻结惯性，不追加防备惩罚。
      trustDelta = 0
      guardDelta = 0
      tensionDelta = 0
    } else {
      trustDelta = budget === 'backfire' ? -4 : 0
      guardDelta = budget === 'backfire' ? 6 : 3
      tensionDelta = -3
    }
  } else if (budget === 'frozen') {
    trustDelta = 0
    guardDelta = 1
    tensionDelta = 0
  } else if (budget === 'breakthrough') {
    const step = strict ? 7 : 11
    trustDelta = tier === 'conflicted_half_step' ? Math.round(step * 0.6) : step
    guardDelta = -(strict ? 6 : 10)
    tensionDelta = strict ? 6 : 10
    leverageDelta = 8
  } else {
    // micro_step / default
    const step = strict ? 3 : 5
    trustDelta = tier === 'costly_advance' ? 2 : step
    guardDelta = -(strict ? 2 : 4)
    tensionDelta = strict ? 3 : 5
    leverageDelta = Number(ruling.leverageScore) >= 1.8 ? 4 : 1
  }
  return {
    intimacy_trust: clampRange(base.intimacy_trust + trustDelta, 0, 100),
    psychological_guard: clampRange(base.psychological_guard + guardDelta, 0, 100),
    arousal_or_tension: clampRange(base.arousal_or_tension + tensionDelta, 0, 100),
    leverage_depth: clampRange(base.leverage_depth + leverageDelta, 0, 100)
  }
}

const GEMINI_DAMPER_QUESTIONS = Object.freeze({
  godmode_outcome: {
    type: 'noul',
    instructions: '玩家输入是否越权替其他角色（NPC）直接指定了心理活动、感情归属、服从妥协或生理峰值反应，而非仅描述受控角色自身的言行尝试？'
  },
  unfounded_retcon: {
    type: 'noul',
    instructions: '玩家输入是否凭空捏造了当前状态与前文均无依据的过往设定、隐藏药物/特殊能力或凭空持有的物品把柄？'
  },
  epistemic_violation: {
    type: 'noul',
    instructions: '受控角色是否直接使用了其当前不在场或按既有状态根本无从知晓的场外天眼信息？'
  },
  leverage_score: {
    type: 'score',
    instructions: '结合当前状态指标、角色软肋与前文现场气氛，评估玩家本轮行动提供的有效铺垫或筹码（情感共鸣、伏笔细节、氛围递进、真实把柄拿捏）有多充分？',
    criteria: [
      '0: 毫无铺垫的突兀越界或纯口胡直接索取结果',
      '1: 常规日常言行互动，无特殊破局筹码',
      '2: 顺应当前暧昧/紧张情境自然递进，或利用了表面处境优势',
      '3: 精准兑现前文伏笔、核心筹码软肋或极具说服力的渐进心理诱导'
    ]
  },
  ruling_tier: {
    type: 'choice',
    instructions: '对照当前各项状态数值与角色心理防线，裁定本轮剧情最合理的响应档位：',
    criteria: {
      full_accept: '动作尺度与当前关系/亲密/唤起状态完全匹配，顺畅达成预期互动。',
      conflicted_half_step: '具备有效筹码或暧昧基础，允许实质推进半步，但受防线/羞耻/伴侣忠诚约束，NPC须保留嘴硬、羞愤、找借口自欺或身心错位拉扯。',
      costly_advance: '冒险试探勉强奏效，但伴随代价（引发警惕怀疑、消耗筹码或留下事后疏离隐患）。',
      resist_pushback: '动作尺度明显超越当前状态阈值且筹码不足，NPC依人设表现错愕、回绝、推开或防备收紧。',
      strip_delusion: '存在越权控心、捏造设定或天眼作弊，剥离玩家自封结果，仅将受控角色言行作为单方面口嗨/试探/妄想演出并予以客观反制。'
    }
  },
  mvu_delta_budget: {
    type: 'choice',
    instructions: '裁定本轮结束后，核心好感/亲密/沦陷/心理防线类状态数值允许的变动幅度配额：',
    criteria: {
      backfire: '因鲁莽跳阶段越界引发反感、惊惧或防线反弹收紧',
      frozen: '口胡无效或试探未达门槛，核心关系与防线数值锁死（变动上限 ±1）',
      micro_step: '常规良性互动升温或轻微心理动摇（小幅渐进）',
      breakthrough: '高分筹码或关键伏笔成功兑现，产生阶段性松动突破（仍受单轮上限约束）'
    }
  }
})

const BINARY_FALLBACK_QUESTIONS = Object.freeze([
  { id: 'godmode_outcome', text: GEMINI_DAMPER_QUESTIONS.godmode_outcome.instructions },
  { id: 'unfounded_retcon', text: GEMINI_DAMPER_QUESTIONS.unfounded_retcon.instructions },
  { id: 'epistemic_violation', text: GEMINI_DAMPER_QUESTIONS.epistemic_violation.instructions },
  { id: 'strong_leverage', text: '结合当前状态与前文情境，玩家本轮行动是否精准利用了前文伏笔、角色软肋、有效把柄或恰当的渐进氛围铺垫？' },
  { id: 'overreaches_state', text: '玩家本轮企图达到的亲密、服从或剧情跨越程度是否明显超出了当前状态指标与角色心理防线所能接受的范围？' },
  { id: 'triggers_backfire', text: '玩家本轮举动是否过于粗暴突兀，足以引发角色的反感、惊惧或心理防线反弹收紧？' }
])

// 写作模式（作者=全知）判定集：不存在「受控角色」，因此不判越权代笔与天眼作弊。
// 三个通道复用同一解析槽位，语义改为：角色失真 / 设定吃书 / 信息边界穿帮。
const AUTHOR_DAMPER_QUESTIONS = Object.freeze({
  godmode_outcome: {
    type: 'noul',
    instructions: '本轮续写是否让既有角色说出或做出与其性格底色、既定关系、当前处境明显相悖的行为，且正文没有给出任何动机过渡或心理铺垫（角色失真，而非有意图的转变）？'
  },
  unfounded_retcon: {
    type: 'noul',
    instructions: '本轮续写是否凭空引入与当前状态锚点、前文已发生事件、角色既有设定或世界规则直接矛盾的新事实（吃书：身份、关系、能力、年代、规则被无声改写）？'
  },
  epistemic_violation: {
    type: 'noul',
    instructions: '本轮续写是否把某角色根本无从得知、或尚未在场获得的情报当作业已成立的事实来使用，造成视角穿帮？'
  },
  leverage_score: {
    type: 'score',
    instructions: '评估本轮续写为剧情推进提供的铺垫密度：伏笔回收、情绪递进、冲突蓄力、视角与节奏安排是否到位？',
    criteria: [
      '0: 无任何过渡的突兀跳阶，直接空投结论或结果',
      '1: 常规叙事过渡，按既有节奏平推',
      '2: 承接前文张力自然递进，或新设定有明确落点',
      '3: 精准回收既有伏笔、兑现既定冲突，或完成极具说服力的结构转折'
    ]
  },
  ruling_tier: {
    type: 'choice',
    instructions: '对照既有正史与当前状态，裁定本轮续写的处理档位：',
    criteria: {
      full_accept: '内容与既有设定、当前状态自洽，顺畅成立为正史。',
      conflicted_half_step: '方向成立但铺垫偏薄，允许推进，同时补足动机、过渡或视角交代。',
      costly_advance: '推进跨越较大，需在正文中落下合理代价或后效（时间流逝、关系裂痕、暴露风险、债务）。',
      resist_pushback: '节奏明显超出情境承载，需放缓并补写承接过程，而非直接跳到结果。',
      strip_delusion: '新增内容与既有正史直接矛盾（吃书），不予追认为正史，须按既有设定校正或改写为伏笔/误记/传闻。'
    }
  },
  mvu_delta_budget: {
    type: 'choice',
    instructions: '裁定本轮结束后，核心好感/亲密/沦陷/心理防线类状态数值允许的变动幅度配额：',
    criteria: {
      backfire: '情绪或冲突急转，指标反向回调（如关系破裂、信任崩解）',
      frozen: '本轮主要交代设定与过渡，核心关系指标基本不动（变动上限 ±1）',
      micro_step: '常规叙事推进带来的自然小幅变化',
      breakthrough: '关键转折或伏笔兑现，阶段性格局松动（仍受单轮上限约束）'
    }
  }
})

const AUTHOR_BINARY_FALLBACK_QUESTIONS = Object.freeze([
  { id: 'godmode_outcome', text: AUTHOR_DAMPER_QUESTIONS.godmode_outcome.instructions },
  { id: 'unfounded_retcon', text: AUTHOR_DAMPER_QUESTIONS.unfounded_retcon.instructions },
  { id: 'epistemic_violation', text: AUTHOR_DAMPER_QUESTIONS.epistemic_violation.instructions },
  { id: 'strong_leverage', text: '本轮续写是否回收了前文伏笔、利用了既有冲突张力，或安排了恰当的视角与节奏铺垫？' },
  { id: 'overreaches_state', text: '本轮续写推进的剧情跨度是否明显超出当前情境与既有节奏所能承载的范围？' },
  { id: 'triggers_backfire', text: '本轮续写是否让角色产生与既有设定断裂且缺少动机铺垫的剧烈转向？' }
])

function damperQuestionSet(config) {
  return config?.judgeMode === 'author' ? AUTHOR_DAMPER_QUESTIONS : GEMINI_DAMPER_QUESTIONS
}

function damperBinaryQuestionSet(config) {
  return config?.judgeMode === 'author' ? AUTHOR_BINARY_FALLBACK_QUESTIONS : BINARY_FALLBACK_QUESTIONS
}


function compactStateSummary(stateSnapshot) {
  if (!stateSnapshot || !stateSnapshot.data) return '（无显式数值状态）'
  try {
    const raw = JSON.stringify(stateSnapshot.data)
    return raw.length <= 600 ? raw : raw.slice(0, 597) + '...'
  } catch {
    return '（状态序列化略）'
  }
}

export function normalizeDecisionRuling(rawDecision, config) {
  const strict = config.mode === 'strict'
  const author = config.judgeMode === 'author'
  const threshold = strict ? Math.max(0.5, config.godmodeThreshold - 0.08) : config.godmodeThreshold
  const godmode = Number(rawDecision.godmode) || 0
  const retcon = Number(rawDecision.retcon) || 0
  const epistemic = Number(rawDecision.epistemic) || 0
  const leverageScore = Number.isFinite(rawDecision.leverageScore) ? rawDecision.leverageScore : 1
  let rulingTier = str(rawDecision.rulingTier) || 'full_accept'
  let deltaBudget = str(rawDecision.deltaBudget) || 'micro_step'

  // 角色扮演模式：替他人代笔心智/生理结果、调用场外情报都构成越权。
  // 写作模式：作者本就全知且可替任意角色落笔，只有「与既有正史矛盾」不可被追认，
  // 角色失真与视角穿帮仅作正文层面的软提示，不降档为剥离。
  const violated = author
    ? retcon >= threshold
    : (godmode >= threshold || retcon >= threshold || epistemic >= threshold)
  if (violated && (author || leverageScore < (strict ? 2.4 : 2.1))) {
    rulingTier = 'strip_delusion'
    if (author) {
      // 无受控角色可供「反制」，写作模式下的冲突只冻结指标等待校正，不产生反弹惩罚。
      deltaBudget = 'frozen'
    } else if (deltaBudget === 'breakthrough' || deltaBudget === 'micro_step') {
      deltaBudget = godmode >= 0.88 && leverageScore < 0.8 ? 'backfire' : 'frozen'
    }
  } else if (author && rulingTier === 'strip_delusion') {
    // 模型误判为剥离但「吃书」未过阈值：降为常规推进，保留节奏提示。
    rulingTier = leverageScore >= 2 ? 'conflicted_half_step' : 'full_accept'
  } else if (strict) {
    if (rulingTier === 'full_accept' && leverageScore < 2.2 && (godmode >= 0.45 || rawDecision.overreachProb >= 0.35)) {
      rulingTier = 'conflicted_half_step'
    }
    if (deltaBudget === 'breakthrough' && leverageScore < 2.3) {
      deltaBudget = 'micro_step'
    }
  }
  if (rulingTier === 'resist_pushback' && (deltaBudget === 'breakthrough' || deltaBudget === 'micro_step')) {
    deltaBudget = 'frozen'
  }
  return {
    mode: config.mode,
    judgeMode: author ? 'author' : 'roleplay',
    godmode: Math.round(godmode * 1000) / 1000,
    retcon: Math.round(retcon * 1000) / 1000,
    epistemic: Math.round(epistemic * 1000) / 1000,
    leverageScore: Math.round(leverageScore * 100) / 100,
    rulingTier,
    deltaBudget,
    clampMvuDelta: config.clampMvuDelta !== false,
    fallbackStateForPlainCards: config.fallbackStateForPlainCards !== false
  }
}

function compileAuthorTurnRuling(ruling, { stateLine, postureLine }) {
  const tier = str(ruling && ruling.rulingTier)
  const score = Number(ruling?.leverageScore || 1).toFixed(2)
  const perspective = '写作模式：你拥有全知视角，可自由为任意角色落笔、编排群体行动、切换镜头与切分场景，不受「受控角色」边界限制；唯一硬约束是既有设定与已发生事件的连续性。'
  if (tier === 'strip_delusion') {
    const reasons = []
    if (ruling.retcon >= 0.6) reasons.push(`与既有正史冲突 P=${ruling.retcon.toFixed(2)}`)
    if (ruling.epistemic >= 0.6) reasons.push(`视角穿帮 P=${ruling.epistemic.toFixed(2)}`)
    if (ruling.godmode >= 0.6) reasons.push(`角色失真 P=${ruling.godmode.toFixed(2)}`)
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：设定冲突（${reasons.join('，') || '与既有设定不自洽'}）】`,
      perspective,
      `1. 正史优先：与当前状态锚点 ${stateLine}${postureLine}、前文已发生事件或角色既有设定直接矛盾的新增内容，暂不追认为既成事实。`,
      '2. 冲突处理任选其一：改写为伏笔、传闻、误记、角色主观臆测；或按新设定显式改写相关既有段落并交代改动，保持自洽。',
      '3. 其余内容照常演出：镜头调度、多角色落笔与心理刻画不受影响。',
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'resist_pushback') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：节奏失配（铺垫得分 ${score}/3.00）】`,
      perspective,
      `1. 本轮推进跨度明显超出当前情境 ${stateLine}${postureLine} 可承载的节奏。`,
      '2. 补写承接：把跳过的过程展开为可见的过渡、动机或环境变化，再落到结果；剧情走向本身不必否定。',
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'costly_advance') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：带代价推进（铺垫得分 ${score}/3.00）】`,
      perspective,
      `1. 本轮推进可以成立，但需在当前状态 ${stateLine}${postureLine} 上落下合理后效。`,
      '2. 后效任选其一：时间或资源消耗、关系裂痕、暴露风险、欠下的承诺，让转折有重力。',
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'conflicted_half_step') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：铺垫成立·有效推进（铺垫得分 ${score}/3.00）】`,
      perspective,
      `1. 本轮铺垫有效，允许实质推进；受当前状态 ${stateLine}${postureLine} 牵制，转折须有可追溯的动机与过程。`,
      '2. 避免无过渡的剧烈转向：保留角色的犹疑、自欺或身心错位，让变化可被读者追溯。',
      '</turn_ruling>'
    ].join('\n')
  }
  return [
    '<turn_ruling>',
    `【本轮叙事阻尼裁定：顺势成立（铺垫得分 ${score}/3.00）】`,
    perspective,
    `- 本轮续写与当前状态 ${stateLine}${postureLine} 自洽，按既有节奏自然延展。`,
    '</turn_ruling>'
  ].join('\n')
}

export function compileTurnRuling(ruling, { stateSnapshot, posture, explicitSceneShift = false } = {}) {
  const stateLine = compactStateSummary(stateSnapshot)
  const postureLine = str(posture).trim() ? `；现场姿势锚点：${str(posture).trim().slice(0, 140)}` : ''
  if (explicitSceneShift) {
    return [
      '<turn_ruling>',
      '【本轮叙事阻尼裁定：显式场景转换放行】',
      '- 玩家使用了场景转换标记，允许按指引切换时空、镜头视角或引入客观环境事件。',
      `- 连续性硬约束：场内角色的性格底色、已知情报边界与当前状态锚点（${stateLine}）保持连续惯性，严禁因镜头切换发生无铺垫的人设突变。`,
      ruling && ruling.judgeMode === 'author' ? '- 写作模式：全知视角与任意角色落笔均为合法权限，只需与既有设定自洽。' : '',
      '</turn_ruling>'
    ].filter(Boolean).join('\n')
  }
  if (ruling && ruling.judgeMode === 'author') {
    return compileAuthorTurnRuling(ruling, { stateLine, postureLine })
  }
  const tier = str(ruling && ruling.rulingTier)
  if (tier === 'strip_delusion') {
    const reasons = []
    if (ruling.godmode >= 0.6) reasons.push(`越权代笔他者心智/生理结果 P=${ruling.godmode.toFixed(2)}`)
    if (ruling.retcon >= 0.6) reasons.push(`捏造无依据过往/设定 P=${ruling.retcon.toFixed(2)}`)
    if (ruling.epistemic >= 0.6) reasons.push(`调用不在场未知情报 P=${ruling.epistemic.toFixed(2)}`)
    // 逐条只针对真正命中的轴写处置：嘴上的话照常演，被口胡出来的结果/设定/情报不作数。
    const clauses = ['台词与动作照常演出，但发言不是结果：只演受控角色亲口说的话、当场发起的尝试，不得据此推定对方的顺从、倾心、生理反应，或事情已经办成。']
    if (ruling.godmode >= 0.6) {
      clauses.push('越权结果作废：输入中替其他角色预设的顺从、倾心、生理峰值一律不予追认，只作为玩家角色单方面的口嗨、试探话术或一厢情愿来呈现。')
    }
    if (ruling.retcon >= 0.6) {
      clauses.push('无据设定不予采信：玩家本轮新造的机构、法条、外界安排、他人身份关系或既往事件，与既有设定及状态锚点冲突时不得作为本轮事实地基；剧情按已确立的设定与状态推进，只把该主张留给玩家角色自己说出。')
    }
    if (ruling.epistemic >= 0.6) {
      clauses.push('场外天眼作废：角色只能使用故事里已经获知的情报，不得因为玩家写出来就自然地知道不在场的信息。')
    }
    clauses.push(`状态刚性反制：严格依据当前状态锚点（${stateLine}${postureLine}）与角色人设，演出对方真实的错愕、质疑、冷淡推开或心理防备升级。`)
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：越权剥离（${reasons.join('，') || '跨阶口胡拦截'}）】`,
      ...clauses.map((clause, index) => `${index + 1}. ${clause}`),
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'resist_pushback') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：防线受阻（筹码得分 ${ruling.leverageScore.toFixed(2)}/3.00）】`,
      '1. 正常演出受控角色发起的言行试探，但该举动明显超出当前关系与心理防线阈值。',
      `2. 严格锚定当前状态（${stateLine}${postureLine}）：其他角色依性格表现为回避、推拒、警告或转移话题，核心防线不予退让，切勿顺从跨阶段诉求。`,
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'costly_advance') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：带代价推进（筹码得分 ${ruling.leverageScore.toFixed(2)}/3.00）】`,
      '1. 受控角色的冒险行动可达成局部预期效果，但过程须体现明显阻力。',
      `2. 结合当前状态（${stateLine}${postureLine}）同步落下一项合理叙事代价（如引起对方戒备怀疑、暴露破绽、消耗现有筹码或留下事后心理隔阂）。`,
      '</turn_ruling>'
    ].join('\n')
  }
  if (tier === 'conflicted_half_step') {
    return [
      '<turn_ruling>',
      `【本轮叙事阻尼裁定：有效筹码·半步拉扯（筹码得分 ${ruling.leverageScore.toFixed(2)}/3.00）】`,
      '1. 玩家本轮铺垫、伏笔利用或筹码施压有效，允许关系或亲密互动实质推进半步，给予明确正向或动摇反馈。',
      `2. 身心惯性阻尼：受当前状态（${stateLine}${postureLine}）牵制，严禁单轮跳变至彻底臣服、完全倾心或清空羞耻感；须细腻刻画角色的嘴硬心软、羞愤抗拒、自我合理化借口或身体动摇与理智防线的错位拉扯。`,
      '</turn_ruling>'
    ].join('\n')
  }
  // full_accept
  const capNote = ruling?.mode === 'strict'
    ? '保持慢热细腻节奏，情绪与生理反应紧贴当前阶段自然延展，避免跨阶段跳跃。'
    : '顺应当前关系温度与现场氛围流畅演出，保持角色口吻与细节真实。'
  return [
    '<turn_ruling>',
    `【本轮叙事阻尼裁定：顺势成立（筹码得分 ${Number(ruling?.leverageScore || 1).toFixed(2)}/3.00）】`,
    `- 玩家行动与当前状态（${stateLine}${postureLine}）相符。${capNote}`,
    '</turn_ruling>'
  ].join('\n')
}

export function settlementBudgetRuleText(ruling) {
  if (!ruling || typeof ruling !== 'object') return ''
  const strict = ruling.mode === 'strict'
  const author = ruling.judgeMode === 'author'
  const budget = str(ruling.deltaBudget)
  if (budget === 'backfire') {
    if (author) {
      return '【叙事阻尼器·本轮结算配额：反向回调（backfire）】本轮续写出现关系或信任的剧烈反转：好感、信任、亲密、顺从、沦陷类正向指标允许下调，警戒、抗拒、敌意类指标允许上调，但反转须有可见的因果，不得无过渡跳变。'
    }
    return '【叙事阻尼器·本轮结算配额：反弹收紧（backfire）】本轮玩家行动越界冒进或口胡失效：好感、信任、亲密、顺从、沦陷类正向推进指标严禁上调（允许持平或小幅下调），警戒、抗拒、羞耻防线允许小幅上调。'
  }
  if (budget === 'frozen') {
    if (author) {
      return '【叙事阻尼器·本轮结算配额：惯性冻结（frozen）】本轮以交代、过渡或设定校正为主：好感、信任、爱意、沦陷、心理防线等核心关系指标单轮变动幅度须控制在 ±1 以内。'
    }
    return '【叙事阻尼器·本轮结算配额：防线冻结（frozen）】本轮未形成有效破防：好感、信任、爱意、沦陷、心理防线等核心关系指标单轮变动幅度须控制在 ±1 以内。'
  }
  if (budget === 'breakthrough') {
    const cap = strict ? 8 : 12
    return `【叙事阻尼器·本轮结算配额：阶段突破（breakthrough）】本轮有效兑现关键筹码或伏笔：允许关系、沦陷或防线指标发生阶段性松动，但百分制连续指标单轮最大变动幅度仍须控制在 ±${cap} 以内，严禁单轮一步拉满或清零。`
  }
  const cap = strict ? 3 : 5
  if (author) {
    return `【叙事阻尼器·本轮结算配额：渐进微调（micro_step）】按既有节奏自然推进：百分制好感、信任、沦陷、唤起、防线等连续指标单轮变动幅度控制在 ±${cap} 以内。`
  }
  return `【叙事阻尼器·本轮结算配额：渐进微调（micro_step）】保持慢热连续惯性：百分制好感、信任、沦陷、唤起、防线等连续指标单轮变动幅度控制在 ±${cap} 以内。`
}

const NON_ATTITUDE_PATH_RE = /(?:金钱|金币|存款|余额|负债|价格|薪水|资产|回合|天数|日期|年份|月份|星期|时刻|时间|年龄|身高|体重|胸围|腰围|臀围|编号|序号|次数|计数|坐标|等级|经验|血量|生命|法力|体力上限|money|gold|coin|cash|balance|debt|price|turn|day|date|year|month|hour|minute|time|age|height|weight|count|index|id|level|lv|exp|hp|mp)\b/i
const POSITIVE_APPROACH_PATH_RE = /(?:好感|爱意|爱情|喜欢|信任|亲密|亲近|依恋|倾心|心动|顺从|服从|臣服|屈服|沦陷|恶堕|堕落|背德|淫乱|敏感|开发|发情|唤起|情欲|性欲|快感|动摇|依赖|affection|favor|love|trust|intimacy|obedience|submission|corruption|depravity|lust|arousal|desire|sensitivity)/i
const RESISTANCE_GUARD_PATH_RE = /(?:抗拒|抵触|防线|心防|戒备|警惕|敌意|防备|羞耻|贞操|忠诚|理智|清醒|怀疑|反感|厌恶|resistance|guard|defense|vigilance|hostility|shame|chastity|loyalty|sanity|suspicion)/i

function decodePointer(pointer) {
  return str(pointer).split('/').slice(1).map(seg => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function readStatLeaf(currentVariables, opPath) {
  const segments = decodePointer(opPath)
  if (!segments.length) return { exists: false, value: undefined, keyPath: '' }
  const statSegments = segments[0] === 'stat_data' ? segments.slice(1) : segments
  let cursor = object(currentVariables).stat_data
  for (const seg of statSegments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return { exists: false, value: undefined, keyPath: statSegments.join('/') }
    cursor = cursor[seg]
  }
  return { exists: cursor !== undefined, value: cursor, keyPath: statSegments.join('/') }
}

function deltaBoundsForField(keyPath, currentValue, ruling) {
  if (!Number.isFinite(currentValue)) return null
  const isPositiveAxis = POSITIVE_APPROACH_PATH_RE.test(keyPath)
  const isResistanceAxis = !isPositiveAxis && RESISTANCE_GUARD_PATH_RE.test(keyPath)
  if (!isPositiveAxis && !isResistanceAxis) {
    if (NON_ATTITUDE_PATH_RE.test(keyPath)) return null
    if (currentValue < -100 || currentValue > 100) return null
  }
  const strict = ruling.mode === 'strict'
  const budget = str(ruling.deltaBudget)
  if (budget === 'backfire') {
    if (isPositiveAxis) return { min: -10, max: 0 }
    if (isResistanceAxis) return { min: 0, max: 10 }
    return { min: -6, max: 2 }
  }
  if (budget === 'frozen') {
    if (isPositiveAxis) return { min: -3, max: 1 }
    if (isResistanceAxis) return { min: -1, max: 3 }
    return { min: -1, max: 1 }
  }
  if (budget === 'breakthrough') {
    const cap = strict ? 8 : 12
    return { min: -cap, max: cap }
  }
  // micro_step
  const cap = strict ? 3 : 5
  return { min: -cap, max: cap }
}

export function summarizeDamperRulingOutcome(ruling, meta = {}) {
  if (!ruling || typeof ruling !== 'object') return null
  const explicitSceneShift = ruling.explicitSceneShift === true || meta.explicitSceneShift === true
  const rawThreshold = meta.godmodeThreshold ?? ruling.godmodeThreshold
  const rawLatency = meta.latencyMs ?? ruling.latencyMs
  return {
    status: 'applied',
    source: str(meta.source || ruling.source) || (explicitSceneShift ? 'scene-shift' : 'model'),
    mode: ruling.mode === 'strict' ? 'strict' : 'balanced',
    judgeMode: ruling.judgeMode === 'author' ? 'author' : 'roleplay',
    ...(str(meta.provider || ruling.provider) ? { provider: str(meta.provider || ruling.provider) } : {}),
    ...(str(meta.model || ruling.model) ? { model: str(meta.model || ruling.model) } : {}),
    rulingTier: str(ruling.rulingTier) || 'full_accept',
    deltaBudget: str(ruling.deltaBudget) || 'micro_step',
    leverageScore: Number.isFinite(Number(ruling.leverageScore)) ? Math.round(Number(ruling.leverageScore) * 100) / 100 : 1,
    godmode: Number.isFinite(Number(ruling.godmode)) ? Math.round(Number(ruling.godmode) * 1000) / 1000 : 0,
    retcon: Number.isFinite(Number(ruling.retcon)) ? Math.round(Number(ruling.retcon) * 1000) / 1000 : 0,
    epistemic: Number.isFinite(Number(ruling.epistemic)) ? Math.round(Number(ruling.epistemic) * 1000) / 1000 : 0,
    ...(Number.isFinite(Number(rawThreshold)) ? { godmodeThreshold: Math.round(Number(rawThreshold) * 100) / 100 } : {}),
    explicitSceneShift,
    clampMvuDelta: ruling.clampMvuDelta !== false,
    fallbackStateForPlainCards: ruling.fallbackStateForPlainCards !== false,
    ...(str(meta.stateKind || ruling.stateKind) ? { stateKind: str(meta.stateKind || ruling.stateKind) } : {}),
    ...(Number.isFinite(Number(rawLatency)) ? { latencyMs: Math.max(0, Math.round(Number(rawLatency))) } : {}),
    ...((meta.retriedSafetyFallback ?? ruling.retriedSafetyFallback) === true ? { retriedSafetyFallback: true } : {})
  }
}

export function clampMvuSubmissionOperationsWithReport(submission, currentVariables, ruling) {
  if (!submission || !Array.isArray(submission.operations) || !ruling) {
    return { submission, report: null }
  }
  const baseReport = {
    mode: ruling.mode === 'strict' ? 'strict' : 'balanced',
    judgeMode: ruling.judgeMode === 'author' ? 'author' : 'roleplay',
    rulingTier: str(ruling.rulingTier) || 'full_accept',
    deltaBudget: str(ruling.deltaBudget) || 'micro_step',
    leverageScore: Number.isFinite(Number(ruling.leverageScore)) ? Math.round(Number(ruling.leverageScore) * 100) / 100 : 1,
    explicitSceneShift: ruling.explicitSceneShift === true,
    clampEnabled: ruling.clampMvuDelta !== false
  }
  if (ruling.clampMvuDelta === false) {
    return {
      submission,
      report: { ...baseReport, evaluatedCount: 0, clampedCount: 0, clamped: [] }
    }
  }
  const nextOps = []
  const clamped = []
  let evaluatedCount = 0
  for (const op of submission.operations) {
    if (!op || typeof op !== 'object') continue
    if ((op.op === 'delta' || op.op === 'replace' || op.op === 'add') && typeof op.value === 'number' && Number.isFinite(op.value)) {
      const leaf = readStatLeaf(currentVariables, op.path)
      if (leaf.exists && typeof leaf.value === 'number' && Number.isFinite(leaf.value)) {
        const bounds = deltaBoundsForField(leaf.keyPath, leaf.value, ruling)
        if (bounds) {
          evaluatedCount += 1
          const rawDelta = op.op === 'delta' ? op.value : (op.value - leaf.value)
          const integerValues = Number.isInteger(leaf.value) && Number.isInteger(rawDelta)
          const roundVal = n => integerValues ? Math.round(n) : Math.round(n * 100) / 100
          let clampedDelta = Math.min(bounds.max, Math.max(bounds.min, rawDelta))
          clampedDelta = roundVal(clampedDelta)
          const wasClamped = Math.abs(clampedDelta - rawDelta) > 1e-6
          if (wasClamped) {
            const requestedAfter = roundVal(leaf.value + rawDelta)
            const finalAfter = roundVal(leaf.value + clampedDelta)
            clamped.push({
              path: str(op.path),
              operation: str(op.op),
              before: String(leaf.value),
              requestedAfter: String(requestedAfter),
              after: String(finalAfter),
              requestedDelta: roundVal(rawDelta),
              clampedDelta,
              dropped: clampedDelta === 0
            })
          }
          if (clampedDelta === 0) continue
          if (op.op === 'delta') nextOps.push({ ...op, value: clampedDelta })
          else nextOps.push({ ...op, value: Number.isInteger(leaf.value) && Number.isInteger(clampedDelta) ? leaf.value + clampedDelta : Math.round((leaf.value + clampedDelta) * 100) / 100 })
          continue
        }
      }
    }
    nextOps.push(op)
  }
  return {
    submission: { ...submission, operations: nextOps },
    report: {
      ...baseReport,
      evaluatedCount,
      clampedCount: clamped.length,
      clamped
    }
  }
}

export function clampMvuSubmissionOperations(submission, currentVariables, ruling) {
  return clampMvuSubmissionOperationsWithReport(submission, currentVariables, ruling).submission
}

function recentStoryExcerpt(chat, excludeAssistantIndex = -1) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  const picked = []
  for (let i = messages.length - 1; i >= 0 && picked.length < 3; i--) {
    if (i === excludeAssistantIndex) continue
    const msg = messages[i]
    if (!msg || !['user', 'assistant'].includes(msg.role)) continue
    const swipeId = Math.max(0, Number(msg.swipeId) || 0)
    const body = str(Array.isArray(msg.swipes) && msg.swipes[swipeId] ? msg.swipes[swipeId] : (msg.projectionText || msg.text || msg.sourceText)).trim()
    if (!body) continue
    const label = msg.role === 'assistant' ? '【近期剧情片段】' : '【前轮玩家行动】'
    picked.unshift(label + body.slice(-420))
  }
  return picked.join('\n')
}

function buildJudgeMaterial({ chat, card, userText, stateSnapshot, config, excludeAssistantIndex = -1 }) {
  const personaParts = [
    card?.name ? `角色名：${str(card.name)}` : '',
    card?.description ? `核心设定：${str(card.description).slice(0, 700)}` : '',
    card?.personality ? `性格特征：${str(card.personality).slice(0, 350)}` : ''
  ].filter(Boolean).join('\n')
  const guides = Array.isArray(chat?.guides) && chat.guides.length
    ? '【本局指导 Guide】' + chat.guides.map(g => str(g?.text ?? g)).filter(Boolean).join('；').slice(0, 400)
    : ''
  const rawMaterial = [
    config.judgeMode === 'author'
      ? '【视角说明】当前为写作模式：作者拥有全知视角，可为任意角色落笔、编排群体行动、切换镜头与场景。判定只看新增内容是否与既有设定矛盾（吃书）、角色是否失真、视角是否穿帮，不存在「越权代笔」这回事。'
      : '',
    config.preamble ? `【附加裁判准则】${str(config.preamble).trim()}` : '',
    personaParts ? `【角色人设摘要】\n${personaParts}` : '',
    `【当前状态锚点（${stateSnapshot.kind === 'mvu' ? 'MVU 变量表' : '通用四维状态'}）】\n${JSON.stringify(stateSnapshot.data || {})}`,
    str(chat?.posture).trim() ? `【上一轮结算现场姿势】\n${str(chat.posture).trim().slice(0, 320)}` : '',
    guides,
    recentStoryExcerpt(chat, excludeAssistantIndex),
    config.judgeMode === 'author'
      ? `【本轮续写输入（作者视角，可落笔任意角色）】\n${str(userText).trim().slice(0, 2000)}`
      : `【本轮受控角色输入】\n${str(userText).trim().slice(0, 2000)}`
  ].filter(Boolean).join('\n\n')
  return config.desensitizeR18 !== false ? desensitizeForDecisionJudge(rawMaterial) : rawMaterial
}

function buildProviderRequest(config, material, customBinaryQuestions = null) {
  const url = damperEndpointUrl(config)
  if (!url) return null
  const protocol = DAMPER_PROVIDERS[config.provider]?.protocol || 'gemini'
  if (protocol === 'gemini') {
    const questions = customBinaryQuestions
      ? Object.fromEntries(customBinaryQuestions.map(q => [q.id, { type: 'noul', instructions: q.text }]))
      : damperQuestionSet(config)
    const body = JSON.stringify({ model: config.model, input: material, questions })
    return { protocol, url, body, authHeader: key => ({ 'x-goog-api-key': key, 'Content-Type': 'application/json' }) }
  }
  const list = customBinaryQuestions || damperBinaryQuestionSet(config)
  if (protocol === 'jev') {
    const body = JSON.stringify({
      model: config.model,
      state: material,
      questions: Object.fromEntries(list.map(q => [q.id, { type: 'noul', instructions: q.text }]))
    })
    return { protocol, url, body, authHeader: key => ({ Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }) }
  }
  const body = JSON.stringify({
    model: config.model,
    input: material,
    questions: list.map(q => ({ type: 'predicate', name: q.id, instructions: q.text }))
  })
  return { protocol, url, body, authHeader: key => ({ Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }) }
}

function parseTurnDecisionResponse(protocol, data, config = null) {
  const author = config?.judgeMode === 'author'
  if (protocol === 'gemini') {
    const answers = object(data && data.answers)
    const godmode = Number(answers.godmode_outcome?.noul)
    const retcon = Number(answers.unfounded_retcon?.noul)
    const epistemic = Number(answers.epistemic_violation?.noul)
    const leverageScore = Number(answers.leverage_score?.score)
    const rulingTier = str(answers.ruling_tier?.choice)
    const deltaBudget = str(answers.mvu_delta_budget?.choice)
    if (![godmode, retcon, epistemic, leverageScore].every(v => Number.isFinite(v)) || !rulingTier || !deltaBudget) {
      throw error('DAMPER_INVALID_RESPONSE', '决策模型返回格式不完整')
    }
    return { godmode, retcon, epistemic, leverageScore, rulingTier, deltaBudget, overreachProb: Number(answers.ruling_tier?.probabilities?.resist_pushback || 0) }
  }
  const answers = protocol === 'jev'
    ? object(data && data.answers)
    : Object.fromEntries((Array.isArray(data?.answers) ? data.answers : []).map(item => [item.name, item]))
  const probOf = id => {
    const entry = answers[id]
    const value = protocol === 'jev' ? Number(entry?.noul) : Number(entry?.probability)
    if (!Number.isFinite(value) || value < 0 || value > 1) throw error('DAMPER_INVALID_RESPONSE', '决策模型返回概率无效')
    return value
  }
  const godmode = probOf('godmode_outcome')
  const retcon = probOf('unfounded_retcon')
  const epistemic = probOf('epistemic_violation')
  const strongLeverage = probOf('strong_leverage')
  const overreaches = probOf('overreaches_state')
  const backfire = probOf('triggers_backfire')
  const leverageScore = strongLeverage * 3
  let rulingTier = 'full_accept'
  if (author ? retcon >= 0.72 : (godmode >= 0.72 || retcon >= 0.72 || epistemic >= 0.72)) rulingTier = 'strip_delusion'
  else if (overreaches >= 0.65 && strongLeverage < 0.45) rulingTier = 'resist_pushback'
  else if (overreaches >= 0.5 && strongLeverage >= 0.45) rulingTier = 'conflicted_half_step'
  else if (backfire >= 0.55) rulingTier = 'costly_advance'
  let deltaBudget = 'micro_step'
  if (backfire >= 0.65) deltaBudget = 'backfire'
  else if (rulingTier === 'strip_delusion' || rulingTier === 'resist_pushback') deltaBudget = 'frozen'
  else if (strongLeverage >= 0.72 && overreaches < 0.7) deltaBudget = 'breakthrough'
  return { godmode, retcon, epistemic, leverageScore, rulingTier, deltaBudget, overreachProb: overreaches }
}

const SAFETY_ERROR_CODES = new Set(['safety', 'prohibited_content', 'blocklist', 'image_safety', 'content_blocked'])

export function createNarrativeDamper({ getConfig, credentials, fetch: send = globalThis.fetch, log = () => {} }) {
  const decisionCache = new Map()
  const activeTurnRulings = new Map()

  function rememberCache(map, key, value, limit = 80) {
    if (map.has(key)) map.delete(key)
    map.set(key, value)
    while (map.size > limit) map.delete(map.keys().next().value)
  }

  async function resolveCredential(config) {
    const store = credentials?.()
    if (!store?.resolve) return null
    const own = await store.resolve(DAMPER_KEY_REFS[config.provider])
    if (own?.value) return own.value
    if (config.keyName) {
      const env = await store.resolve(config.keyName)
      if (env?.value) return env.value
    }
    return null
  }

  async function sendOnce(request, apiKey, signal) {
    const response = await send(request.url, {
      method: 'POST',
      headers: request.authHeader(apiKey),
      body: request.body,
      signal,
      redirect: 'error'
    })
    let body = null
    try { body = await response.json() } catch { body = null }
    if (!response.ok) {
      const remoteCode = str(body?.error?.code).toLowerCase()
      if (response.status === 400 && SAFETY_ERROR_CODES.has(remoteCode)) {
        throw error('DAMPER_SAFETY_BLOCKED', '决策请求触发输入敏感词拦截')
      }
      if (response.status === 401 || response.status === 403) {
        throw error('DAMPER_AUTH_ERROR', 'API Key 无效或无权访问该决策模型')
      }
      if (response.status === 429) {
        throw error('DAMPER_RATE_LIMIT', '决策模型请求触发速率限制')
      }
      throw error('DAMPER_HTTP_ERROR', `决策模型服务返回 HTTP ${response.status}`)
    }
    if (!body || typeof body !== 'object') throw error('DAMPER_INVALID_RESPONSE', '决策模型未返回有效 JSON')
    return body
  }

  async function runTurnQuery({ material, fallbackMaterial, config }) {
    const request = buildProviderRequest(config, material)
    if (!request) return { ok: false, code: 'DAMPER_INACTIVE', latencyMs: 0, decision: null }
    const start = performance.now()
    const controller = new AbortController()
    let timer
    let retriedSafetyFallback = false
    try {
      const apiKey = await resolveCredential(config)
      if (!apiKey) throw error('DAMPER_NO_KEY', '尚未配置决策模型 API Key')
      const body = await Promise.race([
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(error('DAMPER_TIMEOUT', '决策模型响应超时')) }, config.timeoutMs)
        }),
        (async () => {
          try {
            return await sendOnce(request, apiKey, controller.signal)
          } catch (firstErr) {
            if (firstErr?.code === 'DAMPER_SAFETY_BLOCKED' && fallbackMaterial && !controller.signal.aborted) {
              const retryReq = buildProviderRequest(config, fallbackMaterial)
              if (retryReq) {
                retriedSafetyFallback = true
                return await sendOnce(retryReq, apiKey, controller.signal)
              }
            }
            throw firstErr
          }
        })()
      ])
      const rawDecision = parseTurnDecisionResponse(request.protocol, body, config)
      const ruling = normalizeDecisionRuling(rawDecision, config)
      const latencyMs = Math.round(performance.now() - start)
      const usage = body.usage ? {
        inputTokens: Number(body.usage.total_input_tokens ?? body.usage.input_tokens ?? 0),
        outputTokens: Number(body.usage.total_output_tokens ?? body.usage.output_tokens ?? 0)
      } : undefined
      const stat = { kind: 'narrative-damper', provider: config.provider, model: config.model, code: 'OK', latencyMs, rulingTier: ruling.rulingTier, deltaBudget: ruling.deltaBudget, ...(usage ? { usage } : {}) }
      log(stat)
      return { ok: true, code: 'OK', latencyMs, ruling, usage, retriedSafetyFallback }
    } catch (cause) {
      controller.abort()
      const known = ['DAMPER_TIMEOUT', 'DAMPER_NO_KEY', 'DAMPER_SAFETY_BLOCKED', 'DAMPER_AUTH_ERROR', 'DAMPER_RATE_LIMIT', 'DAMPER_HTTP_ERROR', 'DAMPER_INVALID_RESPONSE']
      const code = known.includes(cause?.code) ? cause.code : 'DAMPER_ERROR'
      const latencyMs = Math.round(performance.now() - start)
      log({ kind: 'narrative-damper', provider: config.provider, model: config.model, code, latencyMs })
      return { ok: false, code, message: str(cause?.message || code), latencyMs, ruling: null }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async enabled() {
      const config = normalizeNarrativeDamperConfig(await getConfig())
      return config.enabled === true
    },

    async credentialStatus(provider, keyName = '') {
      if (!Object.hasOwn(DAMPER_KEY_REFS, provider)) throw error('DAMPER_INVALID_CONFIG', '未知提供方')
      if (typeof keyName !== 'string' || (keyName !== '' && !DAMPER_KEY_NAME.test(keyName))) throw error('DAMPER_INVALID_CONFIG', '环境变量名称无效')
      const store = credentials?.()
      const own = await store?.describe?.(DAMPER_KEY_REFS[provider])
      if (own?.configured) return { configured: true, source: own.source === 'file' ? 'stored' : own.source || 'stored' }
      const effectiveKeyName = keyName || DAMPER_PROVIDERS[provider].keyName
      const info = effectiveKeyName ? await store?.describe?.(effectiveKeyName) : null
      return info?.configured === true
        ? { configured: true, source: info.source || 'env', keyName: effectiveKeyName }
        : { configured: false, source: null, keyName: effectiveKeyName }
    },

    async isReference(value) {
      return typeof value === 'string' && DAMPER_KEY_NAME.test(value) && (await credentials?.()?.describe?.(value))?.configured === true
    },

    async setKey(provider, key) {
      if (!Object.hasOwn(DAMPER_KEY_REFS, provider)) throw error('DAMPER_INVALID_CONFIG', '未知提供方')
      const store = credentials?.()
      if (!store?.set) throw error('DAMPER_KEY_STORE_UNAVAILABLE', '当前宿主环境未提供密钥安全存储')
      await (key === null ? store.unset(DAMPER_KEY_REFS[provider]) : store.set(DAMPER_KEY_REFS[provider], key))
    },

    async test(draftConfig) {
      const saved = normalizeNarrativeDamperConfig(await getConfig())
      const config = draftConfig === undefined ? saved : validateNarrativeDamperConfig(draftConfig)
      const url = damperEndpointUrl(config)
      if (!url) return { ok: false, latencyMs: 0, error: { code: 'DAMPER_INVALID_URL', message: '请先填写有效的自定义接口地址' } }
      // Prevent testing an unsaved custom URL with a stored secret from another endpoint.
      if (url !== fixedDamperUrl(config.provider) && !(saved.provider === config.provider && saved.keyName === config.keyName && damperEndpointUrl(saved) === url)) {
        return { ok: false, latencyMs: 0, error: { code: 'DAMPER_KEY_URL_MISMATCH', message: '请先保存自定义接口地址与密钥设置，再测试连接' } }
      }
      const probeReq = buildProviderRequest({ ...config, enabled: true }, 'A cat sleeps peacefully on the warm windowsill.', [
        { id: 'probe', text: 'Is a cat sleeping on the windowsill?' }
      ])
      const start = performance.now()
      const controller = new AbortController()
      let timer
      try {
        const apiKey = await resolveCredential(config)
        if (!apiKey) return { ok: false, latencyMs: 0, error: { code: 'DAMPER_NO_KEY', message: '尚未配置 API Key' } }
        const body = await Promise.race([
          new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(error('DAMPER_TIMEOUT', '连接超时')) }, Math.max(1500, config.timeoutMs))
          }),
          sendOnce(probeReq, apiKey, controller.signal)
        ])
        const protocol = probeReq.protocol
        const prob = protocol === 'gemini' || protocol === 'jev'
          ? Number(body?.answers?.probe?.noul)
          : Number((Array.isArray(body?.answers) ? body.answers.find(a => a.name === 'probe') : null)?.probability)
        if (!Number.isFinite(prob) || prob < 0 || prob > 1) {
          return { ok: false, latencyMs: Math.round(performance.now() - start), error: { code: 'DAMPER_INVALID_RESPONSE', message: '服务返回了非预期的决策响应结构' } }
        }
        return { ok: true, latencyMs: Math.round(performance.now() - start), sampleProbability: Math.round(prob * 1000) / 1000 }
      } catch (cause) {
        controller.abort()
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - start),
          error: { code: str(cause?.code || 'DAMPER_ERROR'), message: str(cause?.message || '连接测试失败') }
        }
      } finally {
        clearTimeout(timer)
      }
    },

    async evaluateTurn({ chat, card, turn, userText, excludeAssistantIndex = -1 }) {
      const activeKey = chat?.id ? `${chat.id}:${Number(turn) || 0}` : ''
      if (activeKey) activeTurnRulings.delete(activeKey)
      const config = normalizeNarrativeDamperConfig(await getConfig())
      if (!config.enabled || !chat || !['story', 'script'].includes(chat.mode || 'story')) return null
      const trimmedInput = str(userText).trim()
      if (!trimmedInput) return null

      const effectiveThreshold = config.mode === 'strict'
        ? Math.max(0.5, Math.round((config.godmodeThreshold - 0.08) * 100) / 100)
        : config.godmodeThreshold
      const stateSnapshot = readDamperStateSnapshot(chat, {
        excludeAssistantIndex,
        fallbackForPlain: config.fallbackStateForPlainCards !== false
      })
      const explicitSceneShift = isExplicitSceneShiftInput(trimmedInput)
      if (explicitSceneShift) {
        const sceneRuling = {
          mode: config.mode,
          judgeMode: config.judgeMode === 'author' ? 'author' : 'roleplay',
          godmode: 0,
          retcon: 0,
          epistemic: 0,
          leverageScore: 1.5,
          rulingTier: 'full_accept',
          deltaBudget: 'micro_step',
          clampMvuDelta: config.clampMvuDelta !== false,
          fallbackStateForPlainCards: config.fallbackStateForPlainCards !== false,
          explicitSceneShift: true
        }
        const rulingText = compileTurnRuling(sceneRuling, { stateSnapshot, posture: chat.posture, explicitSceneShift: true })
        const outcome = summarizeDamperRulingOutcome(sceneRuling, {
          source: 'scene-shift',
          explicitSceneShift: true,
          stateKind: stateSnapshot.kind,
          latencyMs: 0
        })
        if (activeKey) rememberCache(activeTurnRulings, activeKey, { ruling: sceneRuling, outcome, stateSnapshot })
        return { ruling: sceneRuling, rulingText, stateSnapshot, outcome }
      }

      const cacheFingerprint = createHash('sha256').update(JSON.stringify({
        chatId: str(chat.id),
        branchId: str(chat.timeline?.branchId),
        turn: Number(turn) || 0,
        posture: str(chat.posture),
        state: stateSnapshot,
        input: trimmedInput,
        config: {
          mode: config.mode,
          judgeMode: config.judgeMode,
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          godmodeThreshold: config.godmodeThreshold,
          desensitizeR18: config.desensitizeR18,
          clampMvuDelta: config.clampMvuDelta,
          preamble: config.preamble
        }
      })).digest('hex')

      const cached = decisionCache.get(cacheFingerprint)
      if (cached) {
        const outcome = summarizeDamperRulingOutcome(cached.ruling, {
          source: 'cache',
          provider: config.provider,
          model: config.model,
          godmodeThreshold: effectiveThreshold,
          stateKind: stateSnapshot.kind,
          latencyMs: 0
        })
        if (activeKey) rememberCache(activeTurnRulings, activeKey, { ruling: cached.ruling, outcome, stateSnapshot })
        return { ...cached, stateSnapshot, outcome }
      }

      const material = buildJudgeMaterial({ chat, card, userText: trimmedInput, stateSnapshot, config, excludeAssistantIndex })
      const fallbackMaterial = skeletonizeForSafetyFallback({ stateSnapshot: stateSnapshot.data, posture: chat.posture, userText: trimmedInput })
      const queryResult = await runTurnQuery({ material, fallbackMaterial, config })
      if (!queryResult.ok || !queryResult.ruling) {
        const outcome = {
          status: 'bypassed',
          code: str(queryResult.code || 'DAMPER_ERROR'),
          message: str(queryResult.message || '决策模型未返回有效结果'),
          provider: config.provider,
          model: config.model,
          mode: config.mode,
          judgeMode: config.judgeMode === 'author' ? 'author' : 'roleplay',
          latencyMs: Math.max(0, Math.round(Number(queryResult.latencyMs) || 0))
        }
        if (activeKey) rememberCache(activeTurnRulings, activeKey, { ruling: null, outcome, stateSnapshot })
        return { ruling: null, rulingText: '', stateSnapshot, outcome }
      }

      const rulingText = compileTurnRuling(queryResult.ruling, { stateSnapshot, posture: chat.posture, explicitSceneShift: false })
      const outcome = summarizeDamperRulingOutcome(queryResult.ruling, {
        source: 'model',
        provider: config.provider,
        model: config.model,
        godmodeThreshold: effectiveThreshold,
        stateKind: stateSnapshot.kind,
        latencyMs: queryResult.latencyMs,
        retriedSafetyFallback: queryResult.retriedSafetyFallback
      })
      const entry = { ruling: queryResult.ruling, rulingText }
      rememberCache(decisionCache, cacheFingerprint, entry, 96)
      if (activeKey) rememberCache(activeTurnRulings, activeKey, { ruling: queryResult.ruling, outcome, stateSnapshot })
      return { ...entry, stateSnapshot, outcome }
    },

    clearActive() {
      activeTurnRulings.clear()
    },

    activeRuling(chatId, turn) {
      if (!chatId) return null
      if (turn !== undefined && turn !== null) {
        const exact = activeTurnRulings.get(`${chatId}:${Number(turn) || 0}`)
        if (exact) return exact
      }
      // Fallback to latest turn recorded for this chatId if settlement turn index wasn't specified
      let found = null
      const prefix = `${chatId}:`
      for (const [key, value] of activeTurnRulings.entries()) {
        if (key.startsWith(prefix)) found = value
      }
      return found
    }
  }
}

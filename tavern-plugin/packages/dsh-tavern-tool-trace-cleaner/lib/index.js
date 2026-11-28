import { cleanContextMessages, createStreamingBodyCleaner } from './cleaner.js'
import { DEFAULT_SETTINGS, normalizeSettings, stripBodyTextTraces } from './matcher.js'

export const name = 'dsh-tavern-tool-trace-cleaner'
export const inject = ['tavern']

export const GAME_SETTINGS_SCHEMA = Object.freeze({
  title: '工具痕迹清理',
  fields: [
    {
      key: 'enabled',
      type: 'boolean',
      label: '启用工具痕迹清理',
      description: '总开关：清理前台读变量、Skill、查世界书、召回历史在上下文与正文中的痕迹。',
      default: DEFAULT_SETTINGS.enabled
    },
    {
      key: 'cleanReadVariables',
      type: 'boolean',
      label: '清理读变量痕迹（L1）',
      description: '在后续轮次的上下文中移除历史轮次的 tavern_read_variables 调用与结果。',
      default: DEFAULT_SETTINGS.cleanReadVariables
    },
    {
      key: 'cleanWorldbook',
      type: 'boolean',
      label: '清理查世界书痕迹（L1）',
      description: '在后续轮次的上下文中移除历史轮次的 query_lorebook 及旧版世界书工具调用与结果。',
      default: DEFAULT_SETTINGS.cleanWorldbook
    },
    {
      key: 'cleanRecallHistory',
      type: 'boolean',
      label: '清理召回历史痕迹（L1）',
      description: '在后续轮次的上下文中移除历史轮次的 tavern_recall_history 调用与结果（不触碰 tvh_ 合成历史）。',
      default: DEFAULT_SETTINGS.cleanRecallHistory
    },
    {
      key: 'skillPolicy',
      type: 'select',
      label: 'Skill 清理策略（L1）',
      description: '控制历史轮次中 skill 工具调用与 <skill_content> 注入块的保留策略。',
      options: [
        { value: 'keep-latest', label: '仅留最近一次（推荐）' },
        { value: 'all', label: '全部清理历史 Skill' },
        { value: 'off', label: '不清理 Skill' }
      ],
      default: DEFAULT_SETTINGS.skillPolicy
    },
    {
      key: 'cleanBodyText',
      type: 'boolean',
      label: '清理正文残片（L2）',
      description: '流式与结算阶段剥离正文中泄漏的 <skill_content>、工具调用 XML 与工具 JSON 块。',
      default: DEFAULT_SETTINGS.cleanBodyText
    },
    {
      key: 'stripMetaPrefix',
      type: 'boolean',
      label: '清理正文开头过程过渡句（L2）',
      description: '保守清理正文首行如「我先查询一下世界书：」这类工具过程旁白，不触碰引号对话。',
      default: DEFAULT_SETTINGS.stripMetaPrefix
    },
    {
      key: 'extraTools',
      type: 'text',
      label: '额外清理的工具名',
      description: '可选：用逗号或空格分隔的额外工具名，按 L1 规则一并清理。',
      default: DEFAULT_SETTINGS.extraTools,
      maxLength: 200
    },
    {
      key: 'debugLog',
      type: 'boolean',
      label: '输出调试日志',
      description: '在宿主控制台记录每轮清理的工具调用数量与正文清理次数。',
      default: DEFAULT_SETTINGS.debugLog
    }
  ]
})

export function apply(ctx) {
  const tavern = ctx?.tavern
  if (!tavern) return undefined

  const disposers = []
  const settingsCache = new Map()
  const foregroundGameSessions = new Set()
  const settledHandled = new Set()

  const track = dispose => {
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  // 1. 注册本局设置面板
  if (typeof tavern.gameSettings === 'function') {
    try {
      track(tavern.gameSettings(GAME_SETTINGS_SCHEMA))
    } catch (error) {
      try { console.warn(`[${name}] 注册本局设置失败：`, error?.message || error) } catch {}
    }
  }

  if (typeof tavern.onGameSettingsChanged === 'function') {
    try {
      track(tavern.onGameSettingsChanged(({ gameId, values } = {}) => {
        if (typeof gameId === 'string' && gameId) {
          settingsCache.set(gameId, normalizeSettings(values))
        }
      }))
    } catch {}
  }

  async function isForegroundGameSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return false
    if (foregroundGameSessions.has(sessionId)) return true
    if (typeof tavern.getTurnState !== 'function') return false
    try {
      await tavern.getTurnState({ gameId: sessionId })
      foregroundGameSessions.add(sessionId)
      return true
    } catch {
      return false
    }
  }

  async function resolveSettings(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return DEFAULT_SETTINGS
    if (settingsCache.has(sessionId)) return settingsCache.get(sessionId)
    if (typeof tavern.getGameSettings !== 'function') return DEFAULT_SETTINGS
    try {
      const raw = await tavern.getGameSettings({ gameId: sessionId })
      const normalized = normalizeSettings(raw)
      settingsCache.set(sessionId, normalized)
      return normalized
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  // 2. L1：在 agent/pre-step 钩子最外层（prepend: true）于 next() 之后过滤历史轮次工具痕迹
  if (typeof ctx.on === 'function') {
    track(ctx.on('agent/pre-step', async function cleanPreStep(payload, next) {
      const decision = await next()
      if (!decision || decision.kind !== 'enter' || !Array.isArray(decision.messages) || decision.messages.length === 0) {
        return decision
      }
      const sessionId = payload?.agent?.session?.id
      if (!sessionId) return decision

      // 只处理前台游戏主会话，跳过后台结算 / 压缩 / 子代理会话
      if (!(await isForegroundGameSession(sessionId))) return decision

      const settings = await resolveSettings(sessionId)
      if (!settings.enabled) return decision

      const result = cleanContextMessages(decision.messages, settings)
      if (!result.changed) return decision

      if (settings.debugLog) {
        try {
          console.info(`[${name}] L1 cleaned session=${sessionId}`, result.stats)
        } catch {}
      }
      return { ...decision, messages: result.messages }
    }, { prepend: true }))
  }

  // 3. L2 流式：通过 replyRewriter 在纯文本正文写出前实时剥离残片
  if (typeof tavern.replyRewriter === 'function') {
    try {
      const rewriter = createStreamingBodyCleaner(resolveSettings)
      track(tavern.replyRewriter(rewriter))
    } catch (error) {
      try { console.warn(`[${name}] replyRewriter 注册跳过，将仅使用结算兜底：`, error?.message || error) } catch {}
    }
  }

  // 4. L2 结算兜底：覆盖 submit_story 工具提交模式，或 replyRewriter 被其他插件占用的场景
  if (typeof tavern.onTurnSettled === 'function' && typeof tavern.editTurn === 'function') {
    try {
      track(tavern.onTurnSettled(async snapshot => {
        const gameId = snapshot?.gameId
        const turn = snapshot?.turn
        const textVersion = snapshot?.textVersion
        const text = snapshot?.text
        if (!gameId || !Number.isSafeInteger(turn) || !textVersion || typeof text !== 'string' || !text) return

        const versionKey = `${gameId}:${turn}:${textVersion}`
        if (settledHandled.has(versionKey)) return
        settledHandled.add(versionKey)
        if (settledHandled.size > 500) {
          const first = settledHandled.values().next().value
          if (first) settledHandled.delete(first)
        }

        const settings = await resolveSettings(gameId)
        if (!settings.enabled || !settings.cleanBodyText) return

        const cleaned = stripBodyTextTraces(text, settings)
        if (cleaned === text || !cleaned.trim()) return

        try {
          const updated = await tavern.editTurn({
            gameId,
            turn,
            textVersion,
            text: cleaned,
            polish: false
          })
          if (updated?.textVersion) {
            settledHandled.add(`${gameId}:${turn}:${updated.textVersion}`)
          }
          if (settings.debugLog) {
            try {
              console.info(`[${name}] L2 settled editTurn game=${gameId} turn=${turn} delta=${text.length - cleaned.length}`)
            } catch {}
          }
        } catch (error) {
          if (settings.debugLog) {
            try { console.warn(`[${name}] L2 editTurn skipped:`, error?.message || error) } catch {}
          }
        }
      }))
    } catch {}
  }

  return () => {
    settingsCache.clear()
    foregroundGameSessions.clear()
    settledHandled.clear()
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch {}
    }
  }
}

export default { name, inject, apply }

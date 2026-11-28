import {
  STREAM_TAG_OPEN_RE,
  classifyToolName,
  extractSkillNameFromCall,
  extractSkillNameFromMessage,
  isSkillInjectionMessage,
  isSyntheticHistoryCallId,
  normalizeSettings,
  parseExtraTools,
  shouldCleanNonSkillCategory,
  stripBodyTextTraces
} from './matcher.js'

function isToolResultOnlyUserMessage(message) {
  if (!message || message.role !== 'user' || !Array.isArray(message.content) || !message.content.length) return false
  return message.content.every(block => block && block.type === 'tool-result')
}

function isRealPlayerUserMessage(message) {
  if (!message || message.role !== 'user') return false
  if (isSkillInjectionMessage(message)) return false
  if (isToolResultOnlyUserMessage(message)) return false
  return true
}

function findCurrentTurnStartIndex(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isRealPlayerUserMessage(messages[index])) return index
  }
  return 0
}

function toolCallIdOf(block) {
  if (!block || typeof block !== 'object') return ''
  return typeof block.id === 'string' ? block.id : (typeof block.callId === 'string' ? block.callId : '')
}

function toolResultCallIdOf(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.toolCallId === 'string' && message.toolCallId) return message.toolCallId
  if (typeof message.source?.callId === 'string' && message.source.callId) return message.source.callId
  return ''
}

function isAssistantContentEmpty(content) {
  if (typeof content === 'string') return content.trim() === ''
  if (!Array.isArray(content) || content.length === 0) return true
  return content.every(block => {
    if (!block) return true
    if (block.type === 'text') return typeof block.text !== 'string' || block.text.trim() === ''
    return false
  })
}

/**
 * L1：清理已完成历史轮次中 4 类前台工具的 tool-call / tool-result 与 skill 注入痕迹。
 * - 不修改当前正在执行的轮次（index >= currentTurnStart）
 * - 不触碰 tvh_/tvc_ 合成历史调用
 * - 严格按 callId 成对剥离，防止协议错配
 * - 非破坏式：无改动时直接返回原 messages 引用
 */
export function cleanContextMessages(messages, options = {}) {
  const settings = normalizeSettings(options)
  if (!settings.enabled || !Array.isArray(messages) || messages.length === 0) {
    return { messages, changed: false, stats: { removedToolCalls: 0, removedToolResults: 0, removedSkillInjections: 0, removedEmptyMessages: 0 } }
  }

  const cutoff = findCurrentTurnStartIndex(messages)
  if (cutoff <= 0) {
    return { messages, changed: false, stats: { removedToolCalls: 0, removedToolResults: 0, removedSkillInjections: 0, removedEmptyMessages: 0 } }
  }

  const extraSet = parseExtraTools(settings.extraTools)

  // keep-latest 策略下：记录每个 skill 在全会话里最后一次出现的索引（含当前轮），
  // 早于该位置的历史重复加载才会被清理。
  const latestSkillCallPos = new Map()
  const latestSkillInjectPos = new Map()
  if (settings.skillPolicy === 'keep-latest') {
    for (let i = 0; i < messages.length; i += 1) {
      const msg = messages[i]
      if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
        for (let b = 0; b < msg.content.length; b += 1) {
          const block = msg.content[b]
          if (block?.type !== 'tool-call') continue
          if (isSyntheticHistoryCallId(toolCallIdOf(block))) continue
          if (classifyToolName(block.name, extraSet) !== 'skill') continue
          const key = extractSkillNameFromCall(block) || `__anon_${block.name}`
          latestSkillCallPos.set(key, `${i}:${b}`)
        }
      } else if (isSkillInjectionMessage(msg)) {
        const key = extractSkillNameFromMessage(msg) || '__anon_inject'
        latestSkillInjectPos.set(key, i)
      }
    }
  }

  // 第一遍：在历史区（index < cutoff）收集要剥离的 tool-call id 和 skill 注入消息索引
  const strippedCallIds = new Set()
  const strippedBlockKeys = new Set()
  const strippedMessageIndices = new Set()

  for (let i = 0; i < cutoff; i += 1) {
    const msg = messages[i]
    if (!msg || typeof msg !== 'object') continue

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (let b = 0; b < msg.content.length; b += 1) {
        const block = msg.content[b]
        if (block?.type !== 'tool-call') continue
        const callId = toolCallIdOf(block)
        if (isSyntheticHistoryCallId(callId)) continue

        const category = classifyToolName(block.name, extraSet)
        if (!category) continue

        let shouldStrip = false
        if (category === 'skill') {
          if (settings.skillPolicy === 'all') {
            shouldStrip = true
          } else if (settings.skillPolicy === 'keep-latest') {
            const key = extractSkillNameFromCall(block) || `__anon_${block.name}`
            shouldStrip = latestSkillCallPos.get(key) !== `${i}:${b}`
          }
        } else {
          shouldStrip = shouldCleanNonSkillCategory(category, settings)
        }

        if (shouldStrip) {
          strippedBlockKeys.add(`${i}:${b}`)
          if (callId) strippedCallIds.add(callId)
        }
      }
    } else if (isSkillInjectionMessage(msg)) {
      let shouldStrip = false
      if (settings.skillPolicy === 'all') {
        shouldStrip = true
      } else if (settings.skillPolicy === 'keep-latest') {
        const key = extractSkillNameFromMessage(msg) || '__anon_inject'
        shouldStrip = latestSkillInjectPos.get(key) !== i
      }
      if (shouldStrip) strippedMessageIndices.add(i)
    }
  }

  if (strippedBlockKeys.size === 0 && strippedMessageIndices.size === 0) {
    return { messages, changed: false, stats: { removedToolCalls: 0, removedToolResults: 0, removedSkillInjections: 0, removedEmptyMessages: 0 } }
  }

  // 第二遍：构建过滤后的 messages，严格成对移除 tool 结果与空壳 assistant 消息
  const stats = {
    removedToolCalls: strippedBlockKeys.size,
    removedToolResults: 0,
    removedSkillInjections: strippedMessageIndices.size,
    removedEmptyMessages: 0
  }

  const nextMessages = []
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i]
    if (i >= cutoff) {
      nextMessages.push(msg)
      continue
    }

    if (strippedMessageIndices.has(i)) continue

    // DSH 0.2: role === 'tool'
    if (msg?.role === 'tool') {
      const resultCallId = toolResultCallIdOf(msg)
      if (resultCallId && strippedCallIds.has(resultCallId)) {
        stats.removedToolResults += 1
        continue
      }
      nextMessages.push(msg)
      continue
    }

    // DSH 0.1.5 兼容: role === 'user' 内嵌 tool-result 块
    if (msg?.role === 'user' && Array.isArray(msg.content) && strippedCallIds.size > 0) {
      let removedHere = 0
      const filtered = msg.content.filter(block => {
        if (block?.type === 'tool-result' && typeof block.toolCallId === 'string' && strippedCallIds.has(block.toolCallId)) {
          removedHere += 1
          return false
        }
        return true
      })
      if (removedHere > 0) {
        stats.removedToolResults += removedHere
        if (filtered.length === 0) {
          stats.removedEmptyMessages += 1
          continue
        }
        nextMessages.push({ ...msg, content: filtered })
        continue
      }
    }

    // assistant 消息移除目标 tool-call 块
    if (msg?.role === 'assistant' && Array.isArray(msg.content)) {
      let touched = false
      const filtered = msg.content.filter((_block, b) => {
        if (strippedBlockKeys.has(`${i}:${b}`)) {
          touched = true
          return false
        }
        return true
      })
      if (touched) {
        if (isAssistantContentEmpty(filtered)) {
          stats.removedEmptyMessages += 1
          continue
        }
        nextMessages.push({ ...msg, content: filtered })
        continue
      }
    }

    nextMessages.push(msg)
  }

  return { messages: nextMessages, changed: true, stats }
}

/**
 * L2：流式正文改写器（供 ctx.tavern.replyRewriter 使用）。
 * 遇到可能未闭合的 XML 残片标签（如 <skill_content ...）时暂缓切分，等待闭合或 eof 后一次性剥离。
 */
export function createStreamingBodyCleaner(resolveSettings) {
  const MAX_HOLD_BUFFER = 16000

  function plan(buffer, { eof = false } = {}) {
    if (typeof buffer !== 'string' || buffer.length === 0) return eof ? 0 : null
    if (eof) return buffer.length

    // 如果缓冲区里出现了已知追踪标签的起始，等待其闭合（防止超长无限缓冲设上限）
    const openMatch = STREAM_TAG_OPEN_RE.exec(buffer)
    if (openMatch) {
      const tagName = openMatch[0].slice(1).toLowerCase()
      const closeTag = `</${tagName}>`
      const closeIndex = buffer.toLowerCase().indexOf(closeTag, openMatch.index)
      if (closeIndex !== -1) {
        return closeIndex + closeTag.length
      }
      if (buffer.length < MAX_HOLD_BUFFER) return null
      return buffer.length
    }

    // 尾部可能是截断的 `<` 标签起始或 fenced JSON 起始，留一点尾巴等下一个 chunk
    const lastLt = buffer.lastIndexOf('<')
    if (lastLt !== -1 && buffer.length - lastLt <= 32) {
      return lastLt > 0 ? lastLt : null
    }

    // 如果有未闭合的 ``` 代码块（可能是工具 JSON 残片），暂缓到闭合或超限
    const fenceCount = (buffer.match(/```/g) || []).length
    if (fenceCount % 2 === 1 && buffer.length < MAX_HOLD_BUFFER) {
      return null
    }

    // 正常文本按段落边界切分，保证流畅流式输出
    const boundary = buffer.lastIndexOf('\n\n')
    if (boundary > 0) return boundary + 2
    const lineEnd = buffer.lastIndexOf('\n')
    if (lineEnd > 0) return lineEnd + 1
    return buffer.length >= 120 ? buffer.length : null
  }

  async function rewrite(text, context = {}) {
    const settings = await resolveSettings(context.sessionId)
    return stripBodyTextTraces(text, settings)
  }

  return { plan, rewrite }
}

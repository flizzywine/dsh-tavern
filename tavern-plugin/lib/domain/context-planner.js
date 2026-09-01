import { projectAgentContent } from './runtime-content-projection.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function playProjector(input, warnings) {
  let macroState = {
    userName: str(input.chat && input.chat.macroState && input.chat.macroState.userName) || '你',
    local: Object.assign({}, input.chat && input.chat.macroState && input.chat.macroState.local || {}),
    global: Object.assign({}, input.chat && input.chat.macroState && input.chat.macroState.global || {})
  }
  return function (text) {
    const result = projectAgentContent(text, {
      charName: str(input.card && input.card.name),
      macroState
    })
    macroState = result.macroState
    warnings.push.apply(warnings, result.warnings)
    return result.agentText
  }
}

export function createContextPlanner(options = {}) {
  if (typeof options.prompt !== 'function') throw new Error('缺少提示词目录')
  const prompt = options.prompt

  function cardSections(input, projectText) {
    const sections = []
    const projectedWorldBook = projectText(input.worldBookContext)
    const worldBookLabel = str(input.worldBookLabel) || '本轮世界书上下文'
    const worldBookSection = projectedWorldBook === '' ? null : { kind: 'world-book', required: false, text: '【' + worldBookLabel + '】\n' + projectedWorldBook }
    const guides = Array.isArray(input.chat.guides) ? input.chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    const projectedGuides = guides.map(function (item) { return projectText(str(item.text).trim()) }).filter(Boolean)
    const guideSection = input.includeGuides === false || projectedGuides.length === 0 ? null : { kind: 'guide', required: true, text: '【用户指导 Guide · 优先遵循】\n' + projectedGuides.map(function (text, index) { return (index + 1) + '. ' + text }).join('\n') }
    const projectedPosture = projectText(input.chat.posture)
    const postureSection = input.includePosture === false || projectedPosture === '' ? null : { kind: 'posture', required: true, text: '【现场 · 主要人物状态（每轮结算更新，务必与之一致）】\n' + projectedPosture }
    const cardInfoSections = []
    const instructionSections = []
    if (input.includeName !== false) cardInfoSections.push({ kind: 'card', required: true, text: '【故事设定 · 人物卡】\n名字: ' + str(input.card.name) })
    if (input.includeDetails === true) {
      if (input.includeDescription !== false) cardInfoSections.push({ kind: 'card', required: false, text: '设定: ' + projectText([str(input.card.description), '{{user}} 表示玩家。'].filter(Boolean).join('\n')) })
      if (input.includePersonality !== false && str(input.card.personality) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '主要人物性格: ' + projectText(input.card.personality) })
      if (input.includeScenario !== false && str(input.card.scenario) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '开场情境: ' + projectText(input.card.scenario) })
      if (input.includeStyleExample !== false && str(input.card.mes_example) !== '') cardInfoSections.push({ kind: 'card', required: false, text: '【文风示例】\n' + projectText(input.card.mes_example) })
    }
    if (input.includeInstructions !== false) {
      if (input.includePostHistory !== false && str(input.card.post_history_instructions) !== '') instructionSections.push({ kind: 'card-instruction', required: true, text: '【附加要求】\n' + projectText(input.card.post_history_instructions) })
      if (input.includeSystemPrompt !== false && str(input.card.system_prompt) !== '') instructionSections.push({ kind: 'card-instruction', required: true, text: '【特殊指令】\n' + projectText(input.card.system_prompt) })
    }
    if (input.stableFirst === true) {
      sections.push.apply(sections, cardInfoSections)
      sections.push.apply(sections, instructionSections)
      if (worldBookSection !== null) sections.push(worldBookSection)
      if (guideSection !== null) sections.push(guideSection)
      if (postureSection !== null) sections.push(postureSection)
    } else {
      if (worldBookSection !== null) sections.push(worldBookSection)
      if (postureSection !== null) sections.push(postureSection)
      if (guideSection !== null) sections.push(guideSection)
      sections.push.apply(sections, cardInfoSections)
      sections.push.apply(sections, instructionSections)
    }
    return sections
  }

  function resultOf(sections, warnings, omitted = []) {
    const projected = sections.map(function (section) { return Object.assign({}, section, { text: str(section.text) }) })
    const text = projected.map(function (section) { return section.text }).filter(Boolean).join('\n\n')
    return {
      text,
      sections: projected,
      audit: {
        included: projected.map(function (section) { return { kind: section.kind, chars: section.text.length, required: section.required === true } }),
        omitted,
        warnings,
        totalChars: text.length
      }
    }
  }

  async function plan(input) {
    const warnings = []
    if (input.purpose === 'play-card-snapshot') {
      const projectText = playProjector(input, warnings)
      return resultOf(cardSections({
        card: input.card,
        chat: input.chat,
        worldBookContext: input.worldBookContext,
        worldBookLabel: input.worldBookLabel,
        includeName: true,
        includeDetails: true,
        includeDescription: true,
        includePersonality: true,
        includeScenario: true,
        includeStyleExample: true,
        includeInstructions: false,
        includeGuides: false,
        includePosture: false,
        stableFirst: true
      }, projectText), warnings)
    }
    if (input.purpose === 'body') {
      const projectText = playProjector(input, warnings)
      const sections = [{
        kind: 'base', required: true,
        text: prompt('story')
      }]
      const projectedReply = (input.chat.messages || []).slice().reverse().find(function (message) {
        return message && message.role === 'assistant' && str(message.sourceText) !== '' && str(message.sourceText) !== str(message.text)
      })
      if (projectedReply !== undefined) {
        // Resolve only identity macros here. Do not execute stateful macros a
        // second time or discard hidden narrative while comparing with history.
        const previousSource = str(projectedReply.sourceText).replace(/\{\{(user|char)\}\}/gi, function (_match, name) {
          return name.toLowerCase() === 'user' ? (str(input.chat.macroState && input.chat.macroState.userName) || '你') : str(input.card.name)
        })
        sections.push({
          kind: 'previous-source', required: true,
          text: '【上一轮正文源文本 · 展示正则已从可见正文移除，续写时保持剧情连续】\n' + previousSource
        })
      }
      sections.push.apply(sections, cardSections({
        card: input.card,
        chat: input.chat,
        worldBookContext: input.worldBookContext,
        includeName: false,
        includeDetails: true,
        includeDescription: false,
        includePersonality: false,
        includeScenario: false,
        includeStyleExample: false,
        includeInstructions: true,
        includeSystemPrompt: true,
        includePostHistory: true
      }, projectText))
      if (input.scriptReference !== null && input.scriptReference !== undefined && str(input.scriptReference.text) !== '') {
        const order = Number(input.scriptReference.order)
        const position = Number.isInteger(order) && order >= 0 ? ' · 第 ' + (order + 1) + ' 块' : ''
        sections.push({ kind: 'script', required: true, text: '【本轮剧本参考' + position + '】\n' + projectText(input.scriptReference.text) })
        sections.push({ kind: 'script', required: true, text: prompt('script-story') })
      }
      return resultOf(sections, warnings, [{ kind: 'stable-card-details', reason: '人物卡基本信息和常驻世界书已固定在游戏会话稳定前缀' }])
    }

    if (input.purpose === 'candidate') {
      const projectText = playProjector(input, warnings)
      const taskSection = { kind: 'candidate-task', required: true, text: str(input.task) }
      const stableSections = []
      const dynamicSections = []
      const plannedCardSections = cardSections({
        card: input.card,
        chat: input.chat,
        worldBookContext: input.constantWorldBookContext,
        worldBookLabel: '常驻世界书',
        includeName: true,
        includeDetails: true,
        includeStyleExample: input.scriptWindow === null || input.scriptWindow === undefined,
        includeInstructions: false,
        stableFirst: true
      }, projectText)
      for (const section of plannedCardSections) {
        if (section.kind === 'guide' || section.kind === 'posture') dynamicSections.push(section)
        else stableSections.push(section)
      }
      if (input.scriptWindow !== null && input.scriptWindow !== undefined) {
        const window = input.scriptWindow
        dynamicSections.push({
          kind: 'script', required: true,
          text: '【剧本候选参考 · 游标 ' + Math.min(window.cursor + 1, window.total) + ' / ' + window.total + '】\n' + (window.ended
            ? '剧本已到结尾。按最近剧情自然收束，或给出一个新场景开头候选。'
            : window.chunks.map(function (chunk) { return '[' + chunk.id + ']\n' + projectText(chunk.text) }).join('\n\n'))
        })
      }
      const systemPromptText = projectText(input.card.system_prompt)
      const postHistoryText = projectText(input.card.post_history_instructions)
      const instructionSections = [
        ...(systemPromptText ? [{ kind: 'card-system-prompt', required: true, text: '【人物卡系统提示】\n' + systemPromptText }] : []),
        ...(postHistoryText ? [{ kind: 'card-post-history', required: true, text: '【人物卡历史后指令】\n' + postHistoryText }] : [])
      ]
      const result = resultOf([taskSection].concat(stableSections, instructionSections, dynamicSections), warnings)
      result.stableText = stableSections.map(function (section) { return str(section.text) }).filter(Boolean).join('\n\n')
      result.dynamicText = dynamicSections.map(function (section) { return str(section.text) }).filter(Boolean).join('\n\n')
      result.taskText = taskSection.text
      result.systemPromptText = systemPromptText
      result.postHistoryText = postHistoryText
      return result
    }

    if (input.purpose === 'card') {
      const prepared = input.sourcePrepared
      const sections = []
      if (prepared !== null && typeof prepared === 'object' && Array.isArray(prepared.window) && prepared.window.length > 0) {
        sections.push({ kind: 'card-source', required: true, text: '【本轮挂载资料 · 第 ' + (Number(prepared.cursorBefore) + 1) + '~' + (Number(prepared.cursorBefore) + prepared.window.length) + ' 块 / 共 ' + prepared.total + ' 块】\n' + prepared.window.map(function (chunk) { return '[' + chunk.title + '] ' + chunk.text }).join('\n\n') })
      }
      return resultOf(sections, warnings)
    }

    throw new Error('未知上下文用途: ' + str(input.purpose))
  }

  return Object.freeze({ plan })
}

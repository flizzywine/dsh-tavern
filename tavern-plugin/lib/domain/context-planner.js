import { promptSection } from './prompt-section.js'
import { postureForContext } from './posture-context.js'
import { projectAgentContent } from './runtime-content-projection.js'
import { cardSystemPromptText } from './card-system-prompt.js'
import { styleReferenceSource } from './style-reference.js'
import { variableUpdateText } from './variable-update.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Worldbook context for this turn",
  p002: "User Guide (takes priority):\n",
  p003: "Main characters' current state (settled every turn; stay consistent with it):\n",
  p004: "Name: ",
  p005: "Description: ",
  p006: "{{user}} is the player.",
  p007: "Personality: ",
  p008: "Opening scenario: ",
  p009: "Style examples:\n",
  p010: "Card instructions:\n",
  p011: " · chunk ",
  p012: "",
  p013: "Script reference for this turn",
  p014: "Script reference for staging (unplayed content is not a story fact)",
  p015: "Script reference for choices",
  p016: " · cursor ",
  p017: "The script has ended. Stage only from the finished story text.",
  p018: "The script has ended. Wrap up naturally from the recent story, or offer a choice opening a new scene.",
  p019: "Card instructions:\n",
  p020: "Material for this turn: chunks ",
  p021: " of ",
  p022: "\n"
})


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
    // Rendered worldbook entries have already crossed the runtime projection seam.
    const entries = input.worldBookEntries?.filter(entry => entry.location === 'foreground')
    const projectedWorldBook = entries ? entries.map(entry => entry.text).join('\n\n') : projectText(input.worldBookContext)
    const worldBookSection = projectedWorldBook === '' ? null : { kind: 'world-book', required: false, text: promptSection(input.stableFirst ? 'constant_worldbook' : 'worldbook_context', projectedWorldBook), ...(entries ? { entries } : {}) }
    const guides = Array.isArray(input.chat.guides) ? input.chat.guides.filter(function (item) { return item !== null && typeof item === 'object' && str(item.text).trim() !== '' }) : []
    const projectedGuides = guides.map(function (item) { return projectText(str(item.text).trim()) }).filter(Boolean)
    const guideSection = input.includeGuides === false || projectedGuides.length === 0 ? null : { kind: 'guide', required: true, text: promptSection('user_guide', PROMPT_PROSE.p002 + projectedGuides.map(function (text, index) { return (index + 1) + '. ' + text }).join('\n')) }
    const projectedPosture = input.includePosture === false ? '' : projectText(postureForContext(input.chat))
    const postureSection = input.includePosture === false || projectedPosture === '' ? null : { kind: 'posture', required: true, text: promptSection('character_state', PROMPT_PROSE.p003 + projectedPosture) }
    const cardInfoSections = []
    const instructionSections = []
    if (input.includeName !== false) cardInfoSections.push({ kind: 'card', required: true, text: promptSection('character_card', PROMPT_PROSE.p004 + str(input.card.name)) })
    if (input.includeDetails === true) {
      if (input.includeDescription !== false) cardInfoSections.push({ kind: 'card', required: false, text: promptSection('character_description', PROMPT_PROSE.p005 + projectText([str(input.card.description), PROMPT_PROSE.p006].filter(Boolean).join('\n'))) })
      if (input.includePersonality !== false && str(input.card.personality) !== '') cardInfoSections.push({ kind: 'card', required: false, text: promptSection('character_personality', PROMPT_PROSE.p007 + projectText(input.card.personality)) })
      if (input.includeScenario !== false && str(input.card.scenario) !== '') cardInfoSections.push({ kind: 'card', required: false, text: promptSection('opening_scenario', PROMPT_PROSE.p008 + projectText(input.card.scenario)) })
      if (input.includeStyleExample !== false && str(input.card.mes_example) !== '') cardInfoSections.push({ kind: 'card', required: false, text: promptSection('style_examples', PROMPT_PROSE.p009 + projectText(input.card.mes_example)) })
    }
    if (input.includeInstructions !== false) {
      if (input.includePostHistory !== false && str(input.card.post_history_instructions) !== '') instructionSections.push({ kind: 'card-instruction', required: true, text: promptSection('post_history', PROMPT_PROSE.p010 + projectText(input.card.post_history_instructions)) })
      if (input.includeSystemPrompt !== false && str(input.card.system_prompt) !== '') instructionSections.push({ kind: 'card-system-prompt', required: true, text: cardSystemPromptText(projectText(input.card.system_prompt)) })
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
        includeName: true,
        includeDetails: true,
        includeDescription: true,
        includePersonality: true,
        includeScenario: true,
        includeStyleExample: true,
        includeInstructions: true,
        includePostHistory: false,
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
      sections.push.apply(sections, cardSections({
        card: input.card,
        chat: input.chat,
        worldBookContext: input.worldBookContext,
        worldBookEntries: input.worldBookEntries,
        includeName: false,
        includeDetails: true,
        includeDescription: false,
        includePersonality: false,
        includeScenario: false,
        includeStyleExample: false,
        includeInstructions: true,
        includeSystemPrompt: false,
        includePostHistory: true
      }, projectText))
      const systemPromptText = projectText(input.card.system_prompt)
      if (input.scriptReference !== null && input.scriptReference !== undefined && str(input.scriptReference.text) !== '') {
        const order = Number(input.scriptReference.order)
        const position = Number.isInteger(order) && order >= 0 ? PROMPT_PROSE.p011 + (order + 1) + PROMPT_PROSE.p012 : ''
        sections.push({ kind: 'script', required: true, text: promptSection('script_reference', PROMPT_PROSE.p013 + position + '\n' + projectText(input.scriptReference.text)) })
        sections.push({ kind: 'script', required: true, text: prompt('script-story') })
      }
      if (input.variableUpdate) sections.push({ kind: 'variable-update', required: true, text: variableUpdateText(input.variableUpdate) })
      const style = input.styleReference
      if (style && str(style.quote) !== '') {
        sections.push({ kind: 'style-reference', required: false, text: '【文风联想' + (styleReferenceSource(style) ? ' · ' + styleReferenceSource(style) : '') + '】\n' + str(style.quote) })
        sections.push({ kind: 'style-reference', required: false, text: prompt('style-reference') })
      }
      const result = resultOf(sections, warnings, [{ kind: 'stable-card-details', reason: '人物卡基本信息、系统提示和常驻世界书已固定在游戏会话稳定前缀；系统提示变化时另行追加' }])
      result.systemPromptText = systemPromptText
      return result
    }

    if (input.purpose === 'candidate' || input.purpose === 'stage-director') {
      const director = input.purpose === 'stage-director'
      const projectText = playProjector(input, warnings)
      const taskSection = { kind: director ? 'stage-task' : 'candidate-task', required: true, text: str(input.task) }
      const stableSections = []
      const dynamicSections = []
      let candidateScriptWindow
      const plannedCardSections = cardSections({
        card: input.card,
        chat: input.chat,
        worldBookContext: input.constantWorldBookContext,
        includeName: true,
        includeDetails: true,
        includeStyleExample: director || input.scriptWindow === null || input.scriptWindow === undefined,
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
          text: promptSection('script_window', (director ? PROMPT_PROSE.p014 : PROMPT_PROSE.p015) + PROMPT_PROSE.p016 + Math.min(window.cursor + 1, window.total) + ' / ' + window.total + '\n' + (window.ended
            ? (director ? PROMPT_PROSE.p017 : PROMPT_PROSE.p018)
            : window.chunks.map(function (chunk) { return '[' + chunk.id + ']\n' + projectText(chunk.text) }).join('\n\n')))
        })
        if (!director && !window.ended && window.chunks.length) {
          const text = dynamicSections.at(-1).text
          candidateScriptWindow = { text, heading: text.split('\n').slice(0, 2).join('\n'), positions: window.chunks.map((_, index) => window.cursor + index + 1) }
        }
      }
      const systemPromptText = projectText(input.card.system_prompt)
      if (systemPromptText.trim()) stableSections.push({ kind: 'card-system-prompt', required: true, text: cardSystemPromptText(systemPromptText) })
      const postHistoryText = projectText(input.card.post_history_instructions)
      const instructionSections = [
        ...(postHistoryText ? [{ kind: 'card-post-history', required: true, text: promptSection('post_history', PROMPT_PROSE.p019 + postHistoryText) }] : [])
      ]
      const result = resultOf([taskSection].concat(stableSections, instructionSections, dynamicSections), warnings)
      result.stableText = stableSections.map(function (section) { return str(section.text) }).filter(Boolean).join('\n\n')
      result.candidateScriptWindow = candidateScriptWindow
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
        sections.push({ kind: 'card-source', required: true, text: promptSection('card_source', PROMPT_PROSE.p020 + (Number(prepared.cursorBefore) + 1) + '~' + (Number(prepared.cursorBefore) + prepared.window.length) + PROMPT_PROSE.p021 + prepared.total + PROMPT_PROSE.p022 + prepared.window.map(function (chunk) { return '[' + chunk.title + '] ' + chunk.text }).join('\n\n')) })
      }
      return resultOf(sections, warnings)
    }

    throw new Error('未知上下文用途: ' + str(input.purpose))
  }

  return Object.freeze({ plan })
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function role(value) {
  return value === 'user' || value === 'assistant' ? value : 'system'
}

function macro(text, resolveMacros, state, card) {
  const result = resolveMacros(str(text), { charName: str(card.name), macroState: state })
  state.userName = result.macroState.userName
  state.local = result.macroState.local
  state.global = result.macroState.global
  return { text: result.text, diagnostics: result.diagnostics || [] }
}

function exampleMessages(value, options = {}) {
  let source = str(value)
  if (source === '' || source === '<START>') return []
  source = source
    .replace(/{{\s*user\s*}}/gi, str(options.userName))
    .replace(/{{\s*char\s*}}/gi, str(options.charName))
  if (!source.startsWith('<START>')) source = '<START>\n' + source.trim()
  const blocks = source.split(/<START>/i).slice(1)
  const messages = []
  for (const block of blocks) {
    const parsed = []
    let current = null
    function flush() {
      if (current === null) return
      const content = current.lines.join('\n').trim()
      if (content !== '') parsed.push({ role: 'system', content, name: current.name })
      current = null
    }
    for (const line of block.trim().replace(/\r/g, '').split('\n')) {
      const userPrefix = str(options.userName) + ':'
      const charPrefix = str(options.charName) + ':'
      if (userPrefix !== ':' && line.startsWith(userPrefix)) {
        flush()
        current = { name: 'example_user', lines: [line.slice(userPrefix.length).trimStart()] }
      } else if (charPrefix !== ':' && line.startsWith(charPrefix)) {
        flush()
        current = { name: 'example_assistant', lines: [line.slice(charPrefix.length).trimStart()] }
      } else if (current !== null) {
        current.lines.push(line)
      }
    }
    flush()
    if (parsed.length === 0) continue
    messages.push({ role: 'system', content: str(options.newExampleChatPrompt) })
    messages.push(...parsed)
  }
  return messages
}

function markerMessages(identifier, input) {
  const card = input.card
  const settings = input.settings
  switch (identifier) {
    case 'worldInfoBefore': return input.worldInfoBefore ? [{ role: 'system', content: input.worldInfoBefore }] : []
    case 'worldInfoAfter': return input.worldInfoAfter ? [{ role: 'system', content: input.worldInfoAfter }] : []
    case 'charDescription': return str(card.description).trim() ? [{ role: 'system', content: card.description }] : []
    case 'charPersonality': {
      const value = str(card.personality).trim()
      if (!value) return []
      const format = str(settings.personality_format)
      return [{ role: 'system', content: format ? format.replace(/{{\s*personality\s*}}/gi, value) : value }]
    }
    case 'scenario': {
      const value = str(card.scenario).trim()
      if (!value) return []
      const format = str(settings.scenario_format)
      return [{ role: 'system', content: format ? format.replace(/{{\s*scenario\s*}}/gi, value) : value }]
    }
    case 'personaDescription': return input.persona ? [{ role: 'system', content: input.persona }] : []
    case 'dialogueExamples': return exampleMessages(card.mes_example, {
      userName: input.userName,
      charName: card.name,
      newExampleChatPrompt: settings.new_example_chat_prompt
    })
    case 'chatHistory': return input.history
    default: return null
  }
}

function overrideContent(entry, card) {
  if (entry.forbidOverrides !== true && entry.identifier === 'main' && str(card.system_prompt).trim() !== '') return card.system_prompt
  if (entry.forbidOverrides !== true && entry.identifier === 'jailbreak' && str(card.post_history_instructions).trim() !== '') return card.post_history_instructions
  return entry.content
}

/**
 * Compile one foreground request at the SillyTavern prompt-order seam.
 * Callers provide resources and projections; this module owns ordering,
 * marker expansion, role preservation and absolute-depth insertion.
 */
export function compileSillyTavernRequest(options = {}) {
  const card = options.card && typeof options.card === 'object' ? options.card : {}
  const preset = options.preset && typeof options.preset === 'object' ? options.preset : {}
  const settings = options.presetDocument && typeof options.presetDocument === 'object' ? options.presetDocument : {}
  const resolveMacros = typeof options.resolveMacros === 'function'
    ? options.resolveMacros
    : function (text, context) { return { text: str(text), diagnostics: [], macroState: context.macroState } }
  const projectPromptText = typeof options.projectPromptText === 'function'
    ? options.projectPromptText
    : function (text) { return { text: str(text), warnings: [], applied: [] } }
  const state = {
    userName: str(options.userName).trim() || '你',
    local: Object.assign({}, options.macroState && options.macroState.local || {}),
    global: Object.assign({}, options.macroState && options.macroState.global || {})
  }
  const diagnostics = []
  const history = (Array.isArray(options.history) ? options.history : []).map(function (item) {
    const sourceText = str(item.sourceText || item.text || item.content)
    return { role: role(item.role), content: sourceText, source: { kind: 'chat-history' } }
  })
  const inputText = str(options.input).trim()
  if (inputText !== '') {
    history.push({ role: 'user', content: inputText, source: { kind: 'current-input' } })
  }
  for (const [index, item] of history.entries()) {
    const rendered = macro(item.content, resolveMacros, state, card)
    const messageRole = role(item.role)
    const depth = history.length - index - 1
    const placement = messageRole === 'user' ? 1 : (messageRole === 'assistant' ? 2 : null)
    const projected = placement === null
      ? { text: rendered.text, warnings: [] }
      : projectPromptText(rendered.text, { role: messageRole, placement, depth, sourceKind: item.source.kind })
    diagnostics.push(...rendered.diagnostics, ...(projected.warnings || []))
    item.content = projected.text
    item.source.depth = depth
  }

  const selected = (Array.isArray(preset.entries) ? preset.entries : []).filter(function (entry) {
    return entry && entry.ordered === true && entry.enabled === true
  })
  const regular = []
  const absolute = []
  for (const entry of selected) {
    if (Number(entry.injectionPosition) === 1 && entry.marker !== true) absolute.push(entry)
    else regular.push(entry)
  }
  absolute.sort(function (left, right) {
    return (Number(right.injectionDepth) || 0) - (Number(left.injectionDepth) || 0) || (Number(left.injectionOrder) || 0) - (Number(right.injectionOrder) || 0)
  })
  for (const entry of absolute) {
    const rendered = macro(overrideContent(entry, card), resolveMacros, state, card)
    diagnostics.push(...rendered.diagnostics)
    if (rendered.text.trim() === '') continue
    history.splice(Math.max(0, history.length - (Number(entry.injectionDepth) || 0)), 0, {
      role: role(entry.role), content: rendered.text,
      source: { kind: 'preset-depth', entryKey: entry.entryKey, identifier: entry.identifier, depth: Number(entry.injectionDepth) || 0 }
    })
  }

  const messages = []
  for (const entry of regular) {
    const marker = markerMessages(str(entry.identifier), {
      card, settings, history,
      userName: state.userName,
      persona: str(options.persona),
      worldInfoBefore: str(options.worldInfoBefore),
      worldInfoAfter: str(options.worldInfoAfter)
    })
    const values = marker === null ? [{ role: entry.role, content: overrideContent(entry, card) }] : marker
    for (const value of values) {
      const alreadyProjected = value.source && (value.source.kind === 'chat-history' || value.source.kind === 'current-input' || value.source.kind === 'preset-depth')
      const rendered = alreadyProjected ? { text: value.content, diagnostics: [] } : macro(value.content, resolveMacros, state, card)
      diagnostics.push(...rendered.diagnostics)
      if (rendered.text.trim() === '') continue
      messages.push({
        role: role(value.role), content: rendered.text,
        ...(value.name ? { name: value.name } : {}),
        source: { kind: entry.marker ? 'marker' : 'preset', entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
      })
    }
  }

  return {
    messages,
    macroState: state,
    diagnostics,
    trace: {
      presetPath: str(options.presetPath),
      presetTitle: str(preset.title),
      selectedEntryKeys: selected.map(function (entry) { return entry.entryKey }),
      promptOrderGroupIndex: Number.isInteger(preset.orderGroupIndex) ? preset.orderGroupIndex : null,
      sourceRevision: str(options.sourceRevision)
    }
  }
}

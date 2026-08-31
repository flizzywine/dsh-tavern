function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function promptOverride(document, name) {
  const value = object(document.promptOverrides)[name]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function applyTavernSettingsPatch(current, patch) {
  const next = Object.assign({}, object(current))
  const input = object(patch)
  if (Object.prototype.hasOwnProperty.call(input, 'compatibilityMode')) next.compatibilityMode = input.compatibilityMode === true
  const legacyStory = Object.prototype.hasOwnProperty.call(input, 'storyPrompt') ? { name: 'story', text: input.storyPrompt } : null
  const promptChange = Object.prototype.hasOwnProperty.call(input, 'systemPrompt') ? object(input.systemPrompt) : legacyStory
  if (promptChange !== null) {
    const name = typeof promptChange.name === 'string' ? promptChange.name : ''
    if (name === '') throw new Error('系统提示词名称不能为空')
    const overrides = Object.assign({}, object(next.promptOverrides))
    if (promptChange.text === null) {
      delete overrides[name]
    } else {
      if (typeof promptChange.text !== 'string' || promptChange.text.trim() === '') throw new Error('系统提示词不能为空')
      if (promptChange.text.length > 100000) throw new Error('系统提示词不能超过 100000 字符')
      overrides[name] = promptChange.text.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Object.prototype.hasOwnProperty.call(input, 'systemPrompts')) {
    const values = object(input.systemPrompts)
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const [name, value] of Object.entries(values)) {
      if (typeof value !== 'string' || value.trim() === '') throw new Error('系统提示词不能为空: ' + name)
      if (value.length > 100000) throw new Error('系统提示词不能超过 100000 字符: ' + name)
      overrides[name] = value.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  if (Array.isArray(input.resetSystemPrompts)) {
    const overrides = Object.assign({}, object(next.promptOverrides))
    for (const name of input.resetSystemPrompts) delete overrides[name]
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  } else if (input.resetSystemPrompts === true) delete next.promptOverrides
  return next
}

export function presentTavernSettings(document, defaults) {
  const prompts = Object.keys(object(defaults)).map(function (name) {
    const custom = promptOverride(object(document), name)
    return { name, text: custom === null ? String(defaults[name] || '') : custom, customized: custom !== null }
  })
  const story = prompts.find(function (item) { return item.name === 'story' }) || { text: '', customized: false }
  return {
    compatibilityMode: object(document).compatibilityMode === true,
    // Card rendering uses a fixed trusted policy; legacy preferences are no longer applied.
    trustedCardMode: true,
    systemPrompts: prompts,
    storyPrompt: story.text,
    storyPromptCustomized: story.customized
  }
}

export function resolveSystemPrompt(document, name, fallback) {
  const custom = promptOverride(object(document), name)
  if (custom !== null) return custom
  return fallback(name)
}

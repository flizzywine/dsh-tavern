function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function storyOverride(document) {
  const value = object(document.promptOverrides).story
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function applyTavernSettingsPatch(current, patch) {
  const next = Object.assign({}, object(current))
  const input = object(patch)
  if (Object.prototype.hasOwnProperty.call(input, 'compatibilityMode')) next.compatibilityMode = input.compatibilityMode === true
  if (Object.prototype.hasOwnProperty.call(input, 'storyPrompt')) {
    const overrides = Object.assign({}, object(next.promptOverrides))
    if (input.storyPrompt === null) {
      delete overrides.story
    } else {
      if (typeof input.storyPrompt !== 'string' || input.storyPrompt.trim() === '') throw new Error('正文 Agent 核心提示词不能为空')
      if (input.storyPrompt.length > 100000) throw new Error('正文 Agent 核心提示词不能超过 100000 字符')
      overrides.story = input.storyPrompt.trim()
    }
    if (Object.keys(overrides).length === 0) delete next.promptOverrides
    else next.promptOverrides = overrides
  }
  return next
}

export function presentTavernSettings(document, defaults) {
  const customStory = storyOverride(object(document))
  return {
    compatibilityMode: document && document.compatibilityMode === true,
    storyPrompt: customStory === null ? String(object(defaults).story || '') : customStory,
    storyPromptCustomized: customStory !== null
  }
}

export function resolveSystemPrompt(document, name, fallback) {
  if (name === 'story') {
    const customStory = storyOverride(object(document))
    if (customStory !== null) return customStory
  }
  return fallback(name)
}

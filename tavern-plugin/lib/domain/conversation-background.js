import { configuredChatBackgroundModel, normalizeBackgroundModel } from './background-model-selection.js'
import { normalizeDisabledForegroundTools } from './foreground-tools.js'
import { normalizeConfiguredBackgroundTasks } from './tavern-settings.js'

// Legacy settings are read only when adopting an old save. New games own defaults.
export function adoptConversationBackground(chat, legacy = {}) {
  if (chat.backgroundConfigVersion === 1) return chat
  return { ...chat, backgroundConfigVersion: 1,
    backgroundModelSelection: configuredChatBackgroundModel(chat, legacy),
    backgroundTasks: normalizeConfiguredBackgroundTasks(chat.backgroundTasks || legacy.backgroundTasks) }
}

export function patchConversationBackground(chat, patch) {
  const next = { ...chat, backgroundConfigVersion: 1 }
  if (Object.hasOwn(patch, 'backgroundModel')) {
    next.backgroundModelSelection = normalizeBackgroundModel(patch.backgroundModel)
    if (patch.backgroundModel !== null && !next.backgroundModelSelection) throw new Error('后台模型配置无效')
  }
  if (Object.hasOwn(patch, 'worldbookStrategy')) {
    if (typeof patch.worldbookStrategy !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(patch.worldbookStrategy) || patch.worldbookStrategy.length > 96) throw new Error('世界书策略配置无效')
    next.worldbookStrategy = patch.worldbookStrategy === 'legacy' ? 'native-skills' : patch.worldbookStrategy
  }
  if (Object.hasOwn(patch, 'backgroundTasks')) {
    next.backgroundTasks = normalizeConfiguredBackgroundTasks({ ...normalizeConfiguredBackgroundTasks(chat.backgroundTasks), ...patch.backgroundTasks })
  }
  if (Object.hasOwn(patch, 'webSearchEnabled')) {
    if (typeof patch.webSearchEnabled !== 'boolean') throw new Error('开关配置必须为布尔值')
    next.webSearchEnabled = patch.webSearchEnabled
  }
  if (Object.hasOwn(patch, 'disabledForegroundTools')) {
    if (!Array.isArray(patch.disabledForegroundTools)) throw new Error('前台工具配置无效')
    next.disabledForegroundTools = normalizeDisabledForegroundTools(patch.disabledForegroundTools)
  }
  return next
}

export function adoptConversationFeatures(chat, legacy = {}) {
  if (chat.conversationFeaturesVersion === 1) return chat
  return { ...chat, conversationFeaturesVersion: 1, webSearchEnabled: legacy?.webSearchEnabled === true }
}

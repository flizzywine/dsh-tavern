import { configuredChatBackgroundModel, normalizeBackgroundModel } from './background-model-selection.js'
import { normalizeBackgroundTasks } from './tavern-settings.js'

// Legacy settings are read only when adopting an old save. New games own defaults.
export function adoptConversationBackground(chat, legacy = {}) {
  if (chat.backgroundConfigVersion === 1) return chat
  return { ...chat, backgroundConfigVersion: 1,
    backgroundModelSelection: configuredChatBackgroundModel(chat, legacy),
    backgroundTasks: normalizeBackgroundTasks(chat.backgroundTasks || legacy.backgroundTasks) }
}

export function patchConversationBackground(chat, patch) {
  const next = { ...chat, backgroundConfigVersion: 1 }
  if (Object.hasOwn(patch, 'backgroundModel')) {
    next.backgroundModelSelection = normalizeBackgroundModel(patch.backgroundModel)
    if (patch.backgroundModel !== null && !next.backgroundModelSelection) throw new Error('后台模型配置无效')
  }
  if (Object.hasOwn(patch, 'imageModel')) {
    // null follows the foreground model (at the lightest reasoning level).
    next.imageModelSelection = normalizeBackgroundModel(patch.imageModel)
    if (patch.imageModel !== null && !next.imageModelSelection) throw new Error('生图 Agent 模型配置无效')
  }
  if (Object.hasOwn(patch, 'backgroundTasks')) {
    next.backgroundTasks = normalizeBackgroundTasks({ ...normalizeBackgroundTasks(chat.backgroundTasks), ...patch.backgroundTasks })
  }
  for (const name of ['webSearchEnabled', 'sceneImagesEnabled']) {
    if (Object.hasOwn(patch, name)) {
      if (typeof patch[name] !== 'boolean') throw new Error('开关配置必须为布尔值')
      next[name] = patch[name]
    }
  }
  return next
}

export function adoptConversationFeatures(chat, legacy = {}, legacyImageEnabled = false) {
  if (chat.conversationFeaturesVersion === 1) return chat
  return { ...chat, conversationFeaturesVersion: 1, webSearchEnabled: legacy?.webSearchEnabled === true, sceneImagesEnabled: legacyImageEnabled === true }
}

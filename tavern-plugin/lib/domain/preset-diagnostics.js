import { applyRegexOverrides } from './regex-manager.js'

/** Export the conversation-owned snapshot, never today's library selection. */
export function createPresetDiagnostics(chat, extensions = {}, now = Date.now()) {
  const snapshot = chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object' ? chat.runtimePresetSnapshot : null
  const globals = extensions.globalRegexScripts || []
  const cardRules = extensions.regexScripts || []
  const presetRules = applyRegexOverrides(Array.isArray(snapshot?.regexScripts) ? snapshot.regexScripts : [], chat.regexOverrides && chat.regexOverrides.preset, 'preset')
  const globalRule = rule => globals.some(item => item === rule ||
    (item.ref && item.ref === rule.ref) || (item.id && item.id === rule.id))
  return {
    version: 1, capturedAt: now, source: 'conversation-snapshot-at-export',
    chatId: chat.id, requestMode: chat.requestMode, preset: snapshot,
    regex: {
      scope: 'reply-display',
      note: '导出时的渲染管线顺序；每条规则仍按启用状态、placement、markdownOnly、promptOnly 和楼层深度筛选，不表示在每层都命中。人物卡及全局规则来自导出时配置，不保证等同故障时配置。',
      character: extensions.characterRegexScripts || [], global: globals, preset: presetRules,
      ordered: [
        ...cardRules.map(rule => ({ source: globalRule(rule) ? 'global' : 'character', rule })),
        ...presetRules.map(rule => ({ source: 'preset', rule }))
      ].map((item, index) => ({ order: index + 1, ...item }))
    }
  }
}

import { statusViewDeclaration } from '../../../domain/status-view-declaration.js'
import { executeTemplateSlash } from './commands.js'
import { createTemplateDOMServices } from './dom.js'
import { renderTavernMacros } from '../../../domain/tavern-macro-engine.js'
import { applyTavernRegexText } from '../../../domain/tavern-regex-display.js'
import { chat_metadata, extension_settings, name1, name2 } from './host.js'

export function createTemplateServices(context, rpc) {
  return {
    ...createTemplateDOMServices(),
    getUserAvatar: () => context()?.user_avatar || '',
    getCharaFilename: () => context()?.dsh?.cardPath || '',
    getChatCompletionModel: () => context()?.dsh?.model || '',
    getThumbnailUrl: (_kind, file) => file || '',
    substituteParams(value) {
      const result = renderTavernMacros(String(value), { charName: name2, userName: name1,
        localVariables: chat_metadata.variables || {}, globalVariables: extension_settings.variables?.global || {} })
      chat_metadata.variables = result.localVariables
      extension_settings.variables ||= {}
      extension_settings.variables.global = result.globalVariables
      return result.text
    },
    getRegexedString(value, placement, options = {}) {
      const scripts = [...(extension_settings.regex || []), ...(context()?.dsh?.regexScripts || [])]
      const displayScripts = options.statusBoundaries ? scripts.map((rule, index) => {
        const declaration = statusViewDeclaration(rule)
        if (!declaration || !/<(?:script|iframe|object|embed)\b/i.test(rule.replaceString || '')) return rule
        const content = String(rule.replaceString).replace(/^\s*```(?:html|htm)?\s*\n([\s\S]*?)\n```\s*$/i, '$1')
        return {...rule,replaceString:`<div data-dsh-template-status="${index}" data-dsh-status-key="${encodeURIComponent(declaration.key)}">${content}</div>`}
      }) : scripts
      return applyTavernRegexText(value, displayScripts, { ...options, placement }).text
    },
    getTokenCountAsync: value => rpc('countFullTemplateTokens', { text: String(value) }).then(result => result.tokens),
    executeSlashCommandsWithOptions: source => executeTemplateSlash(source, text => rpc('executeTemplateHostCommand', { text })),
    copyText: value => navigator.clipboard.writeText(String(value))
  }
}

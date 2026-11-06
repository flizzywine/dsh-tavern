import { prompt as promptFile, SYSTEM_PROMPT_DEFINITIONS } from '../prompt-catalog.js'

// Documents carry resolved text; imported sets retain only overrides so future
// shipped prompt improvements still reach entries left at their defaults.
export function createSystemPromptDocuments({ definitions = SYSTEM_PROMPT_DEFINITIONS, prompt = promptFile } = {}) {
  const names = definitions.map(item => item.name)
  function presentSystemPrompts(settings) {
    const byName = Object.fromEntries((settings.systemPrompts || []).map(function (item) { return [item.name, item] }))
    return {
      spec: 'dsh-tavern.system-prompts',
      version: 1,
      systemAppendEnabled: settings.systemAppendEnabled === true,
      promptSets: settings.promptSets,
      prompts: definitions.map(function (definition) {
        return Object.assign({}, definition, byName[definition.name] || { text: prompt(definition.name), customized: false })
      })
    }
  }
  function systemPromptSetFromDocument(document, fallbackName) {
    if (!document || document.spec !== 'dsh-tavern.system-prompts') throw new Error('不是 DSH Tavern 系统提示词文件')
    if (Number(document.version) !== 1) throw new Error('不支持的系统提示词版本: ' + String(document.version))
    const source = document.prompts && typeof document.prompts === 'object' && !Array.isArray(document.prompts) ? document.prompts : {}
    const values = {}
    for (const name of names) {
      if (name === 'system-append' && source[name] === undefined) continue
      if (typeof source[name] !== 'string' || (source[name].trim() === '' && name !== 'system-append')) throw new Error('系统提示词文件缺少有效内容: ' + name)
      if (source[name].length > 100000) throw new Error('系统提示词不能超过 100000 字符: ' + name)
      // Store only what differs from this version's defaults, so later default updates still apply.
      if (source[name].trim() !== prompt(name).trim()) values[name] = source[name]
    }
    const name = typeof document.name === 'string' && document.name.trim() ? document.name.trim().slice(0, 80) : fallbackName
    return { action: 'add', name, promptOverrides: values, systemAppendEnabled: document.systemAppendEnabled !== false }
  }
  function exportSystemPromptDocument(settings) {
    const current = presentSystemPrompts(settings)
    const active = settings.promptSets.sets.find(set => set.active)
    return { spec: current.spec, version: current.version, name: active ? active.name : '系统提示词', systemAppendEnabled: current.systemAppendEnabled, prompts: Object.fromEntries(current.prompts.map(function (item) { return [item.name, item.text] })) }
  }
  return Object.freeze({ present: presentSystemPrompts, import: systemPromptSetFromDocument, export: exportSystemPromptDocument })
}

import { compileSillyTavernRequest, createCleanCompatibilityPreset } from './sillytavern-compatibility.js'
import { resolveRuntimeMacroText } from './runtime-content-projection.js'
import { prepareWorldBookRecall } from './worldbook-recall.js'
import { promptOrder } from './worldbook-activation.js'
import { applyTavernHelperVariableMacros } from './tavern-helper-variable-macros.js'
import { lastTavernHelperVariables, projectTavernHelperContext } from './tavern-helper-context.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { nativeRegexScriptsOf } from './preset-reading.js'

const fields = { char_description: 'description', char_personality: 'personality', scenario: 'scenario', dialogue_examples: 'mes_example' }
const textOverrides = new Set([...Object.keys(fields), 'world_info_before', 'world_info_after', 'persona_description'])
const positions = { before_char: 0, before: 0, after_char: 1, before_an: 2, after_an: 3, at_depth: 4, in_chat: 4, before_example: 5, after_example: 6, outlet: 7 }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value, label) { if (typeof value !== 'string') throw new Error(label + ' 必须是文本'); return value }
function prompt(value) {
  if (!object(value) || !['system', 'user', 'assistant'].includes(value.role) || Object.keys(value).some(key => !['role', 'content'].includes(key))) throw new Error('generate 只接受 system/user/assistant 文本提示词')
  return { role: value.role, content: text(value.content, 'content') }
}

export function validateHelperGenerateConfig(config) {
  if (!object(config)) throw new Error('generate 参数必须是对象')
  const allowed = new Set(['preset_name', 'generation_id', 'user_input', 'should_stream', 'should_silence', 'overrides', 'injects', 'max_chat_history', 'custom_api'])
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error('generate 暂不支持参数：' + key)
  for (const key of ['preset_name', 'generation_id', 'user_input']) if (config[key] !== undefined) text(config[key], key)
  for (const key of ['should_stream', 'should_silence']) if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new Error(key + ' 必须是布尔值')
  if (config.custom_api !== undefined && !object(config.custom_api)) throw new Error('custom_api 必须是对象')
  const limit = config.max_chat_history ?? 'all'
  if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('max_chat_history 必须是非负整数或 all')
  if (config.overrides !== undefined && !object(config.overrides)) throw new Error('overrides 必须是对象')
  for (const [key, value] of Object.entries(config.overrides || {})) {
    if (textOverrides.has(key)) text(value, key)
    else if (key === 'chat_history' && object(value)) {
      for (const [name, item] of Object.entries(value)) {
        if (name === 'with_depth_entries' && typeof item === 'boolean') continue
        if (name === 'author_note') { text(item, name); continue }
        if (name === 'prompts' && Array.isArray(item)) { item.forEach(prompt); continue }
        throw new Error('generate 暂不支持聊天覆盖项：' + name)
      }
    } else throw new Error('generate 暂不支持覆盖项：' + key)
  }
  if (config.injects !== undefined && !Array.isArray(config.injects)) throw new Error('injects 必须是数组')
  for (const entry of config.injects || []) {
    if (!object(entry) || Object.keys(entry).some(key => !['role', 'content', 'position', 'depth', 'should_scan'].includes(key))) throw new Error('generate 不支持此注入参数')
    prompt({ role: entry.role, content: entry.content })
    if (!['in_chat', 'none'].includes(entry.position)) throw new Error('generate 不支持此注入位置')
    if (entry.depth !== undefined && (!Number.isSafeInteger(entry.depth) || entry.depth < 0)) throw new Error('注入 depth 必须是非负整数')
    if (entry.should_scan !== undefined && typeof entry.should_scan !== 'boolean') throw new Error('should_scan 必须是布尔值')
  }
  return config
}

function selectedPreset(snapshot) {
  if (!snapshot) return createCleanCompatibilityPreset()
  if (snapshot.compatibilityPreset) {
    if (snapshot.compatibilityPreset.valid !== true || snapshot.compatibilityPreset.recognized !== true || !Array.isArray(snapshot.compatibilityPreset.entries)) throw new Error('generate 当前预设无法读取')
    return structuredClone(snapshot.compatibilityPreset)
  }
  if (!snapshot.front && !snapshot.middle && !snapshot.back && typeof snapshot.text !== 'string') throw new Error('generate 当前预设快照无法读取')
  // Older DSH snapshots retain real front/middle/back text rather than ST markers.
  const base = createCleanCompatibilityPreset(), convert = phase => (snapshot[phase]?.entries || []).map((entry, index) => ({
    ...entry, entryKey: 'helper:' + phase + ':' + index, identifier: 'helper:' + phase + ':' + index,
    ordered: true, enabled: true, marker: false
  }))
  const front = convert('front'), middle = convert('middle'), back = convert('back')
  if (!front.length && !middle.length && !back.length && snapshot.text) front.push({ entryKey: 'helper:legacy', identifier: 'helper:legacy', role: 'system', content: snapshot.text, ordered: true, enabled: true })
  const index = base.entries.findIndex(entry => entry.identifier === 'chatHistory')
  base.entries.splice(index, 0, ...middle)
  base.entries.unshift(...front)
  base.entries.push(...back)
  return base
}

/** undefined means a new preview; null means this chat deliberately has no preset. */
export async function resolveHelperGenerationPreset(name, snapshot, { catalog, read, readDocument, selected }) {
  if (!name || name === 'in_use') {
    if (snapshot !== undefined) return snapshot
    name = (await selected()).activePreset
    if (!name) return null
  }
  const presets = (await catalog()).presets
  const exact = presets.filter(item => item.path === name)
  const matches = exact.length ? exact : presets.filter(item => item.title === name)
  if (matches.length !== 1) throw new Error(matches.length ? '预设名称不唯一：' + name : '预设不存在：' + name)
  const path = matches[0].path, preset = await read(path), document = await readDocument(path)
  if (!preset || !document) throw new Error('generate 预设无法读取：' + path)
  const nativeRegexes = nativeRegexScriptsOf(document)
  return { presetPath: path, compatibilityPreset: preset, compatibilityPresetDocument: document,
    regexScripts: nativeRegexes.length ? nativeRegexes : preset.regexScripts || [] }
}

export function helperGenerationHistory(chat) {
  return projectTavernHelperContext(chat).messages.filter(message => !message.is_hidden).map(message => ({
    role: message.role, text: message.message, greeting: chat.messages?.[message.message_id]?.greeting === true,
    turn: chat.messages?.[message.message_id]?.turn
  }))
}

/** Read-only DSH emulation: card + bound worldbook activation + preset + history. */
export function compileHelperGenerate(config, { chat = {}, card = {}, history = [], worldBook, presetSnapshot = null, characterVariables = {}, extensions = {}, presetRegexScripts = presetSnapshot?.regexScripts } = {}) {
  validateHelperGenerateConfig(config)
  const overrides = config.overrides || {}, historyOverride = overrides.chat_history || {}
  const projectedCard = { ...card }
  for (const [key, name] of Object.entries(fields)) if (Object.hasOwn(overrides, key)) projectedCard[name] = overrides[key]
  const source = historyOverride.prompts === undefined ? history : historyOverride.prompts.map(prompt)
  const limit = config.max_chat_history ?? 'all'
  const selectedHistory = historyOverride.prompts !== undefined || limit === 'all' ? source : limit === 0 ? [] : source.slice(-limit)
  const injects = [...(chat.tavernScriptPrompts || []), ...(config.injects || [])]
  const scanChat = { ...chat, messages: selectedHistory.map(item => ({ role: item.role, text: item.content ?? item.text, greeting: item.greeting, turn: item.turn })) }
  const world = prepareWorldBookRecall({ worldBook, chat: scanChat, card: projectedCard, userText: config.user_input || '',
    turn: Number([...chat.messages || []].reverse().find(item => item.role === 'assistant')?.turn) || 0,
    scanText: injects.filter(entry => entry.should_scan !== false).map(entry => entry.content).join('\n') })
  const before = [], after = [], depths = [], examplesBefore = [], examplesAfter = [], beforeNote = [], afterNote = []
  for (const entry of promptOrder(world.entries || [])) {
    const position = positions[entry.position] ?? Number(entry.position)
    if (position === 0) before.push(entry.content)
    else if (position === 4) {
      if (historyOverride.with_depth_entries !== false) depths.push({ role: ['system', 'user', 'assistant'][Number(entry.role)] || entry.role || 'system', content: entry.content, depth: Number(entry.depth) || 0, position: 'in_chat' })
    } else if (position === 2) beforeNote.push(entry.content)
    else if (position === 3) afterNote.push(entry.content)
    else if (position === 5) examplesBefore.push(entry.content)
    else if (position === 6) examplesAfter.push(entry.content)
    else if (position !== 7) after.push(entry.content)
  }
  // DSH has no separate persona manager. Its explicit override is supported.
  const persona = overrides.persona_description ?? ''
  const preset = selectedPreset(presetSnapshot)
  if (examplesBefore.length || examplesAfter.length) projectedCard.mes_example = [...examplesBefore, projectedCard.mes_example || '', ...examplesAfter].join('\n')
  // Keep arbitrary example text useful too; ST's dialogue parser otherwise
  // silently drops examples that do not use its <START>/name: conventions.
  for (const entry of preset.entries) if (entry.identifier === 'dialogueExamples') {
    entry.identifier = 'helper:dialogue-examples'
    entry.marker = false
    entry.content = projectedCard.mes_example || ''
  }
  const authorNote = historyOverride.author_note
  const depthPrompts = [...depths, ...injects.filter(entry => entry.position === 'in_chat'),
    ...[...beforeNote, authorNote || '', ...afterNote].filter(Boolean).map(content => ({ role: 'system', content, depth: 0 }))]
  const regexScripts = composeTavernRegexScripts(extensions, presetRegexScripts)
  for (const [index, entry] of depthPrompts.entries()) preset.entries.push({
    entryKey: 'helper:depth:' + index, identifier: 'helper:depth:' + index, role: entry.role, content: entry.content,
    enabled: true, ordered: true, injectionPosition: 1, injectionDepth: entry.depth || 0, injectionOrder: index
  })
  const compiled = compileSillyTavernRequest({ card: projectedCard, preset, presetDocument: presetSnapshot?.compatibilityPresetDocument || {},
    history: selectedHistory, input: config.user_input || '', userName: chat.macroState?.userName,
    macroState: structuredClone(chat.macroState || {}), persona,
    worldInfoBefore: overrides.world_info_before ?? before.join('\n\n'), worldInfoAfter: overrides.world_info_after ?? after.join('\n\n'),
    resolveMacros: resolveRuntimeMacroText,
    projectPromptText: (value, context) => applyTavernRegexText(value, regexScripts, {
      placement: context.placement, isMarkdown: false, isEdit: false, depth: context.depth
    }) })
  const projected = applyTavernHelperVariableMacros(compiled.messages, {
    message: lastTavernHelperVariables(chat.messages), chat: chat.variables, character: characterVariables,
    preset: presetSnapshot?.variables, global: chat.macroState?.global
  }).messages
  for (const message of projected) if (/<%[\s\S]*?%>/.test(message.content)) throw new Error('generate 独立生成不执行 EJS 模板；请提供已渲染的覆盖提示词或使用 generateRaw')
  return projected.map(message => ({ role: message.role, content: message.content }))
}

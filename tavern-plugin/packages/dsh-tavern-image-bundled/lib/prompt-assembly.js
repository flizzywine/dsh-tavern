import { resolveTemplateScenario, resolveTemplateScenarioSync } from './prompt-scenarios.js'
import { matchPromptEntries } from './prompt-entries.js'
import { materializeTemplateModules, materializeTemplateModulesAsync } from './template-modules.js'
import { fillPromptInputs, bindPromptConfig, selectPromptMaterials } from './prompt-materials.js'
import { activePromptBlocks, normalizePromptUsage } from './prompt-structure.js'
import { effectiveImageProvider } from './image-provider-capabilities.js'
import { dedupeTags } from './planner.js'
import { composePresetText, composeStructuredPrompt, effectivePromptPreset, formatPromptForBackend, inheritsUserStyle, promptBackendContext, promptConfigForTarget, promptPresetNegative, resolvePromptMode } from './prompt-presets.js'

export function activeArtistText(config) {
  const fallback = { text: String(config?.styleArtists ?? ''), position: 'prefix', name: '默认', negative: String(config?.styleNegative ?? '') }
  const id = String(config?.activePreset ?? config?.activeArtistSet ?? '')
  if (!id) return fallback
  // 新版：画风预设
  const presets = Array.isArray(config?.stylePresets) ? config.stylePresets : []
  const p = presets.find(s => s && String(s.id) === id && s.enabled !== false)
  if (p && (p.temporaryOverride === true || String(p.artist ?? '').trim())) {
    return { text: String(p.artist), position: p.position === 'suffix' ? 'suffix' : 'prefix', name: String(p.name ?? ''), negative: String(p.negative ?? '') }
  }
  // 兼容旧版：画师串多套
  const sets = Array.isArray(config?.artistSets) ? config.artistSets : []
  const hit = sets.find(s => s && String(s.id) === id && s.enabled !== false)
  if (hit && String(hit.text ?? '').trim()) {
    return { text: String(hit.text), position: hit.position === 'suffix' ? 'suffix' : 'prefix', name: String(hit.name ?? ''), negative: String(config?.styleNegative ?? '') }
  }
  return fallback
}

/** NovelAI 的 {}/[]/n::tag:: 权重语法 → SD 的 (tag:n)。 */
export function convertWeights(text) {
  let out = String(text ?? '')
  out = out.replace(/(-?\d+(?:\.\d+)?)::([^:]+)::/g, (_m, weight, tag) => {
    const value = Number(weight)
    if (!Number.isFinite(value)) return tag.trim()
    if (value <= 0) return `(${tag.trim()}:0.5)`
    return `(${tag.trim()}:${String(Math.min(2, Math.max(0.5, value))).slice(0, 5)})`
  })
  out = out.replace(/(\{+)([^{}]+)(\}+)/g, (_m, open, body, close) => {
    const depth = Math.min(4, Math.min(open.length, close.length))
    return `(${body.trim()}:${[0, 1.05, 1.1, 1.15, 1.2][depth]})`
  })
  // 方括号只剥括号保留内容：NAI 的 [[[artist:x]]] 在 SD 系里不该被当成降权
  out = out.replace(/(\[+)([^[\]]+)(\]+)/g, (_m, _open, body) => body.trim())
  return tidyTags(out)
}

export function stripWeights(text) {
  return tidyTags(String(text ?? '')
    .replace(/-?\d+(?:\.\d+)?::([^:]+)::/g, '$1')
    .replace(/[{}[\]]/g, ''))
}

function tidyTags(text) {
  return String(text).split(',').map(part => part.trim()).filter(Boolean).join(', ')
}

export function applyWeights(text, mode) {
  if (mode === 'keep') return String(text ?? '')
  return mode === 'strip' ? stripWeights(text) : convertWeights(text)
}

export function resolveWeightMode(config = {}, backend = '', mode = 'tags') {
  const requested = String(config.weightMode ?? 'auto').toLowerCase()
  if (mode === 'natural') return 'strip'
  const name = String(backend ?? config.imageBackend ?? '').toLowerCase()
  const novelai = name === 'novelai' || name.startsWith('novelai ')
  if (requested === 'keep' || requested === 'strip') return requested
  return novelai ? 'keep' : 'convert'
}

export function prepareImagePrompt({ workflow, params, config, definitions, onStage = null, channel = null }, injectDefinitions) {
  const stage = (name, data) => { if (onStage) { try { onStage(name, data) } catch {} } }
  const usage = normalizePromptUsage(params.promptUsage, 'story')
  let preset = effectivePromptPreset(config)
  const inputs = fillPromptInputs(preset?.structure, params.inputs)
  if (inputs.missing.length) throw new Error('请填写模板输入：' + inputs.missing.join('、'))
  inputs.structure = resolveTemplateScenarioSync(inputs.structure, { scene: inputs.render(params.tag), selected: config.promptScenario?.id }).structure
  if (inputs.structure && !inputs.structure.entriesResolved) {
    const matches = config.promptEntryMatches ?? matchPromptEntries(config.promptEntries, activePromptBlocks(inputs.structure, usage), inputs.render(params.tag))
    inputs.structure = { ...inputs.structure, entriesResolved: true, modulesResolved: true, blocks: [...inputs.structure.blocks,
      ...matches.filter(entry => ['positive', 'negative'].includes(entry.injection)).map(entry => ({ kind: entry.injection, title: entry.title, text: entry.content }))] }
  }
  const modules = materializeTemplateModules(inputs.structure, { scene: inputs.render(params.tag), inputs: inputs.values, usage, backend: channel ? effectiveImageProvider(channel) : promptBackendContext(config, workflow), definitions, subjects: params.promptSubjects })
  const moduleResult = modules.trace.length ? { parameters: modules.parameters, workflowValues: modules.workflowValues, moduleTrace: modules.trace } : {}
  config = bindPromptConfig(config, preset, modules.structure)
  preset = effectivePromptPreset(config)
  const backend = channel ? effectiveImageProvider(channel) : promptBackendContext(config, workflow)
  const mode = resolvePromptMode(config, backend)
  const materials = params.preparedMaterials ?? selectPromptMaterials(preset?.structure, definitions, {
    usage, subjects: params.promptSubjects, mode, traitMode: config.traitMode,
  })
  if (materials.warnings.length) throw new Error(materials.warnings.join('；'))
  const materialText = materials.positive && mode === 'structured' ? '【角色与服装】\n' + materials.positive : materials.positive
  const tag = [inputs.render(params.tag).trim(), materialText].filter(Boolean).join('\n\n')
  const boundCharacters = new Set(materials.selected.map(item => item.characterId).filter(Boolean))
  const boundOutfits = new Set(materials.selected.map(item => item.outfitId).filter(Boolean))
  const injectionDefinitions = materials.selected.length ? {
    ...definitions,
    characters: (definitions?.characters || []).filter(item => !boundCharacters.has(item.id)),
    outfits: (definitions?.outfits || []).filter(item => !boundOutfits.has(item.id)),
  } : definitions
  const independent = !inheritsUserStyle(config, preset)
  const activeStyleId = String(config.activePreset ?? '')
  const linkedActiveStyle = activeStyleId && activePromptBlocks(preset?.structure, usage)
    .some(block => block.kind === 'style' && block.styleId === activeStyleId)
    && Array.isArray(config.stylePresets) && config.stylePresets.some(style => String(style?.id) === activeStyleId && style.enabled !== false &&
      (style.temporaryOverride === true || String(style.artist ?? '').trim()))
  const omitInheritedStyle = independent || linkedActiveStyle
  const artist = omitInheritedStyle && params.inheritedArtist ? '' : String(params.artist ?? '').trim()
  const styleNegative = omitInheritedStyle ? '' : activeArtistText(config).negative

  if (mode === 'structured') {
    const injected = injectDefinitions(tag, injectionDefinitions, config, { style: 'structured', raw: params.rawTag })
    const prepared = composeStructuredPrompt({ text: tag, definitionAdditions: injected.additions, config, usage, artist, artistPosition: params.artistPosition ?? config.artistPosition, referenceText: params.referenceText || '',
      negative: [styleNegative, params.negative, materials.negative, ...(injected.negatives ?? [])].filter(Boolean).join('\n') })
    if (workflow) {
      const binding = workflow.bindings.negative?.[0]
      const workflowNegative = binding ? String(workflow.prompt[binding.node]?.inputs?.[binding.input] ?? '') : ''
      if (config.negativeMode === 'workflow') prepared.negative = [workflowNegative, materials.negative, ...(injected.negatives ?? [])].filter(Boolean).join('\n')
      else if (config.negativeMode === 'merge') prepared.negative = [workflowNegative, prepared.negative].filter(Boolean).join('\n')
    }
    stage('compile-positive', { mode, final: prepared.positive, hits: injected.hits })
    stage('compile-negative', { negativeMode: config.negativeMode, final: prepared.negative })
    return { ...moduleResult, positive: prepared.positive, negative: prepared.negative, hits: injected.hits,
      promptAssembly: { version: 2, definitionAdditions: injected.additions || [], referenceText: params.referenceText || '' } }
  }

  const rawBase = (params.artistPosition ?? config.artistPosition) === 'suffix'
    ? [tag, artist].filter(Boolean).join(', ')
    : [artist, tag].filter(Boolean).join(', ')
  const base = composePresetText([rawBase, String((independent ? '' : config.promptManualPositive) ?? '')].filter(Boolean).join(mode === 'tags' ? ', ' : '. '), config, backend,
    { maxLength: params.maxPromptLength, usage })
  const provenance = onStage ? [] : null
  const injected = injectDefinitions(base, injectionDefinitions, config, { style: mode === 'natural' ? 'natural' : 'tags', provenance, raw: params.rawTag })
  // 自然语言模型（LLM 文本编码器）不认 (tag:1.2) 这种权重，总是去掉；tag 模型按设置处理。
  // 画风词和按名字补上的外貌是在规划提示词清理之后才拼进来的，tag 写法再去一次重。
  const injectedText = mode === 'tags' ? dedupeTags(injected.text) : injected.text
  let positive = formatPromptForBackend(applyWeights(injectedText, resolveWeightMode(config, backend, mode)), backend, mode)
  if (mode === 'natural' && params.referenceText) {
    const references = '【参考图对应与一致性】\n' + params.referenceText
    positive = [references, positive.replace(references, '').trim()].filter(Boolean).join('\n\n')
  }
  stage('compile-positive', { mode, artistPosition: params.artistPosition ?? config.artistPosition, artist, rawBase, afterPreset: base, afterInjection: injected.text, final: positive, hits: injected.hits, provenance })

  const workflowNegative = String(
    workflow?.bindings.negative?.length
      ? workflow.prompt[workflow.bindings.negative[0].node]?.inputs?.[workflow.bindings.negative[0].input] ?? ''
      : '',
  )
  const pluginNegative = [styleNegative, promptPresetNegative(config, backend, usage), independent ? '' : config.promptManualNegative, String(params.negative ?? '')].filter(Boolean).join(', ')
  const baseNegative = workflow ? ({
    plugin: pluginNegative,
    workflow: workflowNegative,
    merge: [workflowNegative, pluginNegative].filter(Boolean).join(', '),
  }[config.negativeMode] ?? pluginNegative) : pluginNegative
  // 工作流自带的负面词和插件的负面词常有重叠（merge 模式），按逗号分段去重，保留第一次出现的位置。
  const seenNegative = new Set()
  const mergedNegative = [baseNegative, materials.negative, ...(injected.negatives ?? [])].filter(Boolean).join(', ').split(',').map(t => t.trim()).filter(t => {
    const key = t.toLowerCase()
    if (!key || seenNegative.has(key)) return false
    seenNegative.add(key); return true
  }).join(', ')
  const negative = formatPromptForBackend(mergedNegative, backend, mode)
  stage('compile-negative', { negativeMode: config.negativeMode, workflowNegative, pluginNegative, characterNegatives: injected.negatives ?? [], final: negative })
  return { ...moduleResult, positive, negative, hits: injected.hits }
}

/** Stage and other prompt producers already supply the scene description. Reuse the selected template's assembly. */
export function composePluginImagePrompt(config, { channel, prompt, negative, usage = 'plugin', inputs, subjects, definitions } = {}) {
  const selected = promptConfigForTarget(config, null, channel)
  const tag = String(prompt ?? '')
  if (!effectivePromptPreset(selected) && !subjects?.length) return { positive: tag, ...(negative ? { negative } : {}) }
  const artist = activeArtistText(selected)
  const result = prepareImagePrompt({ config: selected, channel,
    definitions, params: { tag, negative, inputs, promptSubjects: subjects, promptUsage: usage, artist: artist.text, inheritedArtist: true, artistPosition: artist.position, maxPromptLength: Infinity } },
  text => ({ text, hits: [] }))
  const backend = channel ? effectiveImageProvider(channel) : promptBackendContext(selected)
  return { ...(result.moduleTrace ? { parameters: result.parameters, workflowValues: result.workflowValues, moduleTrace: result.moduleTrace } : {}), positive: result.positive, negative: result.negative, promptMode: resolvePromptMode(selected, backend) }
}

/** Resolve plugin modules, including asynchronous data sources, before shared assembly. */
export async function composePluginImagePromptAsync(config, request = {}) {
  const selected = promptConfigForTarget(config, null, request.channel), preset = effectivePromptPreset(selected)
  const inputs = fillPromptInputs(preset?.structure, request.inputs)
  if (inputs.missing.length) throw new Error('请填写模板输入：' + inputs.missing.join('、'))
  request.signal?.throwIfAborted()
  const scenario = await resolveTemplateScenario(inputs.structure, { scene: inputs.render(request.prompt), choose: request.chooseScenario, selected: config.promptScenario?.id, signal: request.signal })
  inputs.structure = scenario.structure
  const modules = await materializeTemplateModulesAsync(inputs.structure, { scene: inputs.render(request.prompt), inputs: inputs.values, usage: normalizePromptUsage(request.usage, 'plugin'), backend: request.channel ? effectiveImageProvider(request.channel) : promptBackendContext(selected), definitions: request.definitions, subjects: request.subjects, signal: request.signal })
  request.signal?.throwIfAborted()
  return { ...composePluginImagePrompt(bindPromptConfig(selected, preset, modules.structure), request), ...(scenario.decision ? { scenario: scenario.decision } : {}), ...(modules.trace.length ? { parameters: modules.parameters, workflowValues: modules.workflowValues, moduleTrace: modules.trace } : {}) }
}

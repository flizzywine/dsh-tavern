import { generationTemplates, selectGenerationConfig, usesWorldbook } from '../generation-selection.js'
import { comfyReferenceCapacity } from '../comfy-dynamic.js'
import { comfyLoadImageBindings } from '../comfy-reference-images.js'
import { activeChannel } from '../image-channels.js'
import { effectiveImageProvider, imageReferenceLimit } from '../image-provider-capabilities.js'
import { promptConfigForTarget, resolvePromptMode } from '../prompt-presets.js'

export const SEED_CONTROLS = ['randomize', 'fixed', 'increment', 'decrement']
export const CARD_SIZES = { 竖图: { width: 832, height: 1216 }, 横图: { width: 1216, height: 832 }, 方图: { width: 1024, height: 1024 } }
const seedProviders = new Set(['comfyui', 'novelai', 'sdwebui', 'qwen'])
const fail = message => Object.assign(new Error(message), { code: 'INVALID_ARGUMENT', submissionNotStarted: true })

function select(items, key, label, names) {
  const exact = items.filter(item => names.some(name => String(item[name] || '') === key))
  const hits = exact.length ? exact : items.filter(item => names.some(name => String(item[name] || '').includes(key)))
  if (hits.length !== 1) throw fail(hits.length ? label + '名称不唯一，请用精确 ID' : '没有这个' + label + '，请先读取生图配置')
  return hits[0]
}

/** One-request configuration. The shared live configuration is never changed. */
export function cardSelection(config, workflows, args = {}) {
  let selectedTemplate = null
  if (!usesWorldbook(config)) {
    const purpose = args.sourceImages?.length ? 'edit' : 'generate'
    const named = args.template ? select(generationTemplates(config, purpose), String(args.template), '模板', ['id', 'name']) : null
    const selected = selectGenerationConfig(config, workflows, { templateId: args.templateId || named?.id, purpose })
    config = selected.config; selectedTemplate = selected.template
    if (selected.workflow) args = { ...args, channel: 'comfyui', workflow: selected.workflow.id }
    else if (selected.target?.kind === 'channel') args = { ...args, channel: config.activeImageChannel, workflow: '' }
  }
  const next = structuredClone(config)
  const wanted = String(args.channel || '').trim()
  const local = wanted === 'comfyui' || (!wanted && config.imageBackend === 'comfyui')
  let channel = null, workflow = null
  if (local) {
    const available = workflows.filter(item => !item.error && item.enabled !== false)
    workflow = args.workflow ? select(available, String(args.workflow), '工作流', ['id', 'label', 'file'])
      : available.find(item => item.id === config.defaultWorkflow) || available[0]
    if (!workflow) throw fail('ComfyUI 尚未导入可用工作流，请到配图设置导入完整 API 工作流')
    next.imageBackend = 'comfyui'
    next.comfyMode = 'workflow'
  } else {
    channel = wanted ? select(config.imageChannels || [], wanted, '渠道', ['id', 'name']) : activeChannel(config)
    if (!channel) throw fail('请先在配图设置选择生图渠道')
    next.imageBackend = channel.provider
    next.activeImageChannel = channel.id
  }
  if (args.workflow && !local) throw fail('workflow 仅用于 ComfyUI，请指定 channel 为 comfyui')
  if (args.preset) next.activePreset = select((config.stylePresets || []).filter(item => item.enabled !== false), String(args.preset), '画风预设', ['id', 'name']).id
  // 单次覆盖：只改这一张图用的那份预设副本，不写回设置。传空字符串即本张不用该段词。
  if (typeof args.preset_positive === 'string' || typeof args.preset_negative === 'string') {
    const list = Array.isArray(next.stylePresets) ? next.stylePresets.slice() : []
    const at = list.findIndex(item => item.enabled !== false && String(item.id) === String(next.activePreset))
    if (at >= 0) {
      list[at] = { ...list[at], temporaryOverride: true }
      if (typeof args.preset_positive === 'string') list[at].artist = args.preset_positive
      if (typeof args.preset_negative === 'string') list[at].negative = args.preset_negative
    } else {
      let id = 'preset-override'
      while (list.some(item => item.id === id)) id += '-'
      list.push({ id, name: '本次临时覆盖', artist: args.preset_positive ?? next.styleArtists ?? '',
        negative: args.preset_negative ?? next.styleNegative ?? '', position: 'prefix', enabled: true, temporaryOverride: true })
      next.activePreset = id
    }
    next.stylePresets = list
  }
  if (args.sampler) {
    const provider = channel ? effectiveImageProvider(channel) : 'comfyui'
    if (!['novelai', 'sdwebui'].includes(provider)) throw fail('当前渠道不支持临时采样器，请使用渠道或工作流设置')
    next.imageChannels = next.imageChannels.map(item => item.id === channel.id ? { ...item, options: { ...item.options, sampler: args.sampler } } : item)
  }
  const backend = channel ? effectiveImageProvider(channel) : ['comfyui', workflow.label, ...Object.values(workflow.prompt || {}).map(node => node.inputs?.unet_name || node.inputs?.ckpt_name || '')].join(' ')
  const promptMode = resolvePromptMode(promptConfigForTarget(next, workflow, channel), backend)
  const supportsSeed = channel ? seedProviders.has(effectiveImageProvider(channel)) && channel.options?.protocol !== 'chat' : Boolean(workflow.bindings?.seed?.length)
  if (!supportsSeed && (args.seed !== undefined || args.seed_control)) throw fail('当前渠道不提供种子控制，已停止提交')
  const seedLimit = local ? 2 ** 50 : effectiveImageProvider(channel) === 'qwen' ? 2 ** 31 : 2 ** 32
  if (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0 || args.seed >= seedLimit)) throw fail('seed 超出当前渠道支持的范围（0–' + (seedLimit - 1) + '）')
  if (args.seed_control && !SEED_CONTROLS.includes(args.seed_control)) throw fail('seed_control 无效')
  if (args.size && !CARD_SIZES[args.size] && !/^\d{2,5}x\d{2,5}$/.test(args.size)) throw fail('size 请使用竖图、横图、方图或宽x高')
  // 画幅名必须在提交前换成像素串。引擎 compileChannelJob 查的是它自己那份 config.sizes，
  // 而卡片这边递给它的配置只有白名单字段、没有 sizes 表；名字查不到时引擎会静默落回
  // 832x1216，方图和横图都会出成竖图。像素串走引擎的正则分支，不依赖那张表。
  const toPixels = value => {
    const named = CARD_SIZES[value]
    return named ? named.width + 'x' + named.height : value
  }
  const configuredSize = channel?.options
  const size = toPixels(args.size || (local ? '__workflow__' : Number(configuredSize?.sizeWidth) > 0 && Number(configuredSize?.sizeHeight) > 0
    ? configuredSize.sizeWidth + 'x' + configuredSize.sizeHeight : config.imageSize || '竖图'))
  return { config: next, template: selectedTemplate, workflow, size, promptMode, supportsSeed, seedLimit, maxReferences: channel ? imageReferenceLimit(channel) : comfyReferenceCapacity(workflow, comfyLoadImageBindings(workflow)),
    channel: local ? 'ComfyUI · ' + workflow.label : channel.name || channel.id, channelId: local ? 'comfyui' : channel.id,
    preset: (next.stylePresets || []).find(item => item.enabled !== false && String(item.id) === String(next.activePreset)) || null }
}

function wait(signal, ms) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error('已取消')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

export const TERMINAL_STATES = ['done', 'failed', 'cancelled', 'uncertain']

/**
 * 提交一张卡片生图作业并立即返回作业句柄，不等出图。
 * 同步工具随后调 waitCardImage 把结果等回来；工作台的异步工具拿 jobId 就走人。
 * bindAbort=false 时任务不归调用方信号管：工具一返回，排队中的任务就会被取消信号带走。
 */
export async function submitCardImage(engine, args, { sessionId, signal, key, onJob, bindAbort = true } = {}) {
  signal?.throwIfAborted()
  const picked = cardSelection(engine.config(), engine.workflows(), args)
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt || prompt.length > 16000) throw fail('prompt 必须是 1–16000 字的画面描述')
  const mode = args.generation_mode || 'text'
  if (!['text', 'reference'].includes(mode)) throw fail('generation_mode 无效')
  let job
  const abort = bindAbort ? () => { if (job) engine.cancelJob(job.id) } : null
  if (abort) signal?.addEventListener('abort', abort, { once: true })
  const release = () => { if (abort) signal?.removeEventListener('abort', abort) }
  try {
    const created = await engine.startJob({ tag: prompt, rawTag: prompt, size: picked.size, explicitSize: true, seed: args.seed,
      sessionId, key, negative: args.negative || '', generationMode: mode, subjects: args.subjects, characters: args.characters,
      assetBackground: args.background, assetQuality: args.quality, templateId: picked.template?.id || args.templateId, imagePurpose: args.sourceImages?.length ? 'edit' : 'generate', promptUsage: args.promptUsage, promptSubjects: args.promptSubjects, inputs: args.inputs, sourceImages: args.sourceImages },
    { signal, cardRequest: true, cardMetadata: { preset: picked.preset?.name || '', supportsSeed: picked.supportsSeed }, jobConfig: picked.config, forceWorkflow: picked.workflow, label: '卡片工作台', onCreated(value) { job = value; if (abort && signal?.aborted) abort() } })
    job ||= engine.getJob(created.id)
    await onJob?.(created)
    if (!job) throw Object.assign(new Error('生图任务已创建但读不回来，请到配图记录查询'), { jobId: created?.id })
    return { job, picked, release }
  } catch (error) { release(); throw error }
}

/** 等到作业进入终态；超时与未完成的报错沿用同步工具的原有语义。 */
export async function waitCardImage(engine, { job }, { signal } = {}) {
  const deadline = Date.now() + 10 * 60_000
  while (job && !TERMINAL_STATES.includes(job.state)) {
    signal?.throwIfAborted()
    if (Date.now() >= deadline) { engine.cancelJob(job.id); throw new Error('等待超时，任务已保留，请先到配图记录查询，勿重复提交') }
    if (job.backend === 'comfyui') await engine.refresh(job)
    if (job.state !== 'done') await wait(signal, 250)
  }
  if (job?.state !== 'done') throw Object.assign(new Error(job?.error || '生图未完成，请检查配图记录'), { jobId: job?.id, requestMayHaveSucceeded: Boolean(job?.requestMayHaveSucceeded || job?.cancelMayHaveContinued) })
  return job
}

/** 已完成的作业 → 工作台图库与工具返回共用的结果结构。取自作业本身，重启后取图同样成立。 */
export function cardImageResult(job, { picked = null, preset = '' } = {}) {
  return { jobId: job.id, file: job.file, mediaType: job.mediaType, ...(job.usage ? { usage: structuredClone(job.usage) } : {}),
    seed: picked ? (job.resultSeed ?? (picked.supportsSeed ? job.seed : undefined)) : (job.resultSeed ?? (job.cardSeedSupported === true ? job.seed : undefined)),
    prompt: job.cardPositive ?? (job.submittedPrompt || job.positive), negative: job.cardNegative ?? job.negative,
    negativeInPrompt: job.cardPositive === undefined && job.submittedPrompt !== job.positive, characters: job.cardCharacterPrompts,
    preset: (picked?.preset?.name) || preset || '', size: job.size ? `${job.size.width}x${job.size.height}` : '由工作流决定',
    channel: picked?.channel || job.channelName || job.channelId || '', promptMode: picked?.promptMode }
}

/** Use the existing persistent jobs, channel adapters, queue, reference resolver and recovery. */
export async function runCardImage(engine, args, options = {}) {
  const submitted = await submitCardImage(engine, args, options)
  try {
    const job = await waitCardImage(engine, submitted, { signal: options?.signal })
    return cardImageResult(job, { picked: submitted.picked })
  } finally { submitted.release() }
}

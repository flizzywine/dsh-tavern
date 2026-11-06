import { activeChannel } from '../image-channels.js'
import { effectiveImageProvider, imageReferenceLimit } from '../image-provider-capabilities.js'
import { resolvePromptMode } from '../prompt-presets.js'

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
    const at = list.findIndex(item => String(item.id) === String(next.activePreset))
    if (at >= 0) {
      list[at] = { ...list[at] }
      if (typeof args.preset_positive === 'string') list[at].artist = args.preset_positive
      if (typeof args.preset_negative === 'string') list[at].negative = args.preset_negative
    } else if (typeof args.preset_positive === 'string') {
      list.push({ id: 'preset-override', name: '本次临时覆盖', artist: args.preset_positive, negative: typeof args.preset_negative === 'string' ? args.preset_negative : '', position: 'prefix', enabled: true })
      next.activePreset = 'preset-override'
    }
    next.stylePresets = list
  }
  if (args.sampler) {
    const provider = channel ? effectiveImageProvider(channel) : 'comfyui'
    if (!['novelai', 'sdwebui'].includes(provider)) throw fail('当前渠道不支持临时采样器，请使用渠道或工作流设置')
    next.imageChannels = next.imageChannels.map(item => item.id === channel.id ? { ...item, options: { ...item.options, sampler: args.sampler } } : item)
  }
  const backend = channel ? effectiveImageProvider(channel) : ['comfyui', workflow.label, ...Object.values(workflow.prompt || {}).map(node => node.inputs?.unet_name || node.inputs?.ckpt_name || '')].join(' ')
  const promptMode = resolvePromptMode(next, backend)
  const supportsSeed = channel ? seedProviders.has(effectiveImageProvider(channel)) && channel.options?.protocol !== 'chat' : Boolean(workflow.bindings?.seed?.length)
  if (!supportsSeed && (args.seed !== undefined || args.seed_control)) throw fail('当前渠道不提供种子控制，已停止提交')
  const seedLimit = local ? 2 ** 50 : effectiveImageProvider(channel) === 'qwen' ? 2 ** 31 : 2 ** 32
  if (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0 || args.seed >= seedLimit)) throw fail('seed 超出当前渠道支持的范围（0–' + (seedLimit - 1) + '）')
  if (args.seed_control && !SEED_CONTROLS.includes(args.seed_control)) throw fail('seed_control 无效')
  if (args.size && !CARD_SIZES[args.size] && !/^\d{2,5}x\d{2,5}$/.test(args.size)) throw fail('size 请使用竖图、横图、方图或宽x高')
  const configuredSize = channel?.options
  const size = args.size || (local ? '__workflow__' : Number(configuredSize?.sizeWidth) > 0 && Number(configuredSize?.sizeHeight) > 0
    ? configuredSize.sizeWidth + 'x' + configuredSize.sizeHeight : config.imageSize || '竖图')
  return { config: next, workflow, size, promptMode, supportsSeed, seedLimit, maxReferences: channel ? imageReferenceLimit(channel) : (workflow.bindings?.referenceImages?.length || 0),
    preset: (config.stylePresets || []).find(item => item.id === next.activePreset)?.name || '',
    channel: local ? 'ComfyUI · ' + workflow.label : channel.name || channel.id, channelId: local ? 'comfyui' : channel.id,
    preset: (next.stylePresets || []).find(item => String(item.id) === String(next.activePreset)) || null }
}

function wait(signal, ms) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason || new Error('已取消')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Use the existing persistent jobs, channel adapters, queue, reference resolver and recovery. */
export async function runCardImage(engine, args, { sessionId, signal, key, onJob } = {}) {
  signal?.throwIfAborted()
  const picked = cardSelection(engine.config(), engine.workflows(), args)
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
  if (!prompt || prompt.length > 16000) throw fail('prompt 必须是 1–16000 字的画面描述')
  const mode = args.generation_mode || 'text'
  if (!['text', 'reference'].includes(mode)) throw fail('generation_mode 无效')
  let job
  const abort = () => { if (job) engine.cancelJob(job.id) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const created = await engine.startJob({ tag: prompt, rawTag: prompt, size: picked.size, seed: args.seed,
      sessionId, key, negative: args.negative || '', generationMode: mode, subjects: args.subjects, characters: args.characters },
    { cardRequest: true, jobConfig: picked.config, forceWorkflow: picked.workflow, label: '卡片工作台', onCreated(value) { job = value; if (signal?.aborted) abort() } })
    job ||= engine.getJob(created.id)
    await onJob?.(created)
    const deadline = Date.now() + 10 * 60_000
    while (job && !['done', 'failed', 'cancelled', 'uncertain'].includes(job.state)) {
      signal?.throwIfAborted()
      if (Date.now() >= deadline) { abort(); throw new Error('等待超时，任务已保留，请先到配图记录查询，勿重复提交') }
      if (job.backend === 'comfyui') await engine.refresh(job)
      if (job.state !== 'done') await wait(signal, 250)
    }
    if (job?.state !== 'done') throw Object.assign(new Error(job?.error || '生图未完成，请检查配图记录'), { jobId: job?.id, requestMayHaveSucceeded: Boolean(job?.requestMayHaveSucceeded || job?.cancelMayHaveContinued) })
    return { jobId: job.id, file: job.file, mediaType: job.mediaType, seed: picked.supportsSeed ? job.seed : undefined,
      prompt: job.submittedPrompt || job.positive, negative: job.negative, preset: picked.preset, size: job.size ? `${job.size.width}x${job.size.height}` : '由工作流决定', channel: picked.channel, promptMode: picked.promptMode }
  } finally { signal?.removeEventListener('abort', abort) }
}

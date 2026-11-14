import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMAGE_PROVIDERS } from '../image-providers.js'
import { publicChannels } from '../image-channels.js'
import { imageReferenceLimit, effectiveImageProvider } from '../image-provider-capabilities.js'
import { resolvePromptMode } from '../prompt-presets.js'
import { CARD_SIZES, SEED_CONTROLS, TERMINAL_STATES, cardImageResult, cardSelection } from './generation.js'
import { atomicWrite, readJson, serialQueue } from './storage.js'
import { createCardGallery } from './gallery.js'
import { createCardWorldbook } from './worldbook.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const BASE = '/dsh-tavern-gen'
const SHARED_PARTS = ['body', 'full', 'bodyBack', 'fullBack', 'negative']
const PARTS = ['upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'negative']
const text = (value, max = 8000) => typeof value === 'string' ? value.slice(0, max) : ''
const fail = (code, message) => Object.assign(new Error(message), { code })
// 工具返回值必须能无损序列化成 JSON：undefined 字段会让宿主判成非法输出，这里直接摘掉。
const omitUndefined = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
const output = render => ({ schema: { type: 'object', additionalProperties: true }, render: render || ((_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]) })
const schema = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const named = { name: { type: 'string', description: '精确 ID、名字或唯一匹配的别名，省略时列出可用项。' } }
const pick = (items, key, aliases = () => []) => {
  const wanted = String(key || '').trim()
  if (!wanted) return null
  const exact = items.filter(item => [item.id, item.name, ...aliases(item)].includes(wanted))
  const hits = exact.length ? exact : items.filter(item => [item.name, ...aliases(item)].some(name => String(name).includes(wanted)))
  if (hits.length !== 1) throw fail('INVALID_ARGUMENT', hits.length ? '名称不唯一，请用精确 ID' : '未找到记录，请先读取清单')
  return hits[0]
}

export function apply(ctx, { ready }) {
  const logger = ctx.logger || console, controller = new AbortController()
  const data = join(ROOT, '../../image-cache/dsh-tavern-gen'), enabledFile = join(ROOT, 'card-enabled.json')
  const gallery = createCardGallery(data), worldbook = createCardWorldbook(ROOT), mutate = serialQueue(), seedGate = serialQueue()
  let closed = false, enabled = true, applyTools
  let getOrigin
  const imageOrigin = () => {
    try {
      const origin = new URL(getOrigin?.())
      if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('invalid origin')
      if (origin.hostname === '0.0.0.0') origin.hostname = '127.0.0.1'
      if (origin.hostname === '[::]') origin.hostname = '[::1]'
      return origin.origin
    } catch { throw Object.assign(fail('NOT_CONFIGURED', '尚未取得生图图片服务的完整地址，请确认 Web 服务已启动后再生成；本次未提交生图'), { submissionNotStarted: true, requestMayHaveSucceeded: false }) }
  }
  const enabledReady = readJson(enabledFile, null).then(async value => {
    enabled = value ? value.enabled !== false : (await readJson(join(ROOT, 'config.json'), {})).enabled !== false
    return enabled
  })
  const assertOpen = async () => { await enabledReady; if (closed || !enabled) throw fail('NOT_CONFIGURED', '工作台生图已关闭') }
  const source = async () => (await ready()).currentDefinitions()
  const outfits = async () => (await source()).outfits.filter(item => item.enabled !== false)
  const parts = item => Object.fromEntries(PARTS.map(key => [key, text(item[key])]))
  const sharedParts = item => Object.fromEntries(SHARED_PARTS.map(key => [key, text(item[key])]))
  const context = exec => ({ sessionId: String(exec?.agent?.session?.id || ''), signal: exec?.signal ? AbortSignal.any([exec.signal, controller.signal]) : controller.signal })

  async function seeds(picked, args, count) {
    if (!picked.supportsSeed) return []
    return seedGate(async () => {
      const path = join(data, 'seed-state.json'), state = await readJson(path, {})
      const key = picked.channelId + '/' + (picked.workflow?.id || '')
      const base = JSON.stringify((picked.workflow?.bindings?.seed || []).map(binding => picked.workflow.prompt[binding.node]?.inputs?.[binding.input]))
      const previous = state[key]?.base === base ? state[key] : null
      const control = args.seed_control || 'randomize', wrap = picked.seedLimit
      let seed = args.seed ?? (control === 'randomize' ? Math.floor(Math.random() * wrap) : previous?.last ?? Math.floor(Math.random() * wrap))
      if (args.seed === undefined && previous && control === 'increment') seed = (seed + 1) % wrap
      if (args.seed === undefined && previous && control === 'decrement') seed = (seed + wrap - 1) % wrap
      const values = []
      for (let index = 0; index < count; index++) {
        if (index) seed = control === 'fixed' ? seed : control === 'increment' ? (seed + 1) % wrap : control === 'decrement' ? (seed + wrap - 1) % wrap : Math.floor(Math.random() * wrap)
        values.push(seed)
      }
      state[key] = { last: seed, base }
      // Bound historical seed keys when channels/workflows are repeatedly renamed.
      const kept = Object.fromEntries(Object.entries(state).slice(-100))
      await atomicWrite(path, kept)
      return values
    })
  }

  // 同步和异步工具共用参数定义。
  const generationParameters = () => schema({
    prompt: { type: 'string', description: '画面描述。自然语言渠道可用中文或英文完整句；标签模型用其支持的 tag；structured 按设置保留分节。画风与参考图绑定由引擎追加。' },
    template: { type: 'string', description: '工作台模式使用的模板名称或精确 ID；省略则用当前默认模板或随机范围。先 read_image_config 查看可用模板。' },
    negative: { type: 'string', description: '本张额外排除项，由渠道适配原生负面参数或合入描述。' },
    channel: { type: 'string', description: '精确渠道 ID 或唯一名字；comfyui 选择本地工作流。不填用当前渠道，不改变全局设置。' },
    workflow: { type: 'string', description: 'ComfyUI 工作流 ID，不填使用配图设置的默认工作流。' },
    preset: { type: 'string', description: '本次画风名称或 ID，只影响这一次、不写回设置；不填沿用当前画风。名字从 read_image_config 的画风清单里挑。' },
    preset_positive: { type: 'string', description: '临时覆盖这套预设的正面词（画师串 / 风格词），只对本次生成生效，不写回设置。要改权重或删掉其中某段时，把改好的整串传进来；传空字符串表示本张不用这层词。' },
    preset_negative: { type: 'string', description: '临时覆盖这套预设的负面固定词，只对本次生成生效，不写回设置；传空字符串表示本张不带这层负面词。' },
    size: { type: 'string', description: '竖图、横图、方图或宽x高。自定义宽高建议取 64 的倍数，多数平台按这个对齐，非对齐的值可能被平台改掉。不填沿用渠道或 ComfyUI 工作流尺寸。' },
    count: { type: 'integer', description: '生成 1–4 张，默认 1。异步提交时各张独立推进。' },
    sampler: { type: 'string', description: '仅支持此参数的 NovelAI、SD WebUI 渠道可临时指定。' },
    seed: { type: 'integer', description: '支持种子的渠道可指定第一张种子。不支持时会在提交前报错。' },
    seed_control: { type: 'string', enum: SEED_CONTROLS },
    generation_mode: { type: 'string', enum: ['text', 'reference'], description: '默认 text；reference 使用人物库中的参考图，需要渠道及工作流支持。' },
    subjects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { characterId: { type: 'string' }, outfitId: { type: 'string' }, name: { type: 'string' } } }, description: 'reference 模式的本张人物与服装 ID，read_character/read_outfit 返回精确 ID。' },
    characters: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' }, centers: { type: 'string' }, uc: { type: 'string' } }, required: ['prompt'] }, description: '需要区分多个人物时逐人描述。NovelAI 使用原生角色参数，其他渠道由引擎合成。' },
  }, ['prompt'])

  const generate = {
    name: 'gen_image',
    description: '在卡片工作台生成图片，返回带完整 HTTP(S) 地址的 Markdown。把返回的 markdown 原样写进回复，不要省略域名、端口或改成相对路径。先用 read_image_config 查看渠道及提示词格式，按 image-prompt Skill 描述用户要求的一个画面。使用当前配图渠道或临时指定渠道，支持现有全部在线协议和 ComfyUI。用户已授权直接出图时直接提交。失败或任务不确定时先查配图记录，不能自动重复提交。',
    parameters: generationParameters(),
    output: output((_args, value) => [{ type: 'text', text: [value.ok ? '图片已生成。' : '部分图片已生成，后续任务中断，请先检查配图记录。', value.channel ? '生图渠道：' + value.channel : '', ...(value.images || []).map(image => `![图片](${image.url})`), value.error || ''].filter(Boolean).join('\n\n') }]),
    async execute(args, exec) {
      await assertOpen()
      const count = args.count ?? 1
      if (!Number.isSafeInteger(count) || count < 1 || count > 4) throw fail('INVALID_ARGUMENT', 'count 必须是 1–4 的整数')
      if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 16000) throw fail('INVALID_ARGUMENT', 'prompt 必须是 1–16000 字')
      if (args.negative !== undefined && (typeof args.negative !== 'string' || args.negative.length > 8000)) throw fail('INVALID_ARGUMENT', 'negative 最多 8000 字')
      // Resolve lazily: the service may register before listen(), and its port may change after restart.
      const origin = imageOrigin()
      const engine = await ready(), picked = cardSelection(engine.currentConfig(), engine.cardWorkflows(), args)
      const values = await seeds(picked, args, count), images = [], started = Date.now(), options = context(exec)
      for (let index = 0; index < count; index++) {
        try {
          await assertOpen()
          options.signal.throwIfAborted()
          const result = await engine.generateCardImage({ ...args, templateId: picked.template?.id, seed: values[index] }, { ...options, key: 'card-' + randomUUID() })
          const item = await gallery.add(result, { sessionId: options.sessionId, preset: args.preset })
          const url = new URL(item.url, origin).href
          images.push(omitUndefined({ url, markdown: `![图片](${url})`, jobId: result.jobId, mediaType: result.mediaType, seed: result.seed, size: result.size, prompt: result.prompt, negative: result.negative, negativeInPrompt: result.negativeInPrompt, characters: result.characters, preset: result.preset }))
        } catch (error) {
          if (!images.length) throw error
          return omitUndefined({ ok: false, images, channel: picked.channel, preset: images[0].preset, error: error.message, jobId: error.jobId, requestMayHaveSucceeded: error.requestMayHaveSucceeded === true, elapsedMs: Date.now() - started })
        }
      }
      return omitUndefined({ ok: true, images, channel: picked.channel, promptMode: picked.promptMode, preset: (picked.preset && picked.preset.name) || '', elapsedMs: Date.now() - started })
    },
  }

  const submit = {
    name: 'gen_image_submit',
    description: '提交生图任务后返回任务号，不等出图；随后用 gen_image_status 取图，一次可查多个。多个渠道、或一个渠道多张图都能一次或连续提交，任务并行推进，出来一张取一张。先用 read_image_config 选渠道，用户已授权直接出图时直接提交。',
    parameters: generationParameters(),
    output: output((_args, value) => [{ type: 'text', text: [
      `已提交 ${value.jobs.length} 张，渠道：${value.channel || '未知'}。`,
      ...value.jobs.map(item => `任务号 ${item.jobId}`),
      value.error ? '部分任务未提交：' + value.error + '；已提交的任务不要重复提交。' : '',
      '生成需要时间，先去做别的；要图时调用 gen_image_status 传这些任务号。',
    ].join('\n') }]),
    async execute(args, exec) {
      await assertOpen()
      exec?.signal?.throwIfAborted()
      const count = args.count ?? 1
      if (!Number.isSafeInteger(count) || count < 1 || count > 4) throw fail('INVALID_ARGUMENT', 'count 必须是 1–4 的整数')
      if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 16000) throw fail('INVALID_ARGUMENT', 'prompt 必须是 1–16000 字')
      if (args.negative !== undefined && (typeof args.negative !== 'string' || args.negative.length > 8000)) throw fail('INVALID_ARGUMENT', 'negative 最多 8000 字')
      // 图片服务地址拿不到就在这里停：提交成功却给不出地址，等于白花一次额度。
      imageOrigin()
      const engine = await ready(), picked = cardSelection(engine.currentConfig(), engine.cardWorkflows(), args)
      const values = await seeds(picked, args, count), sessionId = String(exec?.agent?.session?.id || ''), jobs = [], started = Date.now()
      for (let index = 0; index < count; index++) {
        try {
          await assertOpen()
          exec?.signal?.throwIfAborted()
          const created = await engine.submitCardImage({ ...args, templateId: picked.template?.id, seed: values[index] },
            { sessionId, signal: controller.signal, key: 'card-' + randomUUID(), bindAbort: false })
          jobs.push(omitUndefined({ jobId: created.job.id, seed: created.job.resultSeed ?? (picked.supportsSeed ? created.job.seed : undefined), state: created.job.state }))
        } catch (error) {
          if (!jobs.length) throw error
          return { ok: false, channel: picked.channel, jobs, error: error.message, elapsedMs: Date.now() - started }
        }
      }
      return omitUndefined({ ok: true, channel: picked.channel, promptMode: picked.promptMode, preset: (picked.preset && picked.preset.name) || '', jobs, elapsedMs: Date.now() - started })
    },
  }

  const status = {
    name: 'gen_image_status',
    description: '按任务号取回 gen_image_submit 提交的图片，一次可查多个。已完成的直接返回 Markdown 图片地址；还在生成的返回状态，可以稍后再查；失败或结果不确定的返回原因和能否重新提交。',
    parameters: schema({
      jobIds: { type: 'array', items: { type: 'string' }, description: 'gen_image_submit 返回的任务号，1–20 个。' },
      wait: { type: 'integer', description: '最多等待秒数，0–120，默认 30。已有图片或失败结果时立即返回；后续查询只传尚未完成的任务号。' },
    }, ['jobIds']),
    output: output((_args, value) => {
      const images = value.jobs.filter(item => item.markdown), rest = value.jobs.filter(item => !item.markdown)
      return [{ type: 'text', text: [
        images.length ? `已生成 ${images.length} 张。` : '',
        ...images.map(item => item.markdown + (Number.isSafeInteger(item.seed) ? '\n种子：' + item.seed : '')),
        ...rest.map(item => `${item.jobId}（${item.channel || '渠道未知'}）：${[item.error, item.note].filter(Boolean).join('；')}`),
      ].filter(Boolean).join('\n\n') }]
    }),
    async execute(args, exec) {
      await assertOpen()
      const ids = [...new Set((Array.isArray(args.jobIds) ? args.jobIds : [])
        .filter(id => typeof id === 'string' && id.trim()).map(id => id.trim().slice(0, 100)))].slice(0, 20)
      if (!ids.length) throw fail('INVALID_ARGUMENT', 'jobIds 至少要给一个任务号')
      const engine = await ready(), options = context(exec)
      const seconds = Math.max(0, Math.min(120, Math.trunc(Number(args.wait ?? 30)) || 0))
      const ownJob = id => {
        const job = engine.getJob(id)
        return job?.source === 'card' && String(job.gameId || '') === options.sessionId ? job : null
      }
      const deadline = Date.now() + seconds * 1000
      while (Date.now() < deadline) {
        if (options.signal.aborted) throw options.signal.reason ?? new Error('已取消')
        const watched = ids.map(ownJob)
        if (watched.some(job => !job || TERMINAL_STATES.includes(job.state))) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      const jobs = []
      for (const id of ids) {
        const job = ownJob(id)
        if (!job) { jobs.push({ jobId: id, state: 'unknown', note: '没有这个任务号；确认它是不是别的会话提交的' }); continue }
        const base = omitUndefined({ jobId: job.id, state: job.state, channel: job.channelName || job.channelId || '', seed: job.resultSeed ?? (job.cardSeedSupported === true ? job.seed : undefined) })
        if (job.state === 'done') {
          const result = cardImageResult(job, { preset: job.cardPreset || '' })
          let item = null
          try { item = await gallery.add(result, { sessionId: options.sessionId }); item.url = new URL(item.url, imageOrigin()).href }
          catch (error) { item = null; logger.warn?.('dsh-tavern-image: 异步生图写入图库失败 ' + (error?.message ?? error)) }
          if (!item) { jobs.push({ ...base, note: '图片已生成，但没能写进工作台图库或取不到图片服务地址，请到配图记录查看' }); continue }
          jobs.push(omitUndefined({ ...base, url: item.url, markdown: `![图片](${item.url})`, size: item.size, preset: item.preset || job.cardPreset || '', channel: item.channel || base.channel,
            prompt: result.prompt, negative: result.negative, negativeInPrompt: result.negativeInPrompt, characters: result.characters, mediaType: result.mediaType, note: '已生成' }))
          continue
        }
        if (job.state === 'uncertain') {
          jobs.push(omitUndefined({ ...base, error: job.error || '平台是否接单无法确认', requestMayHaveSucceeded: true, note: '平台可能已经接单，先到平台或配图记录确认，不要重复提交' }))
          continue
        }
        if (job.state === 'failed' || job.state === 'cancelled') {
          const ambiguous = job.requestMayHaveSucceeded === true || job.cancelMayHaveContinued === true
          jobs.push(omitUndefined({ ...base, error: job.error || '生图失败', retryable: !ambiguous, requestMayHaveSucceeded: ambiguous,
            note: ambiguous ? '请求可能已被平台接受，先确认再决定是否重提' : '没有提交成功，可以重新提交' }))
          continue
        }
        jobs.push(omitUndefined({ ...base, note: job.state === 'pending' ? '排队中，还没轮到' : '生成中' }))
      }
      return { ok: true, settled: jobs.filter(item => item.state === 'done').length, jobs }
    },
  }

  const character = {
    name: 'read_character', description: '读取共用人物库。不传 name 列出全部人物；传 name 给出可直接粘进 prompt 的人物宏，以及这个角色的服装正文。full: true 只在用户明确要求改这个角色的外貌时传，那时给 traits 而不是宏。', parameters: schema({ ...named, full: { type: 'boolean', description: '仅当用户明确要求修改这个角色的外貌时才传：返回 traits 原文，不含宏。出图、核对宏写没写对、排查画面不对劲，都不要传——宏由工具生成，不需要你校对；读一次全量，省下的 token 就全还回去了。' } }), output: output(),
    async execute(args) {
      await assertOpen()
      const book = await source(), list = book.characters.filter(item => item.enabled !== false && item.name)
      const aliases = item => String(item.match || '').split(/[,，\n]/).map(value => value.trim()).filter(Boolean)
      const hit = pick(list, args.name, aliases)
      if (!hit) return { characters: list.map(item => ({ id: item.id, name: item.name, aliases: aliases(item), note: item.note || '' })) }
      const shared = await outfits(), own = (hit.outfits || []).filter(item => item.enabled !== false)
      const refs = shared.filter(item => hit.outfitRefs?.includes(item.id))
      const outfitRows = own.map(item => ({ id: item.id, name: item.name, default: item.default === true, ...parts(item), hasReference: Boolean(item.referenceImage), hasPairedReference: Boolean(item.characterOutfitImage) }))
      // 全量只服务于「改外貌」：原样给库里的 traits。服装两条路径一样，都给正文。
      if (args.full === true) return { id: hit.id, name: hit.name, traits: { ...hit.traits }, note: hit.note || '', hasReference: Boolean(hit.referenceImage),
        outfits: outfitRows,
        outfitRefs: refs.map(item => ({ id: item.id, name: item.name })),
        ...(hit.defaultOutfit ? { defaultOutfit: shared.filter(item => item.id === hit.defaultOutfit).map(item => ({ id: item.id, name: item.name, ...sharedParts(item) })) } : {}) }
      // 默认只有人物块换成宏，服装照旧给正文：衣服由模型自己挑、自己整块照写。
      // 宏体是 ${ 与 }$ 之间的纯键值对，不带外层大括号：引擎按 JSON.parse('{' + 宏体 + '}') 解析。
      // name 用英文别名，跟游玩模式的写法对齐：allowChinesePrompt 关着时中文名会被清掉，英文名才是匹配键。
      // 别名被别人共用时退回 id：宏展开按名字找不到唯一的人，外貌会整段丢掉。
      const norm = value => String(value ?? '').toLowerCase().replace(/[\s_\-.'"（）()]+/g, '')
      const asciiAlias = aliases(hit).find(value => /^[\x20-\x7e]+$/.test(value) && /[a-z]/i.test(value))
      const claim = asciiAlias || hit.name
      const aliasShared = list.some(item => item !== hit && [item.name, ...aliases(item)].some(name => norm(name) && norm(name) === norm(claim)))
      const macroName = aliasShared ? String(hit.id ?? claim) : claim
      // outfit 固定 unknown：引擎据此判定「这张图的衣服不归你管」，既不补常穿也不展开任何一套，
      // 衣服完全由模型照 outfits 正文写进串里。少了这个键，常穿那套会和模型选的那套一起进提示词。
      const macro = '${' + JSON.stringify({ name: macroName, angle: 'from front', upperBody: 'sfw', lowerBody: 'sfw', outfit: 'unknown' }).slice(1, -1) + '}$'
      return omitUndefined({
        id: hit.id, name: hit.name, macroName, aliases: aliases(hit), note: hit.note || '', hasReference: Boolean(hit.referenceImage),
        macro,
        outfits: outfitRows,
        ...(refs.length ? { outfitRefs: refs.map(item => ({ id: item.id, name: item.name })) } : {}),
        ...(hit.defaultOutfit ? { defaultOutfit: shared.filter(item => item.id === hit.defaultOutfit).map(item => ({ id: item.id, name: item.name, ...sharedParts(item) })) } : {}) })
    },
  }
  const outfit = {
    name: 'read_outfit', description: '查询共用通用服装库，返回精确 ID。通用服装使用 body/full/bodyBack/fullBack/negative（上身、整套及对应背面），角色自带七分部位服装从 read_character 读取。保存时保留读取到的实际字段。', parameters: schema(named), output: output(),
    async execute(args) {
      await assertOpen()
      const list = await outfits(), item = pick(list, args.name)
      return item ? { id: item.id, name: item.name, ...sharedParts(item), hasReference: Boolean(item.referenceImage) } : { outfits: list.map(item => ({ id: item.id, name: item.name })) }
    },
  }
  const configuration = {
    name: 'read_image_config', description: '读取渠道、提示词格式、参考图及种子能力、画风清单和 ComfyUI 工作流。只读本地配置，不联网探测或生成。不传 preset 只给画风的名字和 ID；要看某一套的正面词就传 preset（名称或精确 ID）。指定渠道时优先使用唯一名称，重名时使用 ID。', parameters: schema({ preset: { type: 'string', description: '画风名称或精确 ID。填了就只返回这一套的正面词，不填只列名字。' } }), output: output(),
    async execute(args) {
      await assertOpen()
      const engine = await ready(), cfg = engine.currentConfig(), workflows = engine.cardWorkflows()
      const presets = (cfg.stylePresets || []).filter(item => item.enabled !== false)
      const asked = text(args?.preset, 200).trim()
      // 点名某一套时只给这一套的正面词。负面词由引擎按预设自动带上，模型不需要看。
      if (asked) {
        const hit = pick(presets, asked)
        return { id: hit.id, name: hit.name, artist: hit.artist || '', active: hit.id === cfg.activePreset }
      }
      const channels = (cfg.imageChannels || []).map(item => {
        const protocol = effectiveImageProvider(item)
        return { id: item.id, name: item.name, provider: protocol, model: item.model, promptMode: resolvePromptMode(cfg, protocol), maxReferences: imageReferenceLimit(item), supportsSeed: ['novelai', 'qwen', 'sdwebui'].includes(protocol) && item.options?.protocol !== 'chat', authMode: item.authMode }
      })
      for (const item of workflows) {
        const picked = cardSelection(cfg, workflows, { channel: 'comfyui', workflow: item.id })
        channels.push({ id: 'comfyui', workflowId: item.id, name: item.label, provider: 'comfyui', promptMode: picked.promptMode, maxReferences: picked.maxReferences, supportsSeed: picked.supportsSeed })
      }
      // 画风只列名字和 ID：三十多套的正面词合起来过万字，模型挑的时候用不上，要哪套再单独取。
      return { promptSystem: cfg.promptSystem || 'workbench', templates: engine.templateModels?.() || [], randomTemplates: cfg.randomPromptTemplates === true, activeTemplateId: cfg.activePromptPreset || '__default__', activeChannelId: cfg.imageBackend === 'comfyui' ? 'comfyui' : cfg.activeImageChannel, channels, defaultWorkflow: cfg.defaultWorkflow,
        presets: presets.map(item => ({ id: item.id, name: item.name, active: item.id === cfg.activePreset })), activePreset: cfg.activePreset, sizes: CARD_SIZES }
    },
  }
  const lookup = {
    name: 'find_prompt', description: '按关键词搜索卡片世界书的 lookup 条目。不传 query 返回分类，limit 默认 8、最多 20。规则从 image-prompt Skill 索引按需读取。',
    parameters: schema({ query: { type: 'string' }, category: { type: 'string' }, table: { type: 'string' }, limit: { type: 'integer' } }), output: output(),
    async execute(args) {
      await assertOpen()
      const book = await worldbook.load(), query = text(args.query, 200).trim().toLowerCase(), category = text(args.category, 200).toLowerCase(), table = text(args.table, 100).toLowerCase()
      const rows = book.buckets.flatMap(bucket => bucket.entries.filter(entry => entry.enabled && entry.mode === 'lookup')
        .map(entry => ({ table: bucket.label, tableId: bucket.id, category: entry.title, content: entry.content })))
        .filter(row => !table || [row.table, row.tableId].some(value => value.toLowerCase().includes(table)))
        .filter(row => !category || row.category.toLowerCase().includes(category))
      if (!query) return { categories: rows.map(({ table, category }) => ({ table, category })) }
      const hits = []
      for (const row of rows) {
        let name = ''
        for (const line of row.content.split(/\r?\n/)) {
          const heading = /^\*\*(.+?)\*\*$/.exec(line.trim()), tags = /^`(.+)`$/.exec(line.trim())
          if (heading) name = heading[1]
          if (tags && name && [name, tags[1], row.category].some(value => value.toLowerCase().includes(query))) hits.push({ table: row.table, category: row.category, name, tags: tags[1] })
          if (tags) name = ''
        }
      }
      return { matched: hits.length, hits: hits.slice(0, Math.max(1, Math.min(20, Math.trunc(Number(args.limit) || 8)))) }
    },
  }
  const tools = [generate, submit, status, character, outfit, configuration, lookup]

  function send(response, status, value) {
    if (response.headersSent) return
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  async function body(request) {
    const chunks = []; let length = 0
    for await (const chunk of request) { length += chunk.length; if (length > 4 * 1024 * 1024) throw fail('INVALID_ARGUMENT', '提交内容超过 4 MB'); chunks.push(chunk) }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw fail('INVALID_ARGUMENT', '请求体不是有效 JSON') }
  }
  function check(request, url) {
    if (closed) throw fail('NOT_CONFIGURED', '工作台模块已关闭')
    if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('FORBIDDEN', '请从 Tavern 面板操作')
    if (request.headers.origin) {
      let origin
      try { origin = new URL(request.headers.origin) } catch { throw fail('FORBIDDEN', '来源无效') }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== url.host) throw fail('FORBIDDEN', '请从 Tavern 面板操作')
    }
    if (request.method === 'POST' && !String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw fail('FORBIDDEN', '写入操作需要 JSON 请求')
  }
  async function forward(engine, action, value, request, response, url) {
    const forwarded = Readable.from([Buffer.from(JSON.stringify(value))])
    Object.assign(forwarded, { method: 'POST', headers: { ...request.headers, 'content-type': 'application/json' }, url: request.url })
    return engine.handleConsole(action, forwarded, response, url)
  }
  const api = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://' + (request.headers.host || 'localhost'))
      check(request, url)
      const route = url.pathname.slice((BASE + '/api/').length), method = request.method || 'GET'
      if (method === 'GET' && route === 'tools-enabled') return send(response, 200, { enabled: await enabledReady.then(() => enabled) })
      if (method === 'POST' && route === 'tools-enabled') {
        const value = await body(request)
        if (typeof value.enabled !== 'boolean') throw fail('INVALID_ARGUMENT', 'enabled 必须是布尔值')
        return mutate(async () => { await enabledReady; await atomicWrite(enabledFile, { enabled: value.enabled }); enabled = value.enabled; applyTools?.(enabled); send(response, 200, { ok: true, enabled }) })
      }
      if (method === 'GET' && route === 'worldbook') return send(response, 200, { worldbook: await worldbook.load() })
      // 面板逐条编辑：一次只写一条，串行队列保证不会和整本保存互相覆盖。
      if (method === 'POST' && route === 'worldbook-entry') {
        const payload = await body(request)
        const bucket = String(payload.bucket || ''), id = String(payload.id || '')
        if (payload.remove === true) return send(response, 200, { ok: true, ...(await worldbook.removeEntry(bucket, id)) })
        return send(response, 200, { ok: true, ...(await worldbook.updateEntry(bucket, id, payload.patch && typeof payload.patch === 'object' ? payload.patch : {})) })
      }
      if (method === 'POST' && route === 'worldbook-add') {
        const payload = await body(request)
        return send(response, 200, { ok: true, ...(await worldbook.addEntry(String(payload.bucket || ''), payload.entry && typeof payload.entry === 'object' ? payload.entry : {})) })
      }
      if (method === 'GET' && route === 'gallery') return send(response, 200, { items: await gallery.list(url.searchParams.get('sessionId') || undefined) })
      if (method === 'POST' && route === 'gallery-delete') return send(response, 200, { ok: true, removed: await gallery.remove(String((await body(request)).id || '')) ? 1 : 0 })
      if (method === 'POST' && route === 'gallery-clear') { await body(request); return send(response, 200, { ok: true, removed: await gallery.clear() }) }
      if (method === 'GET' && route === 'state') {
        const engine = await ready(), cfg = engine.currentConfig()
        const safeConfig = Object.fromEntries(['imageBackend', 'activeImageChannel', 'generationMode', 'promptMode', 'imageSize', 'stylePresets', 'activePreset', 'styleArtists', 'styleNegative', 'comfyUrl', 'comfyAuthMode', 'comfyAuthUser', 'defaultWorkflow', 'lockWorkflow'].map(key => [key, structuredClone(cfg[key])]))
        return send(response, 200, { config: { ...safeConfig, imageChannels: publicChannels(cfg.imageChannels), enabled: await enabledReady.then(() => enabled), comfyHasAuthToken: Boolean(cfg.comfyAuthToken), comfyHasAuthPass: Boolean(cfg.comfyAuthPass) },
          characters: structuredClone(engine.currentDefinitions()), outfits: { revision: engine.currentDefinitions().revision, outfits: structuredClone(engine.currentDefinitions().outfits) }, worldbook: await worldbook.load(), providers: IMAGE_PROVIDERS })
      }
      if (method === 'POST' && route === 'save') {
        const payload = await body(request), content = typeof payload.content === 'string' ? JSON.parse(payload.content) : payload.content
        if (!content || typeof content !== 'object' || Array.isArray(content)) throw fail('INVALID_ARGUMENT', 'content 必须是对象')
        if (payload.target === 'worldbook') return send(response, 200, { ok: true, worldbook: await worldbook.save(content) })
        const engine = await ready()
        if (payload.target === 'config') return forward(engine, 'config', { config: content }, request, response, url)
        if (payload.target === 'characters' || payload.target === 'outfits') {
          const key = payload.target === 'characters' ? 'characters' : 'outfits'
          if (!Array.isArray(content[key])) throw fail('INVALID_ARGUMENT', key + ' 必须是数组')
          const next = await engine.saveCardDefinitions({ [key]: content[key] }, content.revision)
          return send(response, 200, { ok: true, revision: next.revision, characters: structuredClone(next) })
        }
        throw fail('INVALID_ARGUMENT', '只支持保存 config、characters、outfits、worldbook')
      }
      if (method === 'GET' && route === 'workflows') return send(response, 200, { ok: true, items: (await ready()).cardWorkflows().map(({ id, label }) => ({ id, name: label })), defaultWorkflow: (await ready()).currentConfig().defaultWorkflow })
      if (method === 'POST' && route === 'workflow-import') { const payload = await body(request); return forward(await ready(), 'workflow-import', { workflow: payload.json, name: payload.name }, request, response, url) }
      if (method === 'POST' && route === 'test-channel') return forward(await ready(), 'image-channel-test', await body(request), request, response, url)
      if (method === 'GET' && route === 'comfy-state') return forward(await ready(), 'comfy-test', {}, request, response, url)
      return send(response, 404, { ok: false, error: '没有这个工作台接口' })
    } catch (error) { send(response, error.code === 'FORBIDDEN' ? 403 : error.code === 'REVISION_CONFLICT' ? 409 : error.code === 'INVALID_ARGUMENT' ? 400 : 500, { ok: false, code: error.code, error: error.message }) }
  }
  const image = async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://' + (request.headers.host || 'localhost'))
      // Read-only image embeds also come from the desktop origin or a localhost/127.0.0.1 alias.
      // Management APIs keep their same-origin checks; image names still require a gallery record.
      if (closed) throw fail('NOT_CONFIGURED', '工作台模块已关闭')
      if (!['GET', 'HEAD'].includes(request.method || 'GET')) return send(response, 405, { error: 'method-not-allowed' })
      const item = await gallery.file(decodeURIComponent(url.pathname.slice((BASE + '/img/').length)))
      let start = 0, end = item.size - 1, status = 200
      if (request.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
        if (!match || !match[1] && !match[2]) throw fail('RANGE', '无效图片范围')
        if (!match[1]) start = Math.max(0, item.size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= item.size) { response.writeHead(416, { 'content-range': `bytes */${item.size}` }); response.end(); return }
        status = 206
      }
      response.writeHead(status, { 'content-type': item.mediaType, 'content-length': end - start + 1, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400',
        ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${item.size}` } : {}) })
      if (request.method === 'HEAD') response.end()
      else createReadStream(item.file, { start, end }).on('error', () => response.destroy?.()).pipe(response)
    } catch (error) { send(response, error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' || error.code === 'ENOENT' ? 404 : error.code === 'RANGE' ? 416 : 500, { ok: false, error: error.message }) }
  }

  ctx.inject(['webServer'], scoped => {
    const install = () => {
      const readOrigin = () => scoped.webServer.getOrigin()
      getOrigin = readOrigin
      const offs = [scoped.webServer.register({ kind: 'prefix', path: BASE + '/api', handler: api }), scoped.webServer.register({ kind: 'prefix', path: BASE + '/img', handler: image })]
      return () => { if (getOrigin === readOrigin) getOrigin = null; offs.forEach(off => off?.()) }
    }
    if (scoped.effect) scoped.effect(install, 'dsh-tavern-image: card routes'); else install()
  })
  // Register tool scopes with their owner in the same lifecycle as tools. No global system-prompt injection.
  ctx.inject(['tools', 'tavern'], scoped => {
    const install = () => {
      let alive = true, offs = [], mounted = false, generation = 0
      const unmount = () => { generation++; for (const off of offs.splice(0).reverse()) { try { off?.() } catch {} } mounted = false }
      const update = on => {
        unmount()
        if (!on || !alive || closed || typeof scoped.tavern.toolModes !== 'function') return
        const ticket = generation
        try {
          for (const tool of tools) { const scopeOff = scoped.tavern.toolModes({ name: tool.name, modes: ['card'] }); if (typeof scopeOff === 'function') offs.push(scopeOff); const off = scoped.tools.register(tool); if (typeof off === 'function') offs.push(off) }
          mounted = true
          void worldbook.load().then(() => { if (alive && mounted && enabled && !closed && ticket === generation) { const off = scoped.tavern.skillSource?.({ dir: join(ROOT, 'skills'), role: 'card' }); if (typeof off === 'function') offs.push(off) } }).catch(error => logger.warn?.('dsh-tavern-image: 卡片世界书加载失败 ' + error.message))
        } catch (error) { unmount(); logger.warn?.('dsh-tavern-image: 工作台工具注册失败 ' + error.message) }
      }
      applyTools = update
      enabledReady.then(() => update(enabled)).catch(error => logger.warn?.('dsh-tavern-image: 工作台开关读取失败 ' + error.message))
      return () => { alive = false; if (applyTools === update) applyTools = null; unmount() }
    }
    if (scoped.effect) scoped.effect(install, 'dsh-tavern-image: card tools'); else install()
    if (typeof scoped.tavern.registerGalleryProvider === 'function') {
      const provider = { list: async ({ sessionId }) => (await gallery.list(sessionId || '')).map(item => ({ id: item.id, caption: [item.preset, item.size].filter(Boolean).join(' · '), createdAt: item.at })), read: ({ sessionId, id }) => gallery.read(id, sessionId || ''), remove: ({ sessionId, id }) => gallery.remove(id, sessionId || '') }
      const installGallery = () => scoped.tavern.registerGalleryProvider(provider)
      if (scoped.effect) scoped.effect(installGallery, 'dsh-tavern-image: card gallery'); else installGallery()
    }
  })
  return () => { closed = true; controller.abort(new Error('插件已卸载')); applyTools?.(false) }
}

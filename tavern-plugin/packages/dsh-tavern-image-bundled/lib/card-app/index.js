import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMAGE_PROVIDERS } from '../image-providers.js'
import { publicChannels } from '../image-channels.js'
import { imageReferenceLimit, effectiveImageProvider } from '../image-provider-capabilities.js'
import { resolvePromptMode } from '../prompt-presets.js'
import { CARD_SIZES, SEED_CONTROLS, cardSelection } from './generation.js'
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

  const generate = {
    name: 'gen_image',
    description: '在卡片工作台生成图片，返回带完整 HTTP(S) 地址的 Markdown。把返回的 markdown 原样写进回复，不要省略域名、端口或改成相对路径。先用 read_image_config 查看渠道及提示词格式，按 image-prompt Skill 描述用户要求的一个画面。使用当前配图渠道或临时指定渠道，支持现有全部在线协议和 ComfyUI。用户已授权直接出图时直接提交。失败或任务不确定时先查配图记录，不能自动重复提交。',
    parameters: schema({
      prompt: { type: 'string', description: '画面描述。自然语言渠道可用中文或英文完整句；标签模型用其支持的 tag；structured 按设置保留分节。画风与参考图绑定由引擎追加。' },
      negative: { type: 'string', description: '本张额外排除项，由渠道适配原生负面参数或合入描述。' },
      channel: { type: 'string', description: '精确渠道 ID 或唯一名字；comfyui 选择本地工作流。不填用当前渠道，不改变全局设置。' },
      workflow: { type: 'string', description: 'ComfyUI 工作流 ID，不填使用配图设置的默认工作流。' },
      preset: { type: 'string', description: '本次画风预设 ID 或唯一名字。' },
      preset_positive: { type: 'string', description: '临时覆盖这套预设的正面词（画师串 / 风格词），只对本次生成生效，不写回设置。要改权重或删掉其中某段时，把改好的整串传进来；传空字符串表示本张不用这层词。' },
      preset_negative: { type: 'string', description: '临时覆盖这套预设的负面固定词，只对本次生成生效，不写回设置；传空字符串表示本张不带这层负面词。' },
      size: { type: 'string', description: '竖图、横图、方图或宽x高。自定义宽高建议取 64 的倍数，多数平台按这个对齐，非对齐的值可能被平台改掉。不填沿用渠道或 ComfyUI 工作流尺寸。' },
      count: { type: 'integer', description: '生成 1–4 张，默认 1。' },
      sampler: { type: 'string', description: '仅支持此参数的 NovelAI、SD WebUI 渠道可临时指定。' },
      seed: { type: 'integer', description: '支持种子的渠道可指定第一张种子。不支持时会在提交前报错。' },
      seed_control: { type: 'string', enum: SEED_CONTROLS },
      generation_mode: { type: 'string', enum: ['text', 'reference'], description: '默认 text；reference 使用人物库中的参考图，需要渠道及工作流支持。' },
      subjects: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { characterId: { type: 'string' }, outfitId: { type: 'string' }, name: { type: 'string' } } }, description: 'reference 模式的本张人物与服装 ID，read_character/read_outfit 返回精确 ID。' },
      characters: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { prompt: { type: 'string' }, centers: { type: 'string' }, uc: { type: 'string' } }, required: ['prompt'] }, description: '需要区分多个人物时逐人描述。NovelAI 使用原生角色参数，其他渠道由引擎合成。' },
    }, ['prompt']),
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
          const result = await engine.generateCardImage({ ...args, seed: values[index] }, { ...options, key: 'card-' + randomUUID() })
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

  const character = {
    name: 'read_character', description: '读取共用人物库及角色自带服装、参考图状态。先列清单再按精确 ID 查询；按本张镜头只取可见外貌，不把所有视角同时塞进提示词。', parameters: schema(named), output: output(),
    async execute(args) {
      await assertOpen()
      const book = await source(), list = book.characters.filter(item => item.enabled !== false && item.name)
      const aliases = item => String(item.match || '').split(/[,，\n]/).map(value => value.trim()).filter(Boolean)
      const hit = pick(list, args.name, aliases)
      if (!hit) return { characters: list.map(item => ({ id: item.id, name: item.name, aliases: aliases(item), note: item.note || '' })) }
      const shared = await outfits(), own = (hit.outfits || []).filter(item => item.enabled !== false)
      return { id: hit.id, name: hit.name, traits: { ...hit.traits }, note: hit.note || '', hasReference: Boolean(hit.referenceImage),
        outfits: own.map(item => ({ id: item.id, name: item.name, default: item.default === true, ...parts(item), hasReference: Boolean(item.referenceImage), hasPairedReference: Boolean(item.characterOutfitImage) })),
        outfitRefs: shared.filter(item => hit.outfitRefs?.includes(item.id)).map(item => ({ id: item.id, name: item.name })),
        ...(hit.defaultOutfit ? { defaultOutfit: shared.filter(item => item.id === hit.defaultOutfit).map(item => ({ id: item.id, name: item.name, ...sharedParts(item) })) } : {}) }
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
    name: 'read_image_config', description: '读取全部已保存渠道、当前默认渠道、提示词格式、参考图及种子能力、画风和 ComfyUI 工作流。只读本地配置，不联网探测或生成。指定渠道和预设时优先使用唯一名称，重名时使用 ID。', parameters: schema({}), output: output(),
    async execute() {
      await assertOpen()
      const engine = await ready(), cfg = engine.currentConfig(), workflows = engine.cardWorkflows()
      const channels = (cfg.imageChannels || []).map(item => {
        const protocol = effectiveImageProvider(item)
        return { id: item.id, name: item.name, provider: protocol, model: item.model, promptMode: resolvePromptMode(cfg, protocol), maxReferences: imageReferenceLimit(item), supportsSeed: ['novelai', 'qwen', 'sdwebui'].includes(protocol) && item.options?.protocol !== 'chat', authMode: item.authMode }
      })
      for (const item of workflows) channels.push({ id: 'comfyui', workflowId: item.id, name: item.label, provider: 'comfyui', promptMode: cardSelection(cfg, workflows, { channel: 'comfyui', workflow: item.id }).promptMode, maxReferences: item.bindings?.referenceImages?.length || 0, supportsSeed: Boolean(item.bindings?.seed?.length) })
      return { activeChannelId: cfg.imageBackend === 'comfyui' ? 'comfyui' : cfg.activeImageChannel, channels, defaultWorkflow: cfg.defaultWorkflow,
        presets: (cfg.stylePresets || []).filter(item => item.enabled !== false).map(item => ({ id: item.id, name: item.name, artist: item.artist || '' })), activePreset: cfg.activePreset, sizes: CARD_SIZES }
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
  const tools = [generate, character, outfit, configuration, lookup]

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

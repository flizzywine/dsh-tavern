/**
 * dsh-tavern-gen
 * ==============
 *
 * 卡片工作台专用的生图工具。
 *
 * 和 dsh-tavern-image 的分工：
 *   dsh-tavern-image  游玩模式用，让前台模型在正文里写 image###tag### 标记，插件解析后自动配图。
 *   dsh-tavern-gen    卡片工作台用，Agent 和人商量好提示词，由 Agent 主动调用 gen_image 提交。
 *
 * 生命周期：
 *   1. Agent 查人物库、按世界书规则写好英文提示词，翻译成中文给用户过目
 *   2. 用户点头，Agent 把英文串交给 gen_image
 *   3. 本插件走 dsh-tavern-image 的渠道实现出图，字节落 data/image-cache
 *   4. 返回一个 /dsh-tavern-gen/img/<file> 链接，Agent 写进回复正文
 *
 * 只在 card 模式可见：工具注册后立刻用 tavern.toolModes 声明 { modes: ['card'] }，
 * 游玩模式（story / script）里这个工具根本不出现在工具列表，不会和 dsh-tavern-image 抢活。
 */

import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, readdir, unlink, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 渠道实现直接复用 dsh-tavern-image 的那一份，不再各存副本（改渠道行为只改一处）。
import { generateImage, testImageChannel, IMAGE_PROVIDERS } from '../image-providers.js'
import { comfyGenerate, comfyState } from './comfy-client.js'
import { normalizeWorkflow, scanWorkflows, readWorkflow } from './workflow-import.js'
import { activeChannel } from '../image-channels.js'
import { createCredentialStore } from './credential-store.js'

export const name = 'dsh-tavern-gen'

// Cordis 要求静态声明：没写进这里的服务，连读 ctx.webServer 都会抛
// "cannot get property ... without inject"。
export const inject = ['webServer']

const ROUTE_BASE = '/dsh-tavern-gen'
// 本模块位于 <插件>/lib/card-app/，ROOT 仍指插件根：配置、人物库、skill 与 dsh-tavern-image 共用同一份。
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CONFIG_FILE = path.join(ROOT, 'config.json')
// 人物库已统一：卡片工作台与游玩模式读同一份 definitions.json（traits 以原 dsh-tavern-gen 的版本为准）。
const DEFINITIONS_FILE = path.join(ROOT, 'definitions.json')
const SKILLS_DIR = path.join(ROOT, 'skills')

/**
 * 图片放数据目录，不放在插件目录里。
 *
 * 插件目录会被宿主反复扫描（加载、索引、打包），一张图一两兆，几十张下来
 * 目录变成十几兆，每次扫描都要逐文件 stat，启动会肉眼可见地慢下来。
 * 数据目录随便大，不参与插件加载。
 */
const DATA_DIR = path.join(ROOT, '..', '..', 'image-cache', 'dsh-tavern-gen')
const IMAGE_DIR = path.join(DATA_DIR, 'images')
// 导入的 ComfyUI 工作流放插件目录：都是小 JSON，属于配置而不是会一直长的数据。
const WORKFLOW_DIR = path.join(ROOT, 'workflows-card')
const TOOL_NAME = 'gen_image'
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
// 每张工作流上一次出图用的种子：文件名 -> { base, last, control, updatedAt }。
const SEED_STATE_FILE = path.join(DATA_DIR, 'seed-state.json')

/**
 * 本地 ComfyUI 的种子「生成后控制」，语义照搬 ComfyUI 网页端的 control_after_generate。
 *
 * API 格式的工作流只存种子数值、不存那个开关。插件不接管的话，每次提交的都是工作流里
 * 写死的那个种子：同一提示词永远出同一张图，ComfyUI 还会直接返回上次的缓存。
 * 所以插件按控制方式自己算种子，并给每张工作流记下上一次用的种子（相当于网页里种子框的值）。
 *
 * 这份记录存数据目录，不进 config.json：每出一张图都要写一次，和设置页保存、密钥迁移
 * 抢同一个文件不安全。
 */
const SEED_CONTROLS = ['randomize', 'fixed', 'increment', 'decrement']
// 和 ComfyUI 前端一致：randomize 取 0 到 2^50-1，decrement 从 0 绕回这里。
const SEED_WRAP = 2 ** 50

function seedControlOf(cfg) {
  const value = String(cfg?.seedControl ?? '').trim()
  // 没配时按 ComfyUI 的默认值 randomize：同一提示词连出几张应当各不相同。
  return SEED_CONTROLS.includes(value) ? value : 'randomize'
}

function randomSeed() {
  return Math.floor(Math.random() * SEED_WRAP)
}

/**
 * 接受任何非负整数当种子。
 *
 * 不能用 Number.isSafeInteger 卡门槛：ComfyUI 前端 randomize 的上限远大于 2^53-1，
 * 导出的工作流里完全可能有比安全整数更大的种子。那种值在 JSON 解析时已经丢了精度，
 * 但作为种子仍然合法；用安全整数去卡，会让整张工作流静默地不接管种子，表现和没修过一样。
 */
function validSeed(value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 ? number : null
}

/** 出完一张后种子怎么变。 */
function nextSeed(control, value) {
  if (control === 'increment') {
    const next = value + 1
    // 到 2^50 绕回 0；工作流原值本来就超过这个范围时照常加一，不要凭空拉回起点。
    return value < SEED_WRAP && next >= SEED_WRAP ? 0 : next
  }
  if (control === 'decrement') return value <= 0 ? SEED_WRAP - 1 : value - 1
  if (control === 'randomize') return randomSeed()
  return value
}

/** 工作流文件里写死的种子，作为 fixed / increment / decrement 的起点。 */
function workflowSeed(workflow) {
  for (const binding of workflow?.bindings?.seed ?? []) {
    const seed = validSeed(workflow?.prompt?.[binding.node]?.inputs?.[binding.input])
    if (seed !== null) return seed
  }
  return null
}

/** 三档尺寸。宽高都是 64 的倍数，总像素压在 NovelAI 的 1M 上限以内。 */
const SIZES = {
  竖图: { width: 832, height: 1216 },
  横图: { width: 1216, height: 832 },
  方图: { width: 1024, height: 1024 },
}

/**
 * 出图尺寸的优先级：工具参数 size > 渠道配置里保存的宽高 > 默认竖图。
 *
 * request 本身不带宽高，最终由 image-providers 的 requestedDims 从
 * channel.options.sizeWidth/sizeHeight 读，所以这里解析完统一写回 options。
 * 配置页有宽高输入框，不这么排会让那两格形同虚设。
 */
function resolveImageSize(channel, wanted) {
  const key = SIZES[wanted] ? wanted : ''
  if (key) return { label: key, width: SIZES[key].width, height: SIZES[key].height }
  const width = Number(channel?.options?.sizeWidth)
  const height = Number(channel?.options?.sizeHeight)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { label: '渠道配置', width: Math.round(width), height: Math.round(height) }
  }
  return { label: '竖图', width: SIZES['竖图'].width, height: SIZES['竖图'].height }
}

/**
 * 导入的工作流自带尺寸：工具传 size 时以参数为准，否则用工作流里识别出的宽高。
 * 都没有时返回 unknown：出图不传尺寸，报告也不报数字。
 */
function resolveWorkflowSize(workflow, wanted) {
  const key = SIZES[wanted] ? wanted : ''
  if (key) return { label: key, width: SIZES[key].width, height: SIZES[key].height }
  for (const binding of workflow?.bindings?.size ?? []) {
    const inputs = workflow?.prompt?.[binding.node]?.inputs ?? {}
    if (Number(inputs.width) > 0 && Number(inputs.height) > 0) {
      return { label: '工作流', width: Math.round(Number(inputs.width)), height: Math.round(Number(inputs.height)) }
    }
  }
  // 没有数值型宽高绑定：尺寸由工作流自己的节点决定，插件既不改，也不该编一个值报出去。
  return { label: '工作流', width: null, height: null, unknown: true }
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** 各渠道常见模型。前端做成下拉，不在表里的值仍然可以手填。 */
const MODEL_CHOICES = {
  novelai: [
    ['nai-diffusion-4-5-full', 'V4.5 Full（默认）'],
    ['nai-diffusion-4-5-curated', 'V4.5 Curated'],
    ['nai-diffusion-4-5-full-inpainting', 'V4.5 Full · 重绘'],
    ['nai-diffusion-4-5-curated-inpainting', 'V4.5 Curated · 重绘'],
    ['nai-diffusion-5-full', 'V5 Full'],
    ['nai-diffusion-5-curated', 'V5 Curated'],
    ['nai-diffusion-4-full', 'V4 Full'],
    ['nai-diffusion-4-curated-preview', 'V4 Curated'],
    ['nai-diffusion-4-full-inpainting', 'V4 Full · 重绘'],
    ['nai-diffusion-3-full', 'V3 Full'],
    ['nai-diffusion-3', 'V3 Anime'],
    ['nai-diffusion-3-curated', 'V3 Curated'],
    ['nai-diffusion-furry-3', 'V3 Furry'],
  ],
  openai: [
    ['gpt-image-2.5-flare', 'gpt-image-2.5-flare'],
    ['gpt-image-1', 'gpt-image-1'],
    ['dall-e-3', 'DALL·E 3'],
  ],
  gemini: [['gemini-3.1-flash-image', 'gemini-3.1-flash-image']],
  'gemini-chat': [['gemini-2.5-flash-image', 'gemini-2.5-flash-image']],
  grok: [['grok-imagine-image-2.0', 'grok-imagine-image-2.0']],
  seedream: [['doubao-seedream-5-0-pro-260628', 'Seedream 5.0 Pro']],
  qwen: [['qwen-image-3.0', 'Qwen-Image 3.0']],
  sdwebui: [],
  custom: [],
}

/** 常驻系统提示词。只放刚性规范，细则全在 image-prompt skill 里。 */
const PROMPT_RULES = `# 卡片生图

手上有 \`gen_image\` 工具，说明在卡片工作台，可以用它直接出图。没有这个工具时，下面整段作废。

## 出图流程

1. 用户点名了角色 → 先 \`read_character\` 取外观，别凭记忆写。它给的是分块 tag（face / bodySFW / lowerSFW / bodyNSFW …）：按镜头和衣着挑块拼成前缀——正面穿衣是 face + bodySFW + lowerSFW，背面换 faceBack 和带 Back 的块，只拍下半身就不取 face，半脱按露出的部位两头拼。**每块整块原样复制，块内一个字都不要改**：括号层数、逗号位置、括号里的组合全部保持原样，禁止去重、禁止合并同义 tag、禁止拆开括号里的词。权重掉了这个角色就变样。服装也在返回里（默认服装、角色自带几套）；公共服装库里的套才调 \`read_outfit\`。
2. 不确定有哪些画风或渠道可填 → \`read_image_config\`。它免费，一次问出全部渠道清单、当前激活的是哪条、全部画风和尺寸。用户指定了渠道或画风，就在 \`gen_image\` 里填对应参数，只影响这一次调用。
3. 照 \`image-prompt\` skill 的规则写完整英文串。没读过就先读，凭印象写会稳定出错。
4. **把提示词翻译成中文给用户过目**，逐项说清画面：主体、外观、服装、动作、表情、镜头、场景。默认只给中文，不展示英文原文，用户明确要才给。等他点头。
5. 同意后再调 \`gen_image\`。它返回的是 \`![图片](url)\` 这种 Markdown 语法，**原样写进回复才出图**；只贴裸网址的话 DSH 会渲染成一个蓝色链接，不是图。

**用户预授权就不必等点头。** 用户说过「不用给我看」「直接出」「别问了自己画」这类话，就是授权跳过第 4 步，直接调 \`gen_image\`。

**跳过过目不等于不交代。** 图出来后仍要用中文说清这张画了什么：主体、外观、服装、动作、镜头、场景。交代的是画面内容，不是英文提示词串。

第 4 步本身不能省，除非拿到明确的预授权。每张图都真实扣费，用户没点头就提交等于替他花钱。

## 拼串顺序

画师串和负面词由插件按画风预设自动加，prompt 里不要重复写画师名。

主体（人数、年龄词、性别）→ 恒定外观（发色、发型、瞳色、角耳尾这类特征）→ 体型 → 服装与穿着状态 → 动作与姿势 → 表情与视线 → 镜头景别与机位 → 场景与光线。

全英文，逗号分隔，禁止分号，禁止中文。不要写 masterpiece、best quality 这类质量词，负面词里已经排了。

## 硬规矩

**看不见的不写。** 镜头框不住、被遮挡、背对镜头的部位一个词都不要写。写了不会补全画面，只会把构图拉远或者画出矛盾的解剖。

**画不出的不写。** 心理活动、回忆、气味、温度、比喻、还没发生的事，一律不写。换成能拍到的物理事实，比如「气氛压抑」写成 dark, dim lighting, heavy shadows。

**年龄词不漏。** 人物库标了年龄段的角色，年龄词必须出现在提示词里，漏了出图会飘成成年体型。

**人物库的串是字面量，素材表才是参考。** \`read_character\` 返回的整串是预设好的，必须原样复制，不改括号、不合并不改写；\`find_prompt\` 查到的素材串是别人那张图的完整构图，可以拆开挑着用、按自己的画面改写。两者不要混着处理。

## 细则出处

规则是 skill 里的 md 文件，**不在世界书工具里**。

- **第一步读 \`references/INDEX.md\`**：插件自动生成，列出当前每个参考文件的档位、路径和标题。拿到映射就不用列目录、不用猜文件名
- 然后按索引取文件：\`tavern_read_skill_reference\`，skill 名 \`image-prompt\`，path 填索引里的路径
- **不要用 \`tavern_read_worldbook\`**：它读的是人物卡世界书，本插件规则不在那儿，只会回「尚未引用世界书」——那不代表没有规则可读
- 索引里没有的文件就是不存在；条目增删后索引会跟着重写

档位标在世界书条目上，决定一条规则什么时候该读：

- **always**：任何题材都读全，不读不许写。同一档有好几条就全读，只读一条等于没读全。
- **nsfw**：画性场景加读，同档多条全读。没有就跳过，不要为找它反复翻工具。
- **gore**：画死亡、肢解、酷刑、内脏、排泄时加读，同档多条全读。没有就跳过。
- **prescan**：提交之前扫一遍。
- **manual**：改世界书、人物库、服装库之前读，字段以那里为准。其中「改库一律走接口」讲的是必须走 \`POST /dsh-tavern-gen/api/save\`——直写磁盘的文件会被下一次保存覆盖成空。
- **lookup**：现成的 tag 串，用 \`find_prompt\` 按词查，别一类一类翻。\`find_prompt\` 只查素材表，规则不在它里面。

其余词表不收，直接用英文写。always 档里带了容易写错的那批：镜头与景别、接触对象、身体反应。

跳过 always 直接写，会稳定写进画不出来的东西、镜头拍不到的部位，或者漏掉年龄词。`

const oneLine = text => String(text ?? '').replace(/\s*,?\s*\r?\n+\s*/g, ', ').replace(/[ \t]{2,}/g, ' ').trim().replace(/,{2,}/g, ',').replace(/^,+|,+$/g, '').trim()

/** 按媒体类型挑扩展名。 */
const extensionOf = mediaType =>
  ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[String(mediaType).split(';')[0].toLowerCase()] || 'png'

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  // config.json 的写盘串行化：启动时的密钥迁移和设置页保存可能前后脚发生，不能交叉写。
  let writeQueue = Promise.resolve()
  function writeConfig(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    writeQueue = writeQueue.catch(() => {}).then(() => writeFile(CONFIG_FILE, text, 'utf8'))
    return writeQueue
  }
  // 明文密钥的迁移出口：凭据服务可用时，读到明文就搬进库里，并把文件里的明文抹掉。
  // 必须走 persist 再写盘——直接把内存里的 config 写回去，等于把明文原样留在磁盘。
  const credentials = createCredentialStore({
    logger,
    save: async target => {
      const out = structuredClone(target)
      await credentials.persist(target, out)
      await writeConfig(out)
    },
  })
  let settings = null
  let loading = null
  let origin = ''
  // 工具开关。存的是「装/卸」的入口，改配置后立刻生效，不用重启插件。
  let applyTools = null

  /** 配置里没写 enabled 时按开启处理：旧配置升级过来行为不变。 */
  const toolsEnabled = cfg => cfg?.enabled !== false

  /**
   * 读 config.json 并补上密钥库里的密钥。
   *
   * 合并进 dsh-tavern-image 之后，两个模块写的是同一份 config.json：
   * 「配图」页保存后，卡片这一侧必须立刻看到新值，所以这里不再长期缓存，
   * 每次都读文件（十几 KB，开销可以忽略），并发调用共用一个进行中的读取。
   */
  async function currentConfig() {
    if (loading) return loading
    loading = (async () => {
      let raw
      try { raw = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }
      catch (error) { throw new Error('读不到插件配置 config.json：' + (error?.message ?? error)) }
      await credentials.load(raw)
      settings = raw
      return raw
    })().finally(() => { loading = null })
    return loading
  }

  // ── 种子状态：每张工作流一个「当前种子」，读写串行，避免并发出图互相覆盖 ──
  let seedQueue = Promise.resolve()

  async function readSeedState() {
    try {
      const value = JSON.parse(await readFile(SEED_STATE_FILE, 'utf8'))
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    } catch { return {} }
  }

  /**
   * 给本次出图的每一张分配种子，并记下最后一张用的种子。
   *
   * 第一张的起点：
   * - 调用时显式给了 seed：用它，等于手动改了 ComfyUI 的种子框。
   * - randomize：抽新种子。不复用工作流里的旧值，那个值多半已经跑过，
   *   提示词一样时 ComfyUI 会直接返回缓存，等于没出新图。
   * - fixed：沿用上一次出图的种子，没有记录时用工作流文件里的值。
   *   这样从 randomize 切到 fixed，重现的就是刚看到的那张，方便只改一处做对比。
   * - increment / decrement：上一次的种子加一 / 减一，没有记录时从工作流文件里的值起算。
   * 同一次调用出多张时，后面每张按控制方式从前一张推算（fixed 张张相同）。
   *
   * 工作流文件里的种子被改过（重新导出）时，上一次的记录作废，从新值起算。
   * 工作流没有识别出种子输入时返回 null，出图不碰种子。
   */
  async function takeSeeds(workflowFile, workflow, control, count, explicit) {
    if (!Array.isArray(workflow?.bindings?.seed) || !workflow.bindings.seed.length) return null
    const base = workflowSeed(workflow)
    // 排队执行：种子要读改写同一个 JSON，并发出图会互相覆盖。
    const task = seedQueue.catch(() => {}).then(async () => {
      const state = await readSeedState()
      const key = String(workflowFile)
      const saved = state[key] && typeof state[key] === 'object' ? state[key] : null
      const last = saved && saved.base === base ? validSeed(saved.last) : null
      let current
      if (explicit !== null) current = explicit
      else if (control === 'randomize') current = randomSeed()
      else if (last === null) current = base ?? randomSeed()
      else current = nextSeed(control, last)
      const seeds = []
      for (let index = 0; index < count; index += 1) {
        if (index > 0) current = nextSeed(control, current)
        seeds.push(current)
      }
      state[key] = { base, last: current, control, updatedAt: new Date().toISOString() }
      await mkdir(DATA_DIR, { recursive: true })
      await writeFile(SEED_STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
      return seeds
    })
    seedQueue = task.catch(() => {})
    return task
  }

  /** 读配置里指定的默认工作流；没配或文件坏了返回 null，由调用方报错。 */
  async function loadDefaultWorkflow(cfg) {
    const file = String(cfg?.defaultWorkflow ?? '').trim()
    if (!file) return null
    try { return await readWorkflow(WORKFLOW_DIR, file) }
    catch (error) {
      logger.warn?.('dsh-tavern-gen: 读取工作流失败 ' + file + '：' + (error?.message ?? error))
      return null
    }
  }

  /** 挑画风预设：指定名字优先，否则用 activePreset，都没有就退回 styleArtists。 */
  function pickPreset(cfg, wanted) {
    const list = Array.isArray(cfg.stylePresets) ? cfg.stylePresets.filter(item => item && item.enabled !== false) : []
    const key = String(wanted ?? '').trim()
    let preset = null
    if (key) {
      preset = list.find(item => item.id === key || item.name === key)
      if (!preset) throw new Error(`没有叫「${key}」的画风预设。现有：${list.map(item => item.name).join('、') || '无'}`)
    } else {
      preset = list.find(item => item.id === cfg.activePreset) || null
    }
    return {
      artist: oneLine(preset?.artist || cfg.styleArtists || ''),
      negative: oneLine(preset?.negative || cfg.styleNegative || ''),
      name: preset?.name || '',
      position: preset?.position === 'suffix' ? 'suffix' : 'prefix',
    }
  }

  /** 把画师串和正文提示词合成最终正向串。 */
  function composePrompt(body, preset) {
    if (!preset.artist) return body
    return preset.position === 'suffix' ? `${body}, ${preset.artist}` : `${preset.artist}, ${body}`
  }

  // ── 图片路由：把 cache/images 下的文件喂给浏览器 ────────────────────────
  /**
   * 流式发送，不把整张图读进内存。以前用 readFile 整读，画廊一次请求十几张
   * 1.5 MB 的图时，内存峰值和事件循环都会被压住。支持 Range，大图分段更省。
   */
  function installRoute(web) {
    const handler = async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        const name = decodeURIComponent(url.pathname.slice((ROUTE_BASE + '/img/').length))
        if (!/^[\w.-]+\.(png|jpe?g|webp|gif)$/i.test(name) || name.includes('..')) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('文件名不合法')
          return
        }
        const file = path.join(IMAGE_DIR, name)
        const info = await stat(file)
        const type = MIME[name.split('.').pop().toLowerCase()] || 'application/octet-stream'
        const base = {
          'content-type': type,
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=604800',
        }

        const range = String(request.headers.range ?? '')
        if (/^bytes=\d*-\d*$/.test(range)) {
          const [rawStart, rawEnd] = range.replace('bytes=', '').split('-')
          const start = rawStart ? Math.min(Number(rawStart) || 0, info.size - 1) : 0
          const end = rawEnd ? Math.min(Number(rawEnd) || 0, info.size - 1) : info.size - 1
          if (start > end) {
            response.writeHead(416, { 'content-range': `bytes */${info.size}` })
            response.end()
            return
          }
          response.writeHead(206, {
            ...base,
            'content-length': String(end - start + 1),
            'content-range': `bytes ${start}-${end}/${info.size}`,
          })
          createReadStream(file, { start, end }).on('error', () => response.destroy()).pipe(response)
          return
        }

        response.writeHead(200, { ...base, 'content-length': String(info.size) })
        if (String(request.method ?? 'GET').toUpperCase() === 'HEAD') { response.end(); return }
        createReadStream(file).on('error', () => response.destroy()).pipe(response)
      } catch (error) {
        const missing = error?.code === 'ENOENT'
        response.writeHead(missing ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end(missing ? '图片不存在' : String(error?.message ?? error))
      }
    }
    return web.register({ kind: 'prefix', path: ROUTE_BASE + '/img', handler })
  }

  // ── 设置页 API ────────────────────────────────────────────────────────
  const REFERENCE_DIR = path.join(SKILLS_DIR, 'image-prompt', 'references')
  const WORLDBOOK_FILE = path.join(ROOT, 'card-worldbook.json')
// 随包默认书：公开版只带规则骨架，首次安装时拷成本地书，之后用户怎么改都不会动到它。
const WORLDBOOK_DEFAULT = path.join(ROOT, 'card-worldbook.default.json')
  // 画廊记录也放数据目录：它会一直长，留在插件目录会让宿主每次扫描都读一遍。
  const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')
  const MAX_JOBS = 500

  /** 画廊记录：每次出图追加一条，只保留最近 MAX_JOBS 条。 */
  async function loadJobs() {
    try {
      const list = JSON.parse(await readFile(JOBS_FILE, 'utf8'))
      return Array.isArray(list) ? list : []
    } catch { return [] }
  }

  /**
   * 服装库。字段照 dsh-tavern-image 的规范固定为七块：
   * upper 上身 / lower 下身 / shoes 鞋 / accessory 配饰 / full 整套兜底 / back 背影补充 / negative 不该出现的
   */
  /**
   * 按 id 或名字挑一条渠道。不传 key 就沿用当前激活的渠道。
   *
   * 单次调用指定渠道，不会改 activeImageChannel，也不影响下一次调用。
   * provider 以渠道自己为准，不受全局 imageBackend 限制——用户点名了就用它。
   */
  function pickChannel(cfg, key) {
    const target = String(key ?? '').trim()
    if (!target) return activeChannel(cfg)

    const list = Array.isArray(cfg.imageChannels) ? cfg.imageChannels : []
    const hit = list.find(item => item?.id === target)
      || list.find(item => String(item?.name ?? '') === target)
      || list.find(item => String(item?.name ?? '').includes(target))
    if (!hit) {
      const names = list.map(item => (item?.name || item?.id)).filter(Boolean)
      throw new Error(`没有「${target}」这个渠道。现有：${names.join('、') || '无'}`)
    }
    const clone = structuredClone(hit)
    if (clone.provider === 'atlascloud') {
      clone.provider = 'custom'
      clone.options = { ...clone.options, apiProtocol: 'atlascloud' }
    }
    return clone
  }

  const OUTFIT_FIELDS = ['upper', 'lower', 'shoes', 'accessory', 'full', 'back', 'negative']

  /**
   * 进 prompt 的外观块，顺序固定：正面穿衣 → 正面赤裸 → 背面穿衣 → 背面赤裸。
   * feature 只用来挑表情、negative 走负面参数，都不在这个清单里。
   */
  const APPEARANCE_FIELDS = [
    'face', 'bodySFW', 'lowerSFW',
    'bodyNSFW', 'lowerNSFW',
    'faceBack', 'bodySFWBack', 'lowerSFWBack',
    'bodyNSFWBack', 'lowerNSFWBack',
  ]

  /** 只取一套服装里填了值的字段：空格子和 name/enabled/default 这类元数据不算。 */
  const outfitTags = item => Object.fromEntries(OUTFIT_FIELDS
    .filter(key => String(item?.[key] ?? '').trim())
    .map(key => [key, String(item[key]).trim()]))

  async function loadOutfits() {
    // 与配图侧的「通用服装库」共用一份数据：definitions.json 顶层的 outfits。
    // 卡片工作台的 read_outfit 查的就是这里，和角色自带的 outfits 是两回事。
    let raw
    try { raw = JSON.parse(await readFile(DEFINITIONS_FILE, 'utf8')) }
    catch { raw = { outfits: [] } }
    const list = Array.isArray(raw?.outfits) ? raw.outfits : []
    return {
      version: 1,
      outfits: list.map(item => {
        const entry = {
          id: String(item?.id ?? ''),
          name: String(item?.name ?? ''),
          enabled: item?.enabled !== false,
        }
        for (const key of OUTFIT_FIELDS) entry[key] = String(item?.[key] ?? '')
        return entry
      }).filter(item => item.id || item.name),
    }
  }

  /** 写画廊记录。数据目录可能还没建过，先确保存在。 */
  async function saveJobs(list) {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(JOBS_FILE, JSON.stringify(list, null, 2), 'utf8')
  }

  async function appendJobs(entries) {
    if (!entries.length) return
    const list = await loadJobs()
    list.push(...entries)
    await saveJobs(list.slice(-MAX_JOBS))
  }

  /**
   * 世界书按「桶」组织：每个桶一个子目录、一组条目。
   * 桶的 id / 名字 / 说明都存在 worldbook.json 里，加一本新世界书只要往数组里加一项，代码不用动。
   */
  /** 读取档位：always 任何题材都读，nsfw / gore 按题材加读，lookup 按段查，manual 改库时读，prescan 提交前扫。 */
  const READ_MODES = ['always', 'nsfw', 'gore', 'lookup', 'manual', 'prescan']

  async function loadWorldbook() {
    let raw
    try {
      raw = JSON.parse(await readFile(WORLDBOOK_FILE, 'utf8'))
    } catch {
      // 首次安装：随包带一份默认书（只有规则骨架，没有私用素材），拷成本地书再用。
      try {
        raw = JSON.parse(await readFile(WORLDBOOK_DEFAULT, 'utf8'))
        await writeFile(WORLDBOOK_FILE, JSON.stringify(raw, null, 2), 'utf8')
      } catch {
        raw = { version: 3, buckets: [] }
      }
    }
    const list = Array.isArray(raw?.buckets) ? raw.buckets : []
    return {
      version: 3,
      buckets: list.map(bucket => ({
        id: String(bucket?.id ?? ''),
        label: String(bucket?.label ?? bucket?.id ?? ''),
        intro: String(bucket?.intro ?? ''),
        entries: (Array.isArray(bucket?.entries) ? bucket.entries : []).map(item => {
          const mode = String(item?.mode ?? 'always')
          return {
            id: String(item?.id ?? ''),
            title: String(item?.title ?? ''),
            content: String(item?.content ?? ''),
            mode: READ_MODES.includes(mode) ? mode : 'always',
            enabled: item?.enabled !== false,
          }
        }),
      })).filter(bucket => bucket.id),
    }
  }

  /**
   * 提示词表：worldbook.json 里的某个分册，一条一个分类。
   *
   * 正文格式固定成「**名字**」换行「`tag 串`」——写进 md 给人看是清单，
   * 这里按行读回来是结构化数据。用户在设置页改条目，工具立刻跟着变。
   */
  async function loadTable(bucketId) {
    const book = await loadWorldbook()
    const bucket = book.buckets.find(item => item.id === bucketId)
    if (!bucket) return null
    const groups = []
    for (const entry of bucket.entries) {
      if (entry.enabled === false) continue
      const items = []
      let name = ''
      for (const line of entry.content.split(/\r?\n/)) {
        const text = line.trim()
        const heading = /^\*\*(.+?)\*\*$/.exec(text)
        if (heading) { name = heading[1].trim(); continue }
        const tags = /^`(.+)`$/.exec(text)
        if (tags && name) { items.push({ name, tags: tags[1].trim() }); name = '' }
      }
      groups.push({ id: entry.id, title: entry.title, items })
    }
    return { label: bucket.label || bucket.id, intro: bucket.intro, groups }
  }

  /**
   * 把条目写成一份份独立的 markdown，一个条目一个文件。
   *
   * 一个条目一个文件，档位写在条目上，由 writeIndex() 生成索引告诉 Agent 读哪几份。
   *   合并成上万字的大文件，模型往往读一半就开始写。
   *   用户在前端看到的是条目卡片，文件怎么拆对他完全透明。
   */
  async function writeReference(bucket, entries) {
    const dir = path.join(REFERENCE_DIR, bucket)
    await mkdir(dir, { recursive: true })
    // 先清空旧的：停用或删除的条目不该留下残骸。
    const existing = await readdir(dir).catch(() => [])
    for (const name of existing) {
      if (name.endsWith('.md')) await unlink(path.join(dir, name)).catch(() => {})
    }
    for (const entry of entries) {
      if (entry.enabled === false) continue
      const title = String(entry.title ?? '').trim()
      if (!title) continue
      const safe = String(entry.id || title).replace(/[^a-zA-Z0-9_-]/g, '-')
      // 内容通常自带一级标题；只有正文没写标题时，才用条目名补一个。
      const raw = String(entry.content ?? '').trim()
      const body = raw.startsWith('#') ? `${raw}\n` : `# ${title}\n\n${raw}\n`
      await writeFile(path.join(dir, `${safe}.md`), body, 'utf8')
    }
  }

  /**
   * 生成 references/INDEX.md：一份「档位 → 文件」的映射。
   *
   * 为什么要有它：SKILL.md 不能写死文件名（条目会增删），可 Agent 只看 SKILL.md
   * 又不知道 references/ 下现在有哪些文件、各是什么档。让它去列目录，没 shell 的环境
   * 直接卡住，有 shell 也要白搭一次调用。这份索引由世界书条目直接生成，永远和磁盘同步。
   */
  async function writeIndex(buckets) {
    if (!Array.isArray(buckets) || !buckets.length) return
    const body = []
    for (const bucket of buckets) {
      const entries = (Array.isArray(bucket.entries) ? bucket.entries : [])
        .filter(entry => entry.enabled !== false && String(entry.title ?? '').trim())
      if (!entries.length) continue
      body.push('## ' + (bucket.label || bucket.id) + ' · `' + bucket.id + '`')
      const intro = String(bucket.intro ?? '').trim()
      if (intro) body.push('', intro)
      // 整册都是 lookup 档就没必要逐个列：这些文件不读，走 find_prompt 检索。
      if (entries.every(entry => String(entry.mode || 'always') === 'lookup')) {
        body.push('', '整册都是 `lookup` 档，用 `find_prompt` 按词查，不读文件，这里不逐个列出。', '')
        continue
      }
      body.push('', '| 档位 | 文件 | 标题 |', '|---|---|---|')
      for (const entry of entries) {
        const safe = String(entry.id || entry.title).replace(/[^a-zA-Z0-9_-]/g, '-')
        body.push('| `' + String(entry.mode || 'always') + '` | `references/' + bucket.id + '/' + safe + '.md` | ' + String(entry.title).trim() + ' |')
      }
      body.push('')
    }
    const text = [
      '# 参考文件索引',
      '',
      '世界书保存时自动生成，不要手改。条目增删后这份会跟着重写。',
      '',
      '读法：`tavern_read_skill_reference`，skill 名 `image-prompt`，path 填表格里的路径。',
      '',
      '| 档位 | 什么时候读 |',
      '|---|---|',
      '| `always` | 写任何 prompt 之前，全部读完 |',
      '| `nsfw` | 画性场景加读 |',
      '| `gore` | 画死亡、肢解、酷刑、内脏、排泄加读 |',
      '| `prescan` | 提交前扫一遍 |',
      '| `manual` | 改世界书、人物库、服装库之前读 |',
      '| `lookup` | 用 `find_prompt` 按词查，不读文件 |',
      '',
      ...body,
    ].join('\n') + '\n'
    await mkdir(REFERENCE_DIR, { recursive: true })
    await writeFile(path.join(REFERENCE_DIR, 'INDEX.md'), text, 'utf8')
  }

  // 启动时补一次投影：首次安装、或者投影被手动删掉时，Agent 才不会无路可走。
  // 先清掉已不存在的分册，再按条目重写 md，最后写索引。
  void loadWorldbook().then(async book => {
    const keep = book.buckets.map(bucket => bucket.id)
    await pruneReferences(keep).catch(() => {})
    for (const bucket of book.buckets) await writeReference(bucket.id, bucket.entries).catch(() => {})
    await writeIndex(book.buckets)
  }).catch(() => {})

  /** 删掉已经不在桶列表里的旧目录，以及早期合并版留下的散文件。 */
  async function pruneReferences(keep) {
    const allowed = new Set(keep)
    const items = await readdir(REFERENCE_DIR, { withFileTypes: true }).catch(() => [])
    for (const item of items) {
      if (item.isDirectory()) {
        if (!allowed.has(item.name)) await rm(path.join(REFERENCE_DIR, item.name), { recursive: true, force: true }).catch(() => {})
      } else if (item.name.endsWith('.md')) {
        await unlink(path.join(REFERENCE_DIR, item.name)).catch(() => {})
      }
    }
  }

  async function readBody(request) {
    const chunks = []
    let total = 0
    for await (const chunk of request) {
      total += chunk.length
      if (total > 4 * 1024 * 1024) throw new Error('提交内容超过 4 MB')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  function send(response, status, value) {
    const isText = typeof value === 'string'
    response.writeHead(status, { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' })
    response.end(isText ? value : JSON.stringify(value))
  }

  /** 抹掉密钥再给前端，密钥只留在宿主内存里。 */
  function publicConfig(cfg) {
    return {
      ...cfg,
      imageChannels: (Array.isArray(cfg.imageChannels) ? cfg.imageChannels : []).map(({ apiKey, password, ...rest }) => ({
        ...rest,
        hasApiKey: Boolean(apiKey),
        hasPassword: Boolean(password),
      })),
    }
  }

  function installApi(web) {
    const handler = async (request, response) => {
      try {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
        const route = url.pathname.slice((ROUTE_BASE + '/api').length).replace(/^\/+/, '')
        const method = String(request.method ?? 'GET').toUpperCase()

        if (route === 'state' && method === 'GET') {
          const cfg = await currentConfig()
          // 人物库和服装库都以对象形式给前端：前端要按数组逐条渲染。
          // 读失败必须硬报错，不能回落到空库：前端拿到 {version,characters:[]} 后会
          // 原样 POST /api/save 写回磁盘，一次空白展示就能把真实数据覆盖成空。
          let characters
          try {
            characters = JSON.parse(await readFile(DEFINITIONS_FILE, 'utf8'))
          } catch (error) {
            const detail = error?.message ?? String(error)
            logger.warn?.('dsh-tavern-gen: 人物库读取或解析失败 ' + detail)
            return send(response, 500, {
              ok: false,
              error: '人物库 definitions.json 读取或解析失败：' + detail,
              hint: '常见原因是文件开头带了 BOM（EF BB BF）或存在 JSON 语法错误。修好文件后刷新；此状态下不要点击保存，否则会用空库覆盖。',
            })
          }
          return send(response, 200, {
            config: publicConfig(cfg),
            worldbook: await loadWorldbook(),
            characters,
            outfits: await loadOutfits(),
            providers: IMAGE_PROVIDERS,
            models: MODEL_CHOICES,
          })
        }

        if (route === 'gallery' && method === 'GET') {
          const list = await loadJobs()
          // 用当前 origin 重拼链接：DSH 重启后端口可能变，存下来的旧 URL 会失效。
          const items = list.slice().reverse().map(item => ({
            ...item,
            url: `${origin}${ROUTE_BASE}/img/${item.file}`,
          }))
          return send(response, 200, { items })
        }

        if (route === 'gallery-delete' && method === 'POST') {
          const payload = JSON.parse(await readBody(request) || '{}')
          const id = String(payload?.id ?? '')
          if (!id) return send(response, 400, { ok: false, error: '缺少 id' })
          const list = await loadJobs()
          const next = list.filter(item => item.id !== id)
          await saveJobs(next)
          const removed = list.find(item => item.id === id)
          // 记录和图片文件一起删：只删记录会留下一堆孤儿文件，越攒越多。
          if (removed?.file) {
            await unlink(path.join(IMAGE_DIR, path.basename(removed.file))).catch(() => {})
          }
          return send(response, 200, { ok: true, removed: list.length - next.length, file: removed?.file ?? '' })
        }

        if (route === 'gallery-clear' && method === 'POST') {
          const list = await loadJobs()
          for (const item of list) {
            if (item?.file) await unlink(path.join(IMAGE_DIR, path.basename(item.file))).catch(() => {})
          }
          await saveJobs([])
          return send(response, 200, { ok: true, removed: list.length })
        }

        // 工具开关只改 config 里的 enabled 一个字段：读盘后原地改再写回，
        // 不碰渠道、密钥引用和其它模块的字段（合并后 config.json 是两边共用的）。
        if (route === 'tools-enabled' && method === 'POST') {
          const payload = JSON.parse(await readBody(request) || '{}')
          const enabled = payload?.enabled !== false
          let next
          try { next = JSON.parse(await readFile(CONFIG_FILE, 'utf8')) }
          catch (error) { return send(response, 400, { ok: false, error: '读不到配置：' + (error?.message ?? error) }) }
          next.enabled = enabled
          await writeConfig(JSON.stringify(next, null, 2))
          try { applyTools?.(enabled) } catch (error) {
            logger.warn?.('dsh-tavern-image/card: 应用工具开关失败 ' + (error?.message ?? error))
          }
          return send(response, 200, { ok: true, enabled })
        }

        if (route === 'save' && method === 'POST') {
          const payload = JSON.parse(await readBody(request) || '{}')
          const target = String(payload?.target ?? '')
          const content = payload?.content
          const allowed = ['config', 'characters', 'worldbook', 'outfits']
          if (!allowed.includes(target)) {
            return send(response, 400, { ok: false, error: `不能保存「${target}」，只接受：${allowed.join('、')}` })
          }

          if (target === 'config') {
            // 前端提交的是对象；手写工具可能传字符串，两种都收。
            let next
            try { next = typeof content === 'string' ? JSON.parse(content) : content }
            catch (error) { return send(response, 400, { ok: false, error: '配置不是合法 JSON：' + error.message }) }
            if (next === null || typeof next !== 'object' || Array.isArray(next)) {
              return send(response, 400, { ok: false, error: 'config 的 content 必须是配置对象' })
            }
            // 前端拿到的配置没有密钥，写回时按 id 把原有密钥补回来。
            // 前端填了新密钥就保留新值，persist 会把它写进凭据库、并从待写盘的对象里抹掉。
            // password 必须一起补：basic 鉴权的渠道只补 apiKey 会把密码清空。
            const previous = await currentConfig()
            next.imageChannels = (Array.isArray(next.imageChannels) ? next.imageChannels : []).map(channel => {
              const old = (previous.imageChannels ?? []).find(item => item?.id === channel?.id)
              if (!old) return channel
              const kept = { ...channel }
              if (!kept.apiKey && old.apiKey) kept.apiKey = old.apiKey
              if (!kept.password && old.password) kept.password = old.password
              return kept
            })
            next.credentialRefs = previous.credentialRefs ?? next.credentialRefs
            // 写盘前把明文密钥搬进凭据服务；服务不可用时 persist 原样返回，明文继续留在文件里。
            await credentials.persist(previous, next)
            const text = JSON.stringify(next, null, 2)
            await writeConfig(text)
            // 清缓存：下一次 gen_image 与 read_image_config 立刻用新配置，不用重启。
            settings = null
            // 开关改了要当场生效，否则用户得重启才看得出区别。
            try { applyTools?.(toolsEnabled(next)) } catch (error) {
              logger.warn?.('dsh-tavern-gen: 应用工具开关失败 ' + (error?.message ?? error))
            }
            return send(response, 200, {
              ok: true,
              target,
              enabled: toolsEnabled(next),
              bytes: Buffer.byteLength(text, 'utf8'),
              activeImageChannel: next.activeImageChannel ?? '',
              activePreset: next.activePreset ?? '',
              channelCount: Array.isArray(next.imageChannels) ? next.imageChannels.length : 0,
              presetCount: Array.isArray(next.stylePresets) ? next.stylePresets.length : 0,
            })
          }

          if (target === 'characters') {
            if (content === null || typeof content !== 'object') return send(response, 400, { ok: false, error: 'characters 的 content 必须是对象' })
            // 默认服装是指向公共服装库的一格引用：那套被删掉之后引用会悬空。
            // 写盘前清掉，否则角色会一直指着一个不存在的套装。
            const known = new Set()
            for (const item of (await loadOutfits()).outfits) {
              if (item.id) known.add(item.id)
              if (item.name) known.add(item.name)
            }
            const next = structuredClone(content)
            let cleared = 0
            for (const character of Array.isArray(next?.characters) ? next.characters : []) {
              const ref = String(character?.defaultOutfit ?? '').trim()
              if (!ref) continue
              if (known.has(ref)) { character.defaultOutfit = ref; continue }
              character.defaultOutfit = ''
              cleared += 1
            }
            const text = JSON.stringify(next, null, 2)
            await writeFile(DEFINITIONS_FILE, text, 'utf8')
            return send(response, 200, { ok: true, target, bytes: Buffer.byteLength(text, 'utf8'), clearedDefaultOutfits: cleared })
          }

          if (target === 'outfits') {
            if (content === null || typeof content !== 'object') return send(response, 400, { ok: false, error: 'outfits 的 content 必须是对象' })
            // 内容里没有 outfits 数组就拒绝：前端传错对象时宁可报错，也不能把库清空。
            if (!Array.isArray(content.outfits)) {
              return send(response, 400, { ok: false, error: 'outfits 的 content 必须带 outfits 数组，收到的是：' + Object.keys(content).join('、') })
            }
            const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
            const list = content.outfits.map(item => {
              const entry = {
                id: String(item?.id ?? '').trim() || stamp(),
                name: String(item?.name ?? '').trim(),
                enabled: item?.enabled !== false,
              }
              for (const key of OUTFIT_FIELDS) entry[key] = String(item?.[key] ?? '').trim()
              return entry
            })
            for (const entry of list) {
              if (!entry.name) return send(response, 400, { ok: false, error: '有一套服装没写名字，先补上再保存' })
            }
            // 写回 definitions.json 的顶层 outfits：人物、分组、其它设置原样保留。
            let book
            try { book = JSON.parse(await readFile(DEFINITIONS_FILE, 'utf8')) }
            catch (error) { return send(response, 400, { ok: false, error: '读不到人物库，服装没有保存：' + (error?.message ?? error) }) }
            book.outfits = list
            const text = JSON.stringify(book, null, 2)
            await writeFile(DEFINITIONS_FILE, text, 'utf8')
            return send(response, 200, { ok: true, target, bytes: Buffer.byteLength(text, 'utf8'), count: list.length })
          }

          // worldbook：桶结构，落盘后按桶重新生成 skill 参考文件。
          if (content === null || typeof content !== 'object') return send(response, 400, { ok: false, error: 'worldbook 的 content 必须是对象' })
          const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
          const rawBuckets = Array.isArray(content.buckets) ? content.buckets : []
          if (!rawBuckets.length) return send(response, 400, { ok: false, error: '至少要有—个世界书分册' })
          const seen = new Set()
          const buckets = []
          for (const raw of rawBuckets) {
            const id = String(raw?.id ?? '').trim()
            // 目录名直接来自 id，必须是安全的 ASCII slug。
            if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
              return send(response, 400, { ok: false, error: `分册 id 只能用 1–32 位小写字母、数字和连字符：${id || '(空)'}` })
            }
            if (seen.has(id)) return send(response, 400, { ok: false, error: `分册 id 重复：${id}` })
            seen.add(id)
            const entries = (Array.isArray(raw?.entries) ? raw.entries : []).map(item => {
              const mode = String(item?.mode ?? 'always')
              return {
                id: String(item?.id ?? '').trim() || stamp(),
                title: String(item?.title ?? '').trim(),
                content: String(item?.content ?? ''),
                mode: READ_MODES.includes(mode) ? mode : 'always',
                enabled: item?.enabled !== false,
              }
            })
            for (const entry of entries) {
              if (!entry.title) return send(response, 400, { ok: false, error: `「${raw?.label || id}」里有条目没写标题，先补上再保存` })
            }
            buckets.push({
              id,
              label: String(raw?.label ?? id).trim() || id,
              intro: String(raw?.intro ?? ''),
              entries,
            })
          }
          const book = { version: 3, buckets }
          await writeFile(WORLDBOOK_FILE, JSON.stringify(book, null, 2), 'utf8')
          await pruneReferences(buckets.map(bucket => bucket.id))
          for (const bucket of buckets) await writeReference(bucket.id, bucket.entries)
          await writeIndex(buckets)
          return send(response, 200, {
            ok: true,
            target,
            bytes: Buffer.byteLength(JSON.stringify(book), 'utf8'),
            counts: Object.fromEntries(buckets.map(bucket => [bucket.id, bucket.entries.length])),
          })
        }

        if (route === 'test-channel' && method === 'POST') {
          const payload = JSON.parse(await readBody(request) || '{}')
          const id = String(payload?.id ?? '')
          if (!id) return send(response, 400, { ok: false, error: '缺少渠道 id' })
          const cfg = await currentConfig()
          const target = (Array.isArray(cfg.imageChannels) ? cfg.imageChannels : []).find(item => item?.id === id)
          if (!target) return send(response, 404, { ok: false, error: '没有这个渠道，先保存渠道配置再测试' })
          const channel = structuredClone(target)
          if (channel.provider === 'atlascloud') {
            channel.provider = 'custom'
            channel.options = { ...channel.options, apiProtocol: 'atlascloud' }
          }
          // testImageChannel 只打不计费的探测接口；连不上也返回 200，让前端显示具体原因。
          try {
            const result = await testImageChannel(channel)
            return send(response, 200, result.ok ? result : { ...result, error: result.message || '渠道连接失败' })
          } catch (error) {
            const message = String(error?.message ?? error)
            return send(response, 200, { ok: false, status: 'configured', message, error: message })
          }
        }

        if (route === 'workflows' && method === 'GET') {
          const cfg = await currentConfig()
          return send(response, 200, {
            ok: true,
            items: await scanWorkflows(WORKFLOW_DIR),
            defaultWorkflow: String(cfg.defaultWorkflow ?? ''),
          })
        }

        if (route === 'workflow-import' && method === 'POST') {
          const payload = JSON.parse(await readBody(request) || '{}')
          let raw = payload?.json
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw) } catch { return send(response, 400, { ok: false, error: '粘贴的内容不是合法 JSON' }) }
          }
          const normalized = normalizeWorkflow(raw, String(payload?.name ?? '').trim() || '导入的工作流')
          if (!normalized) return send(response, 400, { ok: false, error: '认不出这是一张 ComfyUI API 工作流（需要带 class_type 的节点表）' })
          const base = (String(payload?.name ?? '').trim() || normalized.name || 'workflow')
            .replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60) || 'workflow'
          await mkdir(WORKFLOW_DIR, { recursive: true })
          let file = `${base}.json`
          let index = 2
          while (await stat(path.join(WORKFLOW_DIR, file)).catch(() => null)) file = `${base}-${index++}.json`
          const book = {
            format: 'dsh-tavern-gen-v1',
            name: normalized.name,
            prompt: normalized.prompt,
            outputNode: normalized.outputNode,
            bindings: normalized.bindings,
          }
          await writeFile(path.join(WORKFLOW_DIR, file), JSON.stringify(book, null, 2), 'utf8')
          // 导入即设为默认；锁定时只写文件，不动当前默认。
          const cfg = await currentConfig()
          if (!cfg.lockWorkflow) {
            cfg.defaultWorkflow = file
            await writeConfig(cfg)
            settings = null
          }
          return send(response, 200, {
            ok: true,
            file,
            name: normalized.name,
            nodes: Object.keys(normalized.prompt).length,
            outputNode: normalized.outputNode,
            bindings: Object.fromEntries(Object.entries(normalized.bindings).map(([key, value]) => [key, value.length])),
          })
        }

        if (route === 'comfy-state' && method === 'GET') {
          const cfg = await currentConfig()
          const state = await comfyState(cfg)
          return send(response, 200, { ...state, comfyUrl: cfg.comfyUrl ?? '' })
        }

        // 兜底带上可用路由，下次 404 能一眼看出是版本旧还是路径写错。
        return send(response, 404, {
          ok: false,
          error: `没有这个接口：${method} ${route || '/'}`,
          routes: ['GET /state', 'POST /save', 'GET /gallery', 'POST /gallery-delete', 'POST /gallery-clear', 'POST /test-channel', 'GET /comfy-state', 'GET /workflows', 'POST /workflow-import'],
        })
      } catch (error) {
        try { if (!response.headersSent) send(response, 500, { ok: false, error: String(error?.message ?? error) }) } catch { /* 已断开 */ }
      }
    }
    return web.register({ kind: 'prefix', path: ROUTE_BASE + '/api', handler })
  }

  // ── 生图工具 ──────────────────────────────────────────────────────────
  const definition = {
    name: TOOL_NAME,
    description: [
      '提交一张或几张文生图任务，返回可直接贴进回复的 Markdown 图片语法。',
      '返回的是 ![图片](url)，原样写进回复才出图；只贴裸网址会渲染成一个蓝色链接。',
      '返回里会附本地文件路径，仅备查：图出来就直接贴进回复，不要读图核验画面，用户明确要求看画面细节时再读。',
      '只在卡片工作台可用；游玩模式请交给 dsh-tavern-image。',
      '使用顺序：用户点名角色就先 read_character 取外观，不确定画风渠道再 read_image_config，',
      '然后加载 image-prompt skill 照它的规则写 prompt。',
      '给用户过目时要把提示词翻译成中文，逐项讲清画面（主体、外观、服装、动作、表情、镜头、场景），',
      '用户看的是中文，提交给这个工具的必须是英文串。用户点头才提交。',
      'prompt 必须按 image-prompt skill 的规则写；没读过就先读，凭印象写会稳定出错。',
      '调用前必须先把中文说明给用户看过并得到明确同意——每张图都会真实扣费。',
      'prompt 用英文逗号分隔的 Danbooru 风格 tag：主体身份、外观、服装状态、动作、表情、镜头、场景、光线。',
      '画师串和负面提示词由插件按画风预设自动拼接，prompt 里不要重复写画师名，也不要写质量词。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: {
          type: 'string',
          description: '英文提示词，逗号分隔的 tag。不含画师串，不含负面词。',
        },
        negative: {
          type: 'string',
          description: '额外负面提示词，会追加在画风预设的负面串后面。留空只用预设。',
        },
        channel: {
          type: 'string',
          description: '用哪条渠道出图，填渠道 id 或名字，支持部分匹配。省略时用配置里当前激活的那条。只影响这一次调用，不改全局设置。不确定有哪些渠道，先调 read_image_config 拿清单。后端切成本地 ComfyUI 时不要填这个参数，填了会报错。',
        },
        size: {
          type: 'string',
          enum: ['竖图', '横图', '方图'],
          description: '竖图 832x1216，横图 1216x832，方图 1024x1024。不填时用渠道配置里保存的宽高；渠道没配过就用竖图。',
        },
        count: {
          type: 'integer',
          description: '张数，1 到 4，默认 1。每张单独扣费。',
        },
        preset: {
          type: 'string',
          description: '画风预设的名字。省略时用配置里当前激活的那个。不确定有哪些名字，先调 read_image_config 拿列表，不要靠试错——传错名字会直接报错。',
        },
        sampler: {
          type: 'string',
          description: '采样器，省略就用渠道配置里的。常见值：k_euler_ancestral（默认）、k_euler、k_dpmpp_2m、k_dpmpp_2m_sde。只在用户明确要求换采样器时才填。',
        },
        seed: {
          type: 'integer',
          description: '仅本地 ComfyUI：指定第一张的种子（非负整数），后面几张按 seed_control 推算。省略时按 seed_control 决定。只在用户要求复现某张图或指定种子时才填；返回结果里会列出每张用的种子。',
        },
        seed_control: {
          type: 'string',
          enum: SEED_CONTROLS,
          description: '仅本地 ComfyUI：种子生成后控制，同 ComfyUI 的 control_after_generate。randomize 每张随机；fixed 沿用上一次的种子（同一画面只改一处做对比时用）；increment / decrement 在上一次的种子上加一 / 减一。省略时用设置页里的配置（默认 randomize）。只影响这一次调用。',
        },
      },
      required: ['prompt'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                url: { type: 'string' },
                file: { type: 'string' },
                mediaType: { type: 'string' },
                bytes: { type: 'integer' },
                seed: { type: 'integer' },
              },
            },
          },
          channel: { type: 'string' },
          preset: { type: 'string' },
          size: { type: 'string' },
          seedControl: { type: 'string' },
          elapsedMs: { type: 'integer' },
        },
      },
      render(args, value) {
        const images = Array.isArray(value?.images) ? value.images : []
        if (!images.length) return [{ type: 'text', text: '没有生成任何图片。' }]
        // 必须给 Markdown 图片语法。裸 URL 在 DSH 里渲染成一个蓝色链接，不是图。
        // 磁盘绝对路径只备查：别在这里引导模型主动读图，阅读额度要留给正文。
        const lines = images.map((image, index) =>
          `${index + 1}. ![图片](${image.url})${image.seed === undefined ? '' : `\n   种子：${image.seed}`}\n   裸链接（给人复制用）：${image.url}\n   本地文件：${image.file || '（未落盘）'}`)
        return [{
          type: 'text',
          text: [
            `已通过「${value.channel}」生成 ${images.length} 张，画风「${value.preset || '默认'}」，尺寸 ${value.size}${value.seedControl ? `，种子控制 ${value.seedControl}` : ''}，耗时 ${Math.round((value.elapsedMs || 0) / 1000)} 秒。`,
            '',
            '**把下面每行的 ![图片](...) 原样写进回复，图片就会显示。**',
            '只写裸链接的话，DSH 会渲染成一个蓝色链接，不是图。',
            '`![]` 里的文字可以换成角色名或场景描述，不会影响显示。',
            '图出来就贴进回复，不要读图核验。「本地文件」那一行是磁盘绝对路径，只在用户明确要求看画面时才读。',
            '',
            ...lines,
          ].join('\n'),
        }]
      },
    },
    async execute(args, exec) {
      const cfg = await currentConfig()
      // 出图归属：exec.agent.session.id 就是 Tavern 会话的 sessionId。
      // 宿主没给第二个参数时留空，画廊把这张归到「未分类」。
      const sessionId = String(exec?.agent?.session?.id ?? '').trim()
      const body = oneLine(args?.prompt)
      if (!body) throw new Error('prompt 不能为空')
      const count = Math.max(1, Math.min(4, Number(args?.count) || 1))
      const preset = pickPreset(cfg, args?.preset)
      // 本地 ComfyUI 与云端渠道是两条路径：本地不经过渠道，也就没有 channel / 密钥可挑。
      const local = String(cfg.imageBackend ?? '') === 'comfyui'
      if (local && String(args?.channel ?? '').trim()) {
        throw new Error('当前是本地 ComfyUI 后端，不用 channel 参数；要换云端渠道先在设置页把后端切回去')
      }
      // 本地模式只跑导入的工作流：没有就直接拒绝，不再有简单模式兜底。
      const workflow = local ? await loadDefaultWorkflow(cfg) : null
      if (local && !workflow) throw new Error('本地 ComfyUI 还没有可用的工作流，先在设置页导入一张 API 格式的 JSON')

      let channel = null
      if (!local) {
        try { channel = pickChannel(cfg, args?.channel) }
        catch (error) { throw new Error('生图渠道没配好：' + (error?.message ?? error)) }
        if (!channel) throw new Error('当前没有可用的生图渠道，请先在设置页选一条')
        if (!channel.apiKey) throw new Error(`渠道「${channel.name}」没有可用密钥，先在设置页填上`)
      }

      const size = local ? resolveWorkflowSize(workflow, args?.size) : resolveImageSize(channel, args?.size)
      const explicitSize = Boolean(SIZES[args?.size])
      const { width, height } = size
      // 工作流用连线节点给宽高时（例如 ResolutionSelector），插件解析不出数值，
      // 真实尺寸只有 ComfyUI 知道。这时报「由工作流决定」，别报一个假的三档尺寸。
      const sizeText = size.unknown ? '由工作流决定' : `${size.label} ${width}x${height}`
      const sampler = oneLine(args?.sampler)
      if (!local) {
        channel = {
          ...channel,
          options: {
            ...channel.options,
            sizeWidth: String(width),
            sizeHeight: String(height),
            ...(sampler ? { sampler } : {}),
          },
        }
      }

      // 种子只对本地 ComfyUI 有意义：云端渠道各自处理，不在这里管。
      let seedControl = ''
      let seeds = null
      if (local) {
        const wanted = oneLine(args?.seed_control)
        if (wanted && !SEED_CONTROLS.includes(wanted)) {
          throw new Error(`seed_control 只能是 ${SEED_CONTROLS.join(' / ')}`)
        }
        const explicit = validSeed(args?.seed)
        if (args?.seed !== undefined && args?.seed !== null && args?.seed !== '' && explicit === null) {
          throw new Error('seed 必须是非负整数')
        }
        seedControl = wanted || seedControlOf(cfg)
        seeds = await takeSeeds(cfg.defaultWorkflow, workflow, seedControl, count, explicit)
        // 工作流没识别出种子输入时插件不碰种子，别在返回里报一个假的控制方式。
        if (!seeds) seedControl = ''
      }

      const negative = [preset.negative, oneLine(args?.negative)].filter(Boolean).join(', ')
      const request = { positive: composePrompt(body, preset), negative }
      const started = Date.now()

      await mkdir(IMAGE_DIR, { recursive: true })
      const images = []
      // 画廊记录边出边攒：中途失败时已落盘的图也要入账，否则它们既不在画廊里，
      // 也没有删除入口，只能手动去清 images 目录。
      const records = []
      const stamp = Date.now()
      try {
        for (let index = 0; index < count; index += 1) {
          const result = local
            ? await comfyGenerate(cfg, {
              ...request,
              width: workflow && !explicitSize ? undefined : width,
              height: workflow && !explicitSize ? undefined : height,
              sampler: sampler || undefined,
              seed: seeds ? seeds[index] : undefined,
            }, { maxImageBytes: MAX_IMAGE_BYTES, workflow })
            : await generateImage(channel, request, { maxImageBytes: MAX_IMAGE_BYTES })
          const extension = extensionOf(result.mediaType)
          const file = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`
          await writeFile(path.join(IMAGE_DIR, file), result.bytes)
          const url = `${origin}${ROUTE_BASE}/img/${file}`
          images.push({
            url,
            file: path.join(IMAGE_DIR, file),
            mediaType: result.mediaType,
            bytes: result.bytes.length,
            ...(seeds ? { seed: seeds[index] } : {}),
          })
          // prompt 留全文：画廊要能一键复制回去，截断就没用了。
          records.push({
            id: path.basename(file).replace(/\.[^.]+$/, ''),
            file,
            url,
            prompt: String(request.positive || ''),
            negative: String(request.negative || ''),
            preset: preset.name || '',
            channel: local ? '本地 ComfyUI' : (channel.name || channel.id),
            size: sizeText,
            ...(seeds ? { seed: seeds[index] } : {}),
            at: stamp + index,
            session: sessionId,
          })
        }
      } catch (error) {
        // 第一张就失败时没有可记的，原样抛出，不包装。
        if (!records.length) throw error
        await appendJobs(records).catch(jobError => logger.warn?.('dsh-tavern-gen: 画廊记录写入失败 ' + (jobError?.message ?? jobError)))
        throw new Error(`出图在第 ${records.length + 1} 张中断：${error?.message ?? error}。前 ${records.length} 张已经生成并记进画廊，可在设置页「画廊」查看或删除。`)
      }

      await appendJobs(records).catch(error => logger.warn?.('dsh-tavern-gen: 画廊记录写入失败 ' + (error?.message ?? error)))

      return {
        ok: true,
        images,
        channel: local ? '本地 ComfyUI' : (channel.name || channel.id),
        preset: preset.name,
        size: sizeText,
        ...(seedControl ? { seedControl } : {}),
        elapsedMs: Date.now() - started,
      }
    },
  }

  // ── 人物库查询 ────────────────────────────────────────────────────────
  const characterTool = {
    name: 'read_character',
    description: [
      '查人物库。不传 name 列出全部角色；传 name 返回该角色的完整外观 traits。',
      'traits 共十二块：feature 气质描述（出图用不上）；face / faceBack 正面与背面头面部；',
      'bodySFW / lowerSFW 正面常规身体与下半身，bodySFWBack / lowerSFWBack 是它们的背面；',
      'bodyNSFW / lowerNSFW 细节档，bodyNSFWBack / lowerNSFWBack 是它们的背面；negative 该角色专属负面词。',
      '按镜头和衣着状态挑对应的块，不要全塞进提示词。',
      '返回里还有 defaultOutfit（这个角色默认穿的那套）和 outfits（自带的其他几套），都带完整的七块 tag。',
      '要换衣服先在这两处找；公共服装库里的套才用 read_outfit 查。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: '角色名，支持部分匹配。留空列出全部角色。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          characters: { type: 'array', items: { type: 'object', additionalProperties: true } },
          name: { type: 'string' },
          note: { type: 'string' },
          traits: { type: 'object', additionalProperties: true },
          defaultOutfit: { type: 'object', additionalProperties: true },
          outfits: { type: 'array', items: { type: 'object', additionalProperties: true } },
          outfitRefs: { type: 'array', items: { type: 'string' } },
        },
      },
      render(args, value) {
        if (Array.isArray(value?.characters)) {
          const names = value.characters.map(item => item.name).join('、')
          const notes = value.characters.filter(item => item.note).map(item => `  ${item.name}：${item.note}`)
          return [{ type: 'text', text: [`人物库共 ${value.characters.length} 个角色`, names, ...notes].join('\n') }]
        }
        const blocks = [`角色：${value?.name ?? ''}`]
        if (value?.note) blocks.push(`【note】${value.note}`)
        // 外观按块给，模型按镜头自己挑；块内是预设好的字面量，只能整块照抄。
        const traits = value?.traits || {}
        const appearance = APPEARANCE_FIELDS.filter(key => String(traits[key] ?? '').trim())
        if (appearance.length) {
          blocks.push([
            '【外观·按镜头挑块，块内整块照抄】',
            '挑块：正面穿衣 face + bodySFW + lowerSFW；正面赤裸 face + bodyNSFW + lowerNSFW；背面换成 faceBack 和带 Back 的块；只拍下半身就不取 face；半脱时按露出的部位两头拼。',
            '拼接只加逗号。**块内一个字都不要改**：括号层数、逗号位置、括号里的组合全部保持原样，禁止去重、禁止合并同义 tag、禁止拆开括号里的词。权重掉了这个角色就变样。',
          ].join('\n'))
          for (const key of appearance) blocks.push(`【${key}】${traits[key]}`)
        }
        // 这两块不进 prompt。feature 只用来决定表情动作，negative 走 gen_image 的 negative 参数。
        if (traits.feature) blocks.push(`【feature】${traits.feature}\n（不进 prompt，只用来决定表情和动作）`)
        if (traits.negative) blocks.push(`【negative】${traits.negative}\n（走 gen_image 的 negative 参数，不要写进 prompt）`)
        // 默认服装：人物库里选中、指向公共服装库的那一套。有这个就不再给角色自带的套标默认。
        const fallback = value?.defaultOutfit
        if (fallback?.name) {
          const fields = OUTFIT_FIELDS.filter(key => fallback[key]).map(key => `${key}: ${fallback[key]}`)
          blocks.push([`【默认服装】${fallback.name}（公共服装库）`, ...fields].join('\n'))
        }
        // 角色自带的服装：内嵌在人物库条目里那几套，tag 同样照抄。
        for (const outfit of Array.isArray(value?.outfits) ? value.outfits : []) {
          const fields = OUTFIT_FIELDS.filter(key => outfit?.[key]).map(key => `${key}: ${outfit[key]}`)
          if (!fields.length) continue
          blocks.push([`【outfit】${outfit.name}${outfit.default && !fallback?.name ? '（默认这套）' : ''}`, ...fields].join('\n'))
        }
        const refs = Array.isArray(value?.outfitRefs) ? value.outfitRefs : []
        if (refs.length) {
          blocks.push(['【outfitRefs】另外这几套在公共服装库，要完整 tag 用 read_outfit 按名字取', ...refs.map(name => '- ' + name)].join('\n'))
        }
        return [{ type: 'text', text: blocks.join('\n\n') }]
      },
    },
    async execute(args) {
      let book
      try { book = JSON.parse(await readFile(DEFINITIONS_FILE, 'utf8')) }
      catch (error) { throw new Error('读不到人物库 definitions.json：' + (error?.message ?? error)) }
      const list = (Array.isArray(book.characters) ? book.characters : []).filter(item => item && item.name && item.enabled !== false)
      const key = String(args?.name ?? '').trim()
      if (!key) {
        return { characters: list.map(item => ({ name: item.name, note: item.note || '' })) }
      }
      const hit = list.find(item => item.name === key)
        || list.find(item => item.name.includes(key) || key.includes(item.name))
        || list.find(item => String(item.match || '').includes(key))
      if (!hit) throw new Error(`人物库里没有「${key}」。现有：${list.map(item => item.name).join('、')}`)
      // 默认服装是人物库里指向公共服装库的一格引用，被选中那套的 tag 要一起给出来。
      const publicList = (await loadOutfits()).outfits
      const pickPublic = ref => {
        const value = String(ref ?? '').trim()
        if (!value) return null
        return publicList.find(item => item.id === value) || publicList.find(item => item.name === value) || null
      }
      const chosen = pickPublic(hit.defaultOutfit)
      const payload = {
        name: hit.name,
        note: hit.note || '',
        traits: hit.traits || {},
        // 人物库和服装库在这个插件里是拆开的：角色自带的这几套写在 definitions.json 里，
        // 公共服装库（outfits.json）走 read_outfit。自带那几套的 tag 一起给出来，停用的不列。
        outfits: (Array.isArray(hit.outfits) ? hit.outfits : [])
          .filter(item => item && item.name && item.enabled !== false)
          .map(item => ({ name: String(item.name), default: item.default === true, ...outfitTags(item) })),
        // 引用公共服装库的其他套装：id 也翻成名字，完整 tag 走 read_outfit。
        outfitRefs: (Array.isArray(hit.outfitRefs) ? hit.outfitRefs : [])
          .map(item => String(item ?? '').trim())
          .filter(Boolean)
          .map(ref => pickPublic(ref)?.name || ref),
      }
      // 只有真选到那套时才带这个字段：空着就不出现，不给 null。
      if (chosen) payload.defaultOutfit = { name: chosen.name || chosen.id, ...outfitTags(chosen) }
      return payload
    },
  }

  // ── 配置查询 ──────────────────────────────────────────────────────────
  const configTool = {
    name: 'read_image_config',
    description: [
      '查当前生图配置：当前激活的渠道详情、全部可用渠道的清单（含 id 和名字）、全部画风预设、可选尺寸。',
      'gen_image 的 preset 和 channel 两个参数该填什么，这里都能查到，不要靠试错。',
      '调 gen_image 之前想知道 preset 该填什么、或者想知道现在跑的是什么模型和采样器，先调它。',
      '不产生任何费用，也不改配置。',
    ].join('\n'),
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          channel: { type: 'object', additionalProperties: true },
          channels: { type: 'array', items: { type: 'object', additionalProperties: true } },
          activeChannelId: { type: 'string' },
          presets: { type: 'array', items: { type: 'object', additionalProperties: true } },
          activePreset: { type: 'string' },
          sizes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          seedControl: { type: 'string' },
        },
      },
      render(args, value) {
        if (value?.local) {
          const comfy = value.comfy ?? {}
          const lines = [comfy.ok
            ? `后端：本地 ComfyUI（${comfy.version || '版本未知'}）`
            : `后端：本地 ComfyUI，连不上：${comfy.error || '未知错误'}`]
          if (comfy.ok) {
            lines.push(`Checkpoint：${(comfy.checkpoints ?? []).length} 个，LoRA：${(comfy.loras ?? []).length} 个`)
          }
          lines.push(`当前工作流：${value?.defaultWorkflow || '未设置（本地模式需要先导入一张）'}`)
          lines.push(`种子生成后控制：${value?.seedControl || 'randomize'}（gen_image 可用 seed_control 临时改，用 seed 指定种子）`)
          lines.push('', `当前画风：${value?.activePreset || '未指定，将用默认画师串'}`)
          lines.push('可选画风：')
          for (const preset of value?.presets || []) lines.push(`  - ${preset.name}`)
          lines.push('', '可选尺寸：')
          for (const size of value?.sizes || []) lines.push(`  - ${size.name}  ${size.width}x${size.height}`)
          lines.push('本地模式不传 size 时用工作流里识别出的宽高；工作流用连线节点给宽高时，尺寸由工作流决定，插件不改也不报数字。')
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const channel = value?.channel
        const lines = []
        if (channel && !channel.error) {
          lines.push(`当前渠道：${channel.name}（${channel.provider}）`)
          lines.push(`模型：${channel.model || '未填'}`)
          lines.push(`采样器：${channel.sampler}`)
          lines.push(`协议：${channel.protocol === 'chat' ? '对话格式中转' : '原生'}`)
          lines.push(`地址：${channel.baseUrl}`)
          lines.push(`密钥：${channel.hasKey ? '已就绪' : '缺失'}`)
        } else {
          lines.push(`当前渠道：${channel?.error || '没配好，或后端不是云端渠道'}`)
        }

        const channels = Array.isArray(value?.channels) ? value.channels : []
        if (channels.length) {
          lines.push('', '全部渠道（gen_image 的 channel 参数填名字或 id，只影响这一次调用）：')
          for (const item of channels) {
            lines.push(`  - ${item.name}｜${item.provider}｜${item.model || '默认模型'}${item.active ? '  ← 当前' : ''}`)
          }
        }

        lines.push('', `当前画风：${value?.activePreset || '未指定，将用默认画师串'}`)
        lines.push('可选画风：')
        for (const preset of value?.presets || []) lines.push(`  - ${preset.name}`)
        lines.push('', '可选尺寸：')
        for (const size of value?.sizes || []) lines.push(`  - ${size.name}  ${size.width}x${size.height}`)
        lines.push('不传 size 时用渠道配置里保存的宽高；渠道没配过就是竖图。')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      const cfg = await currentConfig()
      const presets = (Array.isArray(cfg.stylePresets) ? cfg.stylePresets : [])
        .filter(item => item && item.enabled !== false && item.name)
        .map(item => ({ id: item.id, name: item.name }))
      const active = presets.find(item => item.id === cfg.activePreset)
      // 本地后端没有渠道可列：探一次 ComfyUI，把模型和模板清单给调用方。
      if (String(cfg.imageBackend ?? '') === 'comfyui') {
        return {
          local: true,
          comfy: await comfyState(cfg),
          defaultWorkflow: String(cfg.defaultWorkflow ?? ''),
          seedControl: seedControlOf(cfg),
          presets,
          activePreset: active?.name || '',
          sizes: Object.entries(SIZES).map(([name, value]) => ({ name, width: value.width, height: value.height })),
        }
      }
      let channel = null
      try {
        const ch = activeChannel(cfg)
        if (ch) {
          channel = {
            name: ch.name || ch.id,
            provider: ch.provider,
            model: ch.model || '',
            baseUrl: ch.baseUrl || '',
            protocol: String(ch.options?.protocol || 'native'),
            sampler: String(ch.options?.sampler || 'k_euler_ancestral'),
            hasKey: Boolean(ch.apiKey),
          }
        }
      } catch (error) {
        channel = { error: String(error?.message ?? error) }
      }
      // 渠道清单：调用方要能看见全部有哪些，而不是只知道当前这一条。
      const channels = (Array.isArray(cfg.imageChannels) ? cfg.imageChannels : [])
        .filter(item => item && (item.id || item.name))
        .map(item => ({
          id: String(item.id ?? ''),
          name: String(item.name ?? item.id ?? ''),
          provider: String(item.provider ?? ''),
          model: String(item.model ?? ''),
          protocol: String(item.options?.protocol || 'native'),
          samplers: String(item.options?.sampler || ''),
          active: item.id === cfg.activeImageChannel,
        }))

      return {
        channel,
        channels,
        activeChannelId: String(cfg.activeImageChannel ?? ''),
        presets,
        activePreset: active?.name || '',
        sizes: Object.entries(SIZES).map(([name, value]) => ({ name, width: value.width, height: value.height })),
      }
    },
  }

  // ── 服装库查询 ────────────────────────────────────────────────────────
  const outfitTool = {
    name: 'read_outfit',
    description: [
      '查服装库。不传 name 列出全部服装；传 name 返回那套的七个块。',
      '字段含义：upper 上身、lower 下身、shoes 鞋、accessory 配饰、full 整套兜底、back 背影补充、negative 这套不该出现的元素。',
      '按镜头挑：正面取 upper/lower/shoes/accessory；背影再加 back；单件凑不齐时用 full 兜底。',
      'negative 走 gen_image 的 negative 参数，不要写进 prompt。',
      '这里只查公共服装库；角色自带的套在 read_character 的返回里，不用来这里找。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: '服装名，支持部分匹配。留空列出全部。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          outfits: { type: 'array', items: { type: 'object', additionalProperties: true } },
          name: { type: 'string' },
        },
      },
      render(args, value) {
        if (Array.isArray(value?.outfits)) {
          if (!value.outfits.length) return [{ type: 'text', text: '服装库现在是空的。' }]
          const lines = value.outfits.map(item => `- ${item.name}${item.full ? '：' + item.full : ''}`)
          return [{ type: 'text', text: [`服装库共 ${value.outfits.length} 套`, ...lines].join('\n') }]
        }
        const lines = OUTFIT_FIELDS
          .filter(key => value?.[key])
          .map(key => `【${key}】${value[key]}`)
        return [{ type: 'text', text: [`服装：${value?.name ?? ''}`, ...lines].join('\n\n') }]
      },
    },
    async execute(args) {
      const book = await loadOutfits()
      const list = book.outfits.filter(item => item.enabled !== false)
      const key = String(args?.name ?? '').trim()
      if (!key) {
        return { outfits: list.map(item => ({ name: item.name, full: item.full })) }
      }
      const hit = list.find(item => item.name === key)
        || list.find(item => item.name.includes(key) || key.includes(item.name))
      if (!hit) throw new Error(`服装库里没有「${key}」。现有：${list.map(item => item.name).join('、') || '空'}`)
      const result = { name: hit.name }
      for (const field of OUTFIT_FIELDS) result[field] = hit[field] || ''
      return result
    },
  }

  // ── 提示词表检索 ────────────────────────────────────────────────────────
  /** 可以查的分册。label 用来给模型看，id 用来定位。 */
  const TABLES = [
    { id: 'library', label: '素材表' },
  ]

  async function queryTables(tables, args) {
    const picked = []
    for (const candidate of tables) {
      const table = await loadTable(candidate.id)
      if (!table) continue
      for (const group of table.groups) {
        if (!group.items.length) continue
        picked.push({ id: candidate.id, label: candidate.label, group })
      }
    }
    if (!picked.length) return { total: 0, categories: [], empty: true }

    const categoryKey = String(args?.category ?? '').trim().toLowerCase()
    const query = String(args?.query ?? '').trim().toLowerCase()

    let scope = picked
    if (categoryKey) {
      scope = picked.filter(item =>
        item.group.title.toLowerCase().includes(categoryKey)
        || item.group.id.includes(categoryKey)
        || item.label.toLowerCase().includes(categoryKey))
      if (!scope.length) {
        // 分类名没对上不代表没有这类素材。把它当关键词重搜一遍再回话：
        // 抛错在界面上只是一条红字，模型也不会因此记住分类名，下次照错。
        const fallback = String(args?.category ?? '').trim()
        const again = await queryTables(tables, { ...args, category: '', query: query || fallback })
        again.notice = '没有「' + fallback + '」这个分类，已按关键词「' + (query || fallback) + '」搜索。'
        return again
      }
    }
    // 数量按过滤后的范围算，限定了分类却报全表总数会让模型以为可选范围很大
    const total = scope.reduce((sum, item) => sum + item.group.items.length, 0)

    if (!query) {
      return {
        total,
        categories: scope.map(item => ({
          table: item.label,
          id: item.group.id,
          title: item.group.title,
          count: item.group.items.length,
        })),
      }
    }

    const hits = []
    for (const item of scope) {
      for (const one of item.group.items) {
        const name = one.name.toLowerCase()
        if (!(name.includes(query) || one.tags.toLowerCase().includes(query) || item.group.title.toLowerCase().includes(query))) continue
        hits.push({
          table: item.label,
          category: item.group.title,
          name: one.name,
          tags: one.tags,
          rank: name === query ? 0 : name.includes(query) ? 1 : 2,
        })
      }
    }
    hits.sort((a, b) => a.rank - b.rank)
    const limit = Math.min(Math.max(Number(args?.limit) || 8, 1), 20)
    return {
      total,
      matched: hits.length,
      hits: hits.slice(0, limit).map(({ rank, ...rest }) => rest),
    }
  }

  function renderTables(args, value) {
    const notice = value?.notice ? value.notice + '\n\n' : ''
    if (Array.isArray(value?.categories)) {
      if (!value.categories.length) {
        return [{ type: 'text', text: '素材表是空的——这一本只放现成的 tag 串，跟规则无关，别从这里推断「没有规则可读」。\n规则是 skill 里的 md：`references/rules/` 下，用 `tavern_read_skill_reference` 读。\n要加素材去「设置 → 卡片生图 → 世界书 → 素材表」，格式是「**中文名**」换行「`tag 串`」。' }]
      }
      const lines = value.categories.map(item => item.table + ' / ' + item.title + ' · ' + item.count + ' 条')
      return [{ type: 'text', text: ['提示词表合计 ' + value.total + ' 条，分类：', ...lines].join('\n') }]
    }
    const hits = Array.isArray(value?.hits) ? value.hits : []
    if (!hits.length) {
      return [{ type: 'text', text: notice + '没有匹配「' + (args?.query || args?.category || '') + '」的条目。换个更短的词再试，或者不带 query 看分类索引。' }]
    }
    const head = value.matched > hits.length
      ? '命中 ' + value.matched + ' 条，先给前 ' + hits.length + ' 条'
      : '命中 ' + hits.length + ' 条'
    const body = hits.map(item => '【' + item.table + ' / ' + item.category + '】' + item.name + '\n' + item.tags)
    return [{ type: 'text', text: notice + [head, ...body].join('\n\n') }]
  }

  const TABLE_SCHEMA = {
    type: 'object',
    additionalProperties: true,
    properties: {
      total: { type: 'integer' },
      matched: { type: 'integer' },
      categories: { type: 'array', items: { type: 'object', additionalProperties: true } },
      hits: { type: 'array', items: { type: 'object', additionalProperties: true } },
    },
  }

  const promptTool = {
    name: 'find_prompt',
    description: [
      '按需查现成的提示词表。每条是一个中文名加一整串英文 Danbooru tag，来自别人验证过能出图的成品。',
      '查世界书里标了 lookup 档的素材条目，现成 tag 串，内容由用户自己导入。',
      '这里只有素材表，不含任何规则。规则是 skill 里的 md，用 tavern_read_skill_reference 读 references/ 下的文件。',
      '素材表为空时只返回一句提示，说清「这一本没内容」——不代表整个插件没有东西可读，规则文件是独立的，不受素材表影响。',
      '不传 query 返回分类索引（有哪些玩法、各多少条）；传 query 按名字、tag 内容、分类名匹配，只回命中的几条，不整表倾倒。一次搜索覆盖全部分类，不用按分类分别调用。',
      '怎么用：先定清楚这一张画什么玩法，再用一个短词查一到两轮，命中后按自己的画面挑着改写，不要整串照抄——那串是别人那张图的完整构图。',
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: '中文名或英文 tag 关键词，填一个短词即可。留空返回分类索引。' },
        table: { type: 'string', description: '可选，限定查哪本分册，一般不用填——留空就查全部。填错会直接报错并列出可用分册。' },
        category: { type: 'string', description: '限定某个分类，按分类标题匹配，填错会把全部分类列出来。省略则查全表。' },
        limit: { type: 'integer', description: '最多返回几条，默认 8，上限 20。' },
      },
    },
    output: {
      schema: TABLE_SCHEMA,
      render(args, value) { return renderTables(args, value) },
    },
    async execute(args) {
      const key = String(args?.table ?? '').trim().toLowerCase()
      const tables = key
        ? TABLES.filter(item => item.id.includes(key) || item.label.includes(key))
        : TABLES
      if (key && !tables.length) throw new Error('没有「' + args?.table + '」这本表。现有：' + TABLES.map(item => item.label).join('、'))
      return queryTables(tables, args)
    },
  }

  const TOOLS = [definition, characterTool, configTool, outfitTool, promptTool]


  // ── 服务接线 ──────────────────────────────────────────────────────────
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], scoped => {
      const tools = scoped.tools
      if (!tools || typeof tools.register !== 'function') {
        logger.warn?.('dsh-tavern-gen: 当前宿主没有 tools 服务，生图工具未注册')
        return
      }
      // 句柄留着：配置里把开关关掉时能当场摘下来，不用重启。
      let dispose = null
      const mount = () => {
        if (dispose) return
        // 逐个注册：某个工具的定义有错时只丢它自己，不让后面的全部不注册。
        // 日志带上工具名，否则出问题时只知道「注册失败」，不知道是谁。
        const disposers = []
        for (const tool of TOOLS) {
          try {
            disposers.push(tools.register(tool))
          } catch (error) {
            logger.warn?.('dsh-tavern-gen: 注册工具 ' + tool.name + ' 失败 ' + (error?.message ?? error))
          }
        }
        dispose = () => { for (const off of disposers) { try { off() } catch { /* 已卸载 */ } } }
      }
      const unmount = () => {
        const off = dispose
        dispose = null
        if (off) { try { off() } catch { /* 已卸载 */ } }
      }
      applyTools = on => { if (on) mount(); else unmount() }
      // 启动时按配置决定挂不挂。配置读不出来就按开启——宁可多给工具，也不能让插件变哑巴。
      currentConfig().then(cfg => applyTools?.(toolsEnabled(cfg)), () => applyTools?.(true))
      if (typeof scoped.effect === 'function') scoped.effect(() => unmount, 'dsh-tavern-gen: tools')
    })

    // 只在卡片工作台露脸；游玩模式交给 dsh-tavern-image。
    ctx.inject(['tavern'], scoped => {
      const tavern = scoped.tavern
      if (!tavern) return
      if (typeof tavern.toolModes === 'function') {
        for (const tool of TOOLS) tavern.toolModes({ name: tool.name, modes: ['card'] })
      } else {
        logger.warn?.('dsh-tavern-gen: 当前 Tavern 不支持 toolModes，工具会在两种模式下都出现')
      }
      // 提示词手册作为插件自带 skill 挂进卡片工作台，按需加载。
      if (typeof tavern.skillSource === 'function') {
        try {
          const off = tavern.skillSource({ dir: SKILLS_DIR, role: 'card' })
          if (typeof off === 'function' && typeof scoped.effect === 'function') scoped.effect(() => off, 'dsh-tavern-gen: skill source')
        } catch (error) {
          logger.warn?.('dsh-tavern-gen: 挂载提示词 skill 失败 ' + (error?.message ?? error))
        }
      } else {
        logger.warn?.('dsh-tavern-gen: 当前 Tavern 不支持插件自带 Skill')
      }
      // 本局画廊：把出过的图登记成一个画廊来源。
      // Tavern 插件接口 6 起才有；没有就静默跳过，设置页画廊照常能用。
      // list/read/remove 的 this 必须绑在 tavern 上，不能先存成变量再调。
      if (typeof tavern.registerGalleryProvider === 'function') {
        // 只认本局自己的图：每条记录带出图时的 sessionId，串局就等于把别的会话的图搬进这一局的画廊。
        // 老记录没有 session 就归「无主」，任何一局都不认领，免得凭空多出一堆不属于这局的图。
        const ownJobs = async sessionId => {
          const wanted = String(sessionId || '').trim()
          const list = await loadJobs()
          return list.filter(job => job && job.id && job.file && wanted && String(job.session || '') === wanted)
        }
        const provider = {
          async list({ sessionId } = {}) {
            return (await ownJobs(sessionId)).map(job => ({
              id: String(job.id),
              caption: [job.preset, job.size].filter(Boolean).join(' · ').slice(0, 200),
              createdAt: Number(job.at) || 0,
              updatedAt: Number(job.at) || 0,
            }))
          },
          // 宿主先调 list 核对 id 再调 read，所以这里查不到就是真的没了，或者根本不属于这一局。
          async read({ sessionId, id } = {}) {
            const job = (await ownJobs(sessionId)).find(item => item.id === String(id))
            if (!job?.file) throw new Error('图片不存在或不属于本局')
            return { data: await readFile(path.join(IMAGE_DIR, path.basename(job.file))) }
          },
          async remove({ sessionId, id } = {}) {
            const target = (await ownJobs(sessionId)).find(item => item.id === String(id))
            if (!target?.file) return false
            const list = await loadJobs()
            await saveJobs(list.filter(item => item !== target))
            await unlink(path.join(IMAGE_DIR, path.basename(target.file))).catch(() => {})
            return true
          },
        }
        // 同步注册：当场抛错能兜住。放进 scoped.effect 里执行的话，抛错发生在别处，这里 catch 不到。
        try {
          const off = tavern.registerGalleryProvider(provider)
          if (typeof off === 'function' && typeof scoped.effect === 'function') {
            scoped.effect(() => off, 'dsh-tavern-gen: gallery provider')
          }
        } catch (error) {
          logger.warn?.('dsh-tavern-gen: 注册画廊来源失败 ' + (error?.message ?? error))
        }
      }
    })

    ctx.inject(['systemPrompt'], scoped => {
      const prompt = scoped.systemPrompt
      if (!prompt || typeof prompt.section !== 'function') {
        logger.warn?.('dsh-tavern-gen: 当前宿主没有 systemPrompt 服务，规范段落未注入')
        return
      }
      const install = () => prompt.section({
        name: 'dsh-tavern-gen-rules',
        order: 520,
        text: PROMPT_RULES,
      })
      if (typeof scoped.effect === 'function') scoped.effect(install, 'dsh-tavern-gen: prompt rules')
      else install()
    })

    ctx.inject(['credentials'], scoped => {
      credentials.connect(scoped.credentials)
        .then(() => currentConfig())
        .catch(error => logger.warn?.('dsh-tavern-gen: 凭据服务接入失败 ' + (error?.message ?? error)))
    })

    ctx.inject(['webServer'], scoped => {
      const web = scoped.webServer
      if (!web || typeof web.register !== 'function') return
      try {
        const value = web.getOrigin?.()
        if (typeof value === 'string' && value) origin = value.replace(/\/+$/, '')
      } catch { /* 拿不到就用相对路径 */ }
      const install = () => {
        const disposers = [installRoute(web), installApi(web)]
        return () => { for (const off of disposers) { try { off?.() } catch { /* 已卸载 */ } } }
      }
      if (typeof scoped.effect === 'function') scoped.effect(install, 'dsh-tavern-gen: 图片路由与设置接口')
      else install()
    })
  } else {
    logger.warn?.('dsh-tavern-gen: 宿主不支持 ctx.inject，插件无法挂载')
  }

  currentConfig().catch(error => logger.warn?.('dsh-tavern-gen: 配置载入失败 ' + (error?.message ?? error)))
}

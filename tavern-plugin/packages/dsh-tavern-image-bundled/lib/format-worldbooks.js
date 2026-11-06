import * as nodeFs from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { normalizeEntryActivation } from './planner-context.js'
import { PROMPT_FORMATS } from './prompt-presets.js'

export const STRUCTURED_WORLDBOOK_SEED_VERSION = 3
// Frozen v1 baseline: never import live guidance here. Changing prompt presets
// must not change the fingerprint used to recognize an untouched old book.
const LEGACY_STRUCTURED_GUIDANCE = [
  '使用结构化中文自然语言写画面提示词，标题和描述都使用中文，不堆砌英文标签。',
  '默认可按以下分节组织：人物及参考图对应、服装、动作、环境、镜头与光线、风格、约束。没有内容的节可以省略，不增加任务宣告段。',
  '这些只是默认分节；本格式独立世界书可以调整标题、顺序、增减分节，不要求机械套用固定模板。',
  '保留人物身份、服装与参考图的明确对应，不虚构参考图，不自行编造图片序号；没有参考图时只写人物描述。',
  '正文决定动作、环境与明确的状态变化；画风指导不能改写剧情事实。不要虚构画师、质量分数或接口参数。',
  '保持自然段、列表、标点和有意义的重复，不把不同人物的相同特征全局去重。',
].join('\n')

export const FORMAT_WORLDBOOK_MODES = PROMPT_FORMATS
export const FORMAT_WORLDBOOK_GROUPS = Object.freeze(['main', 'outfits'])
const BOOKS = Object.freeze({
  main: { file: 'worldbook.json', seed: '世界书-通用生图规则.json', label: '生图规则' },
  outfits: { file: 'worldbook-outfits.json', seed: '世界书-角色与服装库.json', label: '角色与服装库' },
})
const MIGRATION_VERSION = 1
const WRITE_QUEUES = new Map()
const json = value => JSON.stringify(value, null, 2) + '\n'
const clone = value => JSON.parse(JSON.stringify(value))

function assertMode(mode) {
  if (!FORMAT_WORLDBOOK_MODES.includes(mode)) throw new Error('世界书格式必须是 tags、natural、mixed 或 structured；auto 请先解析为实际格式')
  return mode
}
function assertGroup(key) {
  if (!FORMAT_WORLDBOOK_GROUPS.includes(key)) throw new Error('世界书分组必须是 main 或 outfits')
  return key
}

/** Preserve authored entry metadata and activation, while accepting old import shapes. */
export function normalizeFormatWorldbook(raw, { name = '生图世界书' } = {}) {
  let list, title = name, extra = {}
  if (typeof raw === 'string') {
    list = raw.split(/\n{2,}/).map(text => text.trim()).filter(Boolean).map(content => ({ content }))
  } else if (Array.isArray(raw)) {
    list = raw
  } else if (raw && typeof raw === 'object') {
    let source = raw
    if (!Object.hasOwn(raw, 'entries')) {
      const nested = Object.entries(raw).find(([, value]) => value && typeof value === 'object' && Object.hasOwn(value, 'entries'))
      if (!nested) throw new Error('世界书缺少 entries')
      title = nested[0]
      source = nested[1]
    }
    title = String(source.name ?? raw.name ?? title)
    extra = { ...source }
    if (Array.isArray(source.entries)) list = source.entries
    else if (source.entries && typeof source.entries === 'object') list = Object.values(source.entries)
    else throw new Error('世界书 entries 必须是数组或条目对象')
  } else throw new Error('世界书内容格式无效')
  const entries = list.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('世界书第 ' + (index + 1) + ' 个条目不是对象')
    // `enabled` is the editable switch after import. Retaining an old
    // disable:true alias would permanently defeat a later enabled:true edit.
    const { disable, ...metadata } = entry
    return {
      ...metadata,
      comment: String(entry.comment ?? entry.name ?? ('条目 ' + (index + 1))),
      content: String(entry.content ?? ''),
      enabled: entry.enabled !== false && disable !== true,
      ...normalizeEntryActivation(entry),
    }
  })
  return { ...extra, name: title, entries }
}

/** A fresh pair on every call, so editing one format/group never mutates a seed. */
function structuredWorldbookDefaultsV1() {
  const entry = (id, comment, content) => ({ id, comment, content, enabled: true, activation: 'always', keywords: [], andKeywords: [], backends: ['structured'] })
  return {
    main: { name: '结构化中文 · 生图规则', entries: [
      entry('structured-prose', '中文分节（默认结构可修改）', LEGACY_STRUCTURED_GUIDANCE),
      entry('structured-story', '画面事实与叙事瞬间', [
        '从本轮正文选择明确发生的可视瞬间，按各张画面对应的时点描述人物、衣着、动作和环境。',
        '有多张图时，各自突出不同的瞬间、景别或动作，不编造正文没有发生的事件。',
        '画风、构图、灯光和材质要求不能覆盖剧情事实；不要为了套预设添加不在场人物或道具。',
        '本书可调整提示词内部的分节，但外层 image/regex/prompts XML、决定与逐张闭合输出仍遵循插件协议。',
      ].join('\n')),
    ] },
    outfits: { name: '结构化中文 · 角色与服装库', entries: [
      entry('structured-identity', '人物与参考图一致性', [
        '只使用可用角色清单和本轮正文，已知人物保持身份一致；未知人物照正文描述，不编造人物库 ID。',
        '若清单标有身份参考图，该图用于身份外观而不是照搬服装、姿势和背景。若没有参考图，用库内文字和正文写清可见外貌。',
        '规划只收到文字清单，不能声称已经看过参考图；实际图片及其编号由插件按本张人物与服装对应关系确定。',
        '一致性补充与本轮明确的外貌状态变化应清楚表达，不把不同人物的特征混写，也不全局删除他们共有的特征。',
      ].join('\n')),
      entry('structured-clothes', '当刻服装与状态', [
        '按每张画面所处时点确定穿着。正文明确换装、湿衣、破损等变化时，以正文当下状态为准。',
        '引用库中服装时保持服装名准确，并按协议使用该套服装的标识；不要把标识或“常穿”备注误当成服装名。',
        '服装参考图只约束服饰设计，不继承图中人物、动作或背景；缺少参考图时用中文自然语言说明衣物颜色、款式和可见状态。',
        '只描述当前画面真正可见的内容；世界书可以改写本组表达方式，不必输出空白分节。',
      ].join('\n')),
    ] },
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
function bookContent(book) {
  const { defaultSeed, ...content } = normalizeFormatWorldbook(book)
  return content
}
function seedMetadata(book, version = STRUCTURED_WORLDBOOK_SEED_VERSION) {
  return { version, fingerprints: Object.fromEntries(book.entries.map(entry => [entry.id, fingerprint(entry)])) }
}

// Frozen v2 baseline, including its original seed metadata. Never use live rules
// or the current version here: migrations must recognize exact historical entries.
function structuredWorldbookDefaultsV2() {
  const books = structuredWorldbookDefaultsV1()
  const entry = (id, comment, lines) => ({ id, comment, content: lines.join('\n'), enabled: true, activation: 'always', keywords: [], andKeywords: [], backends: ['structured'] })
  books.main.entries = [
    entry('structured-prose', '中文分节与事实边界', [
      '使用结构化中文自然语言，以可见事实组织人物、服装、动作、环境、镜头与光线、风格、约束；标题、顺序和分节可自行调整，无内容的节省略。',
      '画风与构图只能表现剧情，不能添加不在场的人物、道具或事件；不输出内心独白、任务宣告或接口参数。保留自然段和人物各自有意义的重复。',
    ]),
    entry('structured-story', '单张定格与剧情时点', [
      '单张图只取一个时间点、一个可同时成立的动作阶段，写清当前姿态、受力或接触点、朝向和视线；不把起身全过程、随后巡视和心理变化串成连续镜头。',
      '多张图各有不同瞬间、景别或动作。即使按重要性而非时间先后输出，也必须沿用该画面正文时点之前最后明确的状态，不能按输出前一张继承服装、地点和外貌。',
    ]),
    entry('structured-people', '多人动作与物品归属', [
      '每名入镜人物用稳定称呼分别说明站位、朝向、动作和交互对象，明确谁的手接触谁、谁持有什么，不用含混的“他们”代替动作归属。',
      '两个人共有的特征可以分别重复；不要把人物甲的衣服、外貌或参考图约束套给人物乙。局部入镜仍保留人物身份，同一角色按此刻形态描述。',
    ]),
    entry('structured-visible', '镜头裁切与可见内容', [
      '先确定景别、视角和裁切范围，再描述实际可见的外貌、衣物与道具。穿着事实不等于本镜头必须展示；不为了展示鞋脚强行扩大构图，也不把所有中景都当成看不到脚。',
      '背影不强求瞳色或正脸，遮挡处不同时写清被遮住的细节。姿态、接触点和空间位置须能在同一画面成立。',
    ]),
    entry('structured-space', '遮挡与空间光线', [
      '明确已有物体的位置、遮挡范围、光源和照射路径，使它们能够共存；区分窗户遮光布、窗帘和原文明确的开口。',
      '正文说黑布遮窗又有光线时，只澄清正文已有关系，不为解释光线擅自新增开口、掀布或移动光源；没有依据的细节不补造。',
    ]),
    entry('structured-examples', '中文短例与输出前自检', [
      '单人例：正文写江铭撑起回望，可写“江铭上半身刚撑离床面，一手支撑床沿，头侧转回望，神情警觉”，不要续写他随后下床巡视。',
      '双人例：正文写林月向陈安递伞，可写“林月站在左侧，右手握伞柄伸向陈安；陈安站在右侧，左手接住伞柄”，不要只写“两人递伞”；左右和手别仅在正文已有或不违背已确立构图时确定。',
      '输出前检查人数、动作归属、剧情时点、可见衣着、遮挡光路和参考用途；修正文句即可，不额外输出检查过程或长篇思考。示例人物、动作和布景不是每张图必加的内容。',
    ]),
  ]
  books.outfits.entries[0] = entry('structured-identity', '人物与参考资料的分工', [
    '有身份参考图的人物，以参考图约束面部、发型和固有体型比例，不照搬服装、姿势、表情和背景，也不再完整堆叠旧外貌标签。',
    '无身份图的人物使用库内文字与正文描述可见外貌；未知人物照正文写，不编造人物库标识。仅收到文字清单时不能声称看过图片。',
    '人物名称保持清楚，一致性补充归属到具体对象；剧情明确的外观变化优先，不混写不同人物或形态。参考图编号和绑定说明由插件统一生成，不重复代写。',
  ])
  books.outfits.entries[1] = entry('structured-clothes', '当刻穿着与服装可见性', [
    '按本张画面对应的剧情时点确定穿着，换装前后分别描述；未写变化时沿用此时点之前最后明确的状态，不沿用输出上一张图的衣服。',
    '引用库中服装使用准确服装名，不把标识或“常穿”备注当成服装名；纯文字衣着不必强套服装库。拿在手里、脱下或放在一旁不等于正在穿着。',
    '服装图只约束服饰设计，不继承模特身份、姿势或背景；没有服装图时用中文说明可见颜色、款式和状态，正文明确的湿衣、破损等变化优先。',
    '衣着记录与当前镜头可见性分别处理：画外部位不强求展示，不因没写服装参考就擅自补常穿。',
  ])
  for (const book of Object.values(books)) book.defaultSeed = seedMetadata(book, 2)
  return books
}

/** Immutable historical baselines are also exposed for migrations/tests. */
export function structuredWorldbookDefaults(version = STRUCTURED_WORLDBOOK_SEED_VERSION) {
  if (version === 1) return structuredWorldbookDefaultsV1()
  if (version === 2) return structuredWorldbookDefaultsV2()
  if (version !== STRUCTURED_WORLDBOOK_SEED_VERSION) throw new Error('结构化默认规则版本无效')
  const books = structuredWorldbookDefaultsV2()
  const revise = (key, id, lines) => { books[key].entries.find(entry => entry.id === id).content = lines.join('\n') }
  revise('main', 'structured-prose', [
    '使用结构化中文自然语言，以可见事实组织人物与表情、服装、动作、环境、镜头与光线、风格、约束；有身份参考图时人物节只写当前状态。标题、顺序和分节可调整，无内容的节省略。',
    '正文与已确立的上下文是画面事实的依据。画风与构图只表现已有剧情，不补无依据的服装、道具、人物或事件；没有明确风格要求就省略风格节，不自行加电影感、写实或画师名。',
    '先确定这一瞬间的主导情绪，再用正文支持的可见表情、视线、姿态与身体张力呈现；动作和构图服务于情绪，不以抽象心理词、内心独白或过程叙述替代可见表现。保留自然段及人物各自有意义的重复。',
    '负向约束只针对本张已知的具体错误，指出对象与错误关系，例如遮挡物后方的细节不应透出；不写“不存在的道具”等泛泛措辞。没有依据或与本张无关的规则不输出，也不附加通用衣物状态规则、任务宣告或接口参数。',
  ])
  revise('main', 'structured-story', [
    '单张图只取一个明确时间点、一个可同时成立的动作阶段，写清当前姿态、受力或接触点、朝向和视线；不把起身、站稳、巡视等冲突阶段揉进同一张图。',
    '“扫过”“逐渐”“随后”等过程不能直接充当定格动作；按正文选定这一刻视线停留的对象或方向，不虚构巡视终点。只写此刻可见结果，不串联连续镜头。',
    '多张图各有不同瞬间、景别或动作。即使按重要性而非时间先后输出，也必须沿用该画面正文时点之前最后明确的状态，不能按输出前一张继承服装、地点和外貌。',
  ])
  revise('main', 'structured-people', [
    '每名入镜人物用稳定称呼分别说明站位、朝向、动作和交互对象，明确谁的手接触谁、谁持有什么，不用含混的“他们”代替动作归属。',
    '两个人共有的当前状态可以分别描述；不要把人物甲的衣服、外貌或参考图约束套给人物乙。局部入镜仍使用稳定称呼；身份信息与此刻形态、表情和动作分开，不为区分人物补写固定外貌。',
  ])
  revise('main', 'structured-visible', [
    '先确定景别、视角和裁切范围，再描述实际可见的当前状态、衣物与道具；无身份参考图时才按已有文字补充可见外貌。穿着事实不等于本镜头必须展示，不为了展示鞋脚强行扩大构图，也不把所有中景都当成看不到脚。',
    '背影不强求瞳色或正脸，遮挡处不同时写清被遮住的细节。姿态、接触点和空间位置须能在同一画面成立；主导情绪应落实到镜头内看得到的表情或身体表现。',
  ])
  revise('main', 'structured-space', [
    '空间、遮挡范围、光源和照射路径只使用正文或已确立上下文中的依据；窗户遮光布不改写成窗帘，遮挡物后方的细节不同时清晰可见。',
    '正文说黑布遮窗又有光线时，只表达已有的光照结果或明确关系；没有依据就不指定光路，不新增窗帘、开口、缝隙、掀布动作或光源，也不移动已有物体来替文字补解释。',
  ])
  revise('main', 'structured-examples', [
    '单人例：若正文明确江铭一手撑床沿回望并显露警觉，可写“江铭一手撑住床沿，上半身离开床面，头转向身后，肩背绷紧”；有身份参考图时不追加年龄性别或固定外貌，也不续写随后下床巡视。',
    '双人例：正文写林月向陈安递伞，可写“林月握住伞柄递向陈安，陈安的手搭在同一伞柄上”；站位、手别与接触阶段须有正文或已确立构图依据，不把递出、接稳和收伞串成一张图。',
    '输出前检查主导情绪是否可见、人数与动作归属、单一时点、可见衣着、遮挡光路和参考用途；身份绑定由插件统一一次，不重复写入各节。修正文句即可，不输出检查过程；示例人物、道具和布景不是必加内容，无关规则不进入最终提示词。',
  ])
  revise('outfits', 'structured-identity', [
    '有身份参考图的人物，身份外观交给参考图，不再描述年龄、性别或固定外貌；不要补写“年轻男性”等概括，也不重述面部、发型、肤色和固有体型比例。',
    '身份引用、参考图编号与绑定说明由插件统一一次；规划正文只用稳定人物称呼，不另写“人物及参考图对应”段，不在每节重复“保持参考图一致”或自行编造编号。仅收到文字清单时不能声称看过图片。',
    '当前状态与身份分离：表情、视线、动作和本轮明确变化写入对应状态描述，不混入身份引用；身份图不提供当前服装、姿势、表情或背景。',
    '无身份参考图时，才使用人物库文字与正文描述有依据且当前可见的外貌；未知人物照正文写，不编造人物库标识，也不补猜年龄性别。不同人物与形态的状态分别归属。',
  ])
  revise('outfits', 'structured-clothes', [
    '按本张画面对应的剧情时点确定穿着，换装前后分别描述；未写变化时沿用此时点之前最后明确的状态，不沿用输出上一张图的衣服。没有衣着依据就不补造颜色、款式、配饰或随身道具。',
    '引用库中服装使用准确服装名，不把标识或“常穿”备注当成服装名；纯文字衣着不必强套服装库。拿在手里、脱下或放在一旁不等于正在穿着。',
    '服装图只约束服饰设计，不继承模特身份、姿势或背景；没有服装图时只说明已知、当前可见的衣物与状态。衣着记录与镜头可见性分别处理，不强求画外部位展示，也不因缺少服装参考而补常穿。',
    '只在正文明确发生且本镜头可见时写具体衣物变化；最终提示词不附带与本张无关的服装状态提醒或通用负向规则。',
  ])
  for (const book of Object.values(books)) book.defaultSeed = seedMetadata(book)
  return books
}

function upgradeStatus(book, key) {
  const current = normalizeFormatWorldbook(book)
  const latest = structuredWorldbookDefaults()[key]
  // Compare actual content with frozen versions, never trust editable defaultSeed
  // fingerprints. Mixed-version books can safely update untouched entries too.
  const legacy = [1, 2].map(version => normalizeFormatWorldbook(structuredWorldbookDefaults(version)[key]))
  const wholeLegacyUnchanged = legacy.some(previous => fingerprint(bookContent(current)) === fingerprint(bookContent(previous)))
  const entries = latest.entries.map(proposed => {
    const matches = current.entries.filter(entry => entry.id === proposed.id)
    const previous = legacy.flatMap(book => book.entries.filter(entry => entry.id === proposed.id))
    const item = matches[0] || null
    const state = matches.length > 1 ? 'ambiguous' : !item ? 'missing'
      : item.enabled === false ? 'disabled'
      : fingerprint(item) === fingerprint(proposed) ? 'current'
      : previous.some(entry => fingerprint(item) === fingerprint(entry)) ? 'update' : 'customized'
    return { id: proposed.id, state, current: item, proposed: clone(proposed), autoUpdate: state === 'update' || (state === 'missing' && wholeLegacyUnchanged) }
  })
  return { format: 'structured', key, version: STRUCTURED_WORLDBOOK_SEED_VERSION, fingerprint: fingerprint(current), wholeLegacyUnchanged, entries,
    available: entries.some(entry => entry.state !== 'current'), autoUpdateIds: entries.filter(entry => entry.autoUpdate).map(entry => entry.id) }
}

/**
 * Independent worldbooks, scoped to an explicit resolved prompt format.
 *
 * IO defaults to node:fs/promises; tests/hosts may supply an fs-compatible object
 * with readFile, writeFile, mkdir, link, rename and unlink. All methods are async.
 *
 * Paths: format-worldbooks/<format>/{worldbook,worldbook-outfits}.json.
 * An immutable migration snapshot pins both old sources before any copy is made.
 * Originals are never modified; exact source bytes are backed up. Restarting a
 * partial migration creates missing books from that snapshot. Structured defaults
 * then upgrade only fingerprint-confirmed old entries, with exact-byte backups;
 * empty groups, deletions, disabled entries and user edits are never auto-restored.
 */
export function createFormatWorldbooks({ root, io = nodeFs } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('需要世界书根目录 root')
  const base = resolve(root)
  const folder = join(base, 'format-worldbooks')
  const migrationFile = join(folder, 'migration-v1.json')
  const backupFolder = join(base, 'backups', 'format-worldbooks-v1')
  const writes = WRITE_QUEUES
  async function serialize(file, run) {
    const previous = writes.get(file) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(run)
    writes.set(file, operation)
    try { return await operation }
    finally { if (writes.get(file) === operation) writes.delete(file) }
  }
  let ready = null

  const fileFor = (mode, key) => join(folder, assertMode(mode), BOOKS[assertGroup(key)].file)
  async function readText(file) {
    try { return await io.readFile(file, 'utf8') }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  function parse(text, file) {
    try { return JSON.parse(text) }
    catch (error) { throw new Error('世界书 JSON 无效：' + file, { cause: error }) }
  }
  async function removeTemp(file) {
    try { await io.unlink(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  // Both publication operations expose only complete files. A hard link provides
  // atomic create-if-absent (rename alone would overwrite another initializer's
  // winner). Temp files always live beside a validated internal target path.
  async function publish(file, text, replace = false, beforeReplace = null) {
    await io.mkdir(dirname(file), { recursive: true })
    const temp = file + '.tmp-' + randomUUID()
    await io.writeFile(temp, text, { encoding: 'utf8', flag: 'wx' })
    try {
      if (replace) {
        // Windows file scanners can briefly hold either path while a worldbook
        // is being replaced. Keep the same-file rename atomic and retry only
        // transient sharing/permission errors; never unlink the destination.
        const retryDelays = [50, 100, 200, 400, 800, 1200, 1600]
        for (let attempt = 0; ; attempt++) {
          if (beforeReplace) await beforeReplace()
          try {
            await io.rename(temp, file)
            break
          } catch (error) {
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= retryDelays.length) throw error
            await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]))
          }
        }
      }
      else {
        try { await io.link(temp, file) }
        catch (error) { if (error.code === 'EEXIST') return false; throw error }
      }
      return true
    } finally { await removeTemp(temp) }
  }
  async function legacySource(key) {
    const book = BOOKS[key]
    let file = book.file, text = await readText(join(base, file))
    if (text === null) { file = book.seed; text = await readText(join(base, file)) }
    const document = text === null ? { name: book.label, entries: [] }
      : normalizeFormatWorldbook(parse(text, file), { name: book.label })
    return { file: text === null ? null : file, text, document }
  }
  async function initialize() {
    let saved = await readText(migrationFile)
    if (saved === null) {
      const snapshot = { version: MIGRATION_VERSION, sources: {} }
      // Parse both before publishing anything: malformed old data is an explicit
      // error, never an invitation to overwrite it with empty/default rules.
      for (const key of FORMAT_WORLDBOOK_GROUPS) snapshot.sources[key] = await legacySource(key)
      await publish(migrationFile, json(snapshot))
      saved = await readText(migrationFile)
    }
    const snapshot = parse(saved, migrationFile)
    if (snapshot?.version !== MIGRATION_VERSION) throw new Error('世界书迁移快照版本无效')
    for (const key of FORMAT_WORLDBOOK_GROUPS) {
      const source = snapshot.sources?.[key]
      if (!source || !source.document || (source.text !== null && typeof source.text !== 'string')) throw new Error('世界书迁移快照缺少 ' + key)
      normalizeFormatWorldbook(source.document)
      if (source.file !== null) {
        // Snapshot data cannot escape the reserved backup directory.
        if (![BOOKS[key].file, BOOKS[key].seed].includes(source.file) || typeof source.text !== 'string') throw new Error('世界书迁移快照来源无效')
        const target = join(backupFolder, source.file)
        await publish(target, source.text)
        if (await readText(target) !== source.text) throw new Error('世界书迁移备份与快照不一致：' + source.file)
      }
    }
    const defaults = structuredWorldbookDefaults()
    const created = []
    for (const mode of FORMAT_WORLDBOOK_MODES) {
      for (const key of FORMAT_WORLDBOOK_GROUPS) {
        const document = mode === 'structured' ? defaults[key] : snapshot.sources[key].document
        if (await publish(fileFor(mode, key), json(document))) created.push({ mode, key })
      }
    }
    const upgrades = []
    for (const key of FORMAT_WORLDBOOK_GROUPS) upgrades.push(await upgradeBook(key, { automatic: true }))
    return { version: MIGRATION_VERSION, created, migrationFile, backupFolder, upgrades }
  }
  function ensure() {
    if (!ready) ready = initialize().catch(error => { ready = null; throw error })
    return ready
  }
  async function readBook(mode, key) {
    const file = fileFor(mode, key)
    await ensure()
    const text = await readText(file)
    if (text === null) throw new Error('独立世界书文件已不存在：' + mode + '/' + key)
    return normalizeFormatWorldbook(parse(text, file), { name: BOOKS[key].label })
  }
  async function getUpgradeStatus(key) {
    return upgradeStatus(await readBook('structured', assertGroup(key)), key)
  }
  async function upgradeBook(key, { automatic = false, expectedFingerprint, entryIds } = {}) {
    const file = fileFor('structured', key)
    // Snapshot explicit selections before waiting for another writer.
    const requested = Array.isArray(entryIds) ? [...entryIds] : null
    return serialize(file, async () => {
      const old = await readText(file)
      if (old === null) throw new Error('结构化世界书不存在')
      const book = normalizeFormatWorldbook(parse(old, file))
      const status = upgradeStatus(book, key)
      if (!automatic && expectedFingerprint !== status.fingerprint) throw Object.assign(new Error('世界书已变更，请刷新升级预览后重试'), { code: 'WORLDBOOK_UPGRADE_STALE' })
      const ids = automatic ? status.autoUpdateIds : requested
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !status.entries.some(entry => entry.id === id))) throw new Error('请选择有效的默认规则条目')
      const next = clone(book)
      for (const id of new Set(ids)) {
        const item = status.entries.find(entry => entry.id === id)
        if (item.state === 'ambiguous') throw new Error('默认规则标识重复，请先处理：' + id)
        if (item.state === 'current') continue
        const at = next.entries.findIndex(entry => entry.id === id)
        const replacement = { ...item.current, ...clone(item.proposed) }
        // Explicit content restoration never re-enables a user-disabled entry.
        if (item.current?.enabled === false) replacement.enabled = false
        if (at < 0) next.entries.push(replacement)
        else next.entries[at] = replacement
      }
      if (fingerprint(next) === fingerprint(book)) return status
      next.defaultSeed = structuredWorldbookDefaults()[key].defaultSeed
      const backupFile = join(base, 'backups', 'format-worldbooks-upgrades', key + '-' + Date.now() + '-' + randomUUID() + '.json')
      await publish(backupFile, old)
      // Reject an external edit observed while the backup was being written.
      if (await readText(file) !== old) throw Object.assign(new Error('世界书已变更，请刷新升级预览后重试'), { code: 'WORLDBOOK_UPGRADE_STALE' })
      await publish(file, json(next), true, async () => {
        if (await readText(file) !== old) throw Object.assign(new Error('世界书已变更，请刷新升级预览后重试'), { code: 'WORLDBOOK_UPGRADE_STALE' })
      })
      return { ...upgradeStatus(next, key), backupFile }
    })
  }
  async function applyDefaultUpgrade(key, options = {}) {
    assertGroup(key)
    const captured = { expectedFingerprint: options.expectedFingerprint, entryIds: Array.isArray(options.entryIds) ? [...options.entryIds] : options.entryIds }
    await ensure()
    return upgradeBook(key, captured)
  }
  async function writeBook(mode, key, value) {
    const file = fileFor(mode, key)
    // Capture data at invocation time: subsequent caller edits must not mutate a
    // queued write. No cross-format or main/outfits merged view can leak into it.
    const document = clone(normalizeFormatWorldbook(value, { name: BOOKS[key].label }))
    await ensure()
    const previous = writes.get(file) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const old = await readText(file)
      if (old !== null) {
        const backup = join(base, 'backups', 'format-worldbooks-edits', mode + '-' + key + '-' + Date.now() + '-' + randomUUID() + '.json')
        await publish(backup, old)
      }
      await publish(file, json(document), true)
      return clone(document)
    })
    writes.set(file, operation)
    try { return await operation }
    finally { if (writes.get(file) === operation) writes.delete(file) }
  }
  async function listBooks(mode) {
    assertMode(mode)
    return Promise.all(FORMAT_WORLDBOOK_GROUPS.map(async key => {
      const book = await readBook(mode, key)
      const entries = book.entries.map((entry, index) => ({ ...entry, index, length: entry.content.length }))
      return { format: mode, key, file: 'format-worldbooks/' + mode + '/' + BOOKS[key].file, label: BOOKS[key].label,
        name: book.name, count: entries.length, enabled: entries.filter(entry => entry.enabled !== false).length, entries }
    }))
  }
  async function readFormat(mode) {
    const books = await listBooks(mode)
    const entries = []
    for (const book of books) for (const entry of book.entries) entries.push({ ...entry, book: book.key, bookIndex: entry.index, index: entries.length })
    return { format: mode, name: books[0].name, entries, books }
  }
  return { ensure, readBook, writeBook, readFormat, listBooks, getUpgradeStatus, applyDefaultUpgrade }
}

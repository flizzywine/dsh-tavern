import {figureDefaultEmotion,matchBubbleMood,GEN_RECORDS} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {createHash, randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {checkPurchaseConfirmation} from './image-billing-confirmation.js'
import {cropAssetBackground, checkAssetImage, sliceAssetAvatarSheet, alignAssetSprite, checkSpriteCutout, decodeAssetRgba, encodeAssetRgba} from './asset-image-processing.js'
import {matteKey} from '../../packages/dsh-asset-library/lib/pack-v2/key-matte.js'
import {assetSheetEmotionIds} from './asset-generation-emotions.js'
import {imageCost, addCost} from './asset-generation-cost.js'
import spriteEmotions from '../../shared/sprite-emotions.cjs'
import {validateUuid, validateHash, validateShortId, validateStateId} from '../../packages/dsh-asset-library/lib/asset-packs/common.js'
import {validateIdentitySettei} from '../../packages/dsh-asset-library/lib/asset-packs/identity-settei.js'
import {packGenStyle, validGenStyle} from '../../packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {imageKind, imageDimensions, pngSize} from '../../packages/dsh-asset-library/lib/pack-v2/media.js'
import {coverImageType, coverImageAsPng} from './card-cover-image.js'

const ROOT = 'asset-generation/', INDEX = ROOT + 'jobs.json', COSTS = ROOT + 'costs.json', CHANNELS = ROOT + 'channels.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clone = value => structuredClone(value)
import {renderAssetTemplate, assetStyleLines, assetOutput, assetPromptValues, ASSET_REFERENCE_ROLES as roles, ASSET_PRODUCTION_DEFAULTS, ASSET_IMAGE_QUALITIES, assetStyleUse, BACKGROUND_STYLE_REFERENCE_ROLE} from './asset-production-contract.js'
export {renderAssetTemplate} from './asset-production-contract.js'
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), {code, ...extra}) }
const assert = (condition, code, message) => { if (!condition) fail(code, message) }
const path = id => ROOT + id + '.png'
const referencePath = (id,index) => ROOT + id + '.ref-' + index
const targetKey = target => JSON.stringify(target)
const publicJob = job => clone(Object.fromEntries(Object.entries(job).filter(([key]) => !['slot','prompt','basePrompt','provider','output','anchor'].includes(key))))
// A failed request in plain words: why, and what to change. The channel's own text goes along as `detail` (the tile's
// tooltip), because it is often the only clue to what this channel refuses (a size, a reference picture, the balance).
export function generationFailure(error, {size, references = 0} = {}) {
  const raw = String(error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const status = Number(raw.match(/\bHTTP\s*(\d{3})\b/)?.[1])
  const asked = (size ? '这张素材要 ' + size.replace('x', '×') + ' 的图' : '这张素材') + (references ? '、带 ' + references + ' 张参考图' : '')
  const plain = !status ? '' : status === 401 || status === 403 ? '生图渠道拒绝了请求：密钥不对或没有权限。请在 设置 → 配图 检查这个渠道的密钥'
    : status === 402 ? '生图渠道说余额或点数不够。请充值，或在 设置 → 配图 换一个渠道'
    : status === 404 ? '生图渠道找不到这个地址或模型。请在 设置 → 配图 检查渠道地址和模型'
    : status === 429 ? '生图渠道说请求太频繁或额度暂时用完了。过一会儿再试，或在 设置 → 配图 换一个渠道'
    : status >= 500 ? '生图服务那边出错了，过一会儿再试'
    : '生图渠道不接受这次请求：' + asked + '，这个渠道可能不支持。可在 设置 → 配图 换一个渠道再试'
  return plain ? {message:plain, detail:raw} : {message:raw || '生图失败'}
}
// Transparent pictures (立绘, 头像, the eight-face sheet) on a channel that cannot draw transparency: the picture is drawn
// on one flat key colour and keyed out here, with the keying Dot deliveries and the local image model use (key-matte.js).
// Green, or magenta when the picture itself is green.
export const keyColour = prompt => /绿|green/i.test(prompt) ? '#FF00FF' : '#00FF00'
const BACKGROUND_LINE = /^Background\b.*$/m
export function keyedPrompt(prompt, key) {
  const line = 'Background: one flat solid ' + key + ' colour filling the whole canvas, with no shadow, gradient, floor or texture. The character is fully opaque, drawn in its own colours, clearly distinct from that key colour.'
  return BACKGROUND_LINE.test(prompt) ? prompt.replace(BACKGROUND_LINE, line) : prompt + '\n' + line
}
// A keyed picture made transparent; one whose border is not the flat key (or that is transparent already) stays as it came.
function matteCandidate(png, key) {
  const {width, height, data} = decodeAssetRgba(png)
  try { return encodeAssetRgba({width, height, data:matteKey(data, width, height, 4, {key}).data}) }
  catch (error) { if (error.code === 'PRECONDITION') return png; throw error }
}
// The deterministic checks of a received picture. A picture that should be transparent and has a background (its border
// mostly opaque, checkSpriteCutout) reads hasTransparency:false with one NO_TRANSPARENCY warning that says why and what to do.
// `keyed`: this picture was drawn on a key colour and keyed out; `trusted`: the channel says it draws transparency itself,
// so it is never keyed (a redraw is the only way out).
export function pictureChecks(png, kind, {sheet = false, keyed = false, trusted = false} = {}) {
  const checks = checkAssetImage(png, kind, {sheet})
  if (!['sprite','avatar'].includes(kind) || checks.hasTransparency === undefined) return checks
  const cutout = checks.hasTransparency && checkSpriteCutout(png)
  if (cutout?.valid) return checks
  const what = cutout?.haze ? '画布边上有一层半透明的雾（生图渠道没把透明底画干净），放上舞台会看得到' : '生图渠道没有画出透明底，这张图带着背景'
  return {...checks, hasTransparency:false, warnings:[...checks.warnings.filter(w => w.code !== 'NO_TRANSPARENCY'), {code:'NO_TRANSPARENCY', severity:'warning', message:keyed
    ? '自动抠图没成功：生图渠道没有把人物画在纯色底上，这张图还带着背景。可以重画；经常这样的话，在 设置 → 配图 换一个能画透明底的模型（如 OpenAI 的 gpt-image）'
    : trusted ? what + '。重画一张即可'
    : what + '。重画即可：这个模型以后会先把人物画在纯色底上，再自动抠成透明'}]}
}
function text(value = '', max = 4000) {
  assert(typeof value === 'string' && value.length <= max, 'INVALID_ARGUMENT', '文本过长或格式错误')
  return value.trim()
}
// what starts once this request's picture is adopted — the 「平和」 立绘 + 头像 of a
// new outfit after its 服装设定图, a 差分's 头像 after its 立绘. Kept on the job (so it outlives a reload and goes with a
// rejection); the client sends them as their own requests after 采用. Same figure and outfit as the target.
function followUpInput(value, target) {
  if (value === undefined) return undefined
  assert(['settei','sprite'].includes(target.kind) && Array.isArray(value) && value.length > 0 && value.length <= 2, 'INVALID_ARGUMENT', '后续生成只用于设定图或立绘')
  return value.map(item => {
    assert(item && ['sprite','avatar'].includes(item.kind) && (target.kind === 'settei' || item.kind === 'avatar' && item.emotionId === target.emotionId), 'INVALID_ARGUMENT', '后续生成的目标不对')
    validateStateId(item.emotionId)
    const prompt = text(item.userPrompt ?? '', 1000)
    assert(item.style === undefined || validGenStyle(item.style), 'INVALID_ARGUMENT', '未知的画风')
    return {kind:item.kind, emotionId:item.emotionId, ...(prompt ? {userPrompt:prompt} : {}), ...(item.style ? {style:item.style} : {})}
  })
}
function targetInput(value) {
  assert(value && ['identity-settei','settei','sprite','avatar','avatar-sheet','background'].includes(value.kind), 'INVALID_ARGUMENT', '未知素材类型')
  validateUuid(value.packId)
  if (value.kind === 'background') { if (value.assetId !== undefined) validateShortId(value.assetId); return {packId:value.packId,kind:value.kind,...(value.assetId !== undefined ? {assetId:value.assetId} : {})} }
  validateUuid(value.figureId)
  if (value.kind === 'identity-settei') return {packId:value.packId,kind:value.kind,figureId:value.figureId}
  validateShortId(value.outfitKey)
  const result = {packId:value.packId,kind:value.kind,figureId:value.figureId,outfitKey:value.outfitKey}
  if (['sprite','avatar'].includes(value.kind)) { validateStateId(value.emotionId); result.emotionId = value.emotionId }
  if (value.imageId !== undefined) { assert(value.kind === 'avatar', 'INVALID_ARGUMENT', 'Only avatar authoring selects an existing image'); validateStateId(value.imageId); result.imageId=value.imageId }
  if (value.kind === 'avatar-sheet' && value.emotionIds !== undefined) {
    assert(Array.isArray(value.emotionIds) && value.emotionIds.length > 0 && value.emotionIds.length <= 256 && new Set(value.emotionIds).size === value.emotionIds.length, 'INVALID_ARGUMENT', '请选择不重复的已声明差分')
    value.emotionIds.forEach(id => validateStateId(id))
    result.emotionIds = [...value.emotionIds]
  }
  return result
}
function context(pack, target) {
  assert(pack, 'ASSET_UNAVAILABLE', '原素材包已删除')
  if (target.kind === 'background') {
    if (!target.assetId) return {slot:null}
    const asset = pack.manifest.assets.find(a => a.kind === 'backgrounds' && a.id === target.assetId)
    assert(asset, 'ASSET_UNAVAILABLE', '背景条目已删除')
    return {asset, slot:asset.media ?? null}
  }
  const figure = pack.figures[target.figureId], outfit = figure?.outfits.find(o => o.key === target.outfitKey)
  if (target.kind === 'identity-settei') {
    assert(figure, 'ASSET_UNAVAILABLE', '人物已删除')
    return {figure,slot:figure.identitySettei?.board ?? null}
  }
  assert(outfit, 'ASSET_UNAVAILABLE', '人物或服装已删除')
  if (target.kind === 'settei') return {figure,outfit,slot:outfit.settei ?? null}
  if (target.kind === 'avatar-sheet') {
    assert(figure.emotions?.length, 'INVALID_ARGUMENT', '请先声明差分')
    const emotions = (target.emotionIds || assetSheetEmotionIds(figure,outfit)).map(id => context(pack,{...target,kind:'avatar',emotionId:id}).emotion)
    return {figure,outfit,emotions,slot:Object.fromEntries(emotions.map(e => [e.id,outfit.avatars?.[outfit.sprite?.imagePools?.[e.id]?.defaultImageId || e.id] ?? null]))}
  }
  const emotion = matchBubbleMood(target.emotionId,figure.emotions || []) || figure.emotions?.find(e => e.id === target.emotionId)
  assert(emotion, 'INVALID_ARGUMENT', '人物没有此差分')
  if (target.kind === 'avatar') return {figure,outfit,emotion,slot:outfit.avatars?.[target.imageId || outfit.sprite?.imagePools?.[target.emotionId]?.defaultImageId || target.emotionId] ?? null}
  // only this 差分's own state matters. A missing 差分 — in any sprite,
  // layered, lip-synced or hybrid alike — takes a single still, and so does a 差分 whose own state is one still; an
  // animated or parts state (mouth, blink, layers) keeps its structure and is not replaced by a generated picture.
  const sprite = outfit.sprite, manifest = sprite && pack.sprites[sprite.manifestKey]
  const state = manifest ? spriteEmotions.spriteEmotionState(manifest, outfit.sprite?.imagePools?.[target.emotionId]?.defaultImageId || target.emotionId) : null
  assert(!!outfit.sprite?.imagePools || !state || staticSpriteState(state), 'INVALID_ARGUMENT', '这个差分的立绘有分层或口型，不能用单图替换')
  const src = state && (state.stage?.src || state.src)
  return {figure,outfit,emotion,slot:src ? sprite.assets[src] ?? null : null}
}
// One still: no parts, mouth, blink, talk frame or separate portrait (the client's spriteStateStatic, same rule).
export function staticSpriteState(state) {
  const view = state.stage
  return !state.parts && !state.portrait && !state.talk && !state.blink && !state.binding && state.mouthSet === undefined && !Object.keys(state.mouthFrames || {}).length &&
    !view?.mouth && !view?.mouthByFrame && !view?.blink && !Object.keys(view?.mouthFrames || {}).length
}
// for a figure asset the request is the user's own text, then the
// default production prompt (the template without its 「User notes」 line), verbatim; other templates keep the user
// text where they place it.
const USER_NOTES_LINE = /^User notes: """\{\{userPrompt\}\}"""\n/m
export function composeAssetPrompt(template, values) {
  if (!USER_NOTES_LINE.test(template)) return renderAssetTemplate(template, values)
  const base = renderAssetTemplate(template.replace(USER_NOTES_LINE, ''), {...values, userPrompt:''})
  return values.userPrompt ? values.userPrompt + '\n\n' + base : base
}
// 设置 → 生图 replaces a whole-image template for every character (one global
// override per kind; the template file stays the default, read at run time). An override keeps the default's {{slots}}:
// they carry the character, the outfit, the 差分 and the cell's own prompt. CG has no in-app generator, so no override;
// mouth / blink / redraw-note are local patches. No override → the template bytes, unchanged.
export const ASSET_PROMPT_KINDS = Object.freeze(['sprite','avatar','avatar-sheet','settei','identity-settei','background'])
const PROMPTS = ROOT + 'prompts.json', PROMPT_MAX = 12000
const slotsOf = text => [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))]
// The same prompt as composeAssetPrompt, cut into parts: lines of an override that are not lines of the default (by
// longest common subsequence) are `edited`, so 「查看全文」 can mark what 设置 → 生图 changed.
export function assetPromptParts(template, defaultTemplate, values) {
  const notes = USER_NOTES_LINE.test(template), strip = t => USER_NOTES_LINE.test(t) ? t.replace(USER_NOTES_LINE, '') : t
  const lines = assetStyleLines(strip(template), values).split('\n'), base = assetStyleLines(strip(defaultTemplate), values).split('\n'), n = lines.length, m = base.length
  const table = Array.from({length:n + 1}, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = lines[i] === base[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const kept = new Set()
  for (let i = 0, j = 0; i < n && j < m;) { if (lines[i] === base[j]) { kept.add(i); i++; j++ } else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++ }
  const parts = [], push = (text, edited) => { const last = parts.at(-1); if (last && !!last.edited === edited) last.text += text; else parts.push(edited ? {text, edited} : {text}) }
  if (notes && values.userPrompt) push(values.userPrompt + '\n\n', false)
  const filled = notes ? {...values, userPrompt:''} : values
  lines.forEach((line, i) => push(renderAssetTemplate(line, filled) + (i < n - 1 ? '\n' : ''), !kept.has(i)))
  return parts
}
// Freeze authority separately from pack revision: unrelated edits may proceed, changed parents may not.
// key order is not authority — a figure rewritten by patchFigure (e.g. the adoption record)
// stores the same identity board with its keys in another order, which must not fail the next adoption.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
function authority(ctx, kind) {
  if (['background','identity-settei'].includes(kind)) return null
  return JSON.stringify(canonical({identity:ctx.figure.identitySettei ?? null,...(kind !== 'settei' ? {settei:ctx.outfit.settei ?? null,parentVersion:ctx.outfit.setteiParentVersion ?? null} : {})}))
}
function inspectImage(bytes, mediaType, max) {
  assert(bytes.length > 0 && bytes.length <= max, 'LIMIT_EXCEEDED', '图片为空或过大')
  const ext = imageKind(bytes)
  assert(ext && mediaType === 'image/' + ext, 'INVALID_ARGUMENT', '图片格式与内容不符')
  const [width,height] = imageDimensions(bytes, ext)
  assert(width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 32 * 1024 ** 2, 'LIMIT_EXCEEDED', '图片尺寸过大')
  if (ext === 'png') pngSize(bytes, true)
  if (ext === 'jpeg') assert(bytes.readUInt16BE(bytes.length - 2) === 0xffd9, 'INVALID_ARGUMENT', 'JPEG 不完整')
  return {hash:hash(bytes),mediaType,size:bytes.length,width,height}
}
/** One profile owner. Network work never occupies the short mutation gate. */
export function createAssetGeneration({store, imageProvider = () => null, getLibrary, now = Date.now,
  readTemplate = kind => readFile(new URL(`../../presets/asset-gen/templates/${kind}.md`, import.meta.url), 'utf8'),
  planTtlMs = 15 * 60_000, candidateTtlMs = 24 * 60 * 60_000, timeoutMs = 5 * 60_000, linkedAppearance = async () => null}) {
  const plans = new Map(), pendingBytes = new Map(), controllers = new Map(), tasks = new Set()
  let jobs, queue = Promise.resolve(), disposed = false
  const save = () => store.updateJson(INDEX, () => jobs)
  const readPrompts = async () => await store.readJson(PROMPTS) || {revision:0,overrides:{}}
  // The models that answered a transparent request with a background ({opaque:{[model]:at}}). Theirs, and those whose
  // status says `transparent: false`, are keyed from then on; `transparent: true` (OpenAI's own gpt-image) never is.
  const keyFor = async (status, prompt) => status.transparent === true ? null
    : status.transparent === false || (await store.readJson(CHANNELS))?.opaque?.[status.model] ? keyColour(prompt) : null
  const noteOpaque = model => store.updateJson(CHANNELS, current => ({opaque:{...current?.opaque, [model]:now()}}))
  // cost: what every picture drawn so far cost (asset-generation-cost.js), shown beside the prompts in 设置 → 舞台 → 素材生图.
  const promptView = async ({revision, overrides}) => ({revision, cost:await store.readJson(COSTS) || null, kinds:await Promise.all(ASSET_PROMPT_KINDS.map(async kind => {
    const base = await readTemplate(kind)
    return {kind, text:overrides[kind] ?? base, edited:Object.hasOwn(overrides, kind), required:slotsOf(base)}
  }))})
  const library = () => { const service = getLibrary(); assert(service, 'ASSET_UNAVAILABLE', '舞台素材未启用'); return service }
  // A received picture is paid for whatever happens to it next: price it (from the reply's usage, else the request) and add it to the total.
  async function charge(reply, model, request) {
    // request.references are the pictures sent; only an estimate needs their sizes.
    const sizes = reply.usage ? [] : request.references.map(({data}) => { const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength); return imageDimensions(bytes, imageKind(bytes)) })
    const cost = imageCost({model:reply.model ?? model, usage:reply.usage, request:{...request, references:sizes}})
    await store.updateJson(COSTS, total => addCost(total ?? undefined, cost, now())).catch(() => {})
    return cost
  }
  async function initialize() {
    if (jobs) return
    jobs = await store.readJson(INDEX) || {}
    for (const job of Object.values(jobs)) if (job.status === 'running' || job.status === 'save_failed') {
      const bytes = await store.readBytes(path(job.jobId))
      if (bytes && job.candidate) { job.status = 'candidate'; job.outcome = 'received' }
      else { job.status = 'failed'; job.error = {code:'GENERATION_FAILED',message:'任务被重启中断；不会自动重发',retryable:false,mayHaveCharged:job.outcome === 'unconfirmed'} }
    }
    await save()
  }
  async function reap() {
    for (const [id, plan] of plans) if (plan.expiresAt <= now()) plans.delete(id)
    let changed = false
    for (const [id, job] of Object.entries(jobs)) if (job.expiresAt <= now() && job.status !== 'running') {
      await removeImages(job); pendingBytes.delete(id); delete jobs[id]; changed = true
    }
    if (changed) await save()
  }
  async function removeImages(job) {
    await store.remove(path(job.jobId))
    for (let i = 0; i < (job.references?.length || 0); i++) await store.remove(referencePath(job.jobId,i))
  }
  function serial(fn) {
    const result = queue.then(async () => { assert(!disposed, 'ASSET_UNAVAILABLE', '素材生图服务已关闭'); await initialize(); await reap(); return fn() })
    queue = result.catch(() => {})
    return result
  }
  function find(id) { validateUuid(id); const job = jobs[id]; assert(job, 'EXPIRED', '候选已过期或不存在'); return job }
  async function snapshot(target, revision) {
    const pack = await library().getPackSnapshot({packId:target.packId})
    assert(pack, 'ASSET_UNAVAILABLE', '原素材包已删除')
    assert(pack.revision === revision, 'REVISION_CONFLICT', '素材包已变化，请刷新后复核目标')
    return pack
  }
  // an adopted generation is one row of its outfit's record (kind, 差分, when, the user's
  // own prompt), newest last, at most GEN_RECORDS; written with the adoption (settei) or right after its import.
  const recorded = (figure, job) => {
    const prompt = String(job.userPrompt || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 1000)
    const row = {kind:job.target.kind, ...(['sprite','avatar'].includes(job.target.kind) ? {emotionId:job.target.emotionId} : {}), at:now(), ...(prompt ? {prompt} : {}), ...(job.style ? {style:job.style.id} : {})}
    return {...figure, outfits:figure.outfits.map(o => o.key === job.target.outfitKey ? {...o, genRecords:[...(o.genRecords || []), row].slice(-GEN_RECORDS)} : o)}
  }
  const prior = target => Object.values(jobs).reverse().filter(j => targetKey(j.target) === targetKey(target)).sort((a,b) => b.createdAt - a.createdAt)[0]
  const uncertain = target => { const last = prior(target); return last ? Object.values(jobs).filter(j => j.groupId === last.groupId && targetKey(j.target) === targetKey(target) && j.outcome === 'unconfirmed') : [] }
  async function persistCandidate(job, bytes) {
    // Metadata (including received outcome) precedes bytes: interrupted saves never become another request.
    await save()
    await store.writeBytes(path(job.jobId), bytes)
    job.status = 'candidate'; delete job.error
    await save(); pendingBytes.delete(job.jobId)
    const original = jobs[job.redrawOf]
    if (original?.status === 'candidate') {
      original.status = 'rejected'; delete original.candidate; await save()
      await removeImages(original)
    }
  }
  async function run(job, plan, controller) {
    try {
      // Pictures come from the image plugin's current channel; Tavern keeps no image channels of its own.
      const [width, height] = plan.output.size.split('x').map(Number)
      const reply = await plan.source.generate({prompt:plan.prompt, references:plan.images, width, height, promptPreset:plan.style.id, usage:plan.style.use,
        background:plan.output.background, quality:plan.output.quality, signal:AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])})
      if (reply?.data instanceof Uint8Array) {
        const {usd, estimated, model} = await charge(reply, plan.provider.model, {prompt:plan.prompt, width, height, quality:plan.output.quality, references:plan.images})
        job.cost = {usd, estimated, model}
      }
      if (controller.signal.aborted) return
      assert(reply?.data instanceof Uint8Array && reply.data.length <= 20 * 1024 ** 2, 'INVALID_ARGUMENT', '生图渠道没有返回有效图片')
      // Assets are stored as PNG; a channel that answers in JPEG or WebP (many relays do) is converted here.
      let data = Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength)
      assert(coverImageType(data), 'INVALID_ARGUMENT', '生图渠道返回的不是 PNG、JPEG 或 WebP 图片')
      data = await coverImageAsPng(data)
      const key = plan.output.key
      if (key) data = matteCandidate(data, key)
      const result = {data, mediaType:'image/png'}
      const candidate = inspectImage(result.data, result.mediaType, 20 * 1024 ** 2)
      candidate.checks = pictureChecks(result.data,job.target.kind === 'avatar-sheet' ? 'avatar' : job.target.kind,{sheet:job.target.kind === 'avatar-sheet', keyed:!!key, trusted:!!plan.provider.transparent})
      if (!key && plan.output.background === 'transparent' && candidate.checks.hasTransparency === false) await noteOpaque(plan.provider.model)
      if (job.target.kind === 'avatar-sheet') {
        try {
          const checks = {}, slices = sliceAssetAvatarSheet(result.data,job.target.emotionIds,{checks})
          candidate.slices = Object.fromEntries(Object.entries(slices).map(([id,bytes]) => [id,{checks:checks[id],hash:hash(bytes)}]))
        }
        catch { candidate.checks.warnings.push({code:'SHEET_UNSLICEABLE',severity:'warning',message:'网格尺寸或编码不支持自动切片，请人工导入'}) }
      }
      await serial(async () => {
        if (job.status !== 'running' || controller.signal.aborted) return
        job.candidate = candidate; job.outcome = 'received'; job.status = 'save_failed'
        pendingBytes.set(job.jobId, result.data)
        try { await persistCandidate(job, result.data) }
        catch { job.status = 'save_failed'; job.error = {code:'SAVE_FAILED',message:'图片已收到，保存失败；重试保存不会重新生图，重启可能丢失尚未落盘的图片',retryable:true,mayHaveCharged:true}; await save() }
      })
    } catch (error) {
      await serial(async () => {
        if (job.status !== 'running') return
        // The plugin says requestMayHaveSucceeded === false only when nothing can have been billed.
        job.status = 'failed'; job.outcome = error.requestMayHaveSucceeded === false ? 'rejected' : 'unconfirmed'
        const {message, detail} = generationFailure(error, {size:plan.output.size, references:plan.images.length})
        job.error = {code:'GENERATION_FAILED',message:(job.outcome === 'unconfirmed' ? '没有拿到结果，不会自动重试；' : '') + message,...(detail ? {detail} : {}),retryable:false,mayHaveCharged:job.outcome === 'unconfirmed'}
        await save()
      })
    } finally { controllers.delete(job.jobId) }
  }
  const api = {
    prepare: input => serial(async () => {
      assert(input.preview === true || plans.size < 8 && Object.keys(jobs).length < 128 && Object.values(jobs).filter(j => ['running','candidate','save_failed'].includes(j.status)).length < 32, 'LIMIT_EXCEEDED', '请先丢弃候选或等待记录到期')
      const target = targetInput(input.target), pack = await snapshot(target, input.expectedRevision), ctx = context(pack,target), followUp = followUpInput(input.followUp, target)
      if (target.kind === 'avatar-sheet') target.emotionIds = ctx.emotions.map(emotion => emotion.id)
      // 方案甲: a figure's 外貌 lives only in its 配图 人物库 record; without one the prompt has no 外貌 text.
      const linked = ctx.figure && await linkedAppearance({packId:target.packId, figureId:target.figureId, outfitKey:target.outfitKey})
      if (ctx.figure) ctx.figure = {...ctx.figure, identityAppearance:linked?.identityAppearance || ''}
      if (ctx.outfit) ctx.outfit = {...ctx.outfit, outfitAppearance:linked?.outfitAppearance || ''}
      if(target.imageId)assert(ctx.outfit.sprite?.imagePools?.[target.emotionId]?.imageIds.includes(target.imageId),'TARGET_CHANGED','Selected image is no longer an active candidate')
      // `preview` builds the exact prompt and reference list without a plan, a channel
      // or a request (free; works before the channel is set up), so the panel can show what ✦ will send.
      const preview = input.preview === true
      const source = preview ? null : imageProvider()
      const status = source ? await source.status() : null
      if (!preview) {
        assert(source, 'NOT_CONFIGURED', '素材生图由「配图」插件出图；请先安装并启用配图插件')
        assert(status.ready, 'NOT_CONFIGURED', status.reason || '请先在 配图 设置里配置生图渠道')
      }
      const count = input.count ?? 1
      assert(Number.isInteger(count) && count >= 1 && count <= 4, 'LIMIT_EXCEEDED', '每次显式请求 1 至 4 张候选')
      const userPrompt = text(input.userPrompt), references = input.references || []
      assert(Array.isArray(references) && references.length <= 4, 'LIMIT_EXCEEDED', '参考图最多四张')
      const images = [], refs = []
      async function packImage(blobHash, role, purpose = 'user') {
        validateHash(blobHash)
        const {bytes,descriptor} = await library().readMedia({packId:target.packId,expectedRevision:pack.revision,hash:blobHash})
        assert(['image/png','image/jpeg','image/webp'].includes(descriptor.mime) && descriptor.size <= 8 * 1024 ** 2, 'LIMIT_EXCEEDED', '参考图须为最多 8 MiB 的 PNG/JPEG/WebP')
        if (refs.some(ref => ref.hash === blobHash)) return
        images.push({data:Buffer.from(bytes),mediaType:descriptor.mime}); refs.push({hash:blobHash,role,purpose})
      }
      // in the app the identity board, the outfit 设定图 and the 平和
      // pictures are references used when they exist, never prerequisites (the portable CLI keeps its stricter
      // assetPrerequisites gates). A static 立绘 needs only a description (or any reference); a 头像 is a follow-up of its
      // own 差分's 立绘, and the eight-face sheet of the 平和 立绘. An identity board that the outfit 设定图 no longer
      // descends from is left out (the 设定图 is the outfit's authority) instead of blocking the request.
      // `omit` leaves out a default reference the user switched off in the dialog.
      const omit = new Set(Array.isArray(input.omit) ? input.omit : [])
      if (!['background','identity-settei'].includes(target.kind) && !omit.has('identity')) {
        const identity = ctx.figure.identitySettei, stale = !!identity && target.kind !== 'settei' && ctx.outfit.setteiParentVersion !== undefined && ctx.outfit.setteiParentVersion !== identity.version
        if (identity && !stale) await packImage(identity.board, roles.identity, 'identity-settei')
      }
      let anchor
      if (['sprite','avatar','avatar-sheet'].includes(target.kind)) {
        if (ctx.outfit.settei && !omit.has('settei')) await packImage(ctx.outfit.settei, roles.settei)
        const defaultEmotion=figureDefaultEmotion(ctx.figure,ctx.outfit)
        const sprite = ctx.outfit.sprite, manifest = sprite && pack.sprites[sprite.manifestKey]
        const stateFor = emotion => manifest ? spriteEmotions.spriteEmotionState(manifest,(emotion===target.emotionId?target.imageId:null) || ctx.outfit.sprite?.imagePools?.[emotion]?.defaultImageId || emotion) : null
        const sourceFor = emotion => { const state=stateFor(emotion); return state?.stage?.src || state?.src }
        if (target.kind === 'avatar-sheet') assert(sourceFor(defaultEmotion) || ctx.outfit.settei, 'ASSET_UNAVAILABLE', '先有默认差分立绘或设定图，才能一次生成指定头像')
        const emotionId = target.kind === 'avatar' ? target.emotionId : defaultEmotion
        const state = stateFor(emotionId), stateSource = state?.stage?.src || state?.src
        // a 立绘 is drawn from the 设定图 or the 设定文字, never from 平和: the
        // default sprite is no longer sent. It stays the ruler the adopted picture is aligned to (`anchor`, read on import).
        if (stateSource && target.kind === 'sprite' && target.emotionId !== defaultEmotion) anchor = sprite.assets[stateSource]
        if (stateSource && target.kind !== 'sprite') await packImage(sprite.assets[stateSource], target.kind === 'avatar' ? roles.emotionSprite : roles.sprite, target.kind === 'avatar' ? 'emotion-sprite' : 'default-sprite')
        // A single 头像 is drawn from its own 差分's 立绘 and the 设定 (not from the 平和 头像); the eight-face sheet redraws
        // 平和 too, so its current 头像 still sets the framing.
        if (target.kind === 'avatar-sheet' && ctx.outfit.avatars?.[defaultEmotion]) await packImage(ctx.outfit.avatars[defaultEmotion], roles.avatar)
      }
      for (const ref of references) {
        const role = text(ref.role, 300)
        if (ref.hash) await packImage(ref.hash, role)
        else {
          assert(typeof ref.base64 === 'string' && ref.base64.length <= Math.ceil(8 * 1024 ** 2 * 4 / 3) + 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(ref.base64), 'INVALID_ARGUMENT', '参考图上传格式错误')
          const bytes = Buffer.from(ref.base64,'base64'), meta = inspectImage(bytes,ref.mediaType,8 * 1024 ** 2)
          if (!refs.some(r => r.hash === meta.hash)) { images.push({data:bytes,mediaType:meta.mediaType}); refs.push({hash:meta.hash,role}) }
        }
      }
      if (target.kind === 'background') for (const hash of pack.manifest.backgroundStyle?.references || []) await packImage(hash, BACKGROUND_STYLE_REFERENCE_ROLE, 'background-style')
      assert(images.length <= 4, 'LIMIT_EXCEEDED', '设定图与补充参考合计最多四张')
      // The identity board, the outfit 设定图 and a 头像's own 立绘 are references, not prerequisites: a channel that takes
      // fewer pictures (none, for a text-only one) draws from the 设定文字 instead — the identity board is left out first, then
      // the outfit 设定图, then the 立绘. What the user added stays.
      if (!preview && ['settei','sprite','avatar'].includes(target.kind) && !input.redrawOf) for (const role of [roles.identity, roles.settei, roles.emotionSprite]) {
        const at = refs.findIndex(ref => ref.role === role)
        if (images.length > status.maxReferences && at >= 0) { images.splice(at, 1); refs.splice(at, 1) }
      }
      const textOnly = !preview && status.maxReferences === 0 && '当前生图渠道不能带参考图，只照文字画：请先写外貌或服装描述'
      if (['identity-settei','settei'].includes(target.kind) && !input.redrawOf) assert(userPrompt || ctx.figure.identityAppearance || ctx.outfit?.outfitAppearance || images.length, 'INVALID_ARGUMENT', textOnly || '请提供外貌文字或参考图')
      if (['sprite','avatar'].includes(target.kind) && !input.redrawOf) assert(userPrompt || ctx.figure.identityAppearance || ctx.outfit?.outfitAppearance || images.length, 'INVALID_ARGUMENT', textOnly || '请写一句描述，或加一张参考图')
      if (target.kind === 'background' && !input.redrawOf) assert(userPrompt, 'INVALID_ARGUMENT', '请描述需要的背景')
      // 画风: this request's style preset, else the pack's default (manifest.genStyle), else the default; the image plugin
      // adds its text for this kind's use. A pack's own background style replaces the preset for its backgrounds.
      assert(input.style === undefined || validGenStyle(input.style), 'INVALID_ARGUMENT', '未知的画风')
      const style = target.kind === 'background' && pack.manifest.backgroundStyle ? 'no-style' : packGenStyle(input.style ?? pack.manifest.genStyle), use = assetStyleUse(target.kind)
      if (!preview && source.presets) assert(source.presets().some(item => item.id === style), 'INVALID_ARGUMENT', '这个画风不在了：配图插件里找不到「' + style + '」，请另选一个画风')
      const own = (await readPrompts()).overrides[target.kind], values = assetPromptValues({kind:target.kind,backgroundStyle:pack.manifest.backgroundStyle,figure:ctx.figure,outfit:ctx.outfit,
        emotions:ctx.emotions,emotion:ctx.emotion,userPrompt,references:refs})
      let prompt = composeAssetPrompt(own ?? await readTemplate(target.kind), values)
      const parts = preview && own !== undefined && !input.redrawOf ? assetPromptParts(own, await readTemplate(target.kind), values) : null
      let basePrompt = prompt, backgroundName = [...(userPrompt.split(/[\n，。；！？、,.;!?]/).map(s => s.trim()).find(Boolean) || '')].slice(0,16).join('') || '新背景'
      if (input.redrawOf) {
        const original = find(input.redrawOf), note = text(input.note,1000)
        assert(targetKey(original.target) === targetKey(target) && note, 'INVALID_ARGUMENT', '重画须使用原目标并填写 note')
        assert(original.authority === authority(ctx,target.kind), 'TARGET_CHANGED', '原任务引用的设定已变化，请重新准备而非重用旧参考')
        images.length = 0; refs.length = 0
        for (const [index,ref] of (original.references || []).entries()) {
          if (ref.redraw || target.kind === 'background' && ref.purpose === 'background-style') continue
          const bytes = await store.readBytes(referencePath(original.jobId,index))
          assert(bytes, 'ASSET_UNAVAILABLE', '原任务参考已清理，请重新准备生成')
          images.push({data:bytes,mediaType:ref.mediaType}); refs.push({...ref})
        }
        backgroundName = original.backgroundName || backgroundName
        basePrompt = original.basePrompt || original.prompt
        if (target.kind === 'background' && (pack.manifest.backgroundStyle || original.references?.some(ref => ref.purpose === 'background-style'))) {
          for (const hash of pack.manifest.backgroundStyle?.references || []) await packImage(hash, BACKGROUND_STYLE_REFERENCE_ROLE, 'background-style')
          basePrompt = composeAssetPrompt(own ?? await readTemplate(target.kind), assetPromptValues({kind:target.kind,backgroundStyle:pack.manifest.backgroundStyle,userPrompt:original.userPrompt || userPrompt,references:refs}))
        }
        prompt = basePrompt + '\n' + (await readTemplate('redraw-note')).replace('<note>',note)
        if (input.useCandidateReference === true) {
          assert(original.status === 'candidate', 'ASSET_UNAVAILABLE', '请在丢弃原候选之前准备重画参考')
          const bytes = await store.readBytes(path(original.jobId))
          assert(bytes && bytes.length <= 8 * 1024 ** 2, 'LIMIT_EXCEEDED', '原候选不能用作参考：缺失或超过 8 MiB')
          images.push({data:bytes,mediaType:'image/png'}); refs.push({hash:original.candidate.hash,role:'Rejected candidate: follow user correction, not an approved design',redraw:true})
          prompt += `\nImage ${images.length}: rejected candidate, use only with the user correction above.`
        }
      }
      assert(images.length <= 4, 'LIMIT_EXCEEDED', '全部参考合计最多四张')
      if (!preview) assert(images.length <= status.maxReferences, 'UNSUPPORTED_CHANNEL', status.maxReferences
        ? `当前生图渠道最多带 ${status.maxReferences} 张参考图，这次需要 ${images.length} 张；可在对话框里少选几张参考`
        : `当前生图渠道不能带参考图，${target.kind === 'avatar-sheet' ? '八个头像要照立绘或设定图一起画' : '这张素材要照 ' + images.length + ' 张参考图画'}；请在 设置 → 配图 换一个支持参考图的渠道`)
      const output = assetOutput(target.kind,input.quality || ASSET_PRODUCTION_DEFAULTS.quality)
      assert(ASSET_IMAGE_QUALITIES.includes(output.quality), 'INVALID_ARGUMENT', '无效的图片质量')
      if (preview) return clone({preview:true,target,expectedRevision:pack.revision,prompt,...(parts ? {parts} : {}),promptBytes:Buffer.byteLength(prompt),style:{id:style,use},references:refs,output})
      const key = output.background === 'transparent' ? await keyFor(status, prompt) : null
      if (key) { prompt = keyedPrompt(prompt, key); output.background = 'opaque'; output.key = key }
      const planId = randomUUID(), provider = {label:source.label, model:status.model, ...(status.transparent === true ? {transparent:true} : {})}
      const view = {defaults:ASSET_PRODUCTION_DEFAULTS,planId,target,expectedRevision:pack.revision,prompt,promptBytes:Buffer.byteLength(prompt),style:{id:style,use},references:refs,provider,output,consentToken:randomUUID(),expiresAt:now() + planTtlMs,imageCount:count}
      const confirmations = uncertain(target).map(job => job.jobId)
      if (confirmations.length) { view.confirmNewRequestIds = confirmations; view.confirmNewRequestId = confirmations[0] }
      plans.set(planId,{...view,source,images,basePrompt,backgroundName,redrawOf:input.redrawOf,slot:ctx.slot,authority:authority(ctx,target.kind),anchor,userPrompt,followUp})
      return clone(view)
    }),
    generate: input => serial(async () => {
      validateUuid(input.planId)
      if (jobs[input.planId]) return {jobs:Object.values(jobs).filter(job => job.groupId === input.planId).map(publicJob)}
      const plan = plans.get(input.planId)
      assert(plan, 'EXPIRED', '生成方案已过期，请重新确认')
      assert(input.consentToken === plan.consentToken, 'CONSENT_REQUIRED', '请确认本次模型、网关与参考图')
      assert(!Object.values(jobs).some(job => job.status === 'running' && targetKey(job.target) === targetKey(plan.target)), 'BUSY', '同一目标已有生成任务，请等待或取消')
      for (const previous of uncertain(plan.target)) checkPurchaseConfirmation(previous,{confirmNewRequestId:input.confirmNewRequestIds?.includes(previous.jobId) ? previous.jobId : input.confirmNewRequestId})
      assert(controllers.size + plan.imageCount <= 4, 'BUSY', '已有素材生图任务在途（最多四张）')
      assert(Object.keys(jobs).length + plan.imageCount <= 128 && Object.values(jobs).filter(j => ['running','candidate','save_failed'].includes(j.status)).length + plan.imageCount <= 32, 'LIMIT_EXCEEDED', '候选数量达到上限')
      const pack = await snapshot(plan.target,plan.expectedRevision); context(pack,plan.target)
      const group = Array.from({length:plan.imageCount},(_,index) => {
        const id = index ? randomUUID() : plan.planId
        return {jobId:id,requestId:id,groupId:plan.planId,target:plan.target,backgroundName:plan.backgroundName,redrawOf:plan.redrawOf,slot:plan.slot,authority:plan.authority,...(plan.anchor ? {anchor:plan.anchor} : {}),...(plan.userPrompt ? {userPrompt:plan.userPrompt} : {}),...(plan.followUp ? {followUp:plan.followUp} : {}),status:'running',outcome:'not_requested',createdAt:now(),expiresAt:now() + candidateTtlMs,prompt:plan.prompt,basePrompt:plan.basePrompt,style:plan.style,provider:plan.provider,output:plan.output,references:plan.references.map((ref,index) => ({...ref,mediaType:plan.images[index].mediaType}))}
      })
      for (const job of group) jobs[job.jobId] = job
      try {
        await save()
        for (const job of group) for (const [index,image] of plan.images.entries()) await store.writeBytes(referencePath(job.jobId,index),image.data)
        for (const job of group) job.outcome = 'unconfirmed'
        await save()
      } catch(error) {
        for (const job of group) { job.status = 'failed'; job.outcome = 'not_requested' }
        await save(); throw error
      }
      plans.delete(plan.planId)
      for (const job of group) {
        const controller = new AbortController(); controllers.set(job.jobId,controller)
        const task = run(job,plan,controller); tasks.add(task); task.catch(() => {}).finally(() => tasks.delete(task))
      }
      return {jobs:group.map(publicJob)}
    }),
    // One picture for a plugin (tavern.generateImage) on the image plugin's current channel, under the same limit of four
    // in flight as the asset pictures. Nothing is kept or retried here. `mayHaveCharged` is false only for a refusal
    // before dispatch or a failure the image plugin marks requestMayHaveSucceeded === false.
    // promptPreset / usage name an image plugin style for the picture; without one the prompt is sent as written (no-style).
    async image({prompt, width, height, background = 'auto', quality = 'auto', references = [], signal, promptPreset = 'no-style', usage} = {}, source = imageProvider()) {
      const status = source ? await source.status() : null
      assert(source, 'NOT_CONFIGURED', '生图由「配图」插件出图；请先安装并启用配图插件')
      assert(status.ready, 'NOT_CONFIGURED', status.reason || '请先在 配图 设置里配置生图渠道')
      assert(typeof prompt === 'string' && prompt.trim() && prompt.length <= 32000 && [width, height].every(n => Number.isInteger(n) && n > 0 && n <= 8192), 'INVALID_ARGUMENT', '需要提示词和图片尺寸')
      assert(['auto','transparent','opaque'].includes(background) && ASSET_IMAGE_QUALITIES.includes(quality), 'INVALID_ARGUMENT', 'background 或 quality 无效')
      assert(Array.isArray(references) && references.length <= Math.min(4, status.maxReferences), 'UNSUPPORTED_CHANNEL', `当前生图渠道最多带 ${status.maxReferences} 张参考图`)
      const images = references.map(reference => {
        const data = reference?.data, kind = data instanceof Uint8Array && data.length <= 8 * 1024 ** 2 ? imageKind(Buffer.from(data.buffer, data.byteOffset, data.byteLength)) : null
        assert(['png','jpeg','webp'].includes(kind) && reference.mediaType === 'image/' + kind, 'INVALID_ARGUMENT', '参考图须为最多 8 MiB 的 PNG/JPEG/WebP')
        return {data, mediaType:reference.mediaType}
      })
      assert(controllers.size < 4, 'BUSY', '已有生图任务在途（最多四张）')
      const key = randomUUID(), controller = new AbortController(); controllers.set(key, controller)
      const failed = (message, mayHaveCharged) => fail('GENERATION_FAILED', String(message || '生图失败').replace(/\s+/g, ' ').trim().slice(0, 300), {mayHaveCharged})
      try {
        let reply
        const key = background === 'transparent' ? await keyFor(status, prompt) : null
        try { reply = await source.generate({prompt:key ? keyedPrompt(prompt, key) : prompt, references:images, width, height, promptPreset, ...(usage ? {usage} : {}), background:key ? 'opaque' : background, quality, signal:AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])])}) }
        catch (error) { failed(error?.message, error?.requestMayHaveSucceeded !== false) }
        if (!(reply?.data instanceof Uint8Array) || reply.data.length > 20 * 1024 ** 2) failed('生图渠道没有返回有效图片', true)
        // A transparent picture comes back as a PNG: keyed out when it was drawn on a key colour; a background on an
        // unkeyed request marks the model, so its next transparent picture is keyed.
        let data = reply.data, mediaType = String(reply.mediaType || '')
        if (background === 'transparent') {
          const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          if (!coverImageType(bytes)) failed('生图渠道返回的不是 PNG、JPEG 或 WebP 图片', true)
          data = await coverImageAsPng(bytes); mediaType = 'image/png'
          if (key) data = matteCandidate(data, key)
          else if (pictureChecks(data, 'sprite').hasTransparency === false) await noteOpaque(status.model)
        }
        return {data, mediaType, ...(reply.provider!==undefined?{provider:reply.provider}:{}), ...(reply.model!==undefined?{model:reply.model}:{}),
          cost:await charge(reply, status.model, {prompt, width, height, quality, references:images})}
      } finally { controllers.delete(key) }
    },
    // 自动选角 (auto cast): the prompt and output of one automatic picture, from the same editable templates as
    // the asset pictures (设置 → 生图). figure {ref, name, emotions}: its 外貌 is its 配图 人物库 record's (方案甲), else `appearance`
    // (the text the 选角助理 wrote, before the record has it). fromSettei: the one image sent is the figure's 人设图.
    async autoPrompt({kind, figure, emotionId, userPrompt = '', fromSettei = false, appearance = '', style}) {
      assert(['identity-settei','sprite'].includes(kind), 'INVALID_ARGUMENT', '未知素材类型')
      const own = (await readPrompts()).overrides[kind], linked = await linkedAppearance({packId:figure.ref.packId, figureId:figure.ref.figureId})
      const emotion = emotionId === undefined ? undefined : matchBubbleMood(emotionId, figure.emotions || []) || figure.emotions?.find(row => row.id === emotionId)
      const values = assetPromptValues({kind, figure:{name:figure.name, emotions:figure.emotions, identityAppearance:linked?.identityAppearance || appearance}, outfit:{},
        emotion, userPrompt, references:fromSettei ? [{role:roles.identity}] : []})
      return {prompt:composeAssetPrompt(own ?? await readTemplate(kind), values), output:assetOutput(kind), promptPreset:packGenStyle(style), usage:assetStyleUse(kind)}
    },
    // 自动选角's cheap checks of one picture (decode, size, transparency, edge contact): the same as a drawn candidate's.
    autoCheck: (data, kind) => pictureChecks(data, kind),
    // 设置 → 生图: every kind's effective text, whether it is edited, and the {{slots}} an edit must keep.
    prompts: () => serial(async () => promptView(await readPrompts())),
    // The image plugin's style presets for the 画风 menu (id, name, stable/experimental, the uses with their own text).
    styles: ({genStyle} = {}) => ({current:packGenStyle(genStyle), styles:imageProvider()?.presets?.() ?? []}),
    // One kind, CAS on the file's revision. `text: null`, or the default's own text, removes the override.
    setPrompt: ({kind, text, expectedRevision}) => serial(async () => {
      assert(ASSET_PROMPT_KINDS.includes(kind), 'INVALID_ARGUMENT', '未知的生图类型')
      const current = await readPrompts()
      assert(expectedRevision === current.revision, 'REVISION_CONFLICT', '生图提示词已在别处修改，已重新读取')
      const base = await readTemplate(kind), overrides = {...current.overrides}
      if (text === null || typeof text === 'string' && text.trim() === base.trim()) delete overrides[kind]
      else {
        assert(typeof text === 'string' && text.trim() && text.length <= PROMPT_MAX, 'INVALID_ARGUMENT', '提示词不能为空，最多 ' + PROMPT_MAX + ' 字')
        const used = slotsOf(text), missing = slotsOf(base).filter(v => !used.includes(v))
        const unknown = used.filter(v => { try { renderAssetTemplate('{{' + v + '}}', {}); return false } catch { return true } })
        assert(!unknown.length, 'INVALID_ARGUMENT', '没有这个占位符：' + unknown.map(v => '{{' + v + '}}').join(' '))
        assert(!missing.length, 'INVALID_ARGUMENT', '请保留 ' + missing.map(v => '{{' + v + '}}').join(' '))
        overrides[kind] = text
      }
      const next = {revision:current.revision + 1, overrides}
      await store.updateJson(PROMPTS, () => next)
      return promptView(next)
    }),
    get: ({jobId}) => serial(() => publicJob(find(jobId))),
    list: ({packId}) => serial(() => { validateUuid(packId); return Object.values(jobs).filter(j => j.target.packId === packId).map(publicJob) }),
    read: ({jobId,emotionId,forImport = false}) => serial(async () => {
      const job = find(jobId)
      assert(['candidate','save_failed'].includes(job.status), 'ASSET_UNAVAILABLE', '没有可读取的候选')
      let bytes = pendingBytes.get(jobId) || await store.readBytes(path(jobId))
      assert(bytes, 'ASSET_UNAVAILABLE', '候选文件未保存')
      if (emotionId) {
        assert(job.target.kind === 'avatar-sheet' && job.target.emotionIds.includes(emotionId), 'INVALID_ARGUMENT', '未知 sheet 差分槽')
        bytes = sliceAssetAvatarSheet(bytes,job.target.emotionIds)[emotionId]
      }
      if (forImport && job.target.kind === 'sprite') {
        // a 立绘 with a background cannot go on the stage; its candidate's check says why and what to do (pictureChecks).
        const background = job.candidate.checks?.warnings?.find(w => w.code === 'NO_TRANSPARENCY')
        if (background) fail('SPRITE_BACKGROUND', '不能采用为立绘：' + background.message)
        // The default 差分's adopted sprite is the ruler (not a reference the model saw); gone → centred on the canvas.
        // An ordinary picture uploaded there (no cut-out figure) measures its own canvas, not a figure: the new picture is
        // placed on its own instead of being stretched to it.
        let anchor
        const pack = job.anchor && await library().getPackSnapshot({packId:job.target.packId})
        if (pack?.manifest.blobs[job.anchor]) {
          const ruler = await coverImageAsPng(Buffer.from((await library().readMedia({packId:pack.manifest.id,expectedRevision:pack.revision,hash:job.anchor})).bytes))
          if (checkSpriteCutout(ruler).valid) anchor = ruler
        }
        bytes = alignAssetSprite(bytes,anchor)
      }
      return {base64:bytes.toString('base64'),mediaType:job.candidate.mediaType,target:clone(job.target)}
    }),
    cancel: ({jobId}) => serial(async () => {
      const job = find(jobId)
      if (job.status === 'running') { controllers.get(jobId)?.abort(); job.status = 'cancelled'; await save() }
      return publicJob(job)
    }),
    reject: ({jobId}) => serial(async () => {
      const job = find(jobId)
      assert(job.status !== 'running' && job.status !== 'accepted', 'BUSY', '请先取消任务；已采用的素材请在包内管理')
      await removeImages(job); pendingBytes.delete(jobId)
      job.status = 'rejected'; delete job.candidate; await save(); return publicJob(job)
    }),
    retrySave: ({jobId}) => serial(async () => {
      const job = find(jobId)
      assert(job.status === 'save_failed', 'INVALID_ARGUMENT', '任务不需要重试保存')
      const bytes = pendingBytes.get(jobId) || await store.readBytes(path(jobId))
      assert(bytes, 'ASSET_UNAVAILABLE', '没有可恢复的图片；不会自动重新生成')
      await persistCandidate(job,bytes); return publicJob(job)
    }),
    accept: input => serial(async () => {
      const job = find(input.jobId)
      if (job.status === 'accepted') return publicJob(job)
      assert(job.status === 'candidate', 'ASSET_UNAVAILABLE', '请先保存候选图片')
      let pack = await snapshot(job.target,input.expectedRevision)
      const ctx = context(pack,job.target), service = library()
      // A 服装设定图 written here records the 人物设定图 it descends from: one drawn from an older board is not adopted. A
      // 立绘 or 头像 is the user's choice of a picture they have seen (and is already imported when this runs).
      if (job.target.kind === 'settei') assert(job.authority === authority(ctx,job.target.kind), 'SETTEI_CHANGED', '人物设定图在画这张之后换过了，这张服装设定图是照旧的画的，不能采用；请重画')
      if (['sprite','avatar','avatar-sheet'].includes(job.target.kind)) {
        if (job.target.kind === 'avatar-sheet') {
          assert(input.importedHashes && job.target.emotionIds.filter(Boolean).every(id => typeof input.importedHashes[id] === 'string' && ctx.slot[id] === input.importedHashes[id]), 'IMPORT_REQUIRED', '请先完成指定头像槽的裁切和写入')
        } else {
          validateHash(input.importedHash)
          const pool=ctx.outfit.sprite?.imagePools?.[job.target.emotionId]
          if(pool){
            const manifest=pack.sprites[ctx.outfit.sprite.manifestKey]
            const source=id=>{const state=spriteEmotions.spriteEmotionState(manifest,id);return ctx.outfit.sprite.assets[state?.stage?.src || state?.src]}
            const imported=[...pool.imageIds].reverse().find(id=>(job.target.kind==='avatar'?ctx.outfit.avatars?.[id]:source(id))===input.importedHash && (!job.target.imageId || source(id)===source(job.target.imageId)))
            assert(imported,'IMPORT_REQUIRED','Import this candidate into its exact image pool first')
            job.acceptedImageId=imported
          }else assert(ctx.slot === input.importedHash, 'IMPORT_REQUIRED', '请先通过原槽位图片导入完成裁切、对齐和写入')
        }
        await service.patchFigure({packId:job.target.packId,expectedRevision:pack.revision,figureId:ctx.figure.id,patch:{outfits:recorded(ctx.figure,job).outfits}})
      } else {
        let bytes = await store.readBytes(path(job.jobId))
        assert(bytes, 'ASSET_UNAVAILABLE', '候选文件丢失')
        if (job.target.kind === 'background') bytes = cropAssetBackground(bytes)
        // One digest per accepted image: slot identity, settei board and CAS media name are the same value.
        const media = hash(bytes)
        assert(ctx.slot === job.slot || ctx.slot === media || input.replace === true, 'TARGET_CHANGED', '目标槽已变化，请复核后明确替换')
        let identitySettei
        if (job.target.kind === 'identity-settei') {
          const palette = input.palette ?? [], board = media
          identitySettei = validateIdentitySettei({board,version:hash(JSON.stringify({board,palette})),palette})
        }
        const descriptor = {ext:'png',mime:'image/png',size:bytes.length}
        const patch = {blobs:{...pack.manifest.blobs,[media]:descriptor}}, fileUpdates = new Map([['media/'+media+'.png',bytes]])
        if (job.target.kind === 'identity-settei' || job.target.kind === 'settei') {
          const figure = job.target.kind === 'identity-settei' ? {...ctx.figure,identitySettei} : recorded({...ctx.figure,
            outfits:ctx.figure.outfits.map(o => o.key === job.target.outfitKey ? {...o,settei:media,...(ctx.figure.identitySettei ? {setteiParentVersion:ctx.figure.identitySettei.version} : {})} : o)},job)
          fileUpdates.set('figures/'+figure.id+'.json',Buffer.from(JSON.stringify(figure)))
        } else {
          patch.assets = job.target.assetId ? pack.manifest.assets.map(a => a.id === job.target.assetId && a.kind === 'backgrounds' ? {...a,media,pendingMedia:false} : a) :
            [...pack.manifest.assets,{kind:'backgrounds',id:job.jobId,name:job.backgroundName || '新背景',enabled:true,directorNote:'',recall:{mode:'keyword',keywords:input.keywords},media,pendingMedia:false}].filter((a,index,all) => all.findIndex(b => b.kind === a.kind && b.id === a.id) === index)
        }
        await service.patchPack({packId:job.target.packId,expectedRevision:pack.revision,patch,fileUpdates})
      }
      job.status = 'accepted'; await save()
      await removeImages(job); pendingBytes.delete(job.jobId)
      return publicJob(job)
    }),
    async dispose() {
      clearInterval(timer)
      for (const controller of controllers.values()) controller.abort()
      await Promise.allSettled([...tasks]); await queue; disposed = true; plans.clear(); pendingBytes.clear()
    }
  }
  const timer = setInterval(() => { serial(() => {}).catch(() => {}) }, 60_000)
  timer.unref?.()
  return api
}

export async function assetGenerationResult(action) {
  try { return {ok:true,data:await action()} }
  catch (error) { return {ok:false,error:{code:error.code || 'INVALID_ARGUMENT',message:error.code ? error.message : '素材操作失败，请检查输入与存储权限',retryable:error.code === 'SAVE_FAILED',mayHaveCharged:error.mayHaveCharged === true}} }
}

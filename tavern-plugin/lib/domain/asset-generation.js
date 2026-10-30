import {figureDefaultEmotion,matchBubbleMood,GEN_RECORDS} from '../../packages/dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {assetImageCapability} from './asset-image/channels.js'
import {createHash, randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {checkPurchaseConfirmation} from './image-billing-confirmation.js'
import {cropAssetBackground, checkAssetImage, sliceAssetAvatarSheet, alignAssetSprite, assertSpriteCutout} from './asset-image-processing.js'
import {assetSheetEmotionIds} from './asset-generation-emotions.js'
import spriteEmotions from '../../shared/sprite-emotions.cjs'
import {validateUuid, validateHash, validateShortId, validateStateId} from '../../packages/dsh-asset-library/lib/asset-packs/common.js'
import {validateIdentitySettei} from '../../packages/dsh-asset-library/lib/asset-packs/identity-settei.js'
import {PACK_GEN_STYLES} from '../../packages/dsh-asset-library/lib/asset-packs/manifest.js'
import {imageKind, imageDimensions, pngSize} from '../../packages/dsh-asset-library/lib/pack-v2/media.js'

// imageFailure is bounded and credential-redacted at the provider boundary.
export function assetImageFailureReason({httpStatus, message = '', code = '', param = ''}) {
  const detail = `${code} ${message} ${param}`
  let reason = '生图服务拒绝请求'
  if (/moderation|content_policy|safety|审核/i.test(detail)) reason = '内容审核未通过，请调整描述或参考图'
  else if (httpStatus === 401 || httpStatus === 403) reason = '生图服务鉴权失败，请检查密钥或模型权限'
  else if (httpStatus === 402) reason = '生图服务余额不足'
  else if (/image|reference/i.test(detail) && /required|missing|至少|缺少/i.test(detail)) reason = '生图接口缺少参考图'
  else if (/size|resolution|尺寸/i.test(detail)) reason = '生图服务不支持请求的尺寸'
  else if (httpStatus === 404) reason = '生图接口或模型不存在，请检查渠道配置'
  else if (httpStatus === 429) reason = '生图服务限流或额度不足'
  else if (httpStatus >= 500) reason = '生图服务暂时异常'
  const summary = message.replace(/\s+/g, ' ').trim().slice(0, 180)
  return `${reason}（HTTP ${httpStatus}）${summary ? '：' + summary : ''}`
}

const ROOT = 'asset-generation/', INDEX = ROOT + 'jobs.json'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const clone = value => structuredClone(value)
import {renderAssetTemplate, assetStyleLines, assetOutput, assetPromptValues, ASSET_REFERENCE_ROLES as roles, ASSET_PRODUCTION_DEFAULTS, ASSET_STYLE_DEFAULT, BACKGROUND_STYLE_REFERENCE_ROLE} from './asset-production-contract.js'
export {renderAssetTemplate} from './asset-production-contract.js'
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), {code, ...extra}) }
const assert = (condition, code, message) => { if (!condition) fail(code, message) }
const path = id => ROOT + id + '.png'
const referencePath = (id,index) => ROOT + id + '.ref-' + index
const targetKey = target => JSON.stringify(target)
const publicJob = job => clone(Object.fromEntries(Object.entries(job).filter(([key]) => !['slot','prompt','basePrompt','provider','output','anchor'].includes(key))))
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
    assert(item.style === undefined || PACK_GEN_STYLES.includes(item.style), 'INVALID_ARGUMENT', '未知的画风')
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
export function createAssetGeneration({store, imageModule, capture, getLibrary, now = Date.now,
  readTemplate = kind => readFile(new URL(`../../presets/asset-gen/templates/${kind}.md`, import.meta.url), 'utf8'),
  planTtlMs = 15 * 60_000, candidateTtlMs = 24 * 60 * 60_000, timeoutMs = 5 * 60_000}) {
  const plans = new Map(), pendingBytes = new Map(), controllers = new Map(), tasks = new Set()
  let jobs, queue = Promise.resolve(), disposed = false
  const save = () => store.updateJson(INDEX, () => jobs)
  const readPrompts = async () => await store.readJson(PROMPTS) || {revision:0,overrides:{}}
  const promptView = async ({revision, overrides}) => ({revision, kinds:await Promise.all(ASSET_PROMPT_KINDS.map(async kind => {
    const base = await readTemplate(kind)
    return {kind, text:overrides[kind] ?? base, edited:Object.hasOwn(overrides, kind), required:slotsOf(base)}
  }))})
  const library = () => { const service = getLibrary(); assert(service, 'ASSET_UNAVAILABLE', '舞台素材未启用'); return service }
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
    const row = {kind:job.target.kind, ...(['sprite','avatar'].includes(job.target.kind) ? {emotionId:job.target.emotionId} : {}), at:now(), ...(prompt ? {prompt} : {})}
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
      const result = await imageModule.generate({...plan.active, apiKey:plan.apiKey, prompt:plan.prompt,
        referenceImages:plan.images, assetOutput:plan.output, signal:AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]), maxBytes:20 * 1024 ** 2})
      if (controller.signal.aborted) return
      assert(result.mediaType === 'image/png', 'INVALID_ARGUMENT', '素材生图必须返回 PNG')
      const candidate = inspectImage(result.data, result.mediaType, 20 * 1024 ** 2)
      candidate.checks = checkAssetImage(result.data,job.target.kind === 'avatar-sheet' ? 'avatar' : job.target.kind,{sheet:job.target.kind === 'avatar-sheet'})
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
        job.status = 'failed'; job.outcome = error.imageOutcome || 'unconfirmed'
        const refusal = ['IMAGE_NO_RESULT','IMAGE_REFUSED'].includes(error.code)
        job.error = {code:refusal ? error.code : 'GENERATION_FAILED',message:error.imageFailure ? (job.outcome === 'unconfirmed' ? '没有拿到结果，不会自动重试；' : '') + assetImageFailureReason(error.imageFailure) : refusal ? '服务没有提供图片或拒绝了此描述；请手动修改后再请求，不会自动改词重试' : job.outcome === 'not_requested' ? '配置已变化或不完整，未发送图片请求' : job.outcome === 'rejected' ? '服务明确拒绝请求，请检查配置或提示词' : '没有拿到结果，不会自动重试',retryable:false,mayHaveCharged:job.outcome === 'unconfirmed'}
        await save()
      })
    } finally { controllers.delete(job.jobId) }
  }
  const api = {
    prepare: input => serial(async () => {
      assert(input.preview === true || plans.size < 8 && Object.keys(jobs).length < 128 && Object.values(jobs).filter(j => ['running','candidate','save_failed'].includes(j.status)).length < 32, 'LIMIT_EXCEEDED', '请先丢弃候选或等待记录到期')
      const target = targetInput(input.target), pack = await snapshot(target, input.expectedRevision), ctx = context(pack,target), followUp = followUpInput(input.followUp, target)
      if (target.kind === 'avatar-sheet') target.emotionIds = ctx.emotions.map(emotion => emotion.id)
      if(target.imageId)assert(ctx.outfit.sprite?.imagePools?.[target.emotionId]?.imageIds.includes(target.imageId),'TARGET_CHANGED','Selected image is no longer an active candidate')
      // `preview` builds the exact prompt and reference list without a plan, a channel
      // or a request (free; works before the channel is set up), so the panel can show what ✦ will send.
      const preview = input.preview === true
      const {active,apiKey} = preview ? {active:null,apiKey:null} : await capture()
      const capability = preview ? null : assetImageCapability(active)
      if (!preview) {
        assert(capability.supported, 'UNSUPPORTED_CHANNEL', '当前渠道不支持素材生成；请选择 OpenAI Images 或 Responses image tool')
        assert(active.ready && apiKey, 'NOT_CONFIGURED', '请先完成场景生图渠道配置')
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
        if (target.kind === 'avatar') assert(sourceFor(target.emotionId), 'ASSET_UNAVAILABLE', '先有这个差分的立绘，才能生成它的头像')
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
      if (['identity-settei','settei'].includes(target.kind) && !input.redrawOf) assert(userPrompt || ctx.figure.identityAppearance || ctx.outfit?.outfitAppearance || images.length, 'INVALID_ARGUMENT', '请提供外貌文字或参考图')
      if (target.kind === 'sprite' && !input.redrawOf) assert(userPrompt || ctx.figure.identityAppearance || ctx.outfit?.outfitAppearance || images.length, 'INVALID_ARGUMENT', '请写一句描述，或加一张参考图')
      if (target.kind === 'background' && !input.redrawOf) assert(userPrompt, 'INVALID_ARGUMENT', '请描述需要的背景')
      // 画风: this request's preset, else the pack's default (manifest.genStyle), else the built-in default.
      const own = (await readPrompts()).overrides[target.kind], values = assetPromptValues({kind:target.kind,backgroundStyle:pack.manifest.backgroundStyle,style:input.style ?? pack.manifest.genStyle ?? ASSET_STYLE_DEFAULT,figure:ctx.figure,outfit:ctx.outfit,
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
          basePrompt = composeAssetPrompt(own ?? await readTemplate(target.kind), assetPromptValues({kind:target.kind,backgroundStyle:pack.manifest.backgroundStyle,style:input.style ?? pack.manifest.genStyle ?? ASSET_STYLE_DEFAULT,userPrompt:original.userPrompt || userPrompt,references:refs}))
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
      const output = assetOutput(target.kind,input.quality || ASSET_PRODUCTION_DEFAULTS.quality)
      assert(['auto','low','medium','high'].includes(output.quality), 'INVALID_ARGUMENT', '无效的图片质量')
      if (preview) return clone({preview:true,target,expectedRevision:pack.revision,prompt,...(parts ? {parts} : {}),promptBytes:Buffer.byteLength(prompt),references:refs,output})
      const planId = randomUUID(), provider = Object.fromEntries(['provider','baseURL','model','protocol','dispatcherModel'].map(key => [key,active[key]]))
      const view = {defaults:ASSET_PRODUCTION_DEFAULTS,planId,target,expectedRevision:pack.revision,prompt,promptBytes:Buffer.byteLength(prompt),references:refs,provider,capability,output,consentToken:randomUUID(),expiresAt:now() + planTtlMs,imageCount:count}
      const confirmations = uncertain(target).map(job => job.jobId)
      if (confirmations.length) { view.confirmNewRequestIds = confirmations; view.confirmNewRequestId = confirmations[0] }
      plans.set(planId,{...view,active,apiKey,images,basePrompt,backgroundName,redrawOf:input.redrawOf,slot:ctx.slot,authority:authority(ctx,target.kind),anchor,userPrompt,followUp})
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
        return {jobId:id,requestId:id,groupId:plan.planId,target:plan.target,backgroundName:plan.backgroundName,redrawOf:plan.redrawOf,slot:plan.slot,authority:plan.authority,...(plan.anchor ? {anchor:plan.anchor} : {}),...(plan.userPrompt ? {userPrompt:plan.userPrompt} : {}),...(plan.followUp ? {followUp:plan.followUp} : {}),status:'running',outcome:'not_requested',createdAt:now(),expiresAt:now() + candidateTtlMs,prompt:plan.prompt,basePrompt:plan.basePrompt,provider:plan.provider,output:plan.output,references:plan.references.map((ref,index) => ({...ref,mediaType:plan.images[index].mediaType}))}
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
    // 设置 → 生图: every kind's effective text, whether it is edited, and the {{slots}} an edit must keep.
    prompts: () => serial(async () => promptView(await readPrompts())),
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
        assertSpriteCutout(bytes)
        // The default 差分's adopted sprite is the ruler (not a reference the model saw); gone → centred on the canvas.
        let anchor
        const pack = job.anchor && await library().getPackSnapshot({packId:job.target.packId})
        if (pack?.manifest.blobs[job.anchor]) anchor = Buffer.from((await library().readMedia({packId:pack.manifest.id,expectedRevision:pack.revision,hash:job.anchor})).bytes)
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
      assert(job.authority === authority(ctx,job.target.kind), 'TARGET_CHANGED', '生成所依据的设定已变化，请重新准备；不能用 replace 绕过母版复核')
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

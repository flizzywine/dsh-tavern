import { assertJson, check, shape, text, integer, bool, oneOf, version, array, unique, extensions, record, relativePath, validateUuid, validateShortId, validateHash, ASSET_KINDS } from './common.js'
import { validateFiles } from './hash.js'
import { validateCopiedFrom } from './copied-from.js'
import { MOD_PRIVATE_PATH } from '../pack-v2/mod-private.js'
import { validateVoiceLibrary } from '../shared/voice-schema.js'
import { validateCg } from './cg.js'
import {validateAudienceContent} from '../shared/audience.js'
import {validateAssetVariants} from '../shared/asset-variants.js'
import {ASSET_CONTENT_FIELDS,assetContents,assetContentMedia} from '../shared/asset-variant-content.js'
import { validateAssetRef } from './common.js'
import widgetContract from '../shared/widget-schema.cjs'
import widgetTheme from '../shared/widget-theme.cjs'
import audioCategories from '../shared/audio-categories.cjs'
import entranceContract from '../shared/stage-entrance.cjs'
import videoContract from '../shared/stage-video.cjs'
// Canonical extensions only. Signatures/decoding and transport budgets belong to P1.
export const BLOB_MIME_TYPES = Object.freeze({ png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac' })
export function validateBlob(value, path = '$') {
  assertJson(value)
  shape(value, ['ext', 'mime', 'size'], ['ext', 'mime', 'size'], path)
  check(Object.hasOwn(BLOB_MIME_TYPES, value.ext) && value.mime === BLOB_MIME_TYPES[value.ext], path, 'Noncanonical blob ext/MIME')
  integer(value.size, path + '.size', 1); return value
}
export function validateRecall(value, path = '$', minKeywordLength = 2) {
  assertJson(value)
  // 优先级 is gone; an old `priority` is UNKNOWN_FIELD (ingress strips it once, recall-priority.js).
  shape(value, ['mode', 'keywords', 'synonyms'], ['mode', 'keywords'], path)
  oneOf(value.mode, ['constant', 'keyword'], path + '.mode'); array(value.keywords, path + '.keywords', 16)
  for (const word of value.keywords) text(word, path + '.keywords', 40, minKeywordLength)
  unique(value.keywords, path + '.keywords')
  if (value.synonyms !== undefined) record(value.synonyms, path + '.synonyms', (words, p, key) => {
    check(value.keywords.includes(key), p, 'Synonym must belong to a keyword'); array(words, p, 6)
    words.forEach(word => text(word, p, 40, minKeywordLength)); unique(words, p)
  })
  return value
}
const metadata = ['description', 'category', 'aliases', 'author', 'license', 'credits', 'extensions']
function validateMetadata(value, path) {
  for (const key of ['description', 'author', 'license']) if (value[key] !== undefined) text(value[key], path + '.' + key, 4096, 0)
  if (value.category !== undefined && value.kind === 'sfx') {
    check(typeof value.category === 'string' && Object.hasOwn(audioCategories, value.category), path + '.category', 'Choose a UCS audio category ID')
  } else if (value.category !== undefined) {
    // Non-SE categories remain library tags.
    const tags = Array.isArray(value.category) ? value.category : [value.category]
    array(tags, path + '.category', 32); unique(tags, path + '.category')
    tags.forEach(tag => text(tag, path + '.category', 4096, 1))
  }
  if (value.aliases !== undefined) { array(value.aliases, path + '.aliases', 128); value.aliases.forEach(v => text(v, path + '.aliases', 160)) }
  if (value.credits !== undefined) { array(value.credits, path + '.credits', 128); value.credits.forEach(v => relativePath(v, path + '.credits')) }
  if (value.extensions !== undefined) extensions(value.extensions, path + '.extensions')
}
export function validateAsset(value, path = '$') {
  assertJson(value)
  // a standalone skin entry is only an imported theme — no 启用 / 关闭 state.
  const common = value?.kind === 'skins' ? ['kind', 'id', 'name', 'recall', 'directorNote'] : ['kind', 'id', 'name', 'enabled', 'recall', 'directorNote']
  check(value && [...ASSET_KINDS,'props'].includes(value.kind), path + '.kind')
  shape(value, [...common, 'remark', ...(value.kind === 'props' ? ['inventoryId'] : []), ...metadata.filter(field=>!value.variants || !ASSET_CONTENT_FIELDS[value.kind].includes(field)), ...(value.variants ? ['variants'] : ASSET_CONTENT_FIELDS[value.kind])], common, path)
  if (value.inventoryId !== undefined) text(value.inventoryId, path + '.inventoryId', 256)
  validateShortId(value.id, path + '.id'); text(value.name, path + '.name'); if (value.kind !== 'skins') bool(value.enabled, path + '.enabled')
  if (value.remark !== undefined) check(typeof value.remark === 'string', path + '.remark')
  validateCopiedFrom(value.extensions,value.kind,path + '.extensions')
  validateRecall(value.recall, path + '.recall'); text(value.directorNote, path + '.directorNote', 300, 0); validateMetadata(value, path)
  if (value.kind === 'directions') {
    check(value.recall.mode === 'constant' && value.recall.keywords.length === 0 && value.recall.synonyms === undefined, path + '.recall')
    check(value.directorNote === '', path + '.directorNote')
  }
  // an 入场演出 is 蓝灯 (every stage entry of its cards) or 关闭 - no 绿灯.
  if (value.kind === 'entrances') check(value.recall.mode === 'constant', path + '.recall', 'An entrance is blue (always) or off')
  // a 视频 is played where another entry references it - on (蓝灯) or off, never recalled by words.
  if (value.kind === 'videos') check(value.recall.mode === 'constant' && value.recall.keywords.length === 0, path + '.recall', 'A video is on or off; it has no keywords')
  if (value.variants !== undefined) validateAssetVariants(value.kind,value.variants,value.kind === 'audience' ? (_kind,content) => validateAudienceContent(content) : validateAssetContent,path + '.variants')
  else validateAssetContent(value.kind,Object.fromEntries(ASSET_CONTENT_FIELDS[value.kind].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])),path)
  return value
}
export function validateAssetContent(kind, content, path = '$') {
  check(Object.hasOwn(ASSET_CONTENT_FIELDS,kind),path,'Unknown asset kind')
  shape(content, ASSET_CONTENT_FIELDS[kind], [], path)
  const value = {...content,kind}
  if (kind === 'audience') validateAudienceContent(value.content)
  if (kind === 'timers') {
    if (value.look !== undefined) oneOf(value.look, ['default','plate'], path + '.look')
    if (value.mode !== undefined) oneOf(value.mode, ['story','reply'], path + '.mode')
    if (value.seconds !== undefined) check(Number.isFinite(value.seconds) && value.seconds >= 0.001 && value.seconds <= 86400, path + '.seconds')
    for (const key of ['label','onTimeout']) if (value[key] !== undefined) {
      text(value[key], path + '.' + key, key === 'label' ? 80 : 160)
      check(value[key].trim().length > 0 && !/[\r\n\u0000-\u001f]/u.test(value[key]), path + '.' + key, 'Use nonblank single-line text')
    }
    if (value.onTimeout !== undefined) check(value.mode === 'reply', path + '.mode', 'A fallback action requires reply mode')
    if (value.onTimeup !== undefined) validateAssetRef(value.onTimeup, path + '.onTimeup', 'performances')
    // A story countdown may hold while the player chooses; a reply deadline runs exactly then.
    if (value.pauseOnChoices !== undefined) check(value.pauseOnChoices === true && value.mode !== 'reply', path + '.pauseOnChoices', 'Set true on a story countdown, or omit')
  }
  if (['backgrounds', 'cg', 'props', 'music', 'sfx', 'ambience'].includes(value.kind)) {
    if (['backgrounds','cg','props'].includes(value.kind) && value.media === null) check(value.pendingMedia === true, path + '.pendingMedia', 'Missing image must be marked pending')
    else validateHash(value.media, path + '.media')
  }
  if (kind === 'entrances') {
    check(value.entrance !== undefined, path + '.entrance', 'Required field')
    entranceContract.validateStageEntrance(value.entrance)
    // The media an entrance draws (its baked plate) live in one 'entrance' bundle; one without media has none.
    if (entranceContract.stageEntranceFiles(value.entrance).length) validateShortId(value.bundleKey, path + '.bundleKey')
    else check(value.bundleKey === undefined, path + '.bundleKey', 'An entrance without media has no bundle')
  }
  if (kind === 'videos') videoContract.validateStageVideo(content, path)
  if (value.kind === 'directions') {
    check(typeof value.text === 'string' && value.text.trim().length > 0 && [...value.text].length <= 2000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text), path + '.text')
  }
  if (value.kind === 'cg') validateCg(value, path)
  if (['backgrounds','cg','props'].includes(kind) && value.pendingMedia !== undefined) { bool(value.pendingMedia,path+'.pendingMedia'); check(!value.pendingMedia || value.media === null,path+'.pendingMedia') }
  if (value.kind === 'backgrounds') {
    if (value.stageTheme !== undefined) widgetTheme.validateStageTheme(value.stageTheme)
  }
  if (value.usage !== undefined) text(value.usage, path + '.usage', 300, 0)
  if (value.tags !== undefined) { array(value.tags, path + '.tags', 32); value.tags.forEach(t => text(t, path + '.tags', 80)) }
  if (value.loop !== undefined) { bool(value.loop, path + '.loop'); check(value.kind !== 'sfx' || value.loop === false, path + '.loop', 'SFX cannot loop') }
  if (value.durationMs !== undefined) integer(value.durationMs, path + '.durationMs', 1)
  if (value.volume !== undefined) check(Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1, path + '.volume')
  if (value.loopStart !== undefined || value.loopEnd !== undefined) {
    check(Number.isFinite(value.loopStart) && value.loopStart >= 0, path + '.loopStart', 'Loop points require a nonnegative start in seconds')
    check(Number.isFinite(value.loopEnd) && value.loopEnd > value.loopStart, path + '.loopEnd', 'Loop end must follow loop start in seconds')
  }
  // authored gain never relaxes playback true-peak protection.
  if (value.gainDb !== undefined) check(Number.isFinite(value.gainDb) && value.gainDb >= -18 && value.gainDb <= 8, path + '.gainDb')
  if (value.loudness !== undefined) {
    shape(value.loudness, ['v', 'lufs', 'peak'], ['v', 'lufs', 'peak'], path + '.loudness')
    check(value.loudness.v === 1, path + '.loudness.v')
    for (const [key, max] of [['lufs', 10], ['peak', 20]]) check(Number.isFinite(value.loudness[key]) && value.loudness[key] >= -100 && value.loudness[key] <= max, path + '.loudness.' + key)
  }
  if (value.gainDb > 0) check(value.loudness !== undefined, path + '.loudness', 'Positive SFX gain requires a measured loudness and true peak')
  if (value.kind === 'looks') {
    oneOf(value.layer, ['mood'], path + '.layer')
    if (value.event !== undefined) bool(value.event, path + '.event')
    extensions(value.params, path + '.params')
    const walk = item => { if (item && typeof item === 'object') for (const [key, v] of Object.entries(item)) { if (['lut', 'texture'].includes(key)) validateHash(v, path + '.params.' + key); else walk(v) } }
    walk(value.params)
  }
  if (value.kind === 'performances' && value.background !== undefined) validateShortId(value.background, path + '.background')
  if (['skins', 'performances'].includes(value.kind)) {
    validateShortId(value.bundleKey, path + '.bundleKey'); relativePath(value.entry, path + '.entry')
    check(value.entry.endsWith('.json'), path + '.entry', 'Declarative entry must be JSON')
  }
  if (value.kind === 'widgets') {
    if (value.settingsDefaults !== undefined) widgetContract.stageWidgetSettingsMap(value.settingsDefaults)
    validateShortId(value.bundleKey, path + '.bundleKey'); relativePath(value.entry, path + '.entry')
    check(value.entry.endsWith('.json'), path + '.entry', 'Widget entry must be a dsh.widget/2 document')
  }
  return content
}
// the pack's default style preset for generated pictures.
// These ids are the one list; each preset's prompt text is asset-production-contract.js, its name the client's.
export const PACK_GEN_STYLES = Object.freeze(['clean', 'anime', 'polished', 'none'])
export function validatePackManifest(value, path = '$') {
  assertJson(value)
  const required = ['format', 'schemaVersion', 'id', 'name', 'contentHash', 'assets', 'figures', 'sprites', 'bundles', 'blobs', 'files']
  shape(value, [...required, ...metadata, 'voiceLibrary', 'tagIcons', 'genStyle', 'backgroundStyle', 'stageSkin'], required, path)
  if (value.genStyle !== undefined) oneOf(value.genStyle, PACK_GEN_STYLES, path + '.genStyle')
  // the stage skin a card bound to this pack first gets when it has no
  // skin of its own (card-stage-settings.js cardStageSkin / packStageSkin); one of the pack's skins. A skin removed later only
  // stops it applying.
  if (value.stageSkin !== undefined) validateShortId(value.stageSkin, path + '.stageSkin')
  if (value.voiceLibrary !== undefined) validateVoiceLibrary(value.voiceLibrary, path + '.voiceLibrary')
  oneOf(value.format, ['dsh-asset-pack'], path + '.format'); check([1,2].includes(value.schemaVersion), path + '.schemaVersion', 'Unsupported schemaVersion', 'UNSUPPORTED_SCHEMA_VERSION')
  validateUuid(value.id, path + '.id'); text(value.name, path + '.name'); validateHash(value.contentHash, path + '.contentHash'); validateMetadata(value, path)
  array(value.assets, path + '.assets'); value.assets.forEach((asset, i) => validateAsset(asset, `${path}.assets[${i}]`))
  unique(value.assets.map(a => `${a.kind}/${a.id}`), path + '.assets')
  array(value.figures, path + '.figures'); value.figures.forEach(id => validateUuid(id, path + '.figures')); unique([value.id, ...value.figures], path + '.figures')
  record(value.sprites, path + '.sprites', (file, p, key) => { validateShortId(key, p); check(file === `sprites/${key}/manifest.json`, p) })
  record(value.bundles, path + '.bundles', (bundle, p, key) => {
    validateShortId(key, p); shape(bundle, ['kind', 'entry', 'contentHash'], ['kind', 'entry', 'contentHash'], p)
    oneOf(bundle.kind, ['live2d', 'spine', 'widget', 'skin', 'performance', 'entrance', 'video'], p + '.kind'); relativePath(bundle.entry, p + '.entry'); validateHash(bundle.contentHash, p + '.contentHash')
  })
  record(value.blobs, path + '.blobs', (blob, p, hash) => { validateHash(hash, p); validateBlob(blob, p) })
  validateFiles(value.files, path + '.files')
  const files = new Map(value.files.map(file => [file.path, file]))
  check(!files.has('manifest.json'), path + '.files', 'Manifest cannot hash itself', 'FILE_CLOSURE_MISMATCH')
  const declared = file => check(files.has(file), path + '.files', 'Missing declared file: ' + file, 'FILE_CLOSURE_MISMATCH')
  value.figures.forEach(id => declared(`figures/${id}.json`)); Object.values(value.sprites).forEach(declared)
  for (const [key, bundle] of Object.entries(value.bundles)) declared(`bundles/${key}/${bundle.entry}`)
  const mediaFiles = new Set(), figureFiles = new Set(value.figures.map(id => `figures/${id}.json`))
  for (const [hash, blob] of Object.entries(value.blobs)) {
    const file = `media/${hash}.${blob.ext}`; declared(file); mediaFiles.add(file)
    check(files.get(file).sha256 === hash && files.get(file).size === blob.size, path + '.blobs.' + hash, 'Blob/file mismatch', 'FILE_CLOSURE_MISMATCH')
  }
  for (const file of files.keys()) {
    const [root, key] = file.split('/')
    check(root === 'credits' && file.startsWith('credits/') || root === 'media' && mediaFiles.has(file)
      || root === 'mods' && MOD_PRIVATE_PATH.test(file)
      || root === 'figures' && figureFiles.has(file)
      || root === 'sprites' && value.sprites[key] === file
      || root === 'bundles' && Object.hasOwn(value.bundles, key) && file.startsWith(`bundles/${key}/`), path + '.files', 'Undeclared file namespace: ' + file, 'FILE_CLOSURE_MISMATCH')
  }
  if (value.credits) value.credits.forEach(file=>{check(!file.startsWith('mods/'),path+'.credits','Mod private files are not editor resources','UNKNOWN_FIELD');declared(file)})
  const blobRef = (hash, type) => { if (hash === null) return; const blob = value.blobs[hash]; check(blob && (!type || blob.mime.startsWith(type)), path + '.assets', 'Missing or wrong-kind blob: ' + hash, 'MISSING_DEPENDENCY') }
  if (value.backgroundStyle !== undefined) {
    const style = value.backgroundStyle, at = path + '.backgroundStyle'
    shape(style, ['prompt', 'references'], ['prompt'], at)
    text(typeof style.prompt === 'string' ? style.prompt.replace(/[\r\n\t]/g, ' ') : style.prompt, at + '.prompt', 12000)
    if (style.references !== undefined) {
      array(style.references, at + '.references', 3)
      style.references.forEach(hash => { validateHash(hash, at + '.references'); blobRef(hash, 'image/') })
      unique(style.references, at + '.references')
    }
  }
  if (value.tagIcons !== undefined) {
    array(value.tagIcons, path + '.tagIcons', 256)
    for (const [index, icon] of value.tagIcons.entries()) {
      const at = path + '.tagIcons[' + index + ']'
      shape(icon, ['tag', 'media'], ['tag', 'media'], at)
      text(icon.tag, at + '.tag', 4096); validateHash(icon.media, at + '.media'); blobRef(icon.media, 'image/')
    }
    unique(value.tagIcons.map(icon => icon.tag), path + '.tagIcons')
  }
  for (const asset of value.assets) {
    for (const {hash,type} of assetContentMedia(asset)) blobRef(hash,type)
    for (const content of assetContents(asset)) {
      if (['skins','performances','widgets'].includes(asset.kind)) {
        const kind = {skins:'skin',performances:'performance',widgets:'widget'}[asset.kind]
        check(value.bundles[content.bundleKey]?.kind === kind && value.bundles[content.bundleKey].entry === content.entry,path+'.assets','Missing '+kind+' bundle','MISSING_DEPENDENCY')
      }
      // An entrance bundle's entry is its first media file.
      if (asset.kind === 'entrances' && content.bundleKey !== undefined)
        check(value.bundles[content.bundleKey]?.kind === 'entrance' && value.bundles[content.bundleKey].entry === entranceContract.stageEntranceFiles(content.entrance)[0],path+'.assets','Missing entrance bundle','MISSING_DEPENDENCY')
      // The video an entrance plays is a 视频 entry of the same pack.
      if (asset.kind === 'entrances' && content.entrance.layers.video)
        check(value.assets.some(row => row.kind === 'videos' && row.id === content.entrance.layers.video.asset),path+'.assets','Missing video entry: '+content.entrance.layers.video.asset,'MISSING_DEPENDENCY')
      // A video's bundle holds it (its entry) and its poster.
      if (asset.kind === 'videos')
        check(value.bundles[content.bundleKey]?.kind === 'video' && value.bundles[content.bundleKey].entry === content.entry,path+'.assets','Missing video bundle','MISSING_DEPENDENCY')
    }
    asset.credits?.forEach(declared)
  }
  return value
}
export function validatePackIdentities(manifests) {
  array(manifests, '$'); manifests.forEach(value => validatePackManifest(value))
  unique(manifests.map(value => value.id), '$.packIds')
  unique(manifests.flatMap(value => value.figures), '$.figureIds')
  unique(manifests.flatMap(value => [value.id, ...value.figures]), '$.uuids')
  return manifests
}

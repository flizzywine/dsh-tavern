// 压缩素材 (export-compress.js): an export's packs go out with smaller media — PNG backgrounds as WebP q80, music as Opus
// 96 kbps of the same length, mouth / blink patches lossless pixel for pixel — re-sealed so a fresh library installs them,
// while the installed files are never written.
import test from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import sharp from 'sharp'
import {canonicalJson} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {compressExportPacks, createAssetPackService, writePackZip} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {decodeMedia} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media.js'
import {sealPack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {syntheticPack, digest, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const run = promisify(execFile)

const noise = (width, height, seed) => {
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([(i * 13 + seed) % 251, (i * 7 + seed * 3) % 241, (i * 11) % 239, 255], i)
  return sharp(pixels, {raw:{width, height, channels:4}}).png({compressionLevel:0}).toBuffer()
}
const samples = async file => (await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], {encoding:'buffer', maxBuffer:1 << 26, windowsHide:true})).stdout.length / 2

// The synthetic pack with real media: two large PNG backgrounds, a mouth occlusion mask of its own and a two-second WAV.
async function fixture(root) {
  const pack = await syntheticPack()
  const swap = (from, bytes, ext, mime) => {
    const hash = digest(bytes)
    for (const [name, value] of pack.files) if (name.endsWith('.json')) pack.files.set(name, Buffer.from(value.toString('utf8').replaceAll(from, hash)))
    const blob = pack.manifest.blobs[from]
    pack.files.delete('media/' + from + '.' + blob.ext); pack.files.set('media/' + hash + '.' + ext, bytes)
    pack.manifest = JSON.parse(JSON.stringify(pack.manifest).replaceAll(from, hash))
    pack.manifest.blobs[hash] = {ext, mime, size:bytes.length}
    return hash
  }
  const blobs = Object.keys(pack.manifest.blobs)
  const background = pack.manifest.assets.find(asset => asset.kind === 'backgrounds' && asset.variants).variants.entries
  const [day, night] = [background[0].content.media, background[1].content.media]
  const wav = path.join(root, 'music.wav')
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=2:c=pink', '-ar', '44100', '-ac', '2', wav], {windowsHide:true})
  // the music gets its own file (the fixture's one WAV is also a voice reference, which stays WAV).
  const musicBytes = await readFile(wav), music = digest(musicBytes)
  pack.files.set('media/' + music + '.wav', musicBytes); pack.manifest.blobs[music] = {ext:'wav', mime:'audio/wav', size:musicBytes.length}
  pack.manifest.assets.find(asset => asset.kind === 'music').media = music
  const media = {day:swap(day, await noise(320, 180, 1), 'png', 'image/png'), night:swap(night, await noise(320, 180, 2), 'png', 'image/png'), music}
  // the mask gets its own picture: a patch, so it must stay lossless.
  const mask = await noise(8, 8, 3), maskHash = digest(mask)
  const figureName = 'figures/' + FIGURE_ID + '.json', figure = JSON.parse(pack.files.get(figureName))
  figure.outfits[0].sprite.assets['assets/mask.png'] = maskHash
  pack.files.set(figureName, Buffer.from(canonicalJson(figure)))
  pack.files.set('media/' + maskHash + '.png', mask); pack.manifest.blobs[maskHash] = {ext:'png', mime:'image/png', size:mask.length}
  media.mask = maskHash
  pack.manifest.files = []
  await sealPack(pack.manifest, pack.files)
  assert.ok(blobs.length)
  return {pack:{manifest:pack.manifest, files:pack.files}, media, mask}
}

test('压缩素材 shrinks backgrounds and music, keeps patches pixel-exact, and the re-sealed pack installs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'export-compress-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const {pack, media, mask} = await fixture(root)
  const before = structuredClone(pack.manifest), progress = []
  const result = await compressExportPacks([pack], {directory:path.join(root, 'out'), onProgress:p => progress.push(p)})
  const [out] = result.packs, blobs = out.manifest.blobs
  assert.deepEqual(pack.manifest, before, 'the installed pack is not changed')
  assert.ok(result.summary.afterBytes < result.summary.beforeBytes)
  assert.equal(result.summary.ffmpeg, true)
  assert.equal(progress.at(-1).done, progress.at(-1).total, 'progress ends at the whole')
  assert.equal(progress.at(-1).pack, 'Synthetic pack')
  assert.deepEqual(progress[0], {done:0, total:0, pack:'Synthetic pack'}, 'the bar says compressing while it finds what to convert')
  for (const hash of [media.day, media.night, media.music, media.mask]) assert.equal(blobs[hash], undefined, 'every converted blob has a new hash')
  const file = hash => out.files.get('media/' + hash + '.' + blobs[hash].ext)
  const bytes = async ref => ref.file ? readFile(ref.file) : Buffer.from(ref)
  const webps = Object.entries(blobs).filter(([, blob]) => blob.ext === 'webp')
  assert.equal(webps.length, 3, 'two backgrounds and the mask are WebP')
  // the mask: lossless, the same pixels.
  const figure = JSON.parse(await bytes(out.files.get('figures/' + FIGURE_ID + '.json')))
  const maskHash = figure.outfits[0].sprite.assets['assets/mask.png']
  assert.equal(blobs[maskHash].ext, 'webp')
  assert.deepEqual(await sharp(await bytes(file(maskHash))).ensureAlpha().raw().toBuffer(), await sharp(mask).ensureAlpha().raw().toBuffer())
  // the backgrounds: lossy WebP (VP8), the variants point at them.
  const variants = out.manifest.assets.find(asset => asset.kind === 'backgrounds' && asset.variants).variants.entries
  for (const row of variants.slice(0, 2)) assert.equal((await bytes(file(row.content.media))).toString('ascii', 12, 16), 'VP8 ')
  // the music: Ogg Opus, the same decoded length (loop points stay put).
  const musicHash = out.manifest.assets.find(asset => asset.kind === 'music').media
  assert.equal(blobs[musicHash].mime, 'audio/ogg')
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file(musicHash).file], {windowsHide:true})
  assert.equal(stdout.trim(), 'opus')
  const wav = path.join(root, 'source.wav'); await writeFile(wav, pack.files.get('media/' + media.music + '.wav'))
  assert.equal(await samples(file(musicHash).file), await samples(wav))
  // the card's embeded:// references move with them.
  assert.deepEqual(result.rewrite({uri:'embeded://assets/x/media/' + media.day + '.png'}), {uri:'embeded://assets/x/media/' + variants[0].content.media + '.webp'})
  // a fresh library verifies and installs the compressed pack like any other.
  const zip = path.join(root, 'pack.zip')
  await writePackZip(zip, [{path:'manifest.json', data:Buffer.from(JSON.stringify(out.manifest))}, ...[...out.files].map(([name, ref]) => ({path:name, ...(ref.file ? {file:ref.file, size:ref.length} : {data:ref})}))])
  const service = createAssetPackService({assetRoot:path.join(root, 'library'), decodeMedia})
  t.after(() => service.dispose())
  const preview = await service.inspectImportFile({file:zip})
  const installed = await service.applyImport({inspectionId:preview.inspectionId, expectedRevision:null, decision:'install', acceptScriptRisk:true})
  assert.equal(installed.snapshot.manifest.contentHash, out.manifest.contentHash)
})

test('the export sheet names the same import limit and audio rates as the library', async () => {
  const {PACK_BUDGET} = await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/budget.js')
  const {EXPORT_AUDIO_KBPS} = await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js')
  const sheet = await readFile(new URL('../tavern-plugin/packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js', import.meta.url), 'utf8')
  assert.equal(eval(/const DSHCARD_IMPORT_LIMIT=([^;]+);/.exec(sheet)[1]), PACK_BUDGET.spoolBytes)
  const help = /const DSHCARD_COMPRESS_HELP='([^']+)'/.exec(sheet)[1]
  assert.match(help, new RegExp('音乐转成 Opus ' + EXPORT_AUDIO_KBPS.music + ' kbps、环境音 ' + EXPORT_AUDIO_KBPS.ambience + ' kbps'))
})

test('压缩素材 stops when its progress report throws (the export was cancelled)', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'export-compress-cancel-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const {pack} = await fixture(root)
  let calls = 0
  await assert.rejects(compressExportPacks([pack], {directory:path.join(root, 'out'), onProgress:() => { if (++calls > 1) throw Object.assign(new Error('导出已取消'), {name:'AbortError'}) }}), /导出已取消/)
})

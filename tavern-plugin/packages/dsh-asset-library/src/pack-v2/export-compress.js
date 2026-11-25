import {spawn} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises'
import {availableParallelism} from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {fileURLToPath} from 'node:url'
import {assetContents} from '../shared/asset-variant-content.js'
import {resolveAudioFfmpeg} from './audio-loudness.js'
import {sealPack, StoredFile} from './validation.js'

// 压缩素材 — an export's smaller copy of its packs (the card export's 压缩素材 switch). The installed packs are only read:
// every new file is written under `directory` and the packs go out re-sealed with the new media.
// Images: PNG and lossless WebP become lossy WebP q80 with lossless alpha; a lossy or animated WebP and an animated PNG
// stay as they are. Mouth and blink patches (and mouth occlusion masks) stay lossless (lossless WebP), so they still line
// up pixel for pixel with the base image; the colour tables of a look (lut / texture) are not touched.
// Voice references (the voice library) stay as they are, also where a music asset shares the file.
// Audio: music becomes Ogg Opus 96 kbps and ambience 80 kbps (the rates the owner approved by ear, review page
// triangle-compress-1122b); a lossy source already at or below the rate stays, sound effects and voices stay. An encode
// is kept only when its decoded length is the source's to the sample (loop points stay put). Without ffmpeg the audio
// stays as it is (`audio: 'no-ffmpeg'`).
// Every conversion is kept only when it is smaller. References (blobs, file rows, figure and sprite documents, the card's
// embeded:// URIs) move to the new content hashes.
// The same source gives the same bytes on the same encoders (images always; audio is muxed bitexact, without the random
// Ogg stream serial), so an update package can leave out what an earlier export already sent.
export const EXPORT_AUDIO_KBPS = Object.freeze({music:96, ambience:80})
const LOSSLESS_AUDIO = new Set(['flac', 'alac', 'wavpack', 'ape', 'tta'])
const MEDIA = /^media\/([0-9a-f]{64})\.(\w+)$/

const readJson = async bytes => JSON.parse((bytes.file ? await readFile(bytes.file) : Buffer.from(bytes)).toString('utf8'))

// The sprite-relative files a sprite document draws over its base image.
function patchFiles(value, out = new Set()) {
  if (!value || typeof value !== 'object') return out
  for (const [key, item] of Object.entries(value)) {
    if (key === 'blink' && item) { out.add(item.closed); if (item.half) out.add(item.half) }
    else if (key === 'mouthOcclusionMask') out.add(item)
    else if (key === 'mouthAtlas') { if (item?.src) out.add(item.src) }
    else if (key === 'mouthSets') for (const set of Object.values(item || {})) { if (set?.src) out.add(set.src) }
    else patchFiles(item, out)
  }
  return out
}
const hashesUnder = (value, out) => {
  if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) out.add(value)
  else if (value && typeof value === 'object') Object.values(value).forEach(item => hashesUnder(item, out))
  return out
}

function run(command, args, {signal, onLine, stdin} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {windowsHide:true, stdio:[stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], signal, env:{...process.env, ELECTRON_RUN_AS_NODE:'1'}})
    const errors = []
    let bytes = 0, failure = null
    // settles only once the process has exited, so a caller cleaning up after a stop finds its files released.
    const fail = error => { failure ??= error; child.kill() }
    if (onLine) createInterface({input:child.stdout}).on('line', line => { if (failure) return; try { onLine(line) } catch (error) { fail(error) } })
    else child.stdout.on('data', chunk => { bytes += chunk.length })
    child.stderr.on('data', chunk => errors.push(chunk))
    child.on('error', fail)
    child.on('close', code => failure ? reject(failure) : resolve({code, bytes, stderr:Buffer.concat(errors).toString()}))
    if (stdin !== undefined) { child.stdin.on('error', fail); child.stdin.end(stdin) }
  })
}

async function audioInfo(ffmpeg, file, signal) {
  const {stderr} = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file], {signal})
  const stream = /Stream #\S+: Audio: (\w+)[^\n]*/.exec(stderr)
  return {codec:stream?.[1], kbps:Number(/, (\d+) kb\/s/.exec(stream?.[0] || '')?.[1] || /bitrate: (\d+) kb\/s/.exec(stderr)?.[1])}
}
const samples = async (ffmpeg, file, signal) => (await run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], {signal})).bytes / 2

async function encodeAudio(ffmpeg, input, output, kbps, signal) {
  const before = await audioInfo(ffmpeg, input, signal)
  if (!before.codec || !LOSSLESS_AUDIO.has(before.codec) && !before.codec.startsWith('pcm_') && !(before.kbps > kbps + 8)) return null
  const {code} = await run(ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-map_metadata', '-1', '-c:a', 'libopus', '-b:a', kbps + 'k', '-vbr', 'on', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-f', 'ogg', output], {signal})
  if (code !== 0) return null
  const [a, b] = await Promise.all([samples(ffmpeg, input, signal), samples(ffmpeg, output, signal)])
  if (a !== b || !a) return null
  const data = await readFile(output)
  return {bytes:data.length, sha256:createHash('sha256').update(data).digest('hex')}
}

const fileSize = async ref => ref.file ? (await stat(ref.file)).size : ref.length

// packs: [{manifest, files}] as projectPackFigures gives them. onProgress({done, total, pack}) hears input bytes handled out
// of those to convert, with the title of the pack; a throw from it stops the work (the encoders are killed).
// reuse ({source sha256: {sha256, ext, mime, size}}, optional): media an earlier export already converted, taken as that
// result without encoding again (an update package leaves those files out, so they carry no bytes here).
// Resolves {packs, rewrite(card), converted: the same map for this export, summary:{beforeBytes, afterBytes, images, audio, ffmpeg}}.
export async function compressExportPacks(packs, {directory, onProgress = () => {}, reuse = {}} = {}) {
  await mkdir(directory, {recursive:true})
  const controller = new AbortController(), signal = controller.signal
  const renames = new Map()
  const plans = [], reused = []
  let total = 0
  for (const [index, pack] of packs.entries()) {
    const {manifest, files} = pack
    if (manifest.format !== 'dsh-asset-pack' || !manifest.blobs) { plans.push(null); continue }
    // finding what to convert reads every figure of a large pack (minutes for 3.8 GB): the bar says compressing meanwhile.
    onProgress({done:0, total:0, pack:manifest.name || manifest.title || ''})
    const lossless = new Set(), audio = new Map()
    for (const id of manifest.figures || []) {
      const figure = await readJson(files.get('figures/' + id + '.json'))
      for (const outfit of figure.outfits || []) {
        const sprite = outfit.sprite && files.get(manifest.sprites?.[outfit.sprite.manifestKey])
        if (!sprite) continue
        for (const name of patchFiles(await readJson(sprite))) if (outfit.sprite.assets?.[name]) lossless.add(outfit.sprite.assets[name])
      }
    }
    // voice references stay WAV / MP3 (the voice library accepts only those) and a look's tables stay exact.
    const untouched = hashesUnder(manifest.voiceLibrary, new Set())
    for (const asset of manifest.assets || []) {
      if (asset.kind === 'looks') for (const content of assetContents(asset)) hashesUnder(content.params, untouched)
      if (EXPORT_AUDIO_KBPS[asset.kind]) for (const content of assetContents(asset)) if (content.media) audio.set(content.media, EXPORT_AUDIO_KBPS[asset.kind])
    }
    const jobs = [], taken = new Map()
    for (const [hash, blob] of Object.entries(manifest.blobs)) {
      const ref = files.get('media/' + hash + '.' + blob.ext)
      if (!ref || untouched.has(hash)) continue
      const image = blob.ext === 'png' || blob.ext === 'webp'
      if (!image && !audio.has(hash)) continue
      if (Object.hasOwn(reuse, hash)) { const next = reuse[hash]; taken.set(hash, {sha256:next.sha256, ext:next.ext, mime:next.mime, bytes:next.size}); continue }
      const size = await fileSize(ref)
      jobs.push({hash, blob, ref, size, image, lossless:lossless.has(hash), kbps:audio.get(hash)})
      total += size
    }
    plans[index] = jobs; reused[index] = taken
  }
  let done = 0
  const report = title => onProgress({done, total, pack:title})
  const ffmpeg = plans.some(jobs => jobs?.some(job => !job.image)) ? await resolveAudioFfmpeg() : null
  const counts = {images:0, audio:0}
  const out = []
  try {
    for (const [index, pack] of packs.entries()) {
      const jobs = plans[index], taken = reused[index]
      if (!jobs?.length && !taken?.size) { out.push(pack); continue }
      const title = pack.manifest.name || pack.manifest.title || ''
      report(title)
      const folder = path.join(directory, String(index))
      await mkdir(folder, {recursive:true})
      const input = async job => {
        if (job.ref.file) return job.ref.file
        const file = path.join(folder, job.hash + '.in.' + job.blob.ext)
        await writeFile(file, job.ref)
        return file
      }
      const converted = new Map(taken)
      const finish = (job, result, ext, file) => {
        done += job.size
        if (result && result.bytes < job.size) { converted.set(job.hash, {...result, ext, mime:ext === 'webp' ? 'image/webp' : 'audio/ogg', file}); counts[job.image ? 'images' : 'audio']++ }
        report(title)
      }
      const images = jobs.filter(job => job.image), sounds = jobs.filter(job => !job.image)
      const imageWork = (async () => {
        if (!images.length) return
        const list = await Promise.all(images.map(async job => ({input:await input(job), output:path.join(folder, job.hash + '.webp'), lossless:job.lossless})))
        const workers = Math.max(1, Math.min(8, availableParallelism() - 2))
        const {code, stderr} = await run(process.execPath, [fileURLToPath(new URL('./thumbnail-encoder.js', import.meta.url)), 'compress'], {signal, stdin:JSON.stringify({jobs:list, workers}),
          onLine: line => { const row = JSON.parse(line), job = images[row.i]; finish(job, row.sha256 ? row : null, 'webp', list[row.i].output) }})
        if (code !== 0) throw new Error('压缩图片时出错：' + (stderr.trim() || '编码进程退出 ' + code))
      })()
      const audioWork = (async () => {
        let next = 0
        await Promise.all(Array.from({length:Math.min(2, sounds.length)}, async () => {
          while (next < sounds.length) {
            const job = sounds[next++], file = path.join(folder, job.hash + '.ogg')
            finish(job, ffmpeg ? await encodeAudio(ffmpeg, await input(job), file, job.kbps, signal) : null, 'ogg', file)
          }
        }))
      })()
      // both run to their end (a stop kills the encoders) before a failure is passed on.
      const stopOthers = work => work.catch(error => { controller.abort(); throw error })
      const failed = (await Promise.allSettled([imageWork, audioWork].map(stopOthers))).find(item => item.status === 'rejected')
      if (failed) throw failed.reason
      out.push(await resealPack(pack, converted))
      for (const [hash, next] of converted) renames.set(hash, next)
    }
  } catch (error) { controller.abort(); throw error }
  const beforeBytes = (await Promise.all(packs.map(packBytes))).reduce((a, b) => a + b, 0)
  const afterBytes = (await Promise.all(out.map(packBytes))).reduce((a, b) => a + b, 0)
  return {packs:out, rewrite:value => renameHashes(value, renames),
    converted:Object.fromEntries([...renames].map(([hash, next]) => [hash, {sha256:next.sha256, ext:next.ext, mime:next.mime, size:next.bytes}])),
    summary:{beforeBytes, afterBytes, images:counts.images, audio:counts.audio, ffmpeg:!!ffmpeg || !plans.some(jobs => jobs?.some(job => !job.image))}}
}

async function packBytes(pack) {
  let sum = 0
  for (const ref of pack.files.values()) sum += await fileSize(ref)
  return sum
}

// A JSON value with every renamed hash moved: media/<hash>.<ext> paths take the new extension, bare hashes the new hash.
function renameHashes(value, renames) {
  if (!renames.size) return value
  const text = JSON.stringify(value)
    .replace(/media\/([0-9a-f]{64})\.(\w+)/g, (match, hash) => renames.has(hash) ? 'media/' + renames.get(hash).sha256 + '.' + renames.get(hash).ext : match)
    .replace(/[0-9a-f]{64}/g, hash => renames.get(hash)?.sha256 || hash)
  return JSON.parse(text)
}

// The pack with its converted media: new blobs and files, every document that named an old hash rewritten, sealed again
// (file rows and content hash) so the importer verifies it like any pack.
async function resealPack(pack, converted) {
  if (!converted.size) return pack
  const {files: before} = pack
  const files = new Map(), hashed = new Map()
  for (const [name, ref] of before) {
    const match = MEDIA.exec(name), next = match && converted.get(match[1])
    if (next) {
      const renamed = 'media/' + next.sha256 + '.' + next.ext
      files.set(renamed, new StoredFile(next.bytes, next.file)); hashed.set(renamed, next.sha256)
    } else if (name.endsWith('.json') && !name.startsWith('bundles/')) {
      const original = ref.file ? await readFile(ref.file) : Buffer.from(ref), text = original.toString('utf8')
      const moved = JSON.stringify(renameHashes(JSON.parse(text), converted))
      if (moved === JSON.stringify(JSON.parse(text))) files.set(name, ref)
      else { const bytes = Buffer.from(moved); files.set(name, bytes); hashed.set(name, createHash('sha256').update(bytes).digest('hex')) }
    } else files.set(name, ref)
  }
  const manifest = renameHashes(structuredClone(pack.manifest), converted)
  for (const [hash, next] of converted) {
    const {ext:_ext, mime:_mime, size:_size, ...rest} = manifest.blobs[next.sha256] || {}
    manifest.blobs[next.sha256] = {...rest, ext:next.ext, mime:next.mime, size:next.bytes}
    if (hash !== next.sha256) delete manifest.blobs[hash]
  }
  // file rows of renamed media named their old path; sealPack lists them again from `files`.
  manifest.files = (manifest.files || []).filter(row => files.has(row.path))
  await sealPack(manifest, files, pack, hashed)
  return {...pack, manifest, files}
}


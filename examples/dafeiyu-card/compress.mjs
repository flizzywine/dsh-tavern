// Shrink the built 大肥鱼.source.dshcard into the distributed 大肥鱼.dshcard: PNG pictures become WebP, music and sound
// effects are re-encoded as Ogg Opus, each only where it saves enough. Packs stay
// content-addressed: a re-encoded file gets a new hash, and every reference to it (the
// pack manifest, figures, sprites, the card's own assets) follows. With --drop-live2d the
// Live2D models go (the sample card shows static standing pictures); other bundles stay.
// The card carries no plugin: Tavern's stage draws it from its bound packs, so an earlier build's galgame
// plugin and its retired defaults.stage are dropped. Needs cwebp and ffmpeg (with libopus) on PATH.
//
//   node examples/dafeiyu-card/compress.mjs 大肥鱼.source.dshcard 大肥鱼.dshcard --drop-live2d
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { openZipFile } from '../../tavern-plugin/lib/domain/zip-file.js'
import { writeZipEntries } from '../../tavern-plugin/lib/domain/zip-entries.js'
import { packContentHash } from '../../tavern-plugin/lib/domain/asset-packs.js'

const run = promisify(execFile)
const [source, target] = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const dropLive2d = process.argv.includes('--drop-live2d')
if (!source || !target) { console.error('用法：node compress.mjs <输入.dshcard> <输出.dshcard>'); process.exit(1) }

// Validate before opening source archives or producing a distributable.

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const MIME = { webp: 'image/webp', ogg: 'audio/ogg', png: 'image/png' }
// Keep the original unless the new file is at least this much smaller.
const MIN_SAVING = 0.15

const work = await mkdtemp(path.join(os.tmpdir(), 'dshcard-compress-'))
async function convert(bytes, ext, kind) {
  const input = path.join(work, sha256(bytes) + '.' + ext)
  await writeFile(input, bytes)
  const output = input + (kind === 'image' ? '.webp' : '.ogg')
  // Pictures with transparency (figures, expressions) keep more quality than already-lossy backgrounds.
  if (kind === 'image') await run('cwebp', ['-quiet', '-q', ext === 'png' ? '90' : '80', '-m', '6', '-alpha_q', '100', '-mt', input, '-o', output])
  else await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vn', '-c:a', 'libopus', '-b:a', kind === 'audio' ? '64k' : '48k', '-vbr', 'on', '-f', 'ogg', output])
  const result = await readFile(output)
  await rm(input); await rm(output)
  return result
}

const zip = await openZipFile(source, { label: '人物卡' })
const files = new Map()
for (const entry of zip.entries.values()) files.set(entry.path, await zip.readBuffer(entry, 512 * 1024 * 1024))
await zip.close()
const dsh = JSON.parse(files.get('dsh.json').toString('utf8'))
// No card plugin any more (Tavern's stage draws the card from its packs): drop an earlier build's.
for (const file of [...files.keys()]) if (file.startsWith('plugins/')) files.delete(file)
delete dsh.plugins
if (dsh.defaults) delete dsh.defaults.stage

// Live2D models: their bundle files, the manifest's bundle entries and each outfit's binding.
if (dropLive2d) {
  for (const pack of dsh.packs) {
    const manifestPath = pack.path + 'manifest.json'
    const manifest = JSON.parse(files.get(manifestPath).toString('utf8'))
    const keys = Object.entries(manifest.bundles || {}).filter(([, bundle]) => bundle.kind === 'live2d').map(([key]) => key)
    if (!keys.length) continue
    for (const key of keys) {
      delete manifest.bundles[key]
      for (const file of [...files.keys()]) if (file.startsWith(pack.path + 'bundles/' + key + '/')) files.delete(file)
    }
    for (const id of manifest.figures || []) {
      const figurePath = pack.path + 'figures/' + id + '.json'
      if (!files.has(figurePath)) continue
      const figure = JSON.parse(files.get(figurePath).toString('utf8'))
      for (const outfit of figure.outfits || []) if (keys.includes(outfit.live2d?.bundleKey)) delete outfit.live2d
      if (figure.appearance === 'live2d') figure.appearance = 'sprite'
      files.set(figurePath, Buffer.from(JSON.stringify(figure)))
    }
    files.set(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)))
    console.log('去掉 Live2D：' + keys.join('、'))
  }
}

// Old hash → { hash, ext } for every re-encoded media file, across all packs.
const renamed = new Map()
let before = 0, after = 0
const jobs = []
for (const pack of dsh.packs) {
  const manifest = JSON.parse(files.get(pack.path + 'manifest.json').toString('utf8'))
  for (const [hash, blob] of Object.entries(manifest.blobs || {})) {
    const file = pack.path + 'media/' + hash + '.' + blob.ext
    const bytes = files.get(file)
    if (!bytes) continue
    const kind = blob.ext === 'png' ? 'image' : blob.ext === 'webp' && bytes.length > 100 * 1024 ? 'image' : blob.ext === 'ogg' ? (bytes.length > 400 * 1024 ? 'audio' : 'sfx') : ''
    if (!kind) continue
    jobs.push(async () => {
      const next = await convert(bytes, blob.ext, kind).catch(error => { console.warn('跳过 ' + file + '：' + (error.stderr || error.message)); return null })
      before += bytes.length
      if (!next || next.length > bytes.length * (1 - MIN_SAVING)) { after += bytes.length; return }
      after += next.length
      const ext = kind === 'image' ? 'webp' : 'ogg'
      const fresh = sha256(next)
      files.delete(file)
      files.set(pack.path + 'media/' + fresh + '.' + ext, next)
      renamed.set(hash, { hash: fresh, ext, oldExt: blob.ext, size: next.length })
    })
  }
}
let done = 0
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 1) }, async () => {
  while (jobs.length) { await jobs.shift()(); if (++done % 50 === 0) console.log('已处理 ' + done + ' 个文件') }
}))
await rm(work, { recursive: true, force: true })

// Every JSON in a pack and the card itself: point old hashes (with their old extension) at the new files.
function rewrite(text) {
  return text.replace(/[0-9a-f]{64}(\.(png|webp|ogg))?/g, (match, dotted) => {
    const hash = match.slice(0, 64), change = renamed.get(hash)
    if (!change) return match
    return change.hash + (dotted ? '.' + (dotted.slice(1) === change.oldExt ? change.ext : dotted.slice(1)) : '')
  })
}
for (const [file, bytes] of files) {
  if (!file.endsWith('.json') || file.endsWith('/manifest.json') && dsh.packs.some(pack => file === pack.path + 'manifest.json')) continue
  if (!file.startsWith('assets/') && file !== 'card.json') continue
  const text = bytes.toString('utf8'), next = rewrite(text)
  if (next !== text) files.set(file, Buffer.from(next))
}
const card = JSON.parse(files.get('card.json').toString('utf8'))
for (const asset of card.data?.assets || []) {
  const match = /([0-9a-f]{64})\.(\w+)$/.exec(asset.uri || '')
  if (match) asset.ext = match[2]
}
files.set('card.json', Buffer.from(JSON.stringify(card, null, 2)))

// The licences (CC BY / CC BY-NC-SA) ask that changes be indicated: say what this script did.
const today = new Date().toLocaleDateString('sv')
for (const pack of dsh.packs) {
  const changed = [...renamed.values()].filter(change => files.has(pack.path + 'media/' + change.hash + '.' + change.ext))
  const note = '# Changes for the DSH card distribution (' + today + ')\n\n' +
    'This pack was re-encoded to make the 大肥鱼 DSH card smaller. Content, credits and licences are otherwise unchanged.\n\n' +
    '- ' + changed.filter(change => change.ext === 'webp').length + ' pictures re-encoded as WebP (PNG at quality 90 with lossless alpha; WebP backgrounds over 100 KB at quality 80).\n' +
    '- ' + changed.filter(change => change.ext === 'ogg').length + ' recordings re-encoded as Ogg Opus (music 64 kb/s, effects 48 kb/s).\n' +
    (dropLive2d && pack.path.endsWith('/dafeiyu/') ? '- Live2D models removed; the card shows the static standing pictures.\n' : '') +
    '\nRe-encoded files have new content hashes; references in this pack were updated to match.\n'
  files.set(pack.path + 'credits/DSH-CARD-CHANGES.md', Buffer.from(note))
  const manifest = JSON.parse(files.get(pack.path + 'manifest.json').toString('utf8'))
  if (Array.isArray(manifest.credits) && !manifest.credits.includes('credits/DSH-CARD-CHANGES.md')) manifest.credits.push('credits/DSH-CARD-CHANGES.md')
  files.set(pack.path + 'manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
  if (Array.isArray(pack.credits) && !pack.credits.includes(pack.path + 'credits/DSH-CARD-CHANGES.md')) pack.credits.push(pack.path + 'credits/DSH-CARD-CHANGES.md')
}

// Each pack's manifest: blobs and the file list follow, then the pack digest.
for (const pack of dsh.packs) {
  const manifestPath = pack.path + 'manifest.json'
  const manifest = JSON.parse(rewrite(files.get(manifestPath).toString('utf8')))
  for (const [hash, change] of renamed) {
    if (!manifest.blobs?.[change.hash] && Object.hasOwn(manifest.blobs || {}, hash)) delete manifest.blobs[hash]
  }
  for (const change of renamed.values()) {
    if (files.has(pack.path + 'media/' + change.hash + '.' + change.ext) && manifest.blobs) manifest.blobs[change.hash] = { ext: change.ext, mime: MIME[change.ext], size: change.size }
  }
  const inPack = [...files.keys()].filter(file => file.startsWith(pack.path) && file !== manifestPath)
  if (Array.isArray(manifest.files)) {
    manifest.files = inPack.map(file => ({ path: file.slice(pack.path.length), sha256: sha256(files.get(file)), size: files.get(file).length }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }
  manifest.contentHash = packContentHash(Object.fromEntries((manifest.files || []).map(item => [item.path, item])))
  files.set(manifestPath, Buffer.from(JSON.stringify(manifest, null, 2)))
  const all = Object.fromEntries([...files.keys()].filter(file => file.startsWith(pack.path)).map(file => [file.slice(pack.path.length), { sha256: sha256(files.get(file)) }]))
  pack.contentHash = packContentHash(all)
  pack.bytes = [...files.keys()].filter(file => file.startsWith(pack.path)).reduce((sum, file) => sum + files.get(file).length, 0)
}
files.set('dsh.json', Buffer.from(JSON.stringify(dsh, null, 2)))

await writeFile(target, writeZipEntries([...files].map(([file, content]) => ({ path: file, content }))))
const mb = value => (value / 1024 / 1024).toFixed(1) + ' MB'
console.log('重新编码 ' + renamed.size + ' 个文件：' + mb(before) + ' → ' + mb(after))
console.log('已生成 ' + target)

// Offline audio analysis for authoring tools and ffmpeg comparison tests.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
const validLoudness = value => value.v === 1 && Number.isFinite(value.lufs) && value.lufs >= -100 && value.lufs <= 10 && Number.isFinite(value.peak) && value.peak >= -100 && value.peak <= 20
let executable
export async function resolveAudioFfmpeg() {
  if (!executable) executable = (async () => {
    for (const candidate of [...new Set([process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean))]) {
      try { await execute(candidate, ['-version'], { windowsHide: true, timeout: 5000 }); return candidate } catch {}
    }
    return null
  })()
  return executable
}
export async function measureAudioFile(file) {
  const ffmpeg = await resolveAudioFfmpeg()
  if (!ffmpeg) return null
  try {
    const { stderr } = await execute(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-map', '0:a:0', '-af', 'apad=whole_dur=0.4,ebur128=peak=true', '-f', 'null', '-'], { windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
    const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
    const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), rawPeak = /Peak:\s+(-inf|-?[\d.]+) dBFS/.exec(summary)?.[1]
    // ffmpeg prints a peak just under full scale as -0.0; stored JSON reads back +0, so keep +0 (read-back compares deep-strictly).
    const peak = rawPeak === '-inf' ? -100 : Math.max(-100, Number(rawPeak)) + 0
    const result = { lufs: peak === -100 && lufs <= -70 ? -100 : lufs, peak, v: 1 }
    return validLoudness(result) ? result : null
  } catch { return null }
}

import {mkdtemp, writeFile, unlink, rmdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {assetContents} from '../shared/asset-variant-content.js'

// A video's bundle entry is its audio source; silent video is not audio ingress.
export function audioContentFile(manifest, asset, content) {
  if (asset.kind === 'videos') return content.audio && content.audio !== 'none' ? `bundles/${content.bundleKey}/${content.entry}` : null
  if (!['music', 'sfx', 'ambience'].includes(asset.kind) || !content.media) return null
  return `media/${content.media}.${manifest.blobs[content.media]?.ext}`
}

// Called only at ingress, before sealing. Unchanged installed media is not a migration.
export async function authorAudioLoudness(manifest, files, {previous, read, measure = measureAudioFile} = {}) {
  const known = new Map(), old = new Map()
  const identity = (pack, name) => pack.files?.find(row => row.path === name)?.sha256 || name
  for (const asset of previous?.manifest.assets || []) {
    for (const content of assetContents(asset)) {
      const name = audioContentFile(previous.manifest, asset, content)
      if (!name) continue
      const key = identity(previous.manifest, name)
      old.set(asset.kind + '/' + asset.id + '/' + name, key)
      if (content.loudness) known.set(key, content.loudness)
    }
  }
  let temporary, changed = false
  try {
    for (const asset of manifest.assets) for (const content of assetContents(asset)) {
      const name = audioContentFile(manifest, asset, content)
      if (!name) continue
      const replacedVideo = previous && asset.kind === 'videos' && files.get(name) instanceof Uint8Array
      const key = replacedVideo ? name : identity(manifest, name)
      if (content.loudness) { known.set(key, content.loudness); continue }
      if (!replacedVideo && old.get(asset.kind + '/' + asset.id + '/' + name) === key) continue
      if (!known.has(key)) {
        const extension = path.extname(name)
        if (!/^\.(wav|mp3|ogg|flac|m4a|aac|opus|webm|mp4)$/.test(extension)) throw new Error('Unsupported audio extension')
        const stored = files.get(name)
        const bytes = stored instanceof Uint8Array ? stored : await read(name, stored.length)
        temporary ??= await mkdtemp(path.join(tmpdir(), 'dsh-audio-ingress-'))
        const file = path.join(temporary, 'audio' + extension)
        await writeFile(file, bytes)
        let value
        try { value = await measure(file) } finally { await unlink(file) }
        if (!value) throw new Error('无法测量音频响度，请检查音频文件和 ffmpeg：' + asset.name)
        known.set(key, value)
      }
      content.loudness = {...known.get(key)}; changed = true
    }
    return changed
  } finally { if (temporary) await rmdir(temporary) }
}

export async function measureAudioBytes(bytes, extension) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-audio-write-'))
  const file = path.join(directory, 'audio.' + extension)
  try {
    await writeFile(file, bytes)
    const loudness = await measureAudioFile(file)
    if (!loudness) throw new Error('无法测量音频响度，请检查音频文件和 ffmpeg')
    return loudness
  } finally { await unlink(file).catch(() => {}); await rmdir(directory) }
}

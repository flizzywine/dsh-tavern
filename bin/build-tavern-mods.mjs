import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { firstPartyModIds } from '../tavern-plugin/lib/mod-system-distributions.js'

const root = fileURLToPath(new URL('../', import.meta.url))

// A mod's audio core assets play at their measured loudness (audio-loudness.json, bundled with its entry). A new or
// replaced file is measured once here; to re-measure a replaced file, delete its entry first.
async function measureCoreAudio(directory, manifest) {
  const audio = manifest.coreAssets.filter(row => /\.(?:wav|mp3|ogg|m4a|flac)$/i.test(row.path))
  if (!audio.length) return
  const file = path.join(directory, 'audio-loudness.json')
  const levels = JSON.parse(await fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return '{}'; throw error }))
  const missing = audio.filter(row => !levels[row.path])
  if (!missing.length) return
  const { measureAudioFile } = await import('../tavern-plugin/lib/stage-audio.js')
  for (const row of missing) {
    const level = await measureAudioFile(path.join(directory, row.path))
    if (!level) throw new Error('Cannot measure core audio: ' + row.path)
    levels[row.path] = level
  }
  await fs.writeFile(file, JSON.stringify(levels, null, 2) + '\n')
}

// Each installed mod is self-contained; no private host bundle is required.
export async function buildTavernMods({ check = false } = {}) {
  const { build } = createRequire(import.meta.url)('esbuild')
  for (const id of firstPartyModIds) {
    const directory = path.join(root, 'tavern-plugin/mods', id)
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'mod.json'), 'utf8'))
    if (!check) await measureCoreAudio(directory, manifest)
    const compiled = await build({ absWorkingDir: root, entryPoints: [path.join(directory, manifest.entry)], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'silent' })
    const bytes = Buffer.from(compiled.outputFiles[0].contents)
    const target = path.join(root, 'tavern-plugin/lib/host', 'mod-' + id + '.mjs')
    if (check) {
      if (!(await fs.readFile(target)).equals(bytes)) throw new Error('Stale mod bundle: ' + id)
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bytes)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildTavernMods({ check: process.argv.includes('--check') })
}

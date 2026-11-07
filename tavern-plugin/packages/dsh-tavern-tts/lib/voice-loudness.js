// a voice's loudness, learned from the lines of it already measured.
// A streamed line plays before it is complete and measured; its first play then uses the level its voice is known to
// have (mean integrated loudness, loudest true peak of the voice's recent lines) instead of the nominal speech level.
// Kept beside the audio cache so it survives restarts; an unknown voice keeps the nominal level.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { voiceLoudnessGain } from './loudness.js'

const RECENT = 8, VOICES = 512

export function createVoiceLoudness({dataDir} = {}) {
  const file = dataDir && join(dataDir, 'cache', 'voice-loudness.json')
  let voices, chain = Promise.resolve()
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  async function load() {
    if (voices) return voices
    voices = new Map()
    if (file) try { for (const [key, rows] of Object.entries(JSON.parse(await readFile(file, 'utf8')))) voices.set(key, rows) } catch { /* none measured yet */ }
    return voices
  }
  return {
    // The estimate for a voice, or null when none of its lines has been measured.
    estimate: key => serial(async () => {
      const rows = (await load()).get(key)
      if (!rows?.length) return null
      return voiceLoudnessGain(rows.reduce((sum, row) => sum + row[0], 0) / rows.length, Math.max(...rows.map(row => row[1])))
    }),
    record: (key, loudness) => serial(async () => {
      if (!Number.isFinite(loudness?.lufs) || !Number.isFinite(loudness?.truePeak)) return
      const map = await load(), rows = map.get(key) || []
      map.delete(key); map.set(key, [...rows, [loudness.lufs, loudness.truePeak]].slice(-RECENT))
      while (map.size > VOICES) map.delete(map.keys().next().value)
      if (!file) return
      // A line already synthesized never fails over this note; the next measured line writes it again.
      try {
        await mkdir(join(dataDir, 'cache'), {recursive:true})
        const tmp = file + '.' + randomUUID() + '.tmp'
        await writeFile(tmp, JSON.stringify(Object.fromEntries(map)), {mode:0o600}); await rename(tmp, file)
      } catch {}
    }),
    flush: () => chain,
  }
}

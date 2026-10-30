import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { firstPartyModIds } from '../tavern-plugin/lib/mod-system-distributions.js'

const root = fileURLToPath(new URL('../', import.meta.url))

// Each installed mod is self-contained; no private host bundle is required.
export async function buildTavernMods({ check = false } = {}) {
  const { build } = createRequire(import.meta.url)('esbuild')
  for (const id of firstPartyModIds) {
    const directory = path.join(root, 'tavern-plugin/mods', id)
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'mod.json'), 'utf8'))
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

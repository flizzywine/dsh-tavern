import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SourceTextModule } from 'node:vm'

// Use the packed file list and parse static imports without loading host packages.
const root = pathToFileURL(process.cwd() + path.sep)
const manifest = JSON.parse(await readFile(new URL('dsh-tavern-runtime.json', root), 'utf8'))
const packed = new Set(manifest.files.map(file => file.path))
const checked = new Set()

async function check(relative, importer) {
  if (!packed.has(relative)) throw new Error(`Missing runtime file ${relative}${importer ? ` imported by ${importer}` : ''}`)
  if (checked.has(relative)) return
  checked.add(relative)
  if (!/\.m?js$/.test(relative)) return

  const url = new URL(relative, root)
  const code = await readFile(url, 'utf8')
  const module = new SourceTextModule(code, { identifier: relative })
  for (const { specifier } of module.moduleRequests) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
    const target = fileURLToPath(new URL(specifier, url))
    await check(path.relative(fileURLToPath(root), target).split(path.sep).join('/'), relative)
  }
}

const entry = 'tavern-plugin/lib/index.js'
await check(entry)
console.log(`Checked ${checked.size} packed files reachable from ${entry}`)

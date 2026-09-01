import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const revision = String(process.argv[2] || '')
const releaseSequence = Number(process.argv[3])
if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error('A full Git commit SHA is required')
if (!Number.isSafeInteger(releaseSequence) || releaseSequence <= 0) throw new Error('A positive release sequence is required')

const entries = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml', 'install.ps1', 'install.sh', 'bin', 'config', 'presets', 'tavern-plugin', 'patches']
const files = []

async function collect(relative) {
  const absolute = path.join(root, relative)
  const items = await readdir(absolute, { withFileTypes: true }).catch((error) => error?.code === 'ENOTDIR' ? null : Promise.reject(error))
  if (items === null) {
    const content = await readFile(absolute)
    files.push({ path: relative.replaceAll('\\', '/'), sha256: createHash('sha256').update(content).digest('hex'), size: content.length })
    return
  }
  for (const item of items) {
    if (item.name === 'node_modules') continue
    await collect(path.join(relative, item.name))
  }
}

for (const entry of entries) await collect(entry)
files.sort((left, right) => left.path.localeCompare(right.path))
const version = String(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))?.version || '')
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) throw new Error('package.json must contain a semantic version')
await writeFile(path.join(root, 'dsh-tavern-runtime.json'), `${JSON.stringify({ schemaVersion: 2, revision, releaseSequence, version, files }, null, 2)}\n`, 'utf8')

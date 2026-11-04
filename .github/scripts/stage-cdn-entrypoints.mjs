import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRuntimeArchive } from './check-runtime-archive.mjs'

export const CDN_ENTRYPOINTS = ['install.ps1', 'install.sh', 'android/setup.sh', 'dsh-tavern-runtime.json']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

// The CDN branch contains the ZIP plus these entry points, never the source tree.
// Validate the exact bytes before the workflow publishes the branch.
export async function stageCdnEntrypoints(sourceRoot, destination) {
  const entries = await Promise.all(CDN_ENTRYPOINTS.map(async file => ({ file, bytes: await readFile(path.join(sourceRoot, file)) })))
  const manifest = JSON.parse(entries.find(entry => entry.file === 'dsh-tavern-runtime.json').bytes)
  if (!/^[0-9a-f]{40}$/i.test(String(manifest.revision || '')) || !/^[0-9a-f]{40}$/i.test(String(manifest.archive?.commit || ''))) throw new Error('CDN manifest needs immutable source and archive commits')
  const archiveSize = await checkRuntimeArchive(path.join(destination, 'runtime.zip'))
  const archive = await readFile(path.join(destination, 'runtime.zip'))
  if (manifest.archive.path !== 'runtime.zip' || manifest.archive.size !== archiveSize || manifest.archive.sha256 !== digest(archive)) throw new Error('CDN archive does not match its manifest')
  for (const { file, bytes } of entries) {
    if (file === 'dsh-tavern-runtime.json') continue
    const expected = manifest.files?.find(entry => entry.path === file)
    if (expected?.size !== bytes.length || expected?.sha256 !== digest(bytes)) throw new Error(`CDN entry point does not match its manifest: ${file}`)
  }
  const totalBytes = archiveSize + entries.reduce((sum, entry) => sum + entry.bytes.length, 0)
  if (totalBytes >= 50_000_000 || entries.some(entry => entry.bytes.length >= 20_000_000)) throw new Error('CDN distribution exceeds its size budget')
  for (const { file, bytes } of entries) {
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true })
    await writeFile(path.join(destination, file), bytes)
  }
  return totalBytes
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`CDN distribution: ${await stageCdnEntrypoints(process.cwd(), process.argv[2])} bytes`)
}

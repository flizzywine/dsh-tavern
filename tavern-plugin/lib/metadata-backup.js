import path from 'node:path'
import {constants} from 'node:fs'
import {copyFile, mkdir, stat, lstat, readdir, rm} from 'node:fs/promises'

// Content-addressed media survives metadata publication in the blob store.
// Only explicitly named in-place replacements/deletions may preserve other bytes.
export async function metadataFiles(root, relative = '') {
  const files = []
  for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
    const file = path.posix.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw Error('Linked metadata input: ' + file)
    if (entry.isDirectory()) {
      if (!['media','blobs'].includes(entry.name)) files.push(...await metadataFiles(root, file))
    } else if (entry.name.endsWith('.json')) files.push(file)
  }
  return files
}

export async function copyMetadataTree(source, destination) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw Error('Linked metadata input: ' + source)
  if (info.isDirectory()) return copyBackupFiles(source, destination, await metadataFiles(source))
  if (!source.endsWith('.json')) throw Error('Non-metadata backup requires an explicit destructive-file declaration: ' + source)
  await mkdir(path.dirname(destination), {recursive:true})
  await copyFile(source, destination, constants.COPYFILE_EXCL)
  return {files:1, bytes:info.size}
}

export async function removeMetadataTree(root) {
  for (const file of await metadataFiles(root)) await rm(path.join(root, file))
}

export function backupFiles(files, destructiveFiles = []) {
  return [...new Set([...files.filter(file => file.endsWith('.json')), ...destructiveFiles])]
}

export async function copyBackupFiles(source, destination, files, {destructiveFiles = [], reuse = false} = {}) {
  const root = path.resolve(source), target = path.resolve(destination)
  const metrics = {files:0, bytes:0}
  for (const file of backupFiles(files, destructiveFiles)) {
    const from = path.resolve(root, file), to = path.resolve(target, file)
    if (!from.startsWith(root + path.sep) || !to.startsWith(target + path.sep)) throw Error('Unsafe backup path: ' + file)
    await mkdir(path.dirname(to), {recursive:true})
    try { await copyFile(from, to, constants.COPYFILE_EXCL) }
    catch (error) { if (reuse && error.code === 'EEXIST') continue; throw error }
    metrics.files++
    metrics.bytes += (await stat(to)).size
  }
  return metrics
}

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, lstat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

export async function readJson(file, fallback) {
  try { return JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')) }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error }
}

/** Refuse linked parents before writes to generated rule paths. */
export async function safeDirectory(root, directory) {
  const base = resolve(root), target = resolve(directory)
  if (target !== base && !target.startsWith(base + sep)) throw new Error('工作台数据路径越界')
  const parts = target.slice(base.length).split(sep).filter(Boolean)
  let current = base
  for (const part of ['', ...parts]) {
    if (part) current = resolve(current, part)
    await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error })
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('工作台数据目录不能是链接')
  }
}

export async function atomicWrite(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temp = file + '.tmp-' + randomUUID()
  try { await writeFile(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); await rename(temp, file) }
  finally { await rm(temp, { force: true }) }
}

export function serialQueue() {
  let queue = Promise.resolve()
  return work => { const run = queue.catch(() => {}).then(work); queue = run; return run }
}

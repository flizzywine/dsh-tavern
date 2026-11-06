import { mkdir, writeFile, link, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Script } from 'node:vm'
import path from 'node:path'
const MAX_BYTES = 8 * 1024 * 1024

export function validateRuntimeImport({ name, base64, consent } = {}, { names, markers, label }) {
  if (consent !== true) throw new Error('请先确认持有有效许可并同意 ' + label + ' 许可条款')
  if (!names.includes(name)) throw new Error('请选择 ' + names.join(' 或 ') + '，不支持归档或路径')
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_BYTES / 3) * 4 || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('运行库文件编码无效或超过 8 MiB')
  const body = Buffer.from(base64, 'base64')
  if (body.length > MAX_BYTES || body.toString('base64') !== base64) throw new Error('运行库文件编码无效或超过 8 MiB')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    // Parse only: never evaluate user JavaScript in the host.
    new Script(text)
  } catch { throw new Error('运行库必须是有效的 UTF-8 JavaScript 文件') }
  if (!markers.every(token => text.includes(token))) throw new Error('文件不是预期的 ' + label + ' 运行库；请从指定发布者获取')
  return body
}

export async function publishRuntimeFile(target, body) {
  const directory = path.dirname(target)
  await mkdir(directory, { recursive: true })
  const temporary = path.join(directory, '.core-' + randomUUID() + '.tmp')
  try {
    await writeFile(temporary, body, { flag: 'wx' })
    // Publish atomically without replacing an existing owner installation.
    try { await link(temporary, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

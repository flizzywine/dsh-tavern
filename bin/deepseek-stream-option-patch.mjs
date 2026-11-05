import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patchDeepSeekStreamSource } from '../tavern-plugin/lib/domain/deepseek-stream-option.js'

export { patchDeepSeekStreamSource }

/** true when written, false when already installed, null when this host shape is unknown. */
export function patchDeepSeekStreamOption(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-llm-deepseek') throw new Error('流式设置补丁仅适用于 dsh-llm-deepseek')
  const file = path.join(directory, 'lib', 'index.js')
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchDeepSeekStreamSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(file, result.text)
  return true
}

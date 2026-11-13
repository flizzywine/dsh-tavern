import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patchReasoningChatSource } from '../tavern-plugin/lib/domain/chat-reasoning-fold.js'

export { patchReasoningChatSource }

/**
 * Patch the host chat client in place so a reasoning row follows the stream:
 * true when written, false when already patched, null when this DSH's chat view
 * no longer has the shape (left untouched).
 */
export function patchChatReasoningFold(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-chat') throw new Error('思维链补丁仅适用于 dsh-client-ui-chat')
  const file = path.join(directory, 'lib', 'client.js')
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchReasoningChatSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(file, result.text)
  return true
}

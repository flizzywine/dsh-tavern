import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { patchToolReplyStreamChatSource } from '../tavern-plugin/lib/domain/chat-tool-reply-stream.js'

export { patchToolReplyStreamChatSource }

export function patchChatToolReplyStream(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-chat') throw new Error('工具流式预览补丁仅适用于 dsh-client-ui-chat')
  const file = path.join(directory, 'lib', 'client.js')
  let before
  try { before = readFileSync(file, 'utf8') } catch { return null }
  const result = patchToolReplyStreamChatSource(before)
  if (result.status === 'unmatched') return null
  if (result.status === 'patched') return false
  writeFileSync(file, result.text)
  return true
}

import assert from 'node:assert/strict'
import { readdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { prepareExpandedPatch } from '../../tavern-plugin/lib/domain/host-session-patch.js'
import { encodeCurrentGeneration, parseSessionLog } from '../../tavern-plugin/lib/domain/session-log-codec.js'
import { restoreSessionLog } from '../../tavern-plugin/lib/domain/session-upgrade.js'

// Construct a released-v3 input from the isolated generated game while its host
// is stopped. Real startup must upgrade the physical file; no RPC is mocked.
export async function installV3SaveFixture({ sessionsRoot, sessionId, runtime }) {
  const patch = await prepareExpandedPatch(join(runtime, 'lib'))
  try {
    for (const relative of await readdir(sessionsRoot, { recursive: true })) {
      if (!relative.endsWith('session.v4.jsonl.zstd')) continue
      const file = join(sessionsRoot, relative)
      const parsed = parseSessionLog(await readFile(file))
      if (parsed.header.id !== sessionId) continue
      const artifact = restoreSessionLog(parsed, patch.catalog)
      const rewrite = value => {
        if (Array.isArray(value)) return value.map(rewrite)
        if (!value || typeof value !== 'object') return value
        const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewrite(child)]))
        if (typeof result.role !== 'string' || !result.source || !Array.isArray(result.content)) return result
        const kind = result.source.kind
        const producer = kind === 'system-prompt' || kind === 'runtime-context' ? '@deepseek-ai/dsh-system-prompt'
          : kind === 'compact-checkpoint' ? 'compact' : kind.startsWith('plugin:') ? kind.slice(7)
          : kind.startsWith('@deepseek-ai/') ? kind : null
        if (producer) result.source = { ...result.source, kind: 'plugin', plugin: producer }
        if (result.role === 'tool') {
          result.role = 'user'
          result.content = [{ type: 'tool-result', toolCallId: result.toolCallId, content: result.content,
            ...(result.isError === undefined ? {} : { isError: result.isError }) }]
          delete result.toolCallId; delete result.isError
        }
        return result
      }
      const legacy = { ...artifact, header: { ...artifact.header, version: 3 }, events: artifact.events.map(rewrite) }
      for (const event of legacy.events) if (event.type === 'subagent/catalog') event.ignorable = true
      const bytes = encodeCurrentGeneration(legacy, patch.migration.historicalSessionFormatCatalog)
      const oldFile = join(dirname(file), 'session.v3.jsonl.zstd')
      await writeFile(oldFile, bytes)
      await rm(file)
      return { oldFile, bytes, newFile: file }
    }
    assert.fail('找不到本次临时游戏的原生会话日志')
  } finally { patch.dispose() }
}

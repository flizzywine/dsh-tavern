#!/usr/bin/env node
// Export a session log's structure for an upgrade bug report, without the story:
//   node bin/redact-session-log.mjs <session.v3.jsonl.zstd> > session-structure.jsonl
// Players use 「导出诊断文件」 in the conversation menu; this is the same redaction for one file.
import { readFile } from 'node:fs/promises'
import { parseSessionLog } from '../tavern-plugin/lib/domain/session-log-codec.js'
import { redactSessionLog } from '../tavern-plugin/lib/domain/session-diagnostics.js'

const file = process.argv[2]
if (!file) {
  console.error('用法：node bin/redact-session-log.mjs <session.v3.jsonl.zstd 或 session.jsonl> > session-structure.jsonl')
  process.exit(1)
}
const { header, events } = redactSessionLog(parseSessionLog(await readFile(file)))
process.stdout.write(JSON.stringify(header) + '\n')
for (const event of events) process.stdout.write(JSON.stringify(event) + '\n')

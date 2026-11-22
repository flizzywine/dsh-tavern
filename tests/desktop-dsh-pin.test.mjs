import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveDshInvocation } from '../bin/launcher-environment.mjs'

test('桌面宿主 start：固定入口已带 --expose-internals 时，Windows 不再补一遍入口（#254）', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
  const start = source.slice(source.indexOf('export async function startService('))
  const block = start.slice(start.indexOf('const invocation = resolveDshInvocation('), start.indexOf('mkdirSync(LOG_DIR'))
  assert.match(block, /const pinned = invocation\.args\[0\] === '--expose-internals'/)
  assert.match(block, /if \(process\.platform === 'win32' && !pinned\)/, 'only an unpinned command gets its entry added')
})

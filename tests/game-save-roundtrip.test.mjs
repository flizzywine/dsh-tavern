import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

test('真实插件 RPC 往返保留插图和世界书引用，并拒绝混合版本导出', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-save-rpc-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/game-save-roundtrip.mjs', import.meta.url))], {
      env: { ...process.env, DSH_HOME: root }, encoding: 'utf8', timeout: 20000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /real RPC roundtrip passed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

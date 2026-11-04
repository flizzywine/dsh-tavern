import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
test('real browser plays six-seat game through host RPC, DSH agents and durable saves', { timeout: 120000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'werewolf-browser-'))
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/werewolf-browser.mjs', import.meta.url))], { env: { ...process.env, DSH_HOME: root }, encoding: 'utf8', timeout: 110000, windowsHide: true })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /werewolf browser completed/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernCompatibilityDiagnosticStore } from "../tavern-plugin/lib/domain/tavern-compatibility-diagnostics.js"
import { createMvuDiagnosticStore, createMvuDiagnosticExport } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'

test('记录落盘回读、去重、容量限制、Session 隔离与日志包导出', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tavern-compatibility-'))
  try {
    const storage = createProfileDataStore({ dataRoot: directory })
    const store = createTavernCompatibilityDiagnosticStore(storage, { maxRecords: 3 })
    const call = { scriptId: 'a', scriptName: '测试脚本', capabilityId: 'SillyTavern.hideLoader', count: 10, argumentTypes: ['string', 'PRIVATE_CHAT'], args: ['PRIVATE_CHAT'], stack: 'PRIVATE_CHAT' }
    await store.record('s1', 'r1', [call])
    await store.record('s1', 'r1', [{ ...call, count: 2 }])
    await store.record('s1', 'r1', [call])
    let saved = await createTavernCompatibilityDiagnosticStore(createProfileDataStore({ dataRoot: directory })).read('s1')
    assert.equal(saved.records.length, 1)
    assert.equal(saved.records[0].count, 10)
    assert.equal(saved.records[0].result, 'noop')
    assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_CHAT/)
    assert.equal((await store.read('s2')).records.length, 0)
    await store.record('s1', 'r1', [{ ...call, capabilityId: 'TavernHelper.getPreset', result: 'noop' }, { ...call, capabilityId: 'SillyTavern.registerMacro', result: 'noop' }])
    saved = await store.read('s1')
    assert.equal(saved.records[1].operation, 'lookup')
    assert.equal(saved.records[1].result, 'unavailable')
    assert.equal(saved.records[2].result, 'rejected')
    const exported = await createMvuDiagnosticExport({ sessionId: 's1', store: createMvuDiagnosticStore(storage), compatibilityDiagnostics: saved })
    assert.match(exported.buffer.toString(), /compatibility\/missing-capabilities.json/)
    const archive = join(directory, 'diagnostics.zip')
    await writeFile(archive, exported.buffer)
    const unpacked = execFileSync('unzip', ['-p', archive, 'compatibility/missing-capabilities.json'], { encoding: 'utf8' })
    assert.match(unpacked, /runtime-current-script/)
    assert.doesNotMatch(unpacked, /PRIVATE_CHAT/)
    await store.record('s1', 'r2', [call, { ...call, capabilityId: 'PRIVATE_CHAT' }])
    saved = await store.read('s1')
    assert.equal(saved.records.length, 3)
    assert.equal(saved.dropped, 1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

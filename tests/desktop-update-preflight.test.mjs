import assert from 'node:assert/strict'
import test from 'node:test'

import { findStandaloneDesktopService } from '../bin/desktop-update-preflight.mjs'

const sourceRoot = String.raw`C:\Users\fixture\.dsh\apps\dsh-tavern`
const executable = String.raw`C:\Program Files\DeepSeek Harness\DeepSeek Harness.exe`
const bootstrap = String.raw`C:\Program Files\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js`
const record = { pid: 20260, source: sourceRoot, profile: 'tavern', port: 3087, bindHost: '127.0.0.1',
  startedAt: '2026-11-22T09:37:08.526Z' }
const command = `"${executable}" --expose-internals "${bootstrap}" --profile tavern --host 127.0.0.1 --port 3087 --no-open`
const live = { pid: record.pid, command, created: '2026-11-22T09:37:08.5000000Z' }
function probe(saved, row, run = async (exe, args) => {
  assert.equal(exe, 'powershell.exe')
  assert.match(args.at(-1), /-Filter 'ProcessId = 20260'/)
  return { stdout: JSON.stringify(row) }
}) {
  return findStandaloneDesktopService({ dshHome: 'fixture', sourceRoot, executable, bootstrapFor: () => bootstrap,
    read: async () => JSON.stringify(saved), exec: run })
}

test('recognizes a freshly correlated official standalone process on its recorded port', async () => {
  assert.deepEqual(await probe({ ...record, source: sourceRoot.toUpperCase() }, live), { pid: record.pid })
  const bindHost = '192.168.1.8'
  assert.deepEqual(await probe({ ...record, bindHost },
    { ...live, command: command.replace('127.0.0.1', bindHost) + ' --trusted-host 192.168.1.8:3087' }), { pid: record.pid })
})

test('no record, no live process, or incomplete information leaves the final guard in charge', async () => {
  let queries = 0
  assert.equal(await probe(null, null, () => { queries++; return { stdout: '{}' } }), null)
  assert.equal(queries, 0)
  assert.equal(await probe(record, null), null)
  assert.equal(await probe(record, live, async () => { throw new Error('unavailable') }), null)
  for (const row of [
    { ...live, command: null }, { ...live, created: null }, { ...live, created: '2026-11-22T09:37:06.500Z' },
    { ...live, created: '2026-11-22T09:37:08.600Z' }, { ...live, pid: 20261 },
  ]) assert.equal(await probe(record, row), null)
})

test('rejects an unrelated or ambiguous process even at the same PID', async () => {
  for (const candidate of [
    `"${executable}" --remote-debugging-port=9222`,
    command.replace('DeepSeek Harness.exe', 'other.exe'), command.replace('lib\\cli.js', 'lib\\index.js'),
    command.replace('--profile tavern', '--profile desktop'), command.replace('--port 3087', '--port 3081'),
    command + ' --extra', command.replace('--no-open', '"unexpected"junk --no-open'),
  ]) assert.equal(await probe(record, { ...live, command: candidate }), null, candidate)
  assert.equal(await probe({ ...record, source: 'D:\\another-install' }, live), null)
  assert.equal(await probe({ ...record, profile: 'desktop' }, live), null)
})

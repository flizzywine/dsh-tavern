import test from 'node:test'
import assert from 'node:assert/strict'
import { assertInstallationIdle, installationProcessInventory } from '../tavern-plugin/packages/dsh-tavern/lib/installation-processes.mjs'
const request = { home: '/home/me/.dsh', installation: { appDir: '/home/me/.dsh/apps/dsh-tavern', entries: [{ from: '/home/me/.dsh/profile-data/tavern', to: '/mnt/tavern/data' }] } }
const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) }
const row = (pid, commandLine, name = 'node') => ({ pid, commandLine, name })
const options = rows => ({ selfPid: 10, platform: 'linux', read: missing, cwd: () => '/unrelated', inventory: async () => ({ rows }) })

test('independent Tavern runtime, relocated paths, shared home and Desktop GUI block without killing', async () => {
  for (const process of [row(20, 'node /home/me/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs'), row(20, 'node server.js --data /mnt/tavern/data'), row(20, 'node service.js --home /home/me/.dsh'), row(20, '"/opt/DeepSeek Harness" --expose-internals', 'DeepSeek Harness'), row(20, 'dsh web --profile tavern', 'dsh')]) {
    await assert.rejects(assertInstallationIdle(request, options([row(10, 'node worker.mjs'), process])), /未结束任何进程/)
  }
})
test('live or ambiguous service PID refuses; stale service PID is harmless', async () => {
  const base = options([row(10, 'node worker.mjs')])
  await assert.rejects(assertInstallationIdle(request, { ...base, read: () => '{"pid":90}', alive: () => true }), /PID 90/)
  assert.deepEqual(await assertInstallationIdle(request, { ...base, read: () => '{"pid":90}', alive: () => false }), { idle: true })
  for (const content of ['bad json', '{}', '{"pid":0}']) await assert.rejects(assertInstallationIdle(request, { ...base, read: () => content }), /无法确认/)
})
test('inventory errors, malformed snapshots and hidden runtime arguments fail closed', async () => {
  const base = options([row(10, 'node worker.mjs')])
  for (const inventory of [async () => { throw Error('CIM denied') }, async () => ({}), async () => ({ rows: [] }), async () => ({ rows: [{ pid: '20' }] }), async () => ({ rows: [row(20, null)] })]) {
    await assert.rejects(assertInstallationIdle(request, { ...base, inventory }), /清单|参数/)
  }
})
test('inventory adapters use bounded read-only ps/CIM and parse PID-aware output', async () => {
  const calls = []
  const run = async (...args) => { calls.push(args); return { stdout: ' 10 node worker.mjs\n 20 node service.mjs\n' } }
  assert.equal((await installationProcessInventory({ platform: 'linux', run })).rows.length, 2)
  assert.deepEqual(calls[0][1], ['-axo', 'pid=,args='])
  const win = await installationProcessInventory({ platform: 'win32', run: async (exe, args) => {
    assert.equal(exe, 'powershell.exe'); assert.match(args.at(-1), /Get-CimInstance/); assert.doesNotMatch(args.at(-1), /Stop-Process|TerminateProcess/)
    return { stdout: '{"inspectorPid":99,"rows":[{"pid":10,"name":"node.exe","commandLine":"node worker"}]}' }
  } })
  assert.equal(win.inspectorPid, 99)
})

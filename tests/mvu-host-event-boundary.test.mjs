import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

test('宿主 MVU 连续事件分别等待自己的处理，不返回上轮 throttle Promise', async () => {
  const root = new URL('../tavern-plugin/lib/vendor/magvarupdate/', import.meta.url)
  const dir = await mkdtemp(join(tmpdir(), 'mvu-event-test-'))
  try {
    await cp(new URL('upstream/', root), dir, { recursive: true })
    execFileSync(process.execPath, [fileURLToPath(new URL('host-build/prepare-host-build.mjs', root)), join(dir, 'webpack.config.ts')])
    const source = await readFile(join(dir, 'src/function/update/index.ts'), 'utf8')
    const expression = source.match(/tavern_events.MESSAGE_RECEIVED,\s*([^\n]+)/)[1]
    const context = vm.createContext({ setTimeout, clearTimeout })
    vm.runInContext(await readFile(new URL('../runtime-assets/lodash/lodash.min.js', root), 'utf8'), context)
    const seen = []
    context.is_jest_environment = false
    context.onMessageReceived = async id => { await Promise.resolve(); seen.push(id) }
    const handler = vm.runInContext(expression, context)
    try {
      await handler(1)
      await handler(2)
      assert.deepEqual(seen, [1, 2])
    } finally { handler.cancel?.() }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('host MVU uses the current complete snapshot when earlier floors have no MVU data', async () => {
  const root = new URL('../tavern-plugin/lib/vendor/magvarupdate/', import.meta.url)
  const dir = await mkdtemp(join(tmpdir(), 'mvu-baseline-test-'))
  try {
    await cp(new URL('upstream/', root), dir, { recursive: true })
    execFileSync(process.execPath, [fileURLToPath(new URL('host-build/prepare-host-build.mjs', root)), join(dir, 'webpack.config.ts')])
    const source = await readFile(join(dir, 'src/function/update_variables.ts'), 'utf8')
    const expression = source.slice(source.indexOf('export async function handleVariablesInMessage')).match(/const variables = ([\s\S]*?);\n    const settings/)[1]
    const current = { stat_data: { hp: 10 }, schema: { type: 'object' } }
    const evaluate = previous => vm.runInNewContext(expression, {
      request_message_id: 2, message_id: 2, getLastValidVariable: () => previous,
      getVariables: () => structuredClone(current), _: { has: (object, key) => Object.hasOwn(object, key) }
    })
    const recovered = evaluate(undefined)
    assert.ok(recovered, 'current-floor snapshot must reach the MVU updater')
    assert.deepEqual(JSON.parse(JSON.stringify(recovered)), current)
    const previous = { stat_data: { hp: 8 }, schema: { type: 'object' } }
    assert.equal(evaluate(previous), previous, 'existing prior-floor semantics must stay intact')
    delete current.schema
    assert.equal(evaluate(undefined), undefined, 'an incomplete snapshot is not a valid baseline')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

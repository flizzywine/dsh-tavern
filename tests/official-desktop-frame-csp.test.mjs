import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from './fixtures/client-vm.mjs'
import test from 'node:test'

let descriptor
vm.runInNewContext(await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { descriptor = value } } }, console
})
const client = descriptor.factory(() => ({}))

for (const [name, build] of [
  ['message', () => client.buildTavernFrameDocument({ token: 'desktop', content: '', helperContext: {} })],
  ['helper', () => client.buildTavernHelperScriptDocument({ token: 'desktop', scripts: [], context: {} })],
  ['preview', () => client.buildOpeningPreviewDocument('<p>preview</p>')],
]) test(`official desktop: ${name} CSP permits local runtime assets without allowing other desktop endpoints`, () => {
  const html = build()
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1]
  const directives = new Map(policy.split(';').map(part => {
    const [name, ...sources] = part.trim().split(/\s+/)
    return [name, sources]
  }))
  for (const kind of ['script', 'style', 'connect', 'img', 'font']) {
    const sources = directives.get(`${kind}-src`) || directives.get('default-src')
    assert.ok(sources.includes('dsh-app://app/api/dsh-tavern/'), `${kind}: desktop asset blocked by ${policy}`)
    assert.ok(!sources.includes('dsh-app:') && !sources.includes('dsh-app://app'), 'do not allow all desktop endpoints')
  }
  assert.ok(!directives.get('form-action').some(source => source.startsWith('dsh-app:')))
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

// The installed package is what frozen-lockfile installation produces from patches/dsh-better-sidebar@0.28.0.patch.
const installed = path.dirname(createRequire(import.meta.url).resolve('dsh-better-sidebar/package.json'))
const clients = ['client.js', 'client-registry.js']
const rule = 'const title = descriptor?.single === true ? titleOf(descriptor) : record?.tab.title ?? nativeTab.title;'

for (const file of clients) {
  test(`open single-panel tabs read their title from the panel registry (${file})`, async () => {
    const source = await readFile(path.join(installed, 'lib', file), 'utf8')
    const adapter = source.indexOf('const nativeTab = info.tab;')
    assert.ok(adapter > 0)
    const block = source.slice(adapter, source.indexOf('const path = ', adapter))
    // A renamed panel must not keep the title its tab record stored when it was opened.
    assert.ok(block.includes(rule), block)
    assert.ok(block.indexOf('const descriptor = ') < block.indexOf(rule))
  })
}

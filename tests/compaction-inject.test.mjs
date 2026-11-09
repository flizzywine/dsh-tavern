// scan every shipped fork host plugin, including helpers that borrow ctx.
// Domain helpers do not register Cordis plugins; check their actual context owner.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const customTags = [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }]
import { inject as relayInject } from '../tavern-plugin/lib/agent-compaction.js'

const root = new URL('../tavern-plugin/', import.meta.url)
async function* sources(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.legacy-node_modules-')) continue
    if (['node_modules', 'vendor', 'tests', 'src'].includes(entry.name)) continue
    const relative = prefix + entry.name, url = new URL(entry.name, dir)
    // Host bundles combine multiple Cordis owners; audit their original sources instead.
    if (entry.isDirectory() && relative.endsWith('lib/host')) continue
    if (entry.isDirectory()) yield* sources(new URL(entry.name + '/', dir), relative + '/')
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name) && entry.name !== 'client.js') yield [relative, await readFile(url, 'utf8')]
  }
}

test('all fork tokenMeter accessors and their ctx service dependencies have owner inject declarations', async () => {
  const patch = parse(await readFile(new URL('cordis.patch.yml', root), 'utf8'), { customTags })
  const mainInject = patch.flatMap(item => item.insert || []).find(item => item.id === 'dsh-tavern')?.inject
  assert.ok(mainInject?.includes('tokenMeter'), 'main plugin manifest injects its stream adapter meter')
  const owners = new Map([
    ['lib/agent-compaction.js', relayInject],
    ['lib/domain/whole-turn-maintenance.js', relayInject],
    ['lib/domain/bounded-compaction.js', mainInject]
  ])
  const seen = []
  for await (const [file, source] of sources(root)) {
    if (!/\bctx(?:\.|\?\.)tokenMeter\b|\bctx\[['"]tokenMeter['"]\]/.test(source)) continue
    seen.push(file)
    const declared = owners.get(file)
    assert.ok(declared, `${file}: new tokenMeter accessor must identify its Cordis context owner`)
    // Verify the other services consumed alongside tokenMeter too, not just its name.
    const services = [...source.matchAll(/\bctx\.(\w+)/g)].map(match => match[1]).filter(name => !['get', 'on', 'logger'].includes(name))
    for (const service of services) assert.ok(declared.includes(service), `${file}: ctx.${service} without owner inject`)
  }
  assert.deepEqual(seen.sort(), [...owners.keys()].sort(), 'no adapter is silently omitted from the scan')
})

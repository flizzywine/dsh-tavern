// Isolated measurement of production Helper projection/diff/apply; no user data or model calls.
// node tests/fixtures/mvu-context-performance.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import vm from './client-vm.mjs'
import { chromium } from 'playwright'
const projectionSource = (await readFile(new URL('../../tavern-plugin/lib/domain/tavern-helper-context.js', import.meta.url), 'utf8')).split('/** Append Helper-owned')[0].replace(/^import .*$/mg, '').replaceAll('export function', 'function')
let descriptor
vm.runInNewContext(await readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: value => { descriptor = value } } } })
const client = descriptor.factory(() => ({}))
const browser = await chromium.launch({ headless: true })
const rows = []
try {
  const page = await browser.newPage()
  await page.evaluate(({ create, apply, projection }) => {
    (0, eval)(projection + ";window.projectContext = projectTavernHelperContext")
    window.createUpdate = (0, eval)('(' + create + ')')
    window.applyUpdate = (0, eval)('(' + apply + ')')
  }, { create: client.createTavernHelperContextUpdate.toString(), apply: client.applyTavernHelperContextUpdate.toString(), projection: projectionSource })
  for (const rounds of [20, 80, 200]) for (const stateKiB of [0, 4, 16, 64, 256]) {
    console.error(`measure rounds=${rounds} stateKiB=${stateKiB}`)
    const result = await page.evaluate(({ rounds, stateKiB }) => {
      const state = { stat_data: { fixture: '测'.repeat(Math.floor(stateKiB * 1024 / 3)) } }
      const chat = { id: 'synthetic', _storageRevision: 1, messages: Array.from({ length: rounds * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: '虚构正文。'.repeat(200), variables: stateKiB && i % 2 ? [state] : [] })) }
      const context = window.projectContext(chat)
      const wireStart = performance.now();
      const wire = JSON.stringify(context);
      const encodeMs = performance.now() - wireStart;
      const decodeStart = performance.now();
      const next = JSON.parse(wire);
      const decodeMs = performance.now() - decodeStart;
      next.stateRevision++
      next.messages.at(-1).variables.probe = 1
      const samples = []
      for (let i = 0; i < 4; i++) {
        const start = performance.now()
        const update = window.createUpdate(context, next, rounds, rounds)
        const middle = performance.now()
        const applied = window.applyUpdate(context, update)
        const end = performance.now()
        if (applied.context.messages.at(-1).variables.probe !== 1) throw Error('incorrect update')
        samples.push({ diffMs: middle - start, applyMs: end - middle })
      }
      return { encodeMs, decodeMs, samples: samples.slice(1), contextMiB: new TextEncoder().encode(JSON.stringify(context)).length / 1048576 }
    }, { rounds, stateKiB })
    const median = key => +result.samples.map(x => x[key]).sort((a,b) => a-b)[1].toFixed(1)
    rows.push({ rounds, stateKiB, contextMiB: +result.contextMiB.toFixed(2), diffMs: median('diffMs'), applyMs: median('applyMs'), encodeMs: +result.encodeMs.toFixed(1), decodeMs: +result.decodeMs.toFixed(1) })
  }
} finally { await browser.close() }
await mkdir(new URL('../../output/mvu-performance/', import.meta.url), { recursive: true })
await writeFile(new URL('../../output/mvu-performance/browser.json', import.meta.url), JSON.stringify(rows, null, 2))
console.log(JSON.stringify(rows, null, 2))

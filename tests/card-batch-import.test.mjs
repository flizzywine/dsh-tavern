import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('async function importCardFiles(')
const body = source.slice(start, source.indexOf('async function renameCard()', start))
function setup() {
  const state = { status: '', error: '', calls: [], loads: [], refreshes: 0 }
  const importing = { current: false }
  const rpc = async (_, { payload }) => { state.calls.push(payload.name); if (payload.name === 'bad.json') throw new Error('invalid card'); return { card: { path: payload.name } } }
  const parseCardFile = async file => file
  const run = new Function('busy', 'importing', 'setBusy', 'setError', 'setImportStatus', 'rpc', 'parseCardFile', 'notifyTavernDataChanged', 'refreshCards', 'loadCard',
    'importTavernCardFile', 'tavernCardAssetNotice', 'forkCardZip', 'setTransferStatus', body + '; return importCardFiles;')(
    false, importing, value => { state.busy = value }, value => { state.error = value }, value => { state.status = value },
    rpc, parseCardFile, () => {}, async () => { state.refreshes++ }, async path => { state.loads.push(path) },
    async (file, call) => call('importCard', { payload: await parseCardFile(file) }), () => '',
    null, value => { state.transferStatus = value }) // no asset library: card ZIPs are not routed to its import sheet here
  return { state, run, importing }
}

test('single import still opens the imported card; cancelling picker does nothing', async () => {
  const { state, run } = setup()
  await run([])
  assert.equal(state.refreshes, 0)
  await run([{ name: 'a.png' }])
  assert.deepEqual(state.loads, ['a.png'])
  assert.equal(state.transferStatus, '')
})

test('导入文件分流：PNG、JSON 在页面里解析；CHARX、DSH 人物卡和其他扩展名（插件导入器）整份上传', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function importTavernCardFile(')
  const body = source.slice(start, source.indexOf('/** What a card file brought', start))
  const uploads = []
  const fetch = async (_url, { body: file }) => { uploads.push(file.name); return { ok: true, status: 200, json: async () => ({ ok: true, uploadId: 'u' }) } }
  const importFile = new Function('fetch', 'parseCardFile', 'importTavernPasswordCard', 'beginTavernCardImportProgress', body + '; return importTavernCardFile;')(fetch, async file => ({ parsed: file.name }), run => run(undefined), () => ({ update() {}, close() {} }))
  const calls = []
  const call = async (method, args) => { calls.push([method, args.name || args.payload?.parsed]); return {} }
  // Ordinary PNG and JSON are parsed; native packages upload whole.
  const file = (name, bytes = new Uint8Array(64)) => ({ name, size: bytes.length, slice: start => ({ arrayBuffer: async () => bytes.slice(start).buffer }) })
  await assert.rejects(importFile(file('unsupported.dshcard' + '.png'), call), /卡包请使用/);
  const stages = []
  for (const item of [file('a.png'), file('b.JSON'), file('c.charx'), file('d.dshcard'), file('e.vnpack'), file('noext')]) await importFile(item, call, phase => stages.push([item.name, phase]))
  assert.deepEqual(calls, [['importCard', 'a.png'], ['importCard', 'b.JSON'], ['importCardUpload', 'c.charx'], ['importCardUpload', 'd.dshcard'], ['importCardUpload', 'e.vnpack'], ['importCard', 'noext']])
  assert.deepEqual(uploads, ['c.charx', 'd.dshcard', 'e.vnpack'])
  assert.deepEqual(stages.filter(([name]) => name === 'd.dshcard').map(([, phase]) => phase), ['正在上传卡包…', '正在读取卡包并导入素材…'])
})

test('shared importer keeps its loading dialog open until the host finishes, including callers with no progress callback', async () => {
  const start = source.indexOf('async function importTavernCardFile(')
  const body = source.slice(start, source.indexOf('/** What a card file brought', start))
  let opened = 0, closed = 0, finish
  const host = new Promise(resolve => { finish = resolve })
  const importFile = new Function('fetch', 'importTavernPasswordCard', 'beginTavernCardImportProgress', body + '; return importTavernCardFile;')(
    async () => ({ json: async () => ({ ok: true, uploadId: 'u' }) }), run => run(undefined),
    () => { opened++; return { update() {}, close() { closed++ } } })
  const pending = importFile({ name: 'large.dshcard' }, () => host)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(opened, 1); assert.equal(closed, 0)
  finish({ card: { path: 'cards/large.json' } })
  await pending
  assert.equal(closed, 1)
  await assert.rejects(importFile({ name: 'broken.dshcard' }, async () => { throw new Error('invalid archive') }), /invalid archive/)
  assert.equal(opened, 2); assert.equal(closed, 2)
})

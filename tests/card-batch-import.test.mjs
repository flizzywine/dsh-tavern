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
    'importTavernCardFile', 'tavernCardAssetNotice', 'forkCardZip', body + '; return importCardFiles;')(
    false, importing, value => { state.busy = value }, value => { state.error = value }, value => { state.status = value },
    rpc, parseCardFile, () => {}, async () => { state.refreshes++ }, async path => { state.loads.push(path) },
    async (file, call) => call('importCard', { payload: await parseCardFile(file) }), () => '',
    null) // no asset library: card ZIPs are not routed to its import sheet here
  return { state, run, importing }
}

test('single import still opens the imported card; cancelling picker does nothing', async () => {
  const { state, run } = setup()
  await run([])
  assert.equal(state.refreshes, 0)
  await run([{ name: 'a.png' }])
  assert.deepEqual(state.loads, ['a.png'])
})

test('导入文件分流：PNG、JSON 在页面里解析；CHARX、DSH 人物卡、带封面的卡档案和其他扩展名（插件导入器）整份上传', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('async function importTavernCardFile(file, call)')
  const body = source.slice(start, source.indexOf('/** What a card file brought', start))
  const uploads = []
  const fetch = async (_url, { body: file }) => { uploads.push(file.name); return { ok: true, status: 200, json: async () => ({ ok: true, uploadId: 'u' }) } }
  const importFile = new Function('fetch', 'parseCardFile', body + '; return importTavernCardFile;')(fetch, async file => ({ parsed: file.name }))
  const calls = []
  const call = async (method, args) => { calls.push([method, args.name || args.payload?.parsed]); return {} }
  // A file whose bytes are given; a PNG ending in a ZIP end record (a cover PNG with a card archive behind it) uploads.
  const file = (name, bytes = new Uint8Array(64)) => ({ name, size: bytes.length, slice: start => ({ arrayBuffer: async () => bytes.slice(start).buffer }) })
  const withZipEnd = new Uint8Array(200); withZipEnd.set([0x50, 0x4b, 0x05, 0x06], 200 - 22)
  for (const item of [file('a.png'), file('b.JSON'), file('c.charx'), file('d.dshcard'), file('e.vnpack'), file('noext'), file('f.dshcard.png', withZipEnd)]) await importFile(item, call)
  assert.deepEqual(calls, [['importCard', 'a.png'], ['importCard', 'b.JSON'], ['importCardUpload', 'c.charx'], ['importCardUpload', 'd.dshcard'], ['importCardUpload', 'e.vnpack'], ['importCard', 'noext'], ['importCardUpload', 'f.dshcard.png']])
  assert.deepEqual(uploads, ['c.charx', 'd.dshcard', 'e.vnpack', 'f.dshcard.png'])
})

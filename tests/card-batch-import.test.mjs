import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('async function importCardFiles(')
const body = source.slice(start, source.indexOf('async function renameCard()', start))
const selectionStart = source.indexOf('async function importTavernCardSelection(')
const selection = source.slice(selectionStart, source.indexOf('// No file filter on card import', selectionStart))
function setup(cardZip = null) {
  const state = { status: '', error: '', calls: [], loads: [], refreshes: 0 }
  const importing = { current: false }
  const rpc = async (_, { payload }) => {
    state.calls.push(payload.name)
    if (payload.name === 'bad.json') throw new Error('invalid card')
    if (payload.name === 'cancel.dshcard') throw Object.assign(new Error('cancelled'), { code: 'TAVERN_CARD_IMPORT_CANCELLED' })
    return { card: { path: payload.name, name: payload.name, duplicate: payload.name === 'existing.json' } }
  }
  const run = new Function('busy', 'importing', 'setBusy', 'setError', 'setImportStatus', 'rpc', 'notifyTavernDataChanged', 'refreshCards', 'loadCard',
    'importTavernCardFile', 'tavernCardAssetNotice', 'forkCardZip', 'setTransferStatus', 'splitCardFiles', selection + body + '; return importCardFiles;')(
    false, importing, value => { state.busy = value }, value => { state.error = value }, value => { state.status = value },
    rpc, () => {}, async () => { state.refreshes++; state.error = '' }, async path => { state.loads.push(path) },
    async (file, call) => call('importCard', { payload: file }), () => '',
    cardZip, value => { state.transferStatus = value },
    async files => ({ cards: files.filter(file => !file.name.endsWith('.zip')), zips: files.filter(file => file.name.endsWith('.zip')) }))
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

test('batch continues after failure and cancelled password, then refreshes once without opening a card', async () => {
  const { state, run } = setup()
  const names = ['bad.json', 'cancel.dshcard', 'existing.json', 'new.json']
  await run(names.map(name => ({ name })))
  assert.deepEqual(state.calls, names)
  assert.equal(state.refreshes, 1)
  assert.deepEqual(state.loads, [])
  assert.equal(state.error, 'bad.json：invalid card')
  assert.match(state.status, /已导入 1 张，1 张已在卡库中，1 个文件失败/)
  assert.match(state.status, /cancel\.dshcard：已取消/)
})

test('mixed selection imports cards and opens one interactive ZIP sheet', async () => {
  const opened = []
  const { state, run } = setup({ openFile: async file => { opened.push(file.name) } })
  await run(['one.zip', 'card.json', 'two.zip'].map(name => ({ name })))
  assert.deepEqual(state.calls, ['card.json'])
  assert.deepEqual(opened, ['one.zip'])
  assert.match(state.status, /其余 1 个请单独选择/)
})

// importTavernCardFile and the helpers after it, run with the page's globals given.
function importer(globals) {
  const start = source.indexOf('async function importTavernCardFile(')
  const body = source.slice(start, source.indexOf('/** What a card file brought', start))
  const names = Object.keys(globals)
  return new Function(...names, body + '; return importTavernCardFile;')(...names.map(name => globals[name]))
}
const page = (extra = {}) => ({
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, uploadId: 'u' }) }),
  importTavernPasswordCard: run => run(undefined), beginTavernCardImportProgress: () => ({ update() {}, close() {} }), askTavernCardPassword: async () => null,
  askTavernCardPackWay: async () => assert.fail('no pack to decide about'), tavernCardPackDecisions: (packs, way) => Object.fromEntries(packs.map(pack => [pack.packId, way])), ...extra,
})

test('所有人物卡原样上传，CHARX 和 DSH 人物卡先预览素材包', async () => {
  const uploads = []
  const importFile = importer(page({ fetch: async (_url, { body: file }) => { uploads.push(file.name); return { ok: true, status: 200, json: async () => ({ ok: true, uploadId: 'u' }) } } }))
  const calls = []
  const call = async (method, args) => { calls.push([method, args.name]); return method === 'previewCardUpload' ? { card: { name: 'x', version: '' }, packs: [] } : {} }
  await assert.rejects(importFile({ name: 'unsupported.dshcard' + '.png' }, call), /卡包请使用/);
  const stages = []
  for (const item of ['a.png', 'b.JSON', 'c.charx', 'd.dshcard', 'e.vnpack', 'noext'].map(name => ({ name }))) await importFile(item, call, phase => stages.push([item.name, phase]))
  assert.deepEqual(calls, [['importCardUpload', 'a.png'], ['importCardUpload', 'b.JSON'], ['previewCardUpload', 'c.charx'], ['importCardUpload', 'c.charx'], ['previewCardUpload', 'd.dshcard'], ['importCardUpload', 'd.dshcard'], ['importCardUpload', 'e.vnpack'], ['importCardUpload', 'noext']])
  assert.deepEqual(uploads, ['a.png', 'b.JSON', 'c.charx', 'd.dshcard', 'e.vnpack', 'noext'])
  assert.deepEqual(stages.filter(([name]) => name === 'd.dshcard').map(([, phase]) => phase), ['正在上传卡包…', '正在读取卡包…', '正在导入素材…'])
})

test('浏览器分段发送超过 1 GiB 的卡包并把同一上传 ID 交给导入', async () => {
  const requests = [], calls = [], progress = []
  const file = { name: 'large.dshcard', size: 1024 ** 3 + 9, slice: (start, end) => ({ start, end }) }
  const importFile = importer(page({ fetch: async (endpoint, { body }) => {
    const { searchParams } = new URL(endpoint, 'http://tavern.test')
    assert.equal(searchParams.get('purpose'), 'card-archive')
    assert.equal(Number(searchParams.get('size')), file.size)
    assert.equal(Number(searchParams.get('offset')), body.start)
    assert.equal(searchParams.get('uploadId'), requests.length ? 'archive' : null)
    requests.push(body)
    return { status: 200, json: async () => ({ ok: true, uploadId: 'archive', size: body.end }) }
  } }))
  await importFile(file, async (method, { uploadId }) => {
    calls.push([method, uploadId])
    return { card: {}, packs: [] }
  }, phase => progress.push(phase))
  assert.equal(requests.length, 65)
  assert.deepEqual(requests.at(-1), { start: 1024 ** 3, end: file.size })
  assert.deepEqual(calls, [['previewCardUpload', 'archive'], ['importCardUpload', 'archive']])
  assert.ok(progress.includes('正在上传卡包… 100%'))
})

test('卡包分段上传失败时丢弃部分文件', async () => {
  const calls = []
  const file = { name: 'large.charx', size: 1024 ** 3 + 1, slice: (start, end) => ({ start, end }) }
  const importFile = importer(page({ fetch: async (_url, { body }) => {
    if (body.start) throw new Error('connection dropped')
    return { status: 200, json: async () => ({ ok: true, uploadId: 'archive', size: body.end }) }
  } }))
  await assert.rejects(importFile(file, async (method, args) => { calls.push([method, args.uploadId]) }), /connection dropped/)
  assert.deepEqual(calls, [['discardCardUpload', 'archive']])
})

test('a card carrying another version of an installed pack asks 完全替换 / 增量更新 first; 取消 discards the upload', async () => {
  const packs = [{ packId: 'p', title: '通用SE', choices: ['update', 'merge'], removed: [] }]
  let answer = 'merge'
  const importFile = importer(page({ askTavernCardPackWay: async (_file, staged) => { assert.deepEqual(staged.packs, packs); return answer } }))
  const calls = []
  const call = async (method, args) => { calls.push([method, args.packDecisions]); return method === 'previewCardUpload' ? { card: { name: 'k', version: '11-17' }, packs } : {} }
  await importFile({ name: 'k.dshcard' }, call)
  assert.deepEqual(calls, [['previewCardUpload', undefined], ['importCardUpload', { p: 'merge' }]])
  calls.length = 0; answer = null
  await assert.rejects(importFile({ name: 'k.dshcard' }, call), error => error.code === 'TAVERN_CARD_IMPORT_CANCELLED')
  assert.deepEqual(calls, [['previewCardUpload', undefined], ['discardCardUpload', undefined]])
})

test('an attached pack failure alone opens the import decision and only confirmation commits', async () => {
  const packNotices = ['素材包「通用环境音」未装入：雨声音频已损坏，请重新获取卡包']
  let answer = null
  const importFile = importer(page({ askTavernCardPackWay: async (_file, stage) => {
    assert.deepEqual(stage.packNotices, packNotices)
    return answer
  } }))
  const calls = [], file = { name: 'ambience.dshcard' }
  const call = async (method, args) => {
    calls.push([method, args])
    if (method === 'previewCardUpload') return { card: { name: '环境音卡' }, packs: [], packNotices }
    if (method === 'importCardUpload') return { card: { status: 'partial', libraryNotices: packNotices } }
  }
  await assert.rejects(importFile(file, call), { code: 'TAVERN_CARD_IMPORT_CANCELLED' })
  assert.deepEqual(calls.map(([method]) => method), ['previewCardUpload', 'discardCardUpload'])
  calls.length = 0; answer = 'update'
  const { card } = await importFile(file, call)
  assert.equal(card.status, 'partial')
  assert.equal(calls[1][1].acceptMissingPacks, true)
  assert.equal(calls[1][1].previewed, true)
})

test('shared importer keeps its loading dialog open until the host finishes, including callers with no progress callback', async () => {
  let opened = 0, closed = 0, finish
  const host = new Promise(resolve => { finish = resolve })
  const importFile = importer(page({ beginTavernCardImportProgress: () => { opened++; return { update() {}, close() { closed++ } } } }))
  const pending = importFile({ name: 'large.dshcard' }, method => method === 'previewCardUpload' ? { card: {}, packs: [] } : host)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(opened, 1); assert.equal(closed, 0)
  finish({ card: { path: 'cards/large.json' } })
  await pending
  assert.equal(closed, 1)
  await assert.rejects(importFile({ name: 'broken.dshcard' }, async method => { if (method === 'previewCardUpload') throw new Error('invalid archive') }), /invalid archive/)
  assert.equal(opened, 2); assert.equal(closed, 2)
})

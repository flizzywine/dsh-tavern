// A chat card frame's window.DshCardAssets.asset reads an image of the card's own bound packs, as a stage card page's
// DshCardPage.asset does: the shim asks the host (getCardAsset), the host locates it through the stage's one lookup
// (locateCardFrameAsset → locateCardPageAsset) and hands the thumbnail over as a Blob.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import clientVm from './fixtures/client-vm.mjs'
import {createCardPagesService} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/status-panel-service.js'
import {createStageHandlers} from '../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js'

const plain = value => JSON.parse(JSON.stringify(value)) // the frame code runs in its own realm
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const lifecycle = await read('../tavern-plugin/src/client/runtime/message-frame-lifecycle.js')
const frameAssets = lifecycle.slice(lifecycle.indexOf('function cardFrameAssetRef'), lifecycle.indexOf('const TAVERN_FRAME_MAX_HEIGHT'))

const PACKS = {
  bound: {manifest: {assets: [{kind: 'props', id: 'ta-agency-mug', media: 'mug-hash', enabled: true}]}},
  other: {manifest: {assets: [{kind: 'props', id: 'elsewhere', media: 'other-hash', enabled: true}]}}
}
const card = {spec: 'chara_card_v3', data: {name: '三角机构', extensions: {dsh_tavern: {assetBindings: {boundPackIds: ['bound']}}}}}

function host({dpr = 2, status = 200} = {}) {
  const cardPages = createCardPagesService({readWorkspace: async () => ({raw: card}), chatForSession: async () => ({cardPath: 'card'}),
    index: async () => ({messages: []}), packSnapshot: async packId => PACKS[packId] || null})
  const handlers = createStageHandlers({cardPages}), calls = [], fetched = []
  const context = {window: {devicePixelRatio: dpr},
    rpc: async (method, args) => { calls.push([method, args]); return handlers[method](args) },
    fetch: async (url, options) => { fetched.push([url, options]); return new Response(status === 200 ? 'image:' + url : 'no', {status}) }}
  vm.runInNewContext(frameAssets, context)
  return {context, calls, fetched}
}

test('a chat card frame gets an image of its card bound pack as a Blob, cut for size x devicePixelRatio', async () => {
  const h = host()
  const blob = await h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'ta-agency-mug', size: 256})
  assert.equal(await blob.text(), 'image:/api/dsh-asset-library/v2/thumbnail?v=2&packId=bound&hash=mug-hash&size=512')
  assert.deepEqual(plain(h.calls), [['locateCardFrameAsset', {sessionId: 'session', ref: {kind: 'props', id: 'ta-agency-mug'}, px: 512}]])
  assert.deepEqual(plain(h.fetched[0][1]), {credentials: 'same-origin'})
  // no size: 256 CSS px; beyond the largest thumbnail: the largest
  await h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'ta-agency-mug'})
  await h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'ta-agency-mug', size: 900})
  assert.deepEqual(h.fetched.slice(1).map(([url]) => url.slice(url.lastIndexOf('=') + 1)), ['512', '1024'])
})

test('another pack\'s image, a missing id or a malformed request rejects', async () => {
  const h = host()
  await assert.rejects(h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'elsewhere'}), /本卡的素材包里没有图片 props \/ elsewhere/)
  await assert.rejects(h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'nothing'}), /本卡的素材包里没有图片/)
  await assert.rejects(h.context.cardFrameAssetBlob('session', {kind: 'props'}), /DshCardAssets\.asset 需要/)
  await assert.rejects(h.context.cardFrameAssetBlob('session', {kind: 'props', id: 'ta-agency-mug', size: 'big'}), /DshCardAssets\.asset 需要/)
  assert.equal(h.fetched.length, 0)
  await assert.rejects(host({status: 404}).context.cardFrameAssetBlob('session', {kind: 'props', id: 'ta-agency-mug'}), /素材读取失败 404/)
})

test('the frame helper exposes DshCardAssets.asset: one host call per ref, a frame URL of the Blob, a failed ref asked again', async () => {
  const source = await read('../tavern-plugin/lib/client.js')
  let descriptor
  clientVm.runInNewContext(source, {window: {__ModuleLoader__: {load(d) { descriptor = d }}}})
  const client = descriptor.factory(() => ({}))
  const html = client.buildTavernFrameDocument({content: '<script>void 0</script>', token: 't', helperContext: {messages: []}})
  const shim = html.match(/var cardAssets=new Map\(\);window\.DshCardAssets=[\s\S]*?return cardAssets\.get\(key\);\}\};/)[0]
  const calls = []
  let fail = true
  const context = {window: {}, Map, JSON, URL: {createObjectURL: blob => 'blob:frame:' + blob},
    call: (method, args) => { calls.push([method, args]); return fail && args.id === 'flaky' ? Promise.reject(new Error('no')) : Promise.resolve(args.id) }}
  vm.runInNewContext(shim, context)
  const assets = context.window.DshCardAssets
  assert.equal(await assets.asset({kind: 'props', id: 'ta-agency-mug', size: 256}), 'blob:frame:ta-agency-mug')
  assert.equal(await assets.asset({kind: 'props', id: 'ta-agency-mug', size: 256}), 'blob:frame:ta-agency-mug')
  assert.deepEqual(plain(calls), [['getCardAsset', {kind: 'props', id: 'ta-agency-mug', size: 256}]])
  await assert.rejects(assets.asset({kind: 'props', id: 'flaky'}))
  fail = false
  assert.equal(await assets.asset({kind: 'props', id: 'flaky'}), 'blob:frame:flaky')
  assert.equal(calls.length, 3)
})

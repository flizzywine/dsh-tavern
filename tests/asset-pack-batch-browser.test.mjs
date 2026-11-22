import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'

const clientFile = new URL('../tavern-plugin/lib/client.js', import.meta.url)
const stylesFile = new URL('../tavern-plugin/lib/client-assets/theme.css', import.meta.url)

// Mount the production PackModal against an isolated pack port; expose only its factory to the harness.
test('batch actions use all filtered matches and keep their recall settings', async t => {
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'], ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 375, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://tavern.test/**', route => route.fulfill(route.request().isNavigationRequest()
    ? { contentType: 'text/html', body: '<!doctype html><div id="root" class="ap-ui"></div>' }
    : { contentType: 'application/json', body: '{"ok":true,"settings":{}}' }))
  await page.goto('http://tavern.test/')
  await page.addStyleTag({ content: await readFile(stylesFile, 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + ';window.__dshTavernHeadless=true;window.__ModuleLoader__={load(d){d.factory(name=>modules[name]??{});}};' })
  const bundle = (await readFile(clientFile, 'utf8')).replace('function createAssetPackUI(', 'window.createBatchTestViews = createAssetPackUI;\nfunction createAssetPackUI(')
  await page.addScriptTag({ content: bundle })
  await page.evaluate(() => {
    const asset = (id, name, mode) => ({ kind:'backgrounds', id, name, enabled:false, recall:{mode,keywords:['rain']}, directorNote:'After dark', media:null, pendingMedia:true })
    const dawn = {...asset('dawn', 'Clear sky', 'keyword'), recall:{mode:'keyword',keywords:['dawn']}}
    const assets = [...Array.from({length:42}, (_,i) => asset('night-'+i, 'Rain '+i, i % 2 ? 'keyword' : 'constant')), dawn]
    let snapshot = { manifest:{ id:'demo', name:'Demo pack', figures:[], assets, bundles:{}, files:[] }, figures:{}, sprites:{}, revision:'r1' }
    window.writes = []
    const binding = { service:{ apiVersion:2, capabilities:['packs','figures'], listPackSummaries:async()=>[snapshot], getPackSnapshot:async()=>snapshot, subscribe:()=>()=>{},
      patchPack:async input=>{ window.writes.push(input); snapshot={...snapshot,manifest:{...snapshot.manifest,...input.patch},revision:'r2'}; return {snapshot} } } }
    const React = modules.react, { PackModal, stageScope } = window.createBatchTestViews(React)
    stageScope.bind({useAssetGen:()=>({})})
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(PackModal,{binding,packId:'demo',packs:[snapshot],onClose(){}}))
  })
  await page.getByRole('searchbox', { name:'搜索条目' }).fill('Rain')
  const rows = page.getByRole('listbox', { name:'背景' }).getByRole('option')
  await rows.first().waitFor()
  assert.ok(await rows.count() < 42, 'there are matches outside the mounted window')
  const select = page.getByRole('button', { name:'多选', exact:true })
  const actions = page.getByRole('button', { name:'批量操作' })
  await select.click()
  await page.getByRole('checkbox', { name:'全选' }).press('Control+a')
  await page.getByText('已选 42', { exact:true }).waitFor()
  await actions.click()
  await page.getByRole('menuitem', { name:'开启', exact:true }).click()
  await select.waitFor()
  const [write] = await page.evaluate(() => window.writes)
  assert.equal(write.expectedRevision, 'r1')
  assert.deepEqual(write.patch.assets.map(a=>[a.enabled,a.recall.mode,a.recall.keywords,a.directorNote]),
    [...Array.from({length:42},(_,i)=>[true,i % 2 ? 'keyword' : 'constant',['rain'],'After dark']),[false,'keyword',['dawn'],'After dark']])
  await select.click()
  await page.getByRole('checkbox', { name:'全选' }).click()
  await actions.click()
  await page.getByRole('menuitem', { name:'删除…' }).click()
  const confirm = page.getByRole('dialog', { name:'删除选中的 42 项背景？' })
  await confirm.waitFor()
  assert.equal(await page.evaluate(() => window.writes.length), 1, 'opening the confirmation does not delete anything')
  await confirm.getByRole('button', { name:'删除 42 项' }).click()
  await confirm.waitFor({state:'hidden'})
  const writes = await page.evaluate(() => window.writes)
  assert.equal(writes.length, 2)
  assert.equal(writes[1].expectedRevision, 'r2')
  assert.deepEqual(writes[1].patch.assets.map(a=>a.id), ['dawn'])
  assert.deepEqual(errors, [])
})

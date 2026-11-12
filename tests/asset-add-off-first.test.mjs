import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { createAssetPackService } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import { recallFigures } from '../tavern-plugin/lib/domain/figure-recall.js'
import { triggerEvidence } from '../tavern-plugin/lib/domain/asset-pack-lexical.js'

const read = path => readFile(new URL('../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')
const ui = await read('asset-pack-ui.js')
const line = name => ui.match(new RegExp('^\\s*const ' + name + '=.*$', 'm'))[0]
const newFileEntry = new Function(line('newFileEntry') + ';return newFileEntry')()

// 素材库 › 添加文件: a first upload has no trigger words. How many words an entry has (none, one, any length the schema
// allows) is the author's choice, not a library rule: the write is accepted in every lamp, and the name alone recalls it.
test('the library saves entries and an added 人物 whatever their trigger words', async t => {
  const root = await mkdtemp(join(tmpdir(), 'asset-add-off-first-'))
  const library = createAssetPackService({ assetRoot: join(root, 'packs') })
  t.after(async () => { await library.dispose?.(); await rm(root, { recursive: true, force: true }) })
  let pack = (await library.createPack({ name: '测试包', expectedRevision: null })).snapshot
  // pending pictures keep the fixture free of media; the trigger words are what this checks
  const pending = { media: null, pendingMedia: true }
  const hall = newFileEntry('backgrounds', 'u-hall', '走廊', pending), room = newFileEntry('backgrounds', 'u-room', '教室', pending)
  assert.equal(hall.enabled, false)
  assert.deepEqual(hall.recall, { mode: 'keyword', keywords: [] })
  const assets = [{ ...hall, enabled: true }, { ...room, enabled: true, recall: { mode: 'keyword', keywords: ['黑板'] } }]
  pack = (await library.patchPack({ packId: pack.manifest.id, expectedRevision: pack.revision, patch: { assets } })).snapshot
  assert.deepEqual(pack.manifest.assets.map(a => [a.id, a.enabled, a.recall.keywords]), [['u-hall', true, []], ['u-room', true, ['黑板']]])
  // 添加文件 › 人物 writes a figure whose 默认 outfit has no recall at all (asset-pack-ui.js addFiles).
  const figure = { schemaVersion: 1, name: '自画像', enabled: true, appearance: 'sprite', recall: { mode: 'keyword' }, emotions: [{ id: 'calm' }], outfits: [{ key: 'default', label: '默认', enabled: true }] }
  pack = (await library.createFigure({ packId: pack.manifest.id, expectedRevision: pack.revision, figure })).snapshot
  assert.equal(Object.values(pack.figures)[0].name, '自画像')
})

// Without words, the story naming an entry or a figure is what recalls it (the existing name resolution, no extra table).
test('a figure or an entry without trigger words is recalled by its name', () => {
  const rows = [{ ref: { packId: 'p', figureId: 'f' }, name: '自画像', enabled: true, recall: { mode: 'keyword' } }]
  assert.deepEqual(recallFigures({ rows, units: ['自画像走进教室。'] }).rows.map(row => row.reasons), [['hard-trigger']])
  assert.equal(recallFigures({ rows, units: ['没有人来。'] }).rows.length, 0)
  assert.equal(triggerEvidence({ name: '离别曲', mode: 'keyword', keywords: [] }, ['钢琴弹起了离别曲']).matched, true)
})

// The opened entry in real React and the real InlineField: a fresh 关闭 entry shows its 触发词 field with the caret in it
// and the hint; typing words and Enter writes them. A stored entry keeps the folded 「＋ 触发词」 chip and no hint.
const HINT = '可以填几个正文里会出现的词，再打开蓝灯/绿灯'
test('a fresh entry opens on its 触发词 field with the hint (BGM and background)', async () => {
  const [entry, inline] = await Promise.all([read('asset-pack-entry-ui.js'), read('inline-field.js')])
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] })
  try {
    const page = await browser.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<!doctype html><div id="root"></div>')
    await page.addScriptTag({ content: await browserReactScript() })
    // Everything EntryDetail reaches outside its own file and inline-field.js renders as an empty stub.
    await page.addScriptTag({ content: `
      const stub=()=>null,known={assetTags:{ancestors:()=>[],paths:v=>Array.isArray(v)?v:v?[v]:[],normalize:v=>v}};
      const scope=new Proxy(known,{has:(t,k)=>typeof k==='string'&&k!=='modules'&&!(k in window),get:(t,k)=>k===Symbol.unscopables?undefined:k in t?t[k]:stub});
      with(scope){
        const React=modules.react,h=React.createElement;
        ${inline}
        ${entry}
        window.show=(asset,fresh)=>{
          window.writes=[];
          const commit=async(kind,id,update)=>{window.writes.push(update(asset));};
          const pack={manifest:{id:'pack',name:'包',assets:[asset]},revision:'r1'};
          const root=modules['react-dom/client'].createRoot(document.querySelector('#root'));
          modules['react-dom'].flushSync(()=>root.render(h(EntryDetail,{binding:{},pack,asset,commit,audio:{state:null,stop(){},level(){}},busy:false,fresh})));
          return ()=>root.unmount();
        };
      }` })
    const asset = (kind, enabled) => ({ kind, id: 'u-' + kind, name: kind === 'music' ? '离别曲' : '教室', enabled, recall: { mode: 'keyword', keywords: [] }, directorNote: '', media: 'a'.repeat(64) })
    for (const kind of ['music', 'backgrounds']) {
      await page.evaluate(a => { window.hide = window.show(a, true) }, asset(kind, false))
      const field = page.locator('.fork-inline-field', { has: page.locator('.fork-inline-label-text', { hasText: '触发词' }) })
      await field.waitFor()
      await page.getByRole('status').filter({ hasText: HINT }).waitFor()
      assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.fork-inline-chip-add')), true, kind + ': the caret is in 触发词')
      await page.keyboard.type('离别，毕业，远行')
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => window.writes.length === 1)
      assert.deepEqual(await page.evaluate(() => window.writes[0].recall.keywords), ['离别', '毕业', '远行'])
      await page.evaluate(() => window.hide())
      // a stored entry, or one already on: no hint; the empty field still stands open (owner r1 11-08), not a chip.
      for (const [enabled, fresh] of [[false, false], [true, true]]) {
        await page.evaluate(([a, f]) => { window.hide = window.show(a, f) }, [asset(kind, enabled), fresh])
        assert.equal(await page.getByText(HINT).count(), 0)
        assert.equal(await page.locator('[data-add-chip]', { hasText: '触发词' }).count(), 0)
        await field.waitFor()
        await page.evaluate(() => window.hide())
      }
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

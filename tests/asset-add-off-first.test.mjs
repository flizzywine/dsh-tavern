import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { enforceTriggers } from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/trigger-lint.js'

const read = path => readFile(new URL('../tavern-plugin/src/client/' + path, import.meta.url), 'utf8')
const ui = await read('asset-pack-ui.js')
const line = name => ui.match(new RegExp('^\\s*const ' + name + '=.*$', 'm'))[0]
const newFileEntry = new Function(line('newFileEntry') + ';return newFileEntry')()
const manifest = assets => ({ manifest: { assets }, figures: {} })

// 素材库 › 添加文件: a first upload of a BGM, SE or background has no trigger words yet. It is created 关闭, which the
// trigger lint exempts, so the write is accepted; turning it on still needs 3–6 words.
test('a newly added file entry starts 关闭 and passes the trigger lint; turning it on needs 3–6 words', () => {
  const music = newFileEntry('music', 'u-bgm', '离别曲', { media: 'a'.repeat(64) })
  const background = newFileEntry('backgrounds', 'u-bg', '教室', { media: 'b'.repeat(64) })
  for (const entry of [music, background]) {
    assert.equal(entry.enabled, false)
    assert.deepEqual(entry.recall, { mode: 'keyword', keywords: [] })
  }
  const before = manifest([])
  assert.deepEqual(enforceTriggers(before, manifest([music, background])), [])
  const added = manifest([music, background])
  assert.throws(() => enforceTriggers(added, manifest([{ ...music, enabled: true }, background])), e => e.code === 'TRIGGER_LINT' && e.issues[0].rule === 'count')
  const worded = { ...background, enabled: true, recall: { mode: 'keyword', keywords: ['教室', '黑板', '课桌'] } }
  assert.deepEqual(enforceTriggers(added, manifest([music, worded])), [])
})

test('the rejection text names the minimum of 3 words', () => {
  assert.match(ui.match(/TRIGGER_LINT:'([^']*)'/)[1], /至少 3 个/)
})

// The opened entry in real React and the real InlineField: a fresh 关闭 entry shows its 触发词 field with the caret in it
// and the hint; typing words and Enter writes them. A stored entry keeps the folded 「＋ 触发词」 chip and no hint.
const HINT = '填 3–6 个正文里会出现的词，再打开蓝灯/绿灯'
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
      // a stored entry, or one already on: no hint, the empty field folds into its chip.
      for (const [enabled, fresh] of [[false, false], [true, true]]) {
        await page.evaluate(([a, f]) => { window.hide = window.show(a, f) }, [asset(kind, enabled), fresh])
        assert.equal(await page.getByText(HINT).count(), 0)
        assert.equal(await page.locator('[data-add-chip]', { hasText: '触发词' }).count(), 1)
        await page.evaluate(() => window.hide())
      }
    }
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

// 回想 (stage gallery.cjs) mounted with real React, the real CG consumer/painter and the stage's theme CSS,
// over an in-page catalogue (getCgGallery / removeSceneCg). Used by tests/stage-cg-gallery-browser.test.mjs.
import { readFile } from 'node:fs/promises'
import { browserReactScript } from '../fixtures/browser-react.mjs'

const read = path => readFile(new URL('../../' + path, import.meta.url), 'utf8')

// A 16:9 picture per CG (portrait: 2:3), painted in the page (no network).
export function galleryItems(count, { scene = true, variants = 1, focus = false, portrait = false } = {}) {
  const size = portrait ? { width: 240, height: 360 } : { width: 320, height: 180 }
  return Array.from({ length: count }, (_, i) => ({
    ref: { packId: 'pack-a', kind: 'cg', assetId: `cg-${i + 1}` }, unlocked: true, available: true, label: `第 ${i + 1} 张 CG`, scene,
    defaultVariant: 'v1', focusHints: focus ? [{ key: 'face', label: '特写', x: 0.5, y: 0.35, zoom: 2 }] : [],
    variants: Array.from({ length: variants }, (_, v) => ({ key: `v${v + 1}`, label: `差分 ${v + 1}`, image: { paint: [i, v], ...size } })),
  }))
}

// pageSize pages the catalogue like cg-gallery.js: a cursor names the list's stamp, and a cursor of an older stamp is a REVISION_CONFLICT.
// stale: 'once' | 'always' — right after a first page is read, the list changes (a CG is unlocked: a new stamp and one more CG),
// as a 场景生图 does after the pack write the page already heard. failCursor: every later page fails (not a conflict).
export async function mountGallery(page, { items, imageUrl = null, pageSize = 1000, stale = null, failCursor = false } = {}) {
  const [react, effects, consumer, stage, gallery, theme, stageTheme] = await Promise.all([browserReactScript(),
    read('tavern-plugin/src/client/stage-effects.cjs'), read('tavern-plugin/src/client/cg-consumer.cjs'), read('tavern-plugin/src/client/cg-stage.js'),
    read('tavern-plugin/packages/dsh-tavern-stage/src/client/gallery.cjs'), read('tavern-plugin/lib/client-assets/theme.css'),
    read('tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css')])
  await page.setContent('<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font-family:\'Microsoft YaHei\',sans-serif"><div class="fork-gal-stage" data-theme="classic" style="position:fixed;inset:0"><div id="root" style="position:absolute;inset:0"></div></div></body></html>')
  await page.addStyleTag({ content: theme + '\n' + stageTheme })
  await page.addScriptTag({ content: react + '\nwindow.React=modules.react;window.ReactDOMClient=modules["react-dom/client"];' })
  await page.addScriptTag({ content: effects + '\n' + consumer + '\n' + stage + '\n' + gallery })
  await page.evaluate(({ items, imageUrl, pageSize, stale, failCursor }) => {
    const h = React.createElement
    const picture = ({ paint: [i, v], width, height }) => {
      if (imageUrl) return [imageUrl].flat()[(i + v) % [imageUrl].flat().length]
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const g = canvas.getContext('2d'); g.fillStyle = `hsl(${(i * 67 + v * 25) % 360} 55% 45%)`; g.fillRect(0, 0, width, height)
      g.fillStyle = '#fff'; g.font = '48px sans-serif'; g.fillText(`${i + 1}${v ? '·' + (v + 1) : ''}`, 24, 110)
      return canvas.toDataURL()
    }
    const state = window.galleryState = { items, calls: [], closed: 0, fail: false, stamp: 1 }
    const rpc = async (method, args) => {
      state.calls.push({ method, args })
      if (method === 'getCgGallery') {
        // a read takes a moment, as over the wire (the page renders its busy state in between).
        await new Promise(resolve => setTimeout(resolve, 15))
        let start = 0
        if (args.cursor) {
          if (failCursor) throw new Error('nope')
          const [stamp, at] = args.cursor.split(':')
          if (Number(stamp) !== state.stamp) throw Object.assign(new Error('CG gallery changed; reload'), { code: 'REVISION_CONFLICT' })
          start = Number(at)
        }
        // the filter applies only while both kinds are listed (mixed); a 场景生图 cell is 自动生成 (scene), every other 卡自带.
        const mixed = state.items.some(item => item.scene) && state.items.some(item => !item.scene), source = mixed ? args.source || 'all' : 'all'
        const filtered = source === 'all' ? state.items : state.items.filter(item => !!item.scene === (source === 'scene'))
        const listed = args.order === 'oldest' ? [...filtered].reverse().sort((a, b) => !a.unlocked - !b.unlocked) : filtered
        const end = start + pageSize
        const result = { items: structuredClone(listed.slice(start, end)), nextCursor: end < listed.length ? `${state.stamp}:${end}` : null, mixed, source }
        if (!args.cursor && (stale === 'always' || stale === 'once' && !state.staled)) {
          state.staled = true; state.stamp++
          const n = state.items.length + 1
          state.items = [...state.items, { ...structuredClone(state.items[0]), ref: { ...state.items[0].ref, assetId: `cg-${n}` }, label: `第 ${n} 张 CG` }]
        }
        return result
      }
      if (method === 'removeSceneCg') {
        if (state.fail) throw new Error('nope')
        state.items = state.items.filter(item => JSON.stringify(item.ref) !== JSON.stringify(args.ref)); return {}
      }
      throw new Error(method)
    }
    const owner = { prepare: async image => ({ value: { media: { url: picture(image), identity: String(image.paint) }, label: 'CG' }, release() {} }) }
    const clock = { now: () => performance.now(), isForeground: () => true, requestAnimationFrame: fn => requestAnimationFrame(fn), cancelAnimationFrame: id => cancelAnimationFrame(id) }
    const Spinner = () => h('span', { className: 'test-spinner' })
    const EmptyState = ({ text }) => h('div', { className: 'fork-empty', role: 'status' }, text)
    const views = createStageGallery({ React, window, document, ResizeObserver, IntersectionObserver, AbortController, clock, owner: () => owner,
      consumer: createCgConsumer, paint: cgPaintFrame, revision: () => 1, rpc, Spinner, EmptyState, openLibrary: async () => {} })
    const store = { getSnapshot: () => ({ source: { sessionId: 's', authorityEpoch: 1 } }) }
    ReactDOMClient.createRoot(document.getElementById('root')).render(h(views.Gallery, { sessionId: 's', store, onClose: () => { state.closed++ } }))
  }, { items, imageUrl, pageSize, stale, failCursor })
  await page.waitForSelector('.fork-cg-gallery-cell, .fork-empty')
}

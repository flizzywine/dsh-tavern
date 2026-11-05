import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

test('opening editor renders a missing figure reference as a readable placeholder', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/asset-pack-opening-ui.js', import.meta.url), 'utf8')
  const start = source.indexOf('function OpeningScene(')
  const end = source.indexOf('\n// 开场背景', start)
  assert.ok(start >= 0 && end > start)
  const h = (type, props, ...children) => ({ type, props, children: children.flat(Infinity) })
  const ref = { packId: 'missing', figureId: 'hero' }
  const context = {
    React: { useRef: () => ({ current: null }) }, h, setTimeout,
    openingDraft: () => ({ cast: [{ figure: ref, emotion: 'calm' }] }),
    openingStaged: () => [], stageFigure: () => ({}), openingFigureKey: () => 'missing/hero',
    openingAssets: () => [], openingRefKey: () => '', figureEditorEmotions: () => [],
    InlineRow: 'InlineRow', StageAvatar: 'StageAvatar', OpeningPicker: 'OpeningPicker',
    IconButton: 'IconButton', Segmented: 'Segmented', OpeningBackgroundField: 'Background',
    OPENING_TIMES: [],
  }
  const component = vm.runInNewContext(source.slice(start, end) + '; OpeningScene', context)
  const tree = component({ ctx: {}, label: 'test', scene: {}, onEdit() {}, field: () => null })
  const nodes = []
  function visit(node) { if (node && typeof node === 'object') { nodes.push(node); node.children?.forEach(visit) } }
  visit(tree)
  assert.equal(nodes.find(node => node.props?.className === 'ap-opening-name').children[0], '角色资料暂不可用')
})

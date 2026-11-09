import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const read = path => readFile(new URL('../tavern-plugin/' + path, import.meta.url), 'utf8')
const [opening, stage] = await Promise.all([
  read('src/client/asset-pack-opening-ui.js'),
  read('packages/dsh-tavern-stage/src/client/asset-pack-card-ui.js')
])
const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to))

test('the opening cast renders while its pack loads and when a figure document is absent', () => {
  const h = React.createElement
  const ignore = () => null
  const OpeningScene = vm.runInNewContext([
    section(stage, 'function stageFigureRows(', 'function StageAvatar('),
    section(opening, 'const openingFigureKey=', 'const greetingLabel='),
    section(opening, 'const openingDraft=', '// a greeting without'),
    section(opening, 'function OpeningScene(', '// 开场背景 —'),
    'OpeningScene'
  ].join('\n'), {
    React, h, clone: structuredClone, globalFirst: ids => ids, openingAssets: () => [], openingRefKey: () => '',
    packAppearance: () => ({ form: 'sprite' }), figureEditorEmotions: () => [], OPENING_TIMES: [],
    OpeningBackgroundField: ignore, Segmented: ignore, OpeningPicker: ignore, StageAvatar: ignore,
    IconButton: ignore, InlineRow: ({ children }) => children
  })
  let pack
  const ctx = { binding: {}, ext: { assetBindings: { boundPackIds: ['pack'] } }, writer: { pack: () => pack } }
  const scene = { cast: [{ figure: { packId: 'pack', figureId: 'actor' }, emotion: 'calm' }] }
  const render = () => renderToStaticMarkup(h(OpeningScene, { ctx, scene, label: '开场白', field: (_label, control) => control }))
  assert.match(render(), />pack\/actor<\/span>/)
  pack = { manifest: { figures: ['actor'] }, figures: {} }
  assert.match(render(), />pack\/actor<\/span>/)
  pack.figures.actor = { name: '已加载的人物', enabled: true, outfits: [] }
  assert.match(render(), />已加载的人物<\/span>/)
})

test('the stage retries a failed pack detail once and reports persistent failures', async () => {
  const row = { manifest: { id: 'pack' }, summary: true }
  const detail = { manifest: row.manifest }
  const warnings = []
  let attempts = 0
  const readDetails = vm.runInNewContext(section(stage, 'async function stageReadDetails(', 'function unbindPatch(') + '\nstageReadDetails', {
    setTimeout: queueMicrotask,
    console: { warn: (...args) => warnings.push(args) },
    loadPackDetail: async ({ recover }) => {
      if (++attempts === 1 || !recover) throw Error('detail unavailable')
      return detail
    }
  })
  assert.equal((await readDetails({ recover: true }, [row]))[0], detail)
  assert.equal(attempts, 2)
  assert.equal(warnings.length, 0)
  assert.equal((await readDetails({}, [row])).length, 0)
  assert.equal(attempts, 4)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][1], 'pack')
})

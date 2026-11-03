import assert from 'node:assert/strict'
import test from 'node:test'

import { validateCardStatusPanel } from '../tavern-plugin/lib/domain/card-status-panel.js'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import { cardContentDigest } from '../tavern-plugin/lib/domain/play-card-snapshots.js'

const panel = { version: 1, title: '辉夜的状态', html: '<p>状态</p>', variables: { reads: { affinity: { source: 'mvu', path: '/好感/辉夜' } } },
  ledger: ['items'], figures: [{ name: '辉夜', emotion: '平静' }] }
const invalid = (value, path) => assert.throws(() => validateCardStatusPanel(value), error => error.code === 'CARD_STATUS_PANEL_INVALID' && error.path === path)

test('a valid panel is accepted', () => {
  assert.equal(validateCardStatusPanel(panel), panel)
  assert.doesNotThrow(() => validateCardStatusPanel({ version: 1, html: '<b>状态</b>' }))
  assert.doesNotThrow(() => validateCardStatusPanel({ ...panel, size: 'full' }))
})

test('writes, unknown sources and sections, too many figures, empty html and unknown keys are rejected', () => {
  invalid({ ...panel, variables: { reads: panel.variables.reads, writes: { affinity: { source: 'mvu', path: '/好感/辉夜', scope: 'exact', ops: ['replace'] } } } }, 'statusPanel.variables')
  invalid({ ...panel, variables: { reads: { affinity: { source: 'world', path: '/好感' } } } }, 'statusPanel.variables')
  invalid({ ...panel, ledger: ['items', 'secrets'] }, 'statusPanel.ledger.1')
  invalid({ ...panel, figures: Array.from({ length: 9 }, (_, i) => ({ name: '人物' + i })) }, 'statusPanel.figures')
  invalid({ ...panel, figures: [{ name: '辉夜' }, { name: '辉夜' }] }, 'statusPanel.figures')
  invalid({ ...panel, html: '  ' }, 'statusPanel.html')
  invalid({ ...panel, title: '题'.repeat(41) }, 'statusPanel.title')
  invalid({ ...panel, css: '' }, 'statusPanel.css')
  invalid({ ...panel, size: 'huge' }, 'statusPanel.size')
})

test('a card write checks the panel it sets', () => {
  let sequence = 0
  const cards = createCardPreparation({ id: () => 'card-' + (++sequence), now: () => 1 })
  const workspace = cards.create({ kind: 'import', payload: { spec: 'chara_card_v3', data: { name: '辉夜', extensions: {} } } })
  const set = value => ({ op: 'set', path: '/data/extensions/dsh_tavern/statusPanel', value })
  assert.throws(() => cards.update({ kind: 'card', card: workspace, patch: {}, rawOperations: [set({ ...panel, ledger: ['secrets'] })] }), { code: 'CARD_STATUS_PANEL_INVALID' })
  const saved = cards.update({ kind: 'card', card: workspace, patch: {}, rawOperations: [set(panel)] })
  assert.equal(saved.changed, true)
  assert.deepEqual(saved.card.raw.data.extensions.dsh_tavern.statusPanel, panel)
})

test('cardContentDigest ignores the panel and still follows the card', () => {
  const card = { name: '辉夜', extensions: { dsh_tavern: { modSystem: { version: 1 } } } }
  const withPanel = { ...card, extensions: { dsh_tavern: { ...card.extensions.dsh_tavern, statusPanel: panel } } }
  assert.equal(cardContentDigest(withPanel), cardContentDigest(card))
  assert.notEqual(cardContentDigest({ ...withPanel, name: '辉夜姬' }), cardContentDigest(card))
  assert.notEqual(cardContentDigest({ name: '辉夜', extensions: { dsh_tavern: {} } }), cardContentDigest(card))
})

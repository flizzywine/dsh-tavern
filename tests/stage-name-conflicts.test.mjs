// 「人物重名」 (owner 11-12): a figure name that several figures of the card's packs carry names none of them on the
// stage (resolveFigureName → 'ambiguous'). figureNameConflicts lists exactly those names - not shared aliases (触发词),
// which a family may share on purpose - the host serves them to the stage (getStageNameConflicts) and the top-right
// notice lists each name's figures, each opening its page in 素材库.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const resolution = require('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs')
const libraryCopy = require('../tavern-plugin/packages/dsh-asset-library/lib/shared/figure-resolution.cjs')
const {createStageNotices} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/notices.cjs')

// ids differ from names and aliases on purpose
const row = (packId, figureId, name, aliases = [], extra = {}) => ({actorKey:'k-' + packId + '-' + figureId, ref:{packId, figureId}, name, aliases, enabled:true, packName:'包' + packId, ...extra})

test('figureNameConflicts lists the figure names the resolver cannot settle, and only those', () => {
  const rows = [row('p1', 'f1', '小林', ['Chinatsu']), row('p2', 'f9', '小林'), row('p2', 'f3', '晴子', ['ハル'])]
  const conflicts = resolution.figureNameConflicts(rows)
  assert.deepEqual(conflicts.map(conflict => [conflict.name, conflict.rows.map(r => r.ref.figureId)]), [['小林', ['f1', 'f9']]])
  assert.equal(resolution.resolveFigureName(rows, '小林').status, 'ambiguous')
  // the library's generated copy is the same implementation
  assert.deepEqual(libraryCopy.figureNameConflicts(rows).map(conflict => conflict.name), ['小林'])
  // a family sharing a 触发词 (田中) is no conflict
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'm', '田中一', ['田中']), row('p1', 'j', '田中二', ['田中']), row('p2', 't', '田中三', ['田中'])]), [])
  // two figures with the same name, normalized (full-width / traditional / case)
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'a', 'Ｈａｎａ'), row('p2', 'b', 'hana')]).map(conflict => [conflict.name, conflict.rows.length]), [['Ｈａｎａ', 2]])
  // a disabled figure names no one
  assert.deepEqual(resolution.figureNameConflicts([row('p1', 'f1', '小林'), row('p2', 'f9', '小林', [], {enabled:false})]), [])
  // renaming one away settles it: the stage finds the other
  const fixed = [row('p1', 'f1', '小林千夏'), row('p2', 'f9', '小林')]
  assert.deepEqual(resolution.figureNameConflicts(fixed), [])
  assert.equal(resolution.resolveFigureName(fixed, '小林').ref.figureId, 'f9')
})

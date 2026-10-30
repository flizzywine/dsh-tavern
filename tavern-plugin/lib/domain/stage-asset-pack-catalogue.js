// opt-in pack recall; legacy catalogue policy is deliberately not consulted.
import {listEffectiveAssets} from './effective-assets.js'
import {filterGenericSfx} from './stage-sfx-categories.js'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'
import {outfitJudgeId} from './stage-judge-recall.js'
import { ASSET_KINDS, assetEntryEnabled, assetRefKey, validateAssetRef, validateUuid } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import { createHash } from 'node:crypto'
import { check, canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { triggerEvidence, normalizeCatalogueText, codepointCompare, deepFreeze } from './asset-pack-lexical.js'
import widgetContract from '../../src/client/widget-contracts.cjs'
import { isItemWidget } from './item-widget.js'
import { activeWidgetKeys, widgetIsActive } from './widget-availability.js'
import performanceContract from '../../packages/dsh-presentation-protocol/src/performance-contract.cjs'

export const assetPackDigest = (value, options) => createHash('sha256').update(canonicalJson(value, options)).digest('hex')
const jsonHash = assetPackDigest
export function stageAssetRefs(state) {
  if (!state) return []
  check(state.format === 'asset-packs-v1', '$.state.format', 'Unsupported stage format')
  return [state.scene?.background, state.music, state.skin?.ref, state.performance?.ref, state.cg?.ref, state.lighting?.mood,
    ...Object.values(state.soundscape || {}), ...Object.values(state.widgets || {}).map(w => w.ref)].filter(Boolean)
}

/** snapshots are verified path-free pack DTOs; status is the resolver's per-full-ref availability.
 * Widgets have one item/module availability gate; private resources never become catalogue roots.
 */
export function recallAssetPacks({ snapshots, boundPackIds = [], globalEnabledPackIds = [], units = [],
  dimensions = {}, assetStatus = {}, widgetsEnabled = true, judgeRecall, modAssetKinds = ['props','performances','audience','timers'], kinds = ASSET_KINDS }) {
  const ids = [...new Set([...boundPackIds, ...globalEnabledPackIds])].sort(codepointCompare)
  ids.forEach(id => validateUuid(id))
  const effective = listEffectiveAssets({snapshots,boundPackIds,globalEnabledPackIds})
  const activeWidgets = activeWidgetKeys({packs:snapshots,boundPackIds,allowedPackIds:ids,widgetsEnabled})
  const diagnostics = [], revisions = [], rows = [], seen = new Set()
  const text = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text || ''))
  for (const packId of ids) {
    const matches = snapshots.filter(pack => pack.manifest.id === packId)
    check(matches.length <= 1, '$.snapshots', 'Duplicate pack snapshot')
    const pack = matches[0]
    if (!pack) { diagnostics.push({ code: 'pack-missing', packId }); revisions.push({ packId, missing: true }); continue }
    check(typeof pack.revision === 'string' && pack.revision.length > 0, '$.snapshots.revision')
    revisions.push({ packId, revision: pack.revision, contentHash: pack.manifest.contentHash })
    for (const {asset:entry,sourceRefs} of effective.filter(row => !row.ref.figureId && row.ref.packId === packId && kinds.includes(row.ref.kind))) {
      const asset={...entry,...assetContent(entry)}
      // Time is global, never a recalled pack look.
      if(asset.kind==='looks' && asset.layer!=='mood')continue
      // no recall evidence or catalogue row for themes, nor for the stage's 入场演出 (never the director's).
      if (asset.kind === 'directions' || asset.kind === 'skins' || asset.kind === 'entrances' || asset.kind === 'videos' || asset.kind === 'items' || asset.kind === 'widgets' && isItemWidget(pack.widgets?.[asset.id])) continue
      const ref = { packId, kind: asset.kind, assetId: asset.id }, key = assetRefKey(ref)
      check(!seen.has(key), '$.snapshots.assets', 'Duplicate asset identity'); seen.add(key)
      const status = assetStatus[key]
      let excluded = !asset.enabled ? 'disabled' : status?.available !== true ? 'asset-unavailable' : null
      if (!excluded && ['audience','timers'].includes(asset.kind) && !modAssetKinds.includes(asset.kind)) excluded = 'mod-disabled'
      const dimension = {props:'items',backgrounds:'scene',music:'music',sfx:'sfx',ambience:'sound',looks:'lighting',widgets:'widgets',skins:'skin',performances:'performance',cg:'cg'}[asset.kind]
      if (!excluded && (dimensions[dimension] === false || asset.kind === 'sfx' && dimensions.events === false || asset.kind === 'looks' && dimensions['lighting.' + asset.layer] === false)) excluded = 'dimension-disabled'
      if (!excluded && asset.kind === 'widgets' && !widgetIsActive(activeWidgets,ref)) excluded = 'widget-unavailable'
      let visibleSettings
      if (!excluded && asset.kind === 'widgets') {
        try {
          const widget = pack.widgets[asset.id]
          const {settings} = widgetContract.stageWidgetResolveSettings(widget,asset.settingsDefaults)
          const visible = Object.fromEntries((widget.settingsSchema?.fields || []).filter(field => field.directorVisible && !field.bindable).map(field => [field.key,settings[field.key]]))
          if (Object.keys(visible).length) visibleSettings = visible
        } catch (error) {excluded = 'widget-settings-unavailable'; diagnostics.push({code:excluded,ref,message:error.message})}
      }
      if (!excluded && asset.kind === 'performances') {
        const document = pack.performances?.[asset.id]
        if (!boundPackIds.includes(packId)) excluded = 'performance-pack-unbound'
        else if (!document) excluded = 'performance-document-missing'
        else if (Object.values(document.packs).some(id => !boundPackIds.includes(id))) excluded = 'performance-dependency-unbound'
        else for (const {ref:dependency} of performanceContract.performanceReferences(document, packId)) {
          const dependencyKey = assetRefKey(dependency), resolved = assetStatus[dependencyKey]
          const item = snapshots.find(row => row.manifest.id === dependency.packId)?.manifest.assets.find(row => row.kind === dependency.kind && row.id === dependency.assetId)
          if (!assetEntryEnabled(item) || resolved?.available !== true) { excluded = 'performance-dependency-unavailable'; break }
          if (dependency.kind === 'widgets' && (!widgetsEnabled || !snapshots.find(row => row.manifest.id === dependency.packId)?.widgets?.[dependency.assetId]?.commands.some(command => command.effect === 'state.set'))) { excluded = 'performance-widget-unavailable'; break }
        }
        if (!excluded) for (const block of Object.values(document.timeline)) for (const event of block.events) if (event.do === 'skin' && event.level !== undefined) {
          const [alias,id] = event.ref.split(':'), dependencyPack = alias === 'self' ? packId : document.packs[alias]
          if (!performanceContract.performanceSkinDocument(snapshots.find(row => row.manifest.id === dependencyPack),id)?.levels?.[event.level]) excluded = 'performance-skin-level-unavailable'
        }
        if (excluded) diagnostics.push({code:'performance-unavailable',ref,reason:excluded})
      }
      const hit = triggerEvidence({ name: asset.name, ...asset.recall }, text, { excludeTimeWords: asset.kind === 'backgrounds' })
      const reasons = []
      if (asset.recall.mode === 'constant') reasons.push('constant')
      if (hit.matched) reasons.push('hard-trigger')
      if (!excluded && !reasons.length && judgeRecall?.has(key)) reasons.push('judge')
      const performance = asset.kind === 'performances' ? pack.performances?.[asset.id] : null
      rows.push({ ...(visibleSettings ? {visibleSettings} : {}), ...(performance ? {performanceLevels:performance.levels ? Object.keys(performance.levels).filter(key => /^[123]$/.test(key)).map(Number) : [1],performanceDefault:performance.levels?.default ?? 1,performanceNote:performance.directorNote || asset.directorNote || '',...(performance.interop?.length?{performanceTopicBudget:true}:{})} : {}), ref, sourceRefs:structuredClone(sourceRefs), packName: pack.manifest.name, asset: structuredClone(asset), ...(asset.kind === 'widgets' && pack.widgets?.[asset.id] ? {widget:structuredClone(pack.widgets[asset.id])} : {}), reasons, excluded, ...hit, sent: false, consumer: 'director' })
    }
  }
  // a 视频 plays where another entry references it (stage-video.js), never by the director.
  const directorKinds = ASSET_KINDS.filter(kind => !['items', 'directions', 'entrances', 'videos'].includes(kind))
  const candidates = Object.fromEntries(directorKinds.map(kind => [kind, []]))
  // blue always, green only on trigger; never top up the catalogue.
  for (const row of rows) {
    if (!row.excluded && row.reasons.length) {
      row.sent = true
      candidates[row.ref.kind].push(row)
    } else if (!row.excluded) row.excluded = 'no-trigger'
  }
  const sfx = filterGenericSfx(candidates.sfx, boundPackIds, globalEnabledPackIds)
  const keptSfx = new Set(sfx)
  for (const row of candidates.sfx) if (!keptSfx.has(row)) { row.sent = false; row.excluded = 'card-category' }
  candidates.sfx = sfx
  for (const rows of Object.values(candidates)) rows.sort((a,b) => codepointCompare(assetRefKey(a.ref),assetRefKey(b.ref)))
  const names = new Map()
  for (const row of rows) {
    const group = names.get(row.asset.name) || []
    group.push(row); names.set(row.asset.name, group)
  }
  for (const duplicates of names.values()) {
    const packs = new Map()
    for (const row of duplicates) {
      row.label = duplicates.length === 1 ? row.asset.name : `${row.asset.name} (${row.packName})`
      const group = packs.get(row.packName) || []
      group.push(row); packs.set(row.packName, group)
    }
    for (const group of packs.values()) if (group.length > 1) {
      const sorted = group.map(row => ({ row, key: assetRefKey(row.ref) })).sort((a, b) => codepointCompare(a.key, b.key))
      sorted.forEach(({ row, key }, index) => {
        // Neighbour prefixes suffice in sorted order, without a quadratic duplicate-name scan.
        let length = 8
        for (const neighbour of [sorted[index - 1], sorted[index + 1]]) if (neighbour) {
          let common = 0
          while (common < key.length && key[common] === neighbour.key[common]) common++
          length = Math.max(length, common + 1)
        }
        row.label += ' [' + key.slice(0, length) + ']'
      })
    }
  }
  // Rows already own their asset/widget copies; candidates reference those same rows.
  return deepFreeze({ candidates, rows, diagnostics, revisions, effectivePackIds: ids })
}

// prompt choices are separate from the complete snapshot used by carry/reset.
export function recallFigureOutfits(actors, units, state, judgeRecall) {
  const text = units.map(unit => normalizeCatalogueText(typeof unit === 'string' ? unit : unit.text || ''))
  return Object.fromEntries(Object.entries(actors).map(([alias, actor]) => [alias, actor.outfits.filter(outfit => outfit.enabled).map((outfit, index) => {
    const constant = index === 0 || outfit.recall?.mode === 'constant'
    const carried = state.actors[alias]?.outfitKey === outfit.key
    const hit = triggerEvidence({ name: outfit.label, ...outfit.recall }, text, { excludeTimeWords: false, minLength: 1 })
    return { key: outfit.key, label: outfit.label, ...(outfit.guidance ? {guidance:outfit.guidance} : {}), constant, sent: constant || carried || hit.matched || judgeRecall?.has(outfitJudgeId(alias,outfit.key)) === true }
  }).filter(outfit => outfit.sent)]))
}

export function assetPackTaskBinding({ cardRevision, engine, target, catalogue, characters }) {
  check(typeof cardRevision === 'string' && cardRevision.length > 0, '$.cardRevision')
  check(target && target.revision !== undefined && target.sourceKey && target.branchId, '$.target')
  return deepFreeze(structuredClone({ cardRevision, engineDigest: jsonHash(engine), target,
    packs: catalogue.revisions, effectivePackIds: catalogue.effectivePackIds, charactersDigest: jsonHash(characters), catalogueDigest: jsonHash(catalogue, {admitted:true}) }))
}
export function assertAssetPackTaskCurrent(frozen, current) {
  check(Boolean(current), '$.target', 'Asset-pack director task expired; retry explicitly', 'REVISION_CONFLICT')
  check(canonicalJson(frozen) === canonicalJson(current), '$.target', 'Asset-pack director task expired; retry explicitly', 'REVISION_CONFLICT')
}
export function recalledAsset(catalogue, ref, kind) {
  validateAssetRef(ref, '$.ref', kind)
  const row = catalogue.candidates[ref.kind]?.find(row => assetRefKey(row.ref) === assetRefKey(ref))
  check(Boolean(row), '$.ref', 'Asset was not recalled or authorized', 'ASSET_UNAVAILABLE')
  return row
}

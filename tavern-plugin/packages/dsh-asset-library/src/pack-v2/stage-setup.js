import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID, createHash} from 'node:crypto'
import {check, validateUuid, canonicalJson} from '../asset-packs/common.js'
import {validatePackIdentities} from '../asset-packs/index.js'
import {copyPackItems} from './copy-items.js'
import {sealPack, storedCopyHashes} from './validation.js'
import {isModConfigPack} from './mod-private.js'

// A creation receipt, not card ownership: these remain ordinary editable packs.
export function createStageSetupMethods({run, all, load, verify, storage, cards, nextLocal, emit, blankManifest, assetRoot, createFigure, triggerOverrides}) {
  const revision = packs => createHash('sha256').update(canonicalJson(packs.map(p => [p.manifest.id,p.local.revision]).sort((a,b) => a[0].localeCompare(b[0])))).digest('hex')
  async function state(path) {
    check(cards?.withBoundPack, '$.card', '素材库暂时不可用', 'ASSET_UNAVAILABLE')
    const card = await cards.snapshot({path})
    check(card.raw, '$.path', '找不到这张卡片', 'NOT_FOUND')
    const identity = cards.inspectRaw(card.raw), packs = await all()
    const wizard = packs.find(p => p.local.stageSetupCardId === card.cardId)
    const receipt = join(assetRoot,'stage-setup-shown',encodeURIComponent(card.cardId) + '.json')
    const shown = await readFile(receipt,'utf8').then(() => true,error => {if (error.code === 'ENOENT') return false; throw error})
    return {card,identity,packs,wizard,receipt,shown}
  }
  function view(path, {card,identity,packs,wizard,shown}) {
    return {path,cardId:card.cardId,cardRevision:card.revision,libraryRevision:revision(packs),boundPackIds:identity.boundPackIds,
      hasBoundPacks:identity.boundPackIds.length > 0,hasAssets:packs.some(p => !isModConfigPack(p) && (p.manifest.assets.length || p.manifest.figures.length)),
      wizardPack:wizard ? {packId:wizard.manifest.id,name:wizard.manifest.name,revision:wizard.local.revision} : null,shouldAutoOpen:!shown && !wizard && identity.boundPackIds.length === 0}
  }
  return {
    getStageSetupStatus:({path,autoOpened=false}) => run([], async () => {
      check(typeof autoOpened === 'boolean', '$.autoOpened', 'Invalid autoOpened')
      const current = await state(path)
      if (autoOpened && !current.shown) {
        await mkdir(join(assetRoot,'stage-setup-shown'),{recursive:true})
        await writeFile(current.receipt,'{}',{flag:'wx'}).catch(error => {if (error.code !== 'EEXIST') throw error})
        current.shown = true
      }
      return view(path,current)
    }),
    mergeStageSetupPack(input) {
      check(Array.isArray(input.selections) && input.selections.length <= 256, '$.selections', '请选择要复制的素材')
      for (const selection of input.selections) validateUuid(selection.packId)
      return run(input.selections.map(s => s.packId), async () => {
        const current = await state(input.path)
        check(current.card.revision === input.expectedCardRevision && revision(current.packs) === input.expectedLibraryRevision,
          '$.revision', '卡片或素材刚刚被改过，请重新载入后再试', 'REVISION_CONFLICT')
        if (!input.selections.length && input.figure === undefined) return {...view(input.path,current),copied:[]}
        const before = current.wizard ? await load(current.wizard.manifest.id) : null
        const packId = before?.manifest.id || randomUUID()
        let name = input.name ?? current.identity.name + ' · 本卡素材包'
        if (!before) {
          check(typeof name === 'string' && name.trim().length > 0 && name.length <= 180, '$.name', '请填写素材包名称')
          name = name.trim()
          const base = name
          for (let n = 2; current.packs.some(p => p.manifest.name === name); n++) name = base + ' (' + n + ')'
        }
        const manifest = before ? structuredClone(before.manifest) : blankManifest(packId,name)
        const files = new Map(before?.files || []), copied = [], sources = []
        // Repeated source rows are one selection, so dependencies and figures are not duplicated.
        const selections = new Map()
        for (const row of input.selections) {
          check(Array.isArray(row.itemRefs) && row.itemRefs.length > 0, '$.itemRefs', '请选择要复制的素材')
          selections.set(row.packId,[...(selections.get(row.packId) || []),...row.itemRefs])
        }
        for (const [sourcePackId,itemRefs] of selections) {
          check(sourcePackId !== packId, '$.selections', '请选择其他素材包中的条目')
          const source = await load(sourcePackId)
          check(source && !isModConfigPack(source), '$.selections', '素材暂时不可用', 'ASSET_UNAVAILABLE')
          sources.push(source)
          copied.push(...copyPackItems(source,itemRefs,manifest,files,new Set(before?.local.retired || [])).map(row => ({sourcePackId,...row})))
        }
        const created = input.figure === undefined ? {} : createFigure(manifest,files,{figure:input.figure})
        if (input.figure !== undefined) triggerOverrides(input,before || {manifest:blankManifest(packId,name),figures:{}},manifest,files)
        await sealPack(manifest,files,before,storedCopyHashes(files,sources))
        const pack = await verify(manifest,files,before,true), local = nextLocal(before?.local)
        local.stageSetupCardId = current.card.cardId
        validatePackIdentities([...current.packs.filter(p => p.manifest.id !== packId).map(p => p.manifest),manifest])
        await cards.withBoundPack({path:input.path,expectedRevision:input.expectedCardRevision,packId}, transaction => storage.publishMany([{pack,local}],transaction))
        emit({...pack,local},before)
        return {...view(input.path,await state(input.path)),copied,...created}
      })
    }
  }
}

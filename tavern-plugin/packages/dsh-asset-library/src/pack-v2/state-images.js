import {check} from '../asset-packs/common.js'
import {validateFigureClosure} from '../asset-packs/figure.js'
import {spriteResourcePaths} from '../asset-packs/sprite.js'
import imageContract from '../shared/sprite-images.cjs'
import {canonicalJson} from '../shared/asset-pack-json.js'

function upgradeSprite(sprite, rows) {
  const next = structuredClone(sprite)
  check(Object.keys(next.emotions).length === rows.length,'$.mapping.images','Image inventory changed; regenerate the reviewed mapping','REVISION_CONFLICT')
  next.images = Object.fromEntries(rows.map(row => {
    check(Object.hasOwn(next.emotions,row.oldImageId),'$.mapping.images','Mapped image missing','REVISION_CONFLICT')
    return [row.imageId,next.emotions[row.oldImageId]]
  }))
  delete next.emotions
  next.version = next.kind === 'layered-static-sprites' ? 3 : 2
  return next
}

// Frozen decisions name identities, not media metadata. Always transform the fresh CAS snapshot.
export function applyStateImageMapping(before, mapping) {
  check(before.manifest.schemaVersion === 1 && mapping.ready && mapping.pack === before.manifest.id,'$.mapping','Expected a reviewed mapping for this unmigrated pack')
  const manifest = structuredClone(before.manifest), figures = structuredClone(before.figures), sprites = {}
  manifest.schemaVersion = 2
  for (const [id, figure] of Object.entries(figures)) {
    const definitions = mapping.definitions.filter(row => row.figureId === id)
    check(definitions.length === figure.emotions.length && figure.emotions.every(state=>definitions.some(row=>row.oldStateId===state.id)),'$.mapping.definitions','State inventory changed','REVISION_CONFLICT')
    const old = new Map(figure.emotions.map(state=>[state.id,state])), meanings = new Map()
    for (const row of definitions) if (row.stateId && (!meanings.has(row.stateId) || row.oldStateId === row.stateId)) meanings.set(row.stateId,row)
    figure.emotions = [...meanings.values()].map(row=>({...old.get(row.oldStateId),id:row.stateId,label:row.label,guidance:row.guidance}))
    figure.schemaVersion = 2
    for (const outfit of figure.outfits) {
      if (!outfit.sprite) continue
      const target = mapping.outfits.find(row=>row.figureId===id && row.outfitKey===outfit.key)
      check(target && target.manifestKey === outfit.sprite.manifestKey,'$.mapping.outfits','Outfit inventory changed','REVISION_CONFLICT')
      const rows = mapping.images.filter(row=>row.figureId===id && row.outfitKey===outfit.key)
      const imageMap = new Map(rows.map(row=>[row.oldImageId,row.imageId]))
      const remap = (value,path) => Object.fromEntries(Object.entries(value).map(([key,item])=>{
        check(imageMap.has(key),path,'Unmapped image metadata: '+key,'REVISION_CONFLICT')
        return [imageMap.get(key),item]
      }))
      const sprite = upgradeSprite(before.sprites[outfit.sprite.manifestKey],rows)
      const existing = sprites[outfit.sprite.manifestKey]
      check(!existing || canonicalJson(existing) === canonicalJson(sprite),'$.mapping.images','Shared manifest has conflicting identities')
      sprites[outfit.sprite.manifestKey] = sprite
      outfit.defaultEmotion = target.defaultState
      outfit.sprite.imagePools = structuredClone(target.imagePools)
      for (const field of ['avatarCrop','avatarCropAuto','anatomy']) if (outfit.sprite[field]) outfit.sprite[field] = remap(outfit.sprite[field],'$.sprite.'+field)
      if (outfit.avatars) outfit.avatars = remap(outfit.avatars,'$.avatars')
      outfit.fallbackTo = structuredClone(target.fallbackTo)
      outfit.fallbackEmotions = [...new Set((outfit.fallbackEmotions || []).map(id=>definitions.find(row=>row.oldStateId===id)?.stateId).filter(id=>id && id !== outfit.defaultEmotion))]
    }
  }
  validateFigureClosure(manifest,figures,sprites)
  return {manifest,figures,sprites}
}

// Replacement creates a new identity. The old descriptor, paths, avatars and calibration stay reachable.
export function addStateImage(figure, sprites, {outfitKey,stateId,imageId: requestedImageId,image,assets,renderer = {},avatar,avatarCrop,avatarCropAuto,anatomy,replaceImageId,defaultImage = false}) {
  check(figure.schemaVersion === 2,'$.figure','Migrate this figure before adding pool images')
  const outfit = figure.outfits.find(row=>row.key===outfitKey), pool = outfit?.sprite?.imagePools?.[stateId]
  check(pool,'$.stateId','An existing semantic pool is required','MISSING_DEPENDENCY')
  const sprite = sprites[outfit.sprite.manifestKey], images = imageContract.spriteImageTable(sprite)
  const largest = Math.max(0,...Object.keys(images).map(id=>/^im(\d+)$/.exec(id)?.[1] || 0))
  const imageId = requestedImageId ?? 'im'+String(largest+1).padStart(3,'0')
  const proposed = structuredClone(image)
  if (Object.hasOwn(images,imageId)) {
    check(canonicalJson(images[imageId]) === canonicalJson(proposed) && pool.imageIds.includes(imageId) && (!defaultImage || pool.defaultImageId === imageId) && (replaceImageId === undefined || !pool.imageIds.includes(replaceImageId)),'$.imageId','Published image identity conflicts with this installation')
    for (const [path,hash] of Object.entries(assets)) check(outfit.sprite.assets[path] === hash,'$.assets','Published image resource differs')
    if (avatar !== undefined) check(outfit.avatars?.[imageId] === avatar,'$.avatar','Published avatar differs')
    for (const [key,value] of Object.entries({avatarCrop,avatarCropAuto,anatomy})) if (value !== undefined) check(canonicalJson(outfit.sprite[key]?.[imageId] ?? null) === canonicalJson(value),'$.'+key,'Published image metadata differs')
    for (const [key,value] of Object.entries(renderer)) {
      const source = key === 'mouthAtlas' ? {mouthAtlas:value} : value
      const destination = key === 'mouthAtlas' ? sprite : sprite[key]
      for (const [id,component] of Object.entries(source)) check(canonicalJson(destination?.[id] ?? null) === canonicalJson(component),'$.renderer','Published renderer component differs')
    }
    return imageId
  }
  check(replaceImageId === undefined || pool.imageIds.includes(replaceImageId),'$.replaceImageId','Replacement must name a current pool member')
  for (const [path,hash] of Object.entries(assets)) {
    check(!Object.hasOwn(outfit.sprite.assets,path) || outfit.sprite.assets[path] === hash,'$.assets','Existing image resource paths are immutable; use a new path')
    outfit.sprite.assets[path] = hash
  }
  for (const [key,value] of Object.entries(renderer)) {
    check(['mouthSets','mouthAtlas'].includes(key),'$.renderer','Unknown renderer component')
    if (key === 'mouthAtlas') {
      check(sprite[key] === undefined || canonicalJson(sprite[key]) === canonicalJson(value),'$.renderer.'+key,'Existing renderer components are immutable')
      sprite[key] = structuredClone(value)
    } else {
      const destination = sprite[key] ||= {}
      for (const [id,component] of Object.entries(value)) {
        check(destination[id] === undefined || canonicalJson(destination[id]) === canonicalJson(component),'$.renderer.'+key,'Existing renderer components are immutable')
        destination[id] = structuredClone(component)
      }
    }
  }
  images[imageId] = proposed
  pool.imageIds = pool.imageIds.filter(id=>id !== replaceImageId).concat(imageId)
  if (defaultImage || pool.defaultImageId === replaceImageId) pool.defaultImageId = imageId
  if (avatar !== undefined) (outfit.avatars ||= {})[imageId] = avatar
  for (const [key,value] of Object.entries({avatarCrop,avatarCropAuto,anatomy})) if (value !== undefined) (outfit.sprite[key] ||= {})[imageId] = structuredClone(value)
  return imageId
}

function imageClosure(outfit, sprite, imageId) {
  const document = structuredClone(sprite), images = imageContract.spriteImageTable(document)
  const image = images[imageId]
  // Source-bound mouth animation is editable without replacing the still's identity.
  // Its native binding/size/closure checks run at ingress; the body remains immutable.
  const omitMouth = entry => {
    delete entry.mouthSet; delete entry.mouthFrames; delete entry.closedMouthFrame
    for (const view of [entry.stage, entry.portrait]) if (view) for (const key of ['mouth', 'mouthByFrame', 'mouthFrames', 'mouthOcclusionMask']) delete view[key]
  }
  omitMouth(image)
  document[imageContract.spriteUsesImages(document) ? 'images' : 'emotions'] = {[imageId]:image}
  for (const key of ['mouthAtlas','mouthSets','rig','rigs']) delete document[key]
  if (image.mouthSet !== undefined) document.mouthSets = {[image.mouthSet]:sprite.mouthSets[image.mouthSet]}

  // Shared rigs/atlases used by this descriptor belong to its immutable content closure.
  return {image,mouthAtlas:document.mouthAtlas || null,mouthSets:document.mouthSets || null,rig:document.rig || null,rigs:document.rigs || null,
    assets:Object.fromEntries(spriteResourcePaths(document).map(path=>[path,outfit.sprite.assets[path]])),
    avatar:outfit.avatars?.[imageId] || null,avatarCrop:outfit.sprite.avatarCrop?.[imageId] || outfit.avatarCrop || null,avatarCropAuto:outfit.sprite.avatarCropAuto?.[imageId] || null,anatomy:outfit.sprite.anatomy?.[imageId] || null}
}

// All published image descriptors are conservative historical roots, including retired pool members.
export function retainPublishedStateImages(before, after, avatarRewrites = new Map(), imageResolutions = []) {
  const resolved = validateImageResolutions(before, after, imageResolutions)
  if (before?.manifest.schemaVersion !== 2) return
  for (const [id, figure] of Object.entries(before.figures)) {
    const next = after.figures[id]
    if (!next) continue // Explicit figure deletion withdraws the resource, unlike retiring a state/image.
    for (const outfit of figure.outfits) {
      if (!outfit.sprite?.imagePools) continue
      const target = next.outfits.find(row=>row.key===outfit.key)
      if (!target) continue
      check(target.sprite?.manifestKey === outfit.sprite.manifestKey,'$.sprite.manifestKey','Published image manifests are immutable; add a new outfit to withdraw an old one')
      const oldSprite = before.sprites[outfit.sprite.manifestKey], newSprite = after.sprites[target.sprite.manifestKey]
      for (const imageId of Object.keys(imageContract.spriteImageTable(oldSprite))) {
        if (resolved.has(id+'/'+outfit.key+'/'+imageId)) continue
        check(Object.hasOwn(imageContract.spriteImageTable(newSprite),imageId),'$.images.'+imageId,'Retired images remain historical roots')
        const original=imageClosure(outfit,oldSprite,imageId)
        // Only the native technical-resolution transaction can supply this map.
        // Every other image, mouth/eye, crop and anatomy field stays immutable.
        if(avatarRewrites.has(original.avatar))original.avatar=avatarRewrites.get(original.avatar)
        check(canonicalJson(original) === canonicalJson(imageClosure(target,newSprite,imageId)),'$.images.'+imageId,'Published image closure changed; replace with a new image identity','IMMUTABLE_IMAGE')
      }
    }
  }
}

// Explicit technical replacement: same authored pose, new raster and source-bound geometry.
// This is deliberately separate from artistic replacement, which still creates an identity.
// Image pools and unmigrated per-state emotions (the state key is the image) share this one transaction.
export function replaceStateImageResolution(figure, sprites, input) {
  const {outfitKey,imageId,image,assets,renderer={},avatar,avatarCrop,avatarCropAuto,anatomy,removeImageId}=input
  const outfit=figure.outfits.find(o=>o.key===outfitKey),sprite=sprites[outfit?.sprite?.manifestKey],table=imageContract.spriteImageTable(sprite),pools=outfit?.sprite?.imagePools
  check(sprite?.kind==='layered-static-sprites' && table?.[imageId] && (pools ? figure.schemaVersion===2 : !removeImageId && figure.emotions.some(state=>state.id===imageId)),'$.imageId','Resolution replacement requires an existing layered whole image')
  if(pools) {
    const active=Object.values(pools).some(pool=>pool.imageIds.includes(removeImageId||imageId))
    check(active||removeImageId&&!table[removeImageId]&&Object.values(pools).some(pool=>pool.imageIds.includes(imageId)),'$.imageId','Resolution target must be active')
  }
  for(const [resource,hash] of Object.entries(assets)) {
    check(!outfit.sprite.assets[resource]||outfit.sprite.assets[resource]===hash,'$.assets','Use a new resource path for changed pixels')
    outfit.sprite.assets[resource]=hash
  }
  for(const [key,components] of Object.entries(renderer)) {
    check(key==='mouthSets','$.renderer','Resolution replacement supports only source-bound whole-image mouths')
    for(const [id,component] of Object.entries(components)) {
      check(!sprite[key]?.[id]||canonicalJson(sprite[key][id])===canonicalJson(component),'$.renderer','Use a new mouth-set identity for changed pixels')
      ;(sprite[key]||={})[id]=structuredClone(component)
    }
  }
  table[imageId]=structuredClone(image)
  if(avatar!==undefined)(outfit.avatars||={})[imageId]=avatar
  for(const [key,value] of Object.entries({avatarCrop,avatarCropAuto,anatomy})) {
    if(value!==undefined)(outfit.sprite[key]||={})[imageId]=structuredClone(value)
    else if(outfit.sprite[key])delete outfit.sprite[key][imageId]
  }
  if(removeImageId) {
    check(removeImageId!==imageId,'$.removeImageId','Cannot remove the preserved identity')
    for(const pool of Object.values(pools)) {
      pool.imageIds=[...new Set(pool.imageIds.map(id=>id===removeImageId?imageId:id))]
      if(pool.defaultImageId===removeImageId)pool.defaultImageId=imageId
    }
    delete table[removeImageId]
    if(outfit.avatars)delete outfit.avatars[removeImageId]
    for(const key of ['avatarCrop','avatarCropAuto','anatomy'])if(outfit.sprite[key])delete outfit.sprite[key][removeImageId]
    const policies=figure.extensions?.['dsh.mouth']?.images?.[outfitKey]
    if(policies?.[removeImageId]){policies[imageId]=policies[removeImageId];delete policies[removeImageId]}
  }
  const sets=new Set(Object.values(table).map(entry=>entry.mouthSet))
  for(const id of Object.keys(sprite.mouthSets||{}))if(!sets.has(id))delete sprite.mouthSets[id]
  if(sprite.mouthAtlas&&!sets.has(undefined))delete sprite.mouthAtlas
  const resources=new Set(spriteResourcePaths(sprite))
  for(const resource of Object.keys(outfit.sprite.assets))if(!resources.has(resource))delete outfit.sprite.assets[resource]
  return imageId
}

function validateImageResolutions(before,after,rows) {
  check(Array.isArray(rows),'$.imageResolutions','Expected an array')
  const allowed=new Set()
  for(const row of rows) {
    check(row&&Object.keys(row).every(key=>['figureId','outfitKey','imageId','expectedMedia','removeImageId'].includes(key))&&/^[a-f0-9]{64}$/.test(row.expectedMedia),'$.imageResolutions','Invalid resolution declaration')
    const {figureId,outfitKey,imageId,removeImageId}=row,key=figureId+'/'+outfitKey+'/'
    check(!allowed.has(key+imageId),'$.imageResolutions','Duplicate resolution declaration')
    const oldOutfit=before?.figures[figureId]?.outfits.find(o=>o.key===outfitKey),newOutfit=after.figures[figureId]?.outfits.find(o=>o.key===outfitKey)
    const oldSprite=before?.sprites[oldOutfit?.sprite?.manifestKey],newSprite=after.sprites[newOutfit?.sprite?.manifestKey]
    const oldTable=imageContract.spriteImageTable(oldSprite),newTable=imageContract.spriteImageTable(newSprite)
    const old=oldTable?.[imageId],next=newTable?.[imageId]
    check(old&&next&&oldSprite.kind==='layered-static-sprites'&&newSprite.kind===oldSprite.kind&&oldOutfit.sprite.manifestKey===newOutfit.sprite.manifestKey,'$.imageResolutions','Resolution target changed','REVISION_CONFLICT')
    const original=imageClosure(oldOutfit,oldSprite,imageId),updated=imageClosure(newOutfit,newSprite,imageId)
    if(canonicalJson(original)!==canonicalJson(updated)) {
      check(oldOutfit.sprite.assets[old.stage?.src]===row.expectedMedia,'$.expectedMedia','Resolution source changed','REVISION_CONFLICT')
      // Mouth and eye patches are source-bound layers of the raster: their pixels and rects follow it.
      // Which blink phases exist is pose semantics and stays.
      const shape=image=>{
        const result=structuredClone(image)
        check(!result.binding&&!result.stage?.mouthByFrame&&!result.stage?.mouthOcclusionMask,'$.image','Unsupported resolution rig or mask')
        for(const key of ['mouthSet','mouthFrames','closedMouthFrame'])delete result[key]
        for(const view of [result.stage,result.portrait])if(view) {
          for(const key of ['src','width','height','mouth','mouthFrames'])delete view[key]
          if(view.blink)view.blink=['closed','half'].filter(phase=>view.blink[phase])
        }
        return result
      }
      check(canonicalJson(shape(old))===canonicalJson(shape(next)),'$.image','Resolution replacement cannot change pose semantics')
      for(const view of ['stage','portrait'])if(old[view]) {
        const a=old[view],b=next[view]
        check(b.width>=a.width&&b.height>=a.height&&Math.abs(b.width-a.width*b.height/a.height)<=0.5,'$.image.'+view,'Resolution replacement cannot shrink or change aspect ratio')
        // An eye patch left at the old raster's coordinates would paint at the wrong place and size.
        if(a.blink&&b.height!==a.height) {
          const [x,y,w,h]=a.blink.rect,[nx,ny,nw,nh]=b.blink.rect,k=b.height/a.height,cx=(x+w/2)*k,cy=(y+h/2)*k
          check(nx<=cx&&cx<=nx+nw&&ny<=cy&&cy<=ny+nh&&nw>w&&nh>h,'$.image.'+view+'.blink','Blink rect must follow the replaced raster')
        }
      }
    }
    const expectedPools=structuredClone(oldOutfit.sprite.imagePools)
    if(removeImageId) {
      check(expectedPools&&removeImageId!==imageId&&!newTable[removeImageId],'$.removeImageId','Duplicate must be removed')
      if(oldTable[removeImageId]) {
        check(canonicalJson(imageClosure(oldOutfit,oldSprite,removeImageId))===canonicalJson(updated),'$.removeImageId','Only an exact duplicate of the replacement may be consolidated')
        for(const pool of Object.values(expectedPools)) {
          pool.imageIds=[...new Set(pool.imageIds.map(id=>id===removeImageId?imageId:id))]
          if(pool.defaultImageId===removeImageId)pool.defaultImageId=imageId
        }
      }
      allowed.add(key+removeImageId)
    }
    // Check memberships for this identity only; other declarations can consolidate their own pairs.
    // Unmigrated storage keys the image by its state, so the key itself is the membership.
    const membership=pools=>Object.entries(pools||{}).filter(([,p])=>p.imageIds.includes(imageId)).map(([id,p])=>[id,p.defaultImageId===imageId])
    check(canonicalJson(membership(expectedPools))===canonicalJson(membership(newOutfit.sprite.imagePools)),'$.imagePools','Resolution replacement must preserve semantic membership and defaults')
    allowed.add(key+imageId)
  }
  return allowed
}

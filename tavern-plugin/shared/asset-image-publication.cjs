// one atomic image publication builder, shared by UI and workbench.
const assetImagePublication = (() => {
  const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value));
  async function closure(image) {
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',image.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    return {hash,blobs:{[hash]:image.descriptor},files:new Map([['media/'+hash+'.'+image.descriptor.ext,image.bytes]])};
  }
  function publish(snapshot,media,patch={}) {return {packId:snapshot.manifest.id,expectedRevision:snapshot.revision,patch:{...patch,blobs:{...snapshot.manifest.blobs,...media.blobs}},fileUpdates:media.files};}
  function create({emotionState,newResourceKey}) {
function simpleSpriteImages(outfit,manifest) {
  if(outfit?.sprite?.imagePools)return null;
  if(!outfit?.sprite||!manifest||manifest.mouthAtlas||manifest.mouthSets)return null;
  const images={};
  for(const [id,state] of Object.entries(manifest.emotions||{})){
    const view=state.stage,hash=outfit.sprite.assets?.[view?.src||state.src];
    if(!hash||state.portrait||view?.mouth||view?.mouthByFrame||view?.blink)return null;
    if(view&&(!Number.isFinite(view.width)||!Number.isFinite(view.height)))return null;
    images[id]={hash,...(view?{width:view.width,height:view.height}:{})};
  }
  return images;
}
// one 差分 state that is a single still (the read view of any sprite
// kind): no mouth, blink or separate portrait. Same rule as the backend's staticSpriteState.
function spriteStateStatic(state) {
  const v=state?.stage;
  return !!state&&!state.portrait&&state.mouthSet===undefined&&!Object.keys(state.mouthFrames||{}).length&&
    !v?.mouth&&!v?.mouthByFrame&&!v?.blink&&!Object.keys(v?.mouthFrames||{}).length;
}
// Whether this 差分's 立绘 can take one picture (upload or a generated candidate): an outfit without a 立绘, a simple
// sprite, or — in a layered / lip-synced sprite — a 差分 that is missing or is itself one still. Its animated states keep
// their structure.
function spriteSlotTakesStill(outfit,manifest,id) {
  if(outfit?.sprite?.imagePools)return true;
  if(!outfit?.sprite||simpleSpriteImages(outfit,manifest))return true;
  if(!manifest)return false;
  const state=emotionState(outfit,manifest,id);
  return !state||spriteStateStatic(state);
}
// The resource paths a sprite manifest references (the library's spriteResourcePaths): an outfit's `sprite.assets` must
// map exactly these.
function spriteManifestPaths(value) {
  const paths=new Set();
  const walk=item=>{if(item&&typeof item==='object')for(const [key,v] of Object.entries(item)){
    if(['src','mouthOcclusionMask'].includes(key))paths.add(v);
    else if(key==='blink'){paths.add(v.closed);if(v.half)paths.add(v.half);}
    else walk(v);}};
  walk(value);return [...paths];
}
// Put one still into a sprite that this page cannot rewrite whole (layered, lip-synced): only this 差分's entry
// changes — a layered manifest gets a stage-only state, a flat one a `src` — and the
// outfit's asset map follows the manifest's paths exactly. Every other state keeps its structure. Throws when the 差分's
// own state is animated (spriteSlotTakesStill is false).
function addSpriteStill(outfit,manifest,id,image) {
  const own=manifest?.emotions?.[id],stateView=emotionState(outfit,manifest,id);
  if(stateView&&!spriteStateStatic(stateView))throw new Error('这个差分是动态立绘（会动嘴、眨眼），不能换成单张图：先删除这张立绘');
  if(!own&&Object.keys(manifest.emotions||{}).length>=256)throw new Error('这套立绘的差分已满（最多 256 个）');
  const assets={...(outfit.sprite.assets||{})};let src='emotions/'+id+'/'+image.hash.slice(0,12)+'.png';
  for(let n=2;Object.hasOwn(assets,src)&&assets[src]!==image.hash;n++)src='emotions/'+id+'/'+image.hash.slice(0,12)+'-'+n+'.png';
  const entry=manifest.kind==='static-sprites'?{src}:{stage:{src,width:image.width,height:image.height}};
  const next={...manifest,emotions:{...manifest.emotions,[id]:entry}},used=new Set(spriteManifestPaths(next));
  assets[src]=image.hash;for(const key of Object.keys(assets))if(!used.has(key))delete assets[key];
  const sprite={...outfit.sprite,assets};
  for(const key of ['avatarCrop','avatarCropAuto','anatomy']){if(!sprite[key])continue;const rest={...sprite[key]};delete rest[id];if(Object.keys(rest).length)sprite[key]=rest;else delete sprite[key];}
  return {manifest:next,outfit:{...outfit,sprite}};
}
// 「删除这张立绘…」 of one 差分 in one outfit, for every sprite kind — a plain
// one or a talking / blinking one. Only that 差分's entry leaves the manifest (with its mouth frames, blink patches and
// portrait; a mouth set nobody else uses goes too, as in the service's removeFigureEmotion); the outfit's
// asset map follows the manifest's paths and its measurements of that 差分 go. → null (nothing there),
// {manifest:null, outfit} (it was the last one: the outfit loses its 立绘) or {manifest, outfit}.
function removeSpriteEmotion(outfit,manifest,id) {
  if(outfit?.sprite?.imagePools){
    const pool=outfit.sprite.imagePools[id];if(!pool)return null;
    if(pool.imageIds.length===1)throw new Error('至少保留一张候选图；退役整个意义请删除差分');
    const imageIds=pool.imageIds.filter(image=>image!==pool.defaultImageId);
    return {manifest,outfit:{...outfit,sprite:{...outfit.sprite,imagePools:{...outfit.sprite.imagePools,[id]:{imageIds,defaultImageId:imageIds[0]}}}}};
  }
  if(!outfit?.sprite||!manifest?.emotions||!Object.hasOwn(manifest.emotions,id))return null;
  const next=JSON.parse(JSON.stringify(manifest));delete next.emotions[id];
  const entries=Object.values(next.emotions);
  if(!entries.length){const rest={...outfit};delete rest.sprite;return {manifest:null,outfit:rest};}
  const sets=new Set(entries.map(entry=>entry.mouthSet).filter(key=>key!==undefined));
  if(next.mouthSets)for(const key of Object.keys(next.mouthSets))if(!sets.has(key))delete next.mouthSets[key];
  if(next.mouthSets&&!Object.keys(next.mouthSets).length)delete next.mouthSets;
  if(next.mouthAtlas&&entries.every(entry=>entry.mouthSet!==undefined))delete next.mouthAtlas;
  const used=new Set(spriteManifestPaths(next)),sprite={...outfit.sprite,assets:Object.fromEntries(Object.entries(outfit.sprite.assets||{}).filter(([path])=>used.has(path)))};
  for(const key of ['avatarCrop','avatarCropAuto','anatomy']){if(!sprite[key])continue;const rest={...sprite[key]};delete rest[id];if(Object.keys(rest).length)sprite[key]=rest;else delete sprite[key];}
  return {manifest:next,outfit:{...outfit,sprite}};
}
// a single own-image dictionary; no state pools or implicit duplicate calm slot.
function ownSpriteDefinition(images,name,flat=false){
  const assets={},emotions={};
  for(const [id,image] of Object.entries(images)){
    const src='emotions/'+id+'/stage.png';assets[src]=image.hash;
    emotions[id]=flat?{src}:{stage:{src,width:image.width,height:image.height}};
  }
  return {assets,manifest:flat?{version:1,kind:'static-sprites',emotions}:{version:2,kind:'layered-static-sprites',character:{id:'figure',name},closedBehavior:'restore-base',emotions}};
}
// A rewritten sprite keeps per-state calibration only for states whose image did not change.
function replaceOutfitSprite(outfit,sprite,images,changed) {
  const keep=map=>{if(!map)return undefined;const next=Object.fromEntries(Object.entries(map).filter(([id])=>Object.hasOwn(images,id)&&id!==changed));return Object.keys(next).length?next:undefined;};
  const next={manifestKey:sprite.manifestKey,assets:sprite.assets};
  for(const key of ['avatarCrop','avatarCropAuto','anatomy']){const value=keep(outfit.sprite?.[key]);if(value)next[key]=value;}
  return {...outfit,sprite:next};
}

    async function figure({snapshot:c,figureId,outfitKey,emotion,kind,image,media,customEmotion,imageId,auto:autoPatch=async()=>({})}) {
      const packId=c.manifest.id;
        const figure=c.figures[figureId],outfit=figure?.outfits.find(o=>o.key===outfitKey);
        if(!outfit)throw new Error('服装已被删除，请重新载入');
        const original=outfit.sprite&&c.sprites[outfit.sprite.manifestKey],images=outfit.sprite?simpleSpriteImages(outfit,original):{};
        // a layered / lip-synced 立绘 takes a still into a
        // missing (or still) 差分 — only that entry changes (addSpriteStill); its animated states are never rewritten.
        if(kind==='sprite'&&!images&&!(original&&spriteSlotTakesStill(outfit,original,emotion)))throw new Error('这个差分是动态立绘（会动嘴、眨眼），不能直接替换：先删除这张立绘，再生成或上传');
        let next,manifest,spriteKey,spriteFile;
        if(figure.schemaVersion===2){
          const binding=outfit.sprite||{manifestKey:newResourceKey('sprite'),assets:{},imagePools:{}};
          const pool=binding.imagePools[emotion],oldId=imageId||pool?.defaultImageId;
          if(imageId&&!pool?.imageIds.includes(imageId))throw new Error("Selected image is no longer an active candidate");
          if(!customEmotion&&!figure.emotions.some(row=>row.id===emotion))throw new Error('请先创建差分');
          if(kind==='avatar'&&!oldId)throw new Error('请先为这个差分添加立绘');
          const id=newResourceKey('im'),src='images/'+id+'.'+image.descriptor.ext;
          manifest=JSON.parse(JSON.stringify(original||{kind:'static-sprites',version:2,images:{}}));next=JSON.parse(JSON.stringify({...outfit,sprite:binding}));
          if(!original)next.defaultEmotion=emotion;
          if(kind==='avatar'){
            const entry=JSON.parse(JSON.stringify(original.images[oldId]));
            manifest.images[id]=entry;(next.avatars||={})[id]=media.hash;
            for(const field of ['avatarCrop','avatarCropAuto','anatomy'])if(next.sprite[field]?.[oldId])next.sprite[field][id]=JSON.parse(JSON.stringify(next.sprite[field][oldId]));
            next.sprite.imagePools[emotion]={imageIds:pool.imageIds.map(value=>value===oldId?id:value),defaultImageId:pool.defaultImageId===oldId?id:pool.defaultImageId};
          }else{
            manifest.images[id]=manifest.kind==='static-sprites'?{src}:{stage:{src,width:image.width,height:image.height}};
            next.sprite.assets[src]=media.hash;
            next.sprite.imagePools[emotion]={imageIds:[...(pool?.imageIds||[]),id],defaultImageId:oldId||id};
          }
          spriteKey=binding.manifestKey;spriteFile=c.manifest.sprites[spriteKey]||'sprites/'+spriteKey+'/manifest.json';media.files.set(spriteFile,jsonBytes(manifest));
        }
        else if(kind==='avatar')next={...outfit,avatars:{...(outfit.avatars||{}),[emotion]:media.hash}};
        else if(!images){
          const made=addSpriteStill(outfit,original,emotion,{hash:media.hash,width:image.width,height:image.height});
          spriteKey=outfit.sprite.manifestKey;spriteFile=c.manifest.sprites[spriteKey];manifest=made.manifest;next=made.outfit;
          media.files.set(spriteFile,jsonBytes(manifest));
        }
        else{
          const values={...images,[emotion]:{hash:media.hash,width:image.width,height:image.height}},made=ownSpriteDefinition(values,figure.name,original?.kind==='static-sprites');
          spriteKey=outfit.sprite?.manifestKey||newResourceKey('sprite');spriteFile=c.manifest.sprites[spriteKey]||'sprites/'+spriteKey+'/manifest.json';manifest=made.manifest;
          next=replaceOutfitSprite(outfit,{manifestKey:spriteKey,assets:made.assets},values,emotion);
          media.files.set(spriteFile,jsonBytes(manifest));
        }
        const outfits=figure.outfits.map(o=>o.key===outfitKey?next:o),future={...c,manifest:{...c.manifest,blobs:{...c.manifest.blobs,...media.blobs}},sprites:{...c.sprites,...(manifest?{[spriteKey]:manifest}:{})}};
        const auto=await autoPatch(future,figure,{...figure,outfits},{hash:media.hash,sprite:kind==='sprite',autoColor:image.autoColor,bytes:image.bytes,mime:image.descriptor.mime});
        const updated={...figure,...auto,outfits,...(customEmotion?{emotions:[...(figure.emotions||[]),customEmotion]}:{})};
        media.files.set('figures/'+figureId+'.json',jsonBytes(updated));
        return {packId,expectedRevision:c.revision,patch:{blobs:future.manifest.blobs,...(manifest?{sprites:{...c.manifest.sprites,[spriteKey]:spriteFile}}:{})},fileUpdates:media.files};
    }
    return {figure,simpleSpriteImages,spriteStateStatic,spriteSlotTakesStill,spriteManifestPaths,addSpriteStill,removeSpriteEmotion,ownSpriteDefinition,replaceOutfitSprite};
  }
  return {create,closure,publish,jsonBytes};
})();
if(typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) module.exports=assetImagePublication;

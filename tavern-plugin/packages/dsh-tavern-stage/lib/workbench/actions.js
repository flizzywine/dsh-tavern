import {createHash,randomUUID} from 'node:crypto'
import publication from '../../../../shared/asset-image-publication.cjs'
import sprites from '../../../../shared/sprite-emotions.cjs'
import {imageKind,audioKind,imageDimensions} from '../../../dsh-asset-library/lib/pack-v2/media.js'
import {BLOB_MIME_TYPES} from '../../../dsh-asset-library/lib/asset-packs/manifest.js'
import {assetContent} from '../../../dsh-presentation-protocol/src/asset-variant-content.js'
import {featureError,featurePage,featureText} from './projections.js'

const omit=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([k])=>!keys.includes(k)))
const fields=(value,allowed)=>{const key=Object.keys(value).find(k=>!allowed.includes(k));if(key)throw featureError('UNKNOWN_FIELD','$.patch.'+key,'Allowed fields: '+allowed.join(', ')+'.');return value}
const requireService=value=>{if(!value)throw featureError('ASSET_UNAVAILABLE','$');return value}
const authors={figures:['name','remark','aliases','enabled','recall','appearance','heightCm','heightBasis','elevationCm','imageColor','identityAppearance','identitySettei','outfits','emotions','voice','extensions'],
  pack:['name','description','category','aliases','author','license'],engine:['stageToggles','dialogue','dialogueTheme','dialogueThemes','directorModel','dimensions','actionCaps'],
  openings:['lead','scenes','cast'],judge:['enabled','provider','model','baseUrl','keyName','threshold','capPerKind','timeoutMs','preamble']}
const imagePublisher=publication.create({newResourceKey:prefix=>prefix+'-'+randomUUID(),emotionState:(_outfit,manifest,id)=>sprites.spriteEmotionState(manifest,id)})
function media(bytes) {
  const ext=imageKind(bytes)||audioKind(bytes)
  if(!ext)throw featureError('INVALID_INPUT','$.file','Use a supported image or audio file.')
  return {bytes,descriptor:{ext,mime:BLOB_MIME_TYPES[ext],size:bytes.length},...(imageKind(bytes)?Object.fromEntries(['width','height'].map((k,i)=>[k,imageDimensions(bytes,ext)[i]])):{})}
}
function receipt(result,target,changed=[]) {
  return {status:'saved',target,revision:result?.snapshot?.revision ?? result?.revision,changed,
    ...(result?.snapshot?{packId:result.snapshot.manifest.id}:{}),...(!result?.snapshot?{view:result}:{})}
}
function importView(result) {
  if(Array.isArray(result))return result.map(importView)
  if(!result || typeof result!=='object')return result
  return Object.fromEntries(Object.entries(result).filter(([key])=>!['incoming','current','raw','currentRaw','bytes','files'].includes(key)).map(([key,value])=>[key,importView(value)]))
}
async function publishImage(c,input) {
  const snapshot=await c.snapshot(),image=media(await c.files.read(input.file,512*1024**2)),target=input.target
  if(!image.descriptor.mime.startsWith('image/'))throw featureError('INVALID_INPUT','$.file')
  if(snapshot.revision!==input.expectedRevision)throw featureError('REVISION_CONFLICT','$.expectedRevision')
  const closure=await publication.closure(image)
  let request
  if(['avatar','sprite'].includes(target.kind)) {
    fields(target,['kind','figureId','outfitKey','emotionId'])
    request=await imagePublisher.figure({snapshot,image,media:closure,figureId:target.figureId,outfitKey:target.outfitKey,emotion:target.emotionId,kind:target.kind})
  } else if(['settei','identity-settei'].includes(target.kind)) {
    fields(target,['kind','figureId','outfitKey'])
    const figure=structuredClone(snapshot.figures[target.figureId]);if(!figure)throw featureError('ASSET_UNAVAILABLE','$.target.figureId')
    if(target.kind==='identity-settei') {const palette=[];figure.identitySettei={board:closure.hash,palette,version:createHash('sha256').update(JSON.stringify({board:closure.hash,palette})).digest('hex')}}
    else {
      if(!figure.outfits.some(o=>o.key===target.outfitKey))throw featureError('ASSET_UNAVAILABLE','$.target.outfitKey')
      figure.outfits=figure.outfits.map(o=>o.key===target.outfitKey?{...o,settei:closure.hash}:o)
    }
    closure.files.set('figures/'+figure.id+'.json',publication.jsonBytes(figure));request=publication.publish(snapshot,closure)
  } else if(target.kind==='asset') {
    fields(target,['kind','asset','slot','variant'])
    const asset=structuredClone(target.asset)
    if(!['backgrounds','cg','items','props'].includes(asset.kind) || !['media','variant'].includes(target.slot) || target.slot==='variant' && (!asset.variants || typeof target.variant!=='string'))throw featureError('INVALID_INPUT','$.target','Choose an existing supported image slot.')
    const content=assetContent(asset,target.slot==='variant'?target.variant:undefined)
    content.media=closure.hash;delete content.pendingMedia
    const assets=snapshot.manifest.assets.filter(a=>a.id!==asset.id||a.kind!==asset.kind);assets.push(asset)
    request=publication.publish(snapshot,closure,{assets})
  } else throw featureError('INVALID_INPUT','$.target.kind')
  const result=await c.library.patchPack(request)
  return {packId:input.packId,revision:result.snapshot.revision,hash:closure.hash,target,attached:true,warnings:[]}
}
async function assetsRead(c) {
  const {input:r,library}=c
  if(r.action==='settings')return requireService(c.packSettings).read()
  if(r.action==='catalogue')return requireService(library).catalogueSettings()
  if(r.action==='bindings') {
    const value=await c.rpc('getCardAssetBindings',{path:await c.path(r.path)})
    return {...value,boundPackIds:value.extension?.assetBindings.boundPackIds || [],globalEnabledPackIds:requireService(c.packSettings).read().values.globalEnabledPackIds}
  }
  if(r.action==='dependencies')return c.rpc('getAssetPackDependencies',{packId:r.packId})
  if(r.action==='pack') {
    const pack=await c.snapshot()
    return {packId:r.packId,revision:pack.revision,manifest:pack.manifest}
  }
  if(r.action==='schema')return {kind:r.kind,fields:authors[r.kind] || ['kind','id','name','enabled','recall','directorNote','remark',...(r.kind==='directions'?['text']:[])],...(r.kind==='directions'?{example:{kind:'directions',id:'quiet',name:'Quiet direction',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',text:'Keep movements small.'}}:{}),limits:{page:50,imageBytes:6*1024**2,avatarBytes:3*1024**2,backgroundBytes:4*1024**2,audioBytes:60*1024**2,entryBytes:512*1024**2,packBytes:2*1024**3},owner:'asset-library'}
  if(r.action==='list') {
    const global=requireService(c.packSettings).read().values.globalEnabledPackIds
    const binding=c.chat.cardPath?await c.rpc('getCardAssetBindings',{path:c.chat.cardPath}):null
    const bound=binding?.extension?.assetBindings.boundPackIds || []
    const rows=(await requireService(library).listPackSummaries()).filter(p=>!p.privateConfig && (!r.query||p.name?.toLowerCase().includes(r.query.toLowerCase()))).map(p=>({packId:p.packId,name:p.name,revision:p.revision,counts:p.counts,scope:{global:global.includes(p.packId),card:c.chat.cardPath?bound.includes(p.packId):null},...(p.error?{error:p.error}:{})}))
    return {path:c.chat.cardPath || null,...featurePage(rows,r)}
  }
  if(r.action==='resolve') {
    const named=r.refs.findIndex(ref=>Object.hasOwn(ref,'name'))
    if(named!==-1)throw featureError('UNKNOWN_FIELD','$.refs['+named+'].name','Name lookup is not accepted here. Read assets_read item with packId and kind; select its id, then resolve {packId,figureId:id} for figures or {packId,kind,assetId:id} for assets.')
    const figures=r.refs.filter(v=>v.figureId),assets=r.refs.filter(v=>!v.figureId)
    return {figures:figures.length?await requireService(library).resolveFigures({refs:figures}):[],assets:assets.length?await library.resolveAssets({refs:assets}):[]}
  }
  const pack=await c.snapshot()
  let rows
  if(r.kind==='figures')rows=Object.values(pack.figures)
  else if(r.kind==='sprites')rows=Object.entries(pack.sprites).map(([id,author])=>({id,...author}))
  else if(r.kind==='voices')rows=Object.entries(pack.manifest.voiceLibrary?.voices||{}).map(([id,author])=>({id,...author}))
  else if(r.kind==='bundles')rows=Object.entries(pack.manifest.bundles).map(([id,author])=>({id,...author}))
  else rows=pack.manifest.assets.filter(a=>a.kind===r.kind)
  if(r.id)rows=rows.filter(row=>row.id===r.id)
  else rows=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>['id','kind','name','enabled','appearance'].includes(key))))
  return {packId:r.packId,revision:pack.revision,kind:r.kind,...featurePage(rows,r)}
}
async function assetsPatch(c) {
  const {input:r,library}=c,args=omit(r,'action')
  requireService(library)
  if(r.packId)await c.snapshot()
  if(r.action==='bind')return c.rpc('saveCardAssetBindings',{path:await c.path(r.path),expectedRevision:r.expectedRevision,patch:{assetBindings:{boundPackIds:r.boundPackIds}}})
  if(r.action==='global-packs') {
    for(const packId of r.globalEnabledPackIds)await c.snapshot(packId)
    return requireService(c.packSettings).save(args)
  }
  if(r.action==='catalogue-settings')return library.saveCatalogueSettings(args)
  if(r.action==='patch-pack')fields(args.patch,authors.pack)
  if(r.action==='patch-figure')fields(args.patch,authors.figures)
  if(r.action==='create-figure')args.figure={schemaVersion:1,outfits:[],...args.figure}
  if(['item','remove-item'].includes(r.action)) {
    const before=await c.snapshot(),item=r.item
    const next=before.manifest.assets.filter(a=>r.action==='item'?(a.kind!==item.kind||a.id!==item.id):(a.kind!==r.kind||a.id!==r.id))
    if(item)next.push(item)
    return receipt(await library.patchPack({packId:r.packId,expectedRevision:r.expectedRevision,patch:{assets:next}}),r.packId,['assets'])
  }
  const methods={'create-pack':'createPack','patch-pack':'patchPack','remove-pack':'removePack','create-figure':'createFigure','patch-figure':'patchFigure','remove-figure':'removeFigure',copy:'copyItems','avatar-crop':'setFigureAvatarCrop','emotion-fallback':'setFigureEmotionFallback','remove-emotion':'removeFigureEmotion'}
  return receipt(await library[methods[r.action]](args),r.figureId||r.packId||r.action,Object.keys(r.patch||{}))
}
async function upload(c) {
  const r=c.input
  if(r.action==='image')return publishImage(c,r)
  if(['blob','bundle'].includes(r.action))await c.snapshot()
  if(r.action==='bundle')return receipt(await c.library.putBundle({packId:r.packId,expectedRevision:r.expectedRevision,bundleKey:r.bundleKey,descriptor:{kind:r.kind,entry:r.entry},files:await c.files.directory(r.directory)}),r.bundleKey)
  const image=media(await c.files.read(r.file,60*1024**2))
  if(r.action==='mod-media')return c.library.putModMedia({...omit(r,'action','file'),mime:image.descriptor.mime,bytes:image.bytes})
  if(r.action==='blob') {
    if(!image.descriptor.mime.startsWith('audio/'))throw featureError('INVALID_INPUT','$.purpose','Images must be atomically bound with action image.')
    const result=await c.library.putBlob({packId:r.packId,expectedRevision:r.expectedRevision,bytes:image.bytes,descriptor:image.descriptor})
    return {packId:r.packId,revision:result.snapshot.revision,hash:result.hash,...image.descriptor,attached:false}
  }
  const args={...omit(r,'action','file'),mime:image.descriptor.mime,data:image.bytes.toString('base64')}
  if(r.action==='mod-file')args.cardId=await c.cardId()
  return c.rpc('uploadModConfigFile',args)
}
async function transfer(c) {
  const {input:r,library}=c,args=omit(r,'action','kind','output')
  requireService(library)
  if(r.action==='inspect') {
    const file=await c.files.locate(r.file)
    return importView(await (r.kind==='card'?library.inspectCardBundleFile({path:await c.path(r.path),file}):library.inspectImportFile({file})))
  }
  if(r.action==='inspect-url')return importView(await library.inspectCardBundleUrl({path:await c.path(r.path),url:r.url}))
  if(r.action==='preview-card')return importView(await library.previewCardBundleDecisions(args))
  if(r.action==='apply-pack')return importView(await library.applyImport({...args,acceptScriptRisk:c.approved&&r.acceptScriptRisk===true}))
  if(r.action==='apply-card')return importView(await library.applyCardBundle({...args,acceptScriptRisk:c.approved&&r.acceptScriptRisk===true}))
  if(r.action==='export-pack') {
    if(!r.packs.length)throw featureError('INVALID_INPUT','$.packs')
    const archive=r.packs.length===1?await library.exportPack(r.packs[0]):await library.exportPacks({packs:r.packs})
    return c.files.export(r.output,archive)
  }
  if(r.action==='export-card')return c.files.export(r.output,await library.exportCardBundle({...args,path:await c.path(r.path)}))
  const methods={refresh:'refreshCatalogue',updates:'checkPackUpdates',download:'startPackDownload',status:'getPackDownload',control:'controlPackDownload'}
  if(r.action==='control'){args.action=args.actionId;delete args.actionId}
  if(r.action==='download'&&r.url)delete args.useMirrorPrefix
  return importView(await library[methods[r.action]](args))
}
async function stage(c) {
  const r=c.input,write=c.name==='stage_patch'
  if(r.action==='schema')return {section:r.section,fields:authors[r.section],owner:'asset-engine'}
  if(r.action==='card') {
    const cardPath=await c.path(r.path),before=await c.rpc('getCardAssetBindings',{path:cardPath})
    if(!write)return {bindings:before,openings:await c.rpc('getCardOpeningScenes',{path:cardPath})}
    fields(r.patch,['openings','defaultSkin']);const patch=omit(r.patch,'defaultSkin')
    if(Object.hasOwn(r.patch,'defaultSkin'))patch.stage={...before.extension?.stage,defaultSkin:r.patch.defaultSkin}
    return c.rpc('saveCardAssetBindings',{path:cardPath,expectedRevision:r.expectedRevision,patch})
  }
  if(r.action==='engine')return c.rpc(write?'saveAssetEngineSettings':'getAssetEngineSettings',write?{expectedRevision:r.expectedRevision,patch:fields(r.patch,authors.engine)}:{})
  if(r.action==='judge') {
    if(write)return c.rpc('saveJudgeConfig',{expectedRevision:r.expectedRevision,config:fields(r.patch,authors.judge)})
    const value=await c.rpc('getJudgeConfig',{});return {...value,credentialStatus:value.config.provider==='unset'?null:await c.rpc('getJudgeCredentialStatus',{provider:value.config.provider,keyName:value.config.keyName})}
  }
  if(r.action==='judge-test')return c.rpc('testJudgeConnection',{})
  if(r.action==='bubbles')return c.rpc('getDialogueBubbles',{sessionId:c.sessionId})
  if(r.action==='bubble-preview')return c.rpc('previewDialogueBubbleInstruction',{sessionId:c.sessionId,config:r.config})
  const result=await c.rpc('previewStageDirectorPrompt',{sessionId:await c.play(r.playRef),turn:r.turn})
  const sections=result.sections || []
  return {toolSchemaBytes:result.toolSchemaBytes,sections:sections.map(s=>({name:s.name||s.id,bytes:s.bytes})),...featureText(JSON.stringify(r.section?sections.find(s=>(s.name||s.id)===r.section):omit(result,'tools','toolSchema')),r)}
}
async function mods(c) {
  const r=c.input,args=omit(r,'action'),read=c.name==='mods_read'
  const methods=read?{list:'listMods',mod:'getMod',packs:'listModPacks',config:'getModConfig',resolve:'resolveModConfig',sources:'listModConfigSources',formula:'evaluateModConfigFormula'}:
    {settings:'saveModSettings',pack:'saveModPack',config:'setModConfig','clear-config':'clearModConfig'}
  // An editor session is not a play snapshot; config sources here are card/global only.
  if(!['settings','pack'].includes(r.action))args.cardId=await c.cardId()
  return c.rpc(methods[r.action],args)
}
async function voice(c) {
  const r=c.input,args=omit(r,'action','offset','limit'),read=c.name==='voice_read'
  if(read) {
    if(r.action==='figure')return c.rpc('getFigureVoiceEditor',args)
    if(r.action==='choices')return c.rpc('listFigureVoiceChoices',{})
    if(r.action==='templates')return requireService(c.library).listVoiceTemplates()
    const method={services:'services','provider-kinds':'providerKinds',voices:'listVoices',models:'listModels',presets:'voicePresets',reading:'reading',readings:r.id?'readingPreset':'readingPresets'}[r.action]
    const result=await requireService(c.tts).call(method,args)
    if(Array.isArray(result))return featurePage(result,r)
    if(result && ['voices','models','readings'].includes(r.action)) {
      const key=['voices','models','entries','presets'].find(k=>Array.isArray(result[k]));if(key)return {...omit(result,key),[key]:featurePage(result[key],r)}
    }
    return result
  }
  if(r.packId)await c.snapshot()
  if(r.action==='assign-figure') {fields(r.choice,['voiceId','serviceId','language','voiceSpec']);return c.rpc('assignFigureVoice',{...omit(args,'choice'),...r.choice})}
  const packMethods={binding:'saveFigureVoiceBinding','pack-voice':'savePackVoice','save-template':'saveVoiceTemplate','assign-template':'assignVoiceTemplate','remove-template':'deleteVoiceTemplate'}
  if(packMethods[r.action])return receipt(await requireService(c.library)[packMethods[r.action]]({...args,...(r.action==='pack-voice'?{confirmShared:c.approved===true}:{})}),r.figureId||r.voiceId||r.templateId)
  const methods={'save-service':'saveService','remove-service':'deleteService','test-service':'testService','save-preset':'saveVoicePreset','remove-preset':'deleteVoicePreset','reading-create':'createReadingPreset','reading-rename':'renameReadingPreset','reading-remove':'deleteReadingPreset','reading-active':'setActiveReadingPreset','reading-edit':'editReading'}
  if(r.force===true&&!r.reason?.trim())throw featureError('INVALID_INPUT','$.reason')
  delete args.reason
  return requireService(c.tts).call(methods[r.action],args)
}
async function generation(c) {
  const r=c.input,args=omit(r,'action')
  if(r.action==='prepare') {
    if(r.references)args.references=await Promise.all(r.references.map(async ref=>{
      fields(ref,['file','hash','role']);if(!!ref.file===!!ref.hash)throw featureError('INVALID_INPUT','$.references')
      if(ref.hash)return ref
      const image=media(await c.files.read(ref.file,8*1024**2));return {base64:image.bytes.toString('base64'),mediaType:image.descriptor.mime,role:ref.role}
    }))
    const result=await c.rpc('prepareAssetGeneration',args)
    for(const [id,plan]of c.plans)if(plan.view.expiresAt<=Date.now())c.plans.delete(id)
    if(c.plans.size>=32)throw featureError('LIMIT_EXCEEDED','$')
    c.plans.set(result.planId,{sessionId:c.sessionId,view:result})
    return result
  }
  if(r.action==='generate') {
    const plan=c.plans.get(r.planId)
    if(!plan||plan.sessionId!==c.sessionId||plan.view.expiresAt<=Date.now()||plan.view.consentToken!==r.consentToken)throw featureError('EXPIRED','$.planId','Prepare again in this workbench.')
    const view=plan.view
    await c.confirm(`${view.imageCount} 张 = ${view.imageCount} 个单图请求；外层模型可能另收文字费用，金额由供应商决定；失败、超时、取消、无图不保证免费。\n`+JSON.stringify({target:view.target,provider:view.provider,output:view.output,references:view.references,...(view.confirmNewRequestIds?.length?{unconfirmed:view.confirmNewRequestIds,warning:'上次结果未确认，可能已经收费，本次可能再次收费'}:{})}))
    return c.rpc('generateAssetCandidate',{...args,confirmNewRequestIds:view.confirmNewRequestIds||[]})
  }
  if(r.action==='read') {
    const job=await c.rpc('getAssetGenerationJob',{jobId:r.jobId})
    return {job,review:{page:'asset-library',packId:job.target?.packId,jobId:r.jobId,action:'Open the application candidate review; select adoption and cropping there.'}}
  }
  return c.rpc({status:'getAssetGenerationJob',cancel:'cancelAssetGenerationJob',reject:'rejectAssetCandidate','retry-save':'retryAssetCandidateSave',list:'listAssetCandidates'}[r.action],args)
}
const handlers={assets_read:assetsRead,assets_patch:assetsPatch,media_upload:upload,assets_transfer:transfer,stage_read:stage,stage_patch:stage,mods_read:mods,mods_patch:mods,voice_read:voice,voice_patch:voice,asset_generation:generation}
export async function runWorkbenchAction(name,context) {
  if(!handlers[name])throw featureError('UNKNOWN_FIELD','$.tool')
  return handlers[name]({...context,name})
}

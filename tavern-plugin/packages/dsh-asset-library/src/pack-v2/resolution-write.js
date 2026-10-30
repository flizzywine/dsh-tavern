import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {check, canonicalJson} from '../asset-packs/common.js'
import {imageDimensions,imageKind,STAGE_IMAGE_MAX_BYTES} from './media.js'
import {jsonBytes, readDocument} from './validation.js'
import {assetContents, assetContentMedia} from '../shared/asset-variant-content.js'
import policy from '../shared/media-resolution.cjs'

// The existing isolated media encoder owns native DLL loading, also for master writes.
export function encodeResolution(bytes, width, height, compare = false) {
  return new Promise((resolve, reject) => {
    const child=spawn(process.execPath,[fileURLToPath(new URL('./thumbnail-encoder.js',import.meta.url)),'master',String(width),String(height),compare?'compare':'png'],{
      windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:120000
    }), output=[], errors=[]
    child.stdout.on('data',chunk=>output.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk))
    child.on('error',reject);child.stdin.on('error',reject)
    child.on('close',code=>{
      if(code!==0)return reject(new Error(Buffer.concat(errors).toString()||'Media encoder exited: '+code))
      try {const result=JSON.parse(Buffer.concat(output));resolve({...result,bytes:Buffer.from(result.bytes,'base64')})}catch(error){reject(error)}
    })
    child.stdin.end(bytes)
  })
}

// Only independent raster bindings are closed here. Sprite/atlas/model/authoring
// evidence remains native until its entire geometry contract can be transformed.
export function resolutionBindings(manifest, figures) {
  const refs=new Map()
  const add=(hash,kind,replace,binding)=>{if(!hash)return;const rows=refs.get(hash)||[];rows.push({kind,replace,binding});refs.set(hash,rows)}
  for(const figure of Object.values(figures)) {
    add(figure.identitySettei?.board,'unknown')
    for(const outfit of figure.outfits) {
      add(outfit.settei,'unknown')
      for(const [key,hash] of Object.entries(outfit.avatars||{}))add(hash,'avatar',next=>{outfit.avatars[key]=next},`figure/${figure.id}/${outfit.key}/avatar/${key}`)
      for(const hash of Object.values(outfit.sprite?.assets||{}))add(hash,'unknown')
    }
  }
  for(const hash of manifest.backgroundStyle?.references||[])add(hash,'unknown')
  for(const [index,icon] of (manifest.tagIcons||[]).entries())add(icon.media,'icon',next=>{icon.media=next},'icon/'+index)
  for(const asset of manifest.assets) {
    for(const [index,content] of assetContents(asset).entries())if(content.media)add(content.media,['props','cg'].includes(asset.kind)?asset.kind:'unknown',next=>{content.media=next},`asset/${asset.id}/${index}`)
    if(asset.kind==='looks')for(const {hash} of assetContentMedia(asset))add(hash,'unknown')
  }
  return refs
}

export async function applyResolutionWrites({manifest,files,previous,hashed=new Map(),read,targets,restore,encode=encodeResolution,compare=false}) {
  const figures=Object.fromEntries(manifest.figures.map(id=>[id,readDocument(files.get('figures/'+id+'.json'))]))
  const bindings=resolutionBindings(manifest,figures), priorBindings=previous?resolutionBindings(previous.manifest,previous.figures):new Map(), changes=[], diagnostics=[]
  let provenance
  const provenanceFile='credits/media-resolution.json'
  async function records() {
    if(provenance)return provenance.records
    const pointer=manifest.extensions?.['dsh.media-resolution']
    if(pointer) {
      check(pointer.version===1&&pointer.file===provenanceFile,'$.extensions.dsh.media-resolution','Invalid resolution provenance pointer')
      const value=files.get(provenanceFile)
      provenance=readDocument(Buffer.isBuffer(value)?value:await read(provenanceFile,value.length))
      check(provenance.version===1&&provenance.records&&typeof provenance.records==='object'&&!Array.isArray(provenance.records),'$.resolution','Invalid resolution provenance')
    } else {
      check(!files.has(provenanceFile),'$.resolution','Provenance path is already owned by author content')
      provenance={version:1,records:{}}
    }
    return provenance.records
  }
  const selection=restore||targets
  if(selection)for(const hash of Object.keys(selection))check(manifest.blobs[hash],'$.targets','Source is no longer present','REVISION_CONFLICT')
  for(const [hash,descriptor] of Object.entries(manifest.blobs)) {
    if(!['png','jpeg','webp'].includes(descriptor.ext))continue
    const name='media/'+hash+'.'+descriptor.ext, value=files.get(name)
    const refs=bindings.get(hash)||[]
    const prior=priorBindings.get(hash)||[]
    const changed=!previous?.manifest.blobs[hash]||refs.some(ref=>!prior.some(old=>old.kind===ref.kind&&old.binding===ref.binding))
    if(selection ? !Object.hasOwn(selection,hash) : !changed)continue
    if(!refs.length||refs.some(ref=>ref.kind==='unknown')) {
      diagnostics.push({source:hash,code:'RESOLUTION_GEOMETRY_UNKNOWN',action:'retain-native'})
      if(selection)check(false,'$.targets.'+hash,'Dependent or unbounded geometry must retain native media','RESOLUTION_GEOMETRY_UNKNOWN')
      continue
    }
    const bytes=Buffer.isBuffer(value)?value:await read(name,value.length)
    const source=imageDimensions(bytes,descriptor.ext),longSide=policy.MEDIA_RESOLUTION_POLICY.longSide
    const scale=Math.min(1,longSide/Math.max(...source))
    let output=targets?.[hash]||source.map(n=>Math.max(1,Math.round(n*scale))),result
    if(restore) {
      const original=restore[hash],history=await records()
      check(refs.every(ref=>ref.kind==='avatar'),'$.restore.'+hash,'Only independent avatar sources can be retained','RESOLUTION_GEOMETRY_UNKNOWN')
      check(Buffer.isBuffer(original.bytes),'$.restore.'+hash,'Expected original source bytes')
      const originalBytes=Buffer.from(original.bytes),ext=imageKind(originalBytes)
      check(['png','jpeg','webp'].includes(ext)&&createHash('sha256').update(originalBytes).digest('hex')===original.hash,'$.restore.'+hash,'Original source identity differs','INVALID_MEDIA')
      output=imageDimensions(originalBytes,ext)
      check(history[hash]?.sources?.some(row=>row.source===original.hash&&String(row.sourcePixels)===String(output)),'$.restore.'+hash,'Original source is not in this master provenance','INVALID_MEDIA')
      check(Math.max(...output)<=longSide,'$.restore.'+hash,'Original exceeds approved master cap','RESOLUTION_ENCODING_LIMIT')
      result={bytes:originalBytes,width:output[0],height:output[1],format:ext}
    } else {
      check(Array.isArray(output)&&output.length===2&&output.every((n,i)=>Number.isInteger(n)&&n>0&&n<=source[i]&&n<=longSide),'$.targets.'+hash,'Invalid target dimensions; stored upscaling is forbidden')
      check(Math.abs(output[0]/source[0]-output[1]/source[1])<=1/Math.min(...source),'$.targets.'+hash,'Resolution changes must preserve aspect ratio')
      if(String(source)===String(output))continue
      // Separate files still share the outfit's detected reference/head contract.
      // Resampling is not detection-equivariant; only the avatar authority may rebuild it.
      check(!refs.some(ref=>ref.kind==='avatar'),'$.targets.'+hash,'Avatar masters require the complete framing authority; generic downscaling is forbidden','RESOLUTION_AVATAR_AUTHORITY')
      if(manifest.extensions?.['dsh.media-resolution'])check(!(await records())[hash]?.retainedReason,'$.targets.'+hash,'Source retained after avatar framing regression; a new reviewed plan is required','RESOLUTION_FRAMING_GATE')
      result=await encode(bytes,...output,compare&&changes.length<3)
      check(result.width===output[0]&&result.height===output[1]&&result.format==='png','$.resolution','Encoder dimensions or format differ','INVALID_MEDIA')
    }
    check(result.bytes.length<=STAGE_IMAGE_MAX_BYTES,'$.resolution.'+hash,'Lossless candidate exceeds stage media byte limit; source requires format review','RESOLUTION_ENCODING_LIMIT')
    const nextHash=createHash('sha256').update(result.bytes).digest('hex'),nextName='media/'+nextHash+'.'+result.format
    if(nextHash===hash)continue
    for(const ref of refs)ref.replace(nextHash)
    manifest.blobs[nextHash]={ext:result.format,mime:'image/'+result.format,size:result.bytes.length}
    files.set(nextName,result.bytes);hashed.set(nextName,nextHash)
    delete manifest.blobs[hash];files.delete(name)
    const history=await records(),inherited=history[hash]?.sources||[{source:hash,sourcePixels:source,sourceQuality:'unknown'}]
    const record={sources:[...new Map([...(history[nextHash]?.sources||[]),...inherited].map(row=>[row.source,row])).values()],masterPixels:output,recipe:restore?'display-density/1/retain-native-avatar':'display-density/1/png',approval:'inherited-no-new-art',...(restore?{retainedReason:'avatar-framing-regression'}:{})}
    history[nextHash]=record
    delete history[hash]
    changes.push({...record,previous:hash,hash:nextHash,beforeBytes:bytes.length,afterBytes:result.bytes.length,savedBytes:bytes.length-result.bytes.length,measurements:result.measurements})
  }
  for(const [id,figure] of Object.entries(figures)) {
    const name='figures/'+id+'.json'
    if(canonicalJson(readDocument(files.get(name)))!==canonicalJson(figure))files.set(name,jsonBytes(figure))
  }
  if(provenance) {
    (manifest.extensions||={})['dsh.media-resolution']={version:1,file:provenanceFile}
    manifest.credits=[...new Set([...(manifest.credits||[]),provenanceFile])]
    files.set(provenanceFile,jsonBytes(provenance))
  }
  return {changes,diagnostics}
}

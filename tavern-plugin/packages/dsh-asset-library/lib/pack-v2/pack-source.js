// the native offline build path shared by both CLI entrypoints.
import path from 'node:path'
import {readFile,mkdir,lstat} from 'node:fs/promises'
import {verifyBytes,PACK_LIMITS,jsonBytes,sealPack} from './validation.js'
import {importFigureVariants} from './import-figure-variants.js'
import {normalizeFigureAliases} from '../asset-packs/figure-names.js'
import {PACK_BUDGET} from './budget.js'
import {decodeMedia} from './media.js'
import {writeZip,zipPath} from '../zip.js'
import {validatePackManifest,validatePackKeywords} from '../asset-packs/index.js'
export async function sourceBytes(source, relative) {
  try {zipPath(relative)} catch {throw new Error('Unsafe native source path')}
  source=path.resolve(source)
  let file=path.parse(source).root
  for(const part of [...path.relative(file,source).split(path.sep),...relative.split('/')].filter(Boolean)) {
    file=path.join(file,part)
    if((await lstat(file)).isSymbolicLink())throw new Error('Linked pack source rejected')
  }
  return readFile(file)
}
export async function sealNativePack(manifest, files) {
  manifest=structuredClone(manifest)
  for (const id of manifest.figures) {
    const file='figures/'+id+'.json', figure=JSON.parse(files.get(file))
    if (figure.aliases !== undefined) {
      const aliases=normalizeFigureAliases(figure.name,figure.aliases)
      if (JSON.stringify(aliases)!==JSON.stringify(figure.aliases)) files.set(file,jsonBytes({...figure,aliases}))
    }
  }
  // Preserve the player's manifest order and identity on an unchanged export/rebuild.
  await sealPack(manifest,files)
  const figures=Object.fromEntries(manifest.figures.map(id=>[id,JSON.parse(files.get('figures/'+id+'.json'))]))
  const sprites=Object.fromEntries(Object.entries(manifest.sprites).map(([key,file])=>[key,JSON.parse(files.get(file))]))
  validatePackKeywords({manifest,figures})
  // digests were computed from these bytes just above; validate content only.
  await verifyBytes(manifest,files,{decodeMedia,limits:{...PACK_LIMITS,...PACK_BUDGET},sealed:true})
  return {manifest,figures,sprites,files,notes:[]}
}
export async function compileNativePackSource(source, {prepare} = {}) {
  const meta=JSON.parse(await sourceBytes(source,'pack-source.json'))
  if(meta.version!==1||typeof meta.manifest!=='string'||Object.keys(meta).some(k=>!['version','id','name','description','manifest'].includes(k)))throw new Error('Invalid native pack-source metadata')
  const manifest=JSON.parse(await sourceBytes(source,meta.manifest))
  if(manifest.id!==meta.id)throw new Error('Native source identity differs from pack-source metadata')
  validatePackManifest(manifest)
  const files=new Map(await Promise.all(manifest.files.map(async f=>[f.path,await sourceBytes(source,f.path)])))
  // Native source folders are an import boundary, including pre-declaration packs.
  const figures=Object.fromEntries(manifest.figures.map(id=>[id,JSON.parse(files.get('figures/'+id+'.json'))]))
  const sprites=Object.fromEntries(Object.entries(manifest.sprites).map(([key,file])=>[key,JSON.parse(files.get(file))]))
  const converted=importFigureVariants(manifest,figures,sprites)
  Object.assign(manifest,converted.manifest)
  for(const [id,figure]of Object.entries(converted.figures))if(JSON.stringify(figure)!==JSON.stringify(figures[id]))files.set('figures/'+id+'.json',jsonBytes(figure))
  if (prepare) await prepare(manifest,files)
  return sealNativePack({...manifest,name:meta.name,...(meta.description?{description:meta.description}:{})},files)
}
export async function writeNativePack(pack, output) {
  await mkdir(path.dirname(path.resolve(output)),{recursive:true})
  await writeZip(output,[{path:'manifest.json',data:Buffer.from(JSON.stringify(pack.manifest,null,2)+'\n')},...[...pack.files].map(([path,data])=>({path,data}))])
  return {id:pack.manifest.id,files:pack.files.size,output:path.resolve(output)}
}

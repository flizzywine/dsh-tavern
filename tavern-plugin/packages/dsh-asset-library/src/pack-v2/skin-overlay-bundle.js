// Loaded only for skins with overlays; all dependencies stay in their verified bundle.
import overlayContract from '../shared/skin-overlay.cjs'
import atlasSchema from '../schema/atlas.schema.json' with {type:'json'}
import glyphSchema from '../schema/glyphs.schema.json' with {type:'json'}
import {check} from '../asset-packs/common.js'
const {validateSkinSchema}=overlayContract
export async function validateSkinOverlayBundle(skin,{prefix,bundlePrefix=prefix,files,inspectMedia,decodeMedia}) {
  const dependencies=new Set(),frames=new Set()
  const json=(name,max=262144)=>{
    const bytes=files.get(prefix+name)
    check(bytes?.length<=max,name,'Missing or oversized overlay document','MISSING_DEPENDENCY')
    dependencies.add(prefix+name)
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))
  }
  let total=0
  for(const [name,bytes]of files) if(name.startsWith(bundlePrefix)) total+=bytes.length
  check(total<=6*1024**2,prefix,'Overlay bundle exceeds 6 MiB','LIMIT_EXCEEDED')
  for(const name of skin.overlay.atlases) {
    const atlas=validateSkinSchema(atlasSchema,json(name)),image=prefix+atlas.meta.image,bytes=files.get(image)
    check(bytes,image,'Atlas image missing','MISSING_DEPENDENCY');dependencies.add(image)
    const dimensions=await inspectMedia(bytes,{ext:'webp',mime:'image/webp',size:bytes.length},decodeMedia)
    check(dimensions.width===atlas.meta.size.w&&dimensions.height===atlas.meta.size.h,image,'Atlas dimensions differ')
    for(const [id,item]of Object.entries(atlas.frames)) {
      check(item.frame.x+item.frame.w<=dimensions.width&&item.frame.y+item.frame.h<=dimensions.height,name,'Atlas frame outside image')
      check(item.sourceSize.w>0&&item.sourceSize.h>0,name,'Invalid source frame size')
      frames.add(id.split('@')[0])
    }
    check(!atlas.meta.dsh.privateUse || skin.license?.privateUse===true,name,'Private atlas cannot be relabelled public')
  }
  const glyphs=validateSkinSchema(glyphSchema,json('glyphs/'+skin.overlay.glyphs+'.json',1024**2))
  check(!glyphs.meta.privateUse || skin.license?.privateUse===true,'$.overlay.glyphs','Private glyphs cannot be relabelled public')
  for(const glyph of Object.values(glyphs.glyphs)) check(glyph.d.length<=131072,'$.glyphs','Glyph path limit','LIMIT_EXCEEDED')
  const frame=id=>check(id.startsWith('label:') ? Object.hasOwn(skin.overlay.labels||{},id.slice(6)) : id.startsWith('decal:') ? Object.hasOwn(skin.overlay.decals||{},id.slice(6)) : frames.has(id),'$.overlay','Unknown overlay frame '+id)
  function references(value) {
    if(!value||typeof value!=='object')return
    for(const [key,item]of Object.entries(value)) {
      if(key==='frame'&&typeof item==='string')frame(item)
      else if(key==='frames'&&Array.isArray(item))item.forEach(frame)
      else references(item)
    }
  }
  references(skin.overlay)
  return dependencies
}

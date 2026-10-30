'use strict';
// Plain skins never request or evaluate the optional first-party renderer chunk.
function createSkinOverlayLoader(load = () => import('/api/dsh-tavern/client-assets/skin-overlay.mjs')) {
    let pending;
    return document => {
        if (!document?.overlay) return Promise.resolve(null);
        if (!pending) pending = Promise.resolve().then(load).catch(error => {pending=null;throw error;});
        return pending;
    };
}
// Atlas frames are views of the owner's decoded image, not independently decoded copies.
function borrowSkinOverlayTextures({definition,handle,entry='skin.json'}) {
    const base=entry.slice(0,entry.lastIndexOf('/')+1), textures={};
    for (const name of definition.atlases) {
        const atlas=handle.files[base+name]?.json;
        const image=atlas && handle.files[base+atlas.meta.image]?.image;
        if (!atlas || !image) throw new Error('Prepared overlay atlas is missing');
        for (const [id,value] of Object.entries(atlas.frames)) {
            const match=id.match(/^(.*)@(\d+)$/), key=match ? match[1] : id, variant=match ? Number(match[2]) : 0;
            (textures[key] ||= [])[variant]={image,frame:value.frame,width:value.sourceSize?.w || value.frame.w,height:value.sourceSize?.h || value.frame.h};
        }
    }
    return textures;
}
function prepareSkinOverlayTextures({definition,handle,entry,owner,createScript,canvas:makeCanvas=() => document.createElement('canvas')}) {
    const textures=borrowSkinOverlayTextures({definition,handle,entry}), allocated=[];
    const base=(entry || 'skin.json').slice(0,(entry || 'skin.json').lastIndexOf('/')+1);
    const glyphs=handle.files[base+'glyphs/'+definition.glyphs+'.json']?.json;
    const script=glyphs && createScript(glyphs,{normalize:text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'')});
    const allocate=(w,h) => {
        const allocation=owner.reserveBytes(Math.ceil(w)*Math.ceil(h)*4), canvas=makeCanvas();
        canvas.width=Math.ceil(w);canvas.height=Math.ceil(h);allocated.push({canvas,allocation});return canvas;
    };
    const dispose=() => {for(const {canvas,allocation} of allocated) {canvas.width=canvas.height=0;allocation.release();}allocated.length=0;};
    try {
        for(const [id,label] of Object.entries(definition.labels || {})) {
            if(!script) throw new Error('Prepared overlay glyph set is missing');
            const size=label.size || 30, image=allocate(script.measure(label.text,size)+size,size*1.8), context=image.getContext('2d');
            context.fillStyle=label.paper || '#ffffff';context.fillRect(0,0,image.width,image.height);
            script.draw(context,label.text,size/2,size*1.2,{size,color:label.ink || '#111111'});
            textures['label:'+id]=[image];
        }
        for(const [id,decal] of Object.entries(definition.decals || {})) {
            const original=textures[decal.frame]?.[0];if(!original) throw new Error('Prepared overlay decal frame is missing');
            const image=allocate(original.width,original.height),context=image.getContext('2d'),f=original.frame;
            context.drawImage(original.image,f.x,f.y,f.w,f.h,0,0,image.width,image.height);
            if(decal.kind==='runes' && script) script.draw(context,decal.text,(decal.u || .5)*image.width,(decal.v || .5)*image.height,{align:'center',size:(decal.size || .08)*image.height,color:decal.ink || '#111111'});
            textures['decal:'+id]=[image];
        }
        return {textures,script,dispose};
    } catch(error) {dispose();throw error;}
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createSkinOverlayLoader,borrowSkinOverlayTextures,prepareSkinOverlayTextures};

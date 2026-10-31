function createStageDanmakuAvatar({Image}) {
// The host face's image source, or null: only an image URL the stage may load as a CSS background. Pure; tests.
function danmakuAvatarSrc(view) {
    const src = view?.streamer?.avatar?.src;
    return typeof src === 'string' && src.length <= 2000000 && /^(data:image\/(png|jpeg|webp|gif);base64,|blob:|\/(?!\/))/.test(src) ? src : null;
}
// view.streamer.avatar.crop — the fraction box {x, y, w, h} of the sprite the panel's avatar shows — or null. Pure; tests.
function danmakuCrop(crop) {
    const ok = crop && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(crop[k])) && crop.w > 0 && crop.h > 0 && crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001;
    return ok ? crop : null;
}
// The background (CSS size and position, in %) that fills a round face with a crop of a width × height image: the crop's
// shorter side spans the face, centred on the crop. Pure; tests.
function danmakuFaceCrop(crop, width, height) {
    const side = Math.min(crop.w * width, crop.h * height), w = width / side, h = height / side;
    const at = (size, centre) => Math.abs(1 - size) < 1e-6 ? 50 : (0.5 - centre) / (1 - size) * 100, pct = n => Math.round(n * 1000) / 1000 + '%';
    return { size: pct(w * 100) + ' ' + pct(h * 100), position: pct(at(w, (crop.x + crop.w / 2) * w)) + ' ' + pct(at(h, (crop.y + crop.h / 2) * h)) };
}
// Each renderer owns its pending avatar loads; unloading cancels callbacks and releases images.
const sizes=new Map();let disposed=false;
function danmakuFaceSize(src,ready){
 if(disposed)return null;
 const known=sizes.get(src);
 if(known?.width)return known;
 if(known){known.waiting.add(ready);return null;}
 const img=new Image(),entry={img,waiting:new Set([ready])};sizes.set(src,entry);
 const release=()=>{img.onload=null;img.onerror=null;entry.waiting.clear();};entry.release=release;
 if(sizes.size>16){const key=sizes.keys().next().value;sizes.get(key).release();sizes.delete(key);}
 img.onload=()=>{if(disposed)return;entry.width=img.naturalWidth;entry.height=img.naturalHeight;const waiting=[...entry.waiting];release();for(const fn of waiting)fn();};
 img.onerror=()=>{release();if(sizes.get(src)===entry)sizes.delete(src);};
 img.src=src;return null;
}
function dispose(){if(disposed)return;disposed=true;for(const entry of sizes.values())entry.release();sizes.clear();}

return {danmakuAvatarSrc, danmakuCrop, danmakuFaceCrop, danmakuFaceSize, dispose};
}
if(typeof module!=='undefined'&&typeof window==='undefined')module.exports={createStageDanmakuAvatar};

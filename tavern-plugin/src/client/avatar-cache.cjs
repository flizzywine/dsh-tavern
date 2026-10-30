// Session bitmaps survive virtual-row unmounts, independently of source-media pins.
// PNG canvas encoding waits for main-thread idle time, which a scrolling
// transcript does not have; lossless WebP is encoded off the main thread.
function createAvatarCache({urls = globalThis.URL, image = () => new Image(), maxEntries = 384,
    canvas = () => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1,1) : document.createElement('canvas')} = {}) {
    const entries = new Map(), bases = new Map(), revisions = new Map(), listeners = new Set();
    let session = null, epoch = 0;
    const base = value => JSON.stringify([value.ref?.packId, value.revision, value.ref?.figureId,
        value.outfitKey, value.stateId, value.identity, value.crop && [value.crop.x,value.crop.y,value.crop.w,value.crop.h]]);
    const key = (value, px, dpr) => JSON.stringify([base(value), Math.max(1,Math.round(px * dpr))]);
    const valid = value => session !== null && value?.sessionId === session && revisions.get(value.ref?.packId) === value.revision;
    // a ready entry owns its Blob URL and the decoded image that keeps the
    // URL in the document's available-image list, so a new <img> paints in its first frame.
    function drop(id, entry) {
        if (entries.get(id) === entry) entries.delete(id);
        if (bases.get(entry.base) === id) {
            bases.delete(entry.base);
            for (const [other,value] of entries) if (value.base === entry.base && value.url) bases.set(entry.base,other);
        }
        entry.image = null;
        if (entry.url) urls.revokeObjectURL(entry.url);
    }
    function clear() {
        epoch++;
        for (const [id,entry] of [...entries]) drop(id,entry);
        entries.clear(); bases.clear();
    }
    function emit() { for (const listener of listeners) listener(); }
    // entries are keyed by content (pack revision, figure, outfit, state,
    // identity, crop, size), so a chat switch keeps them; returning to a chat no longer re-encodes every avatar.
    // Only the selected session reads (valid()); pack revision changes still revoke; the LRU bound is unchanged.
    function select(id) {
        if (id === session) return;
        revisions.clear(); session = id; emit();
    }
    function revision(packId, revision) {
        const changed = revisions.has(packId) && revisions.get(packId) !== revision;
        if (changed) clear();
        revisions.set(packId,revision);
        if (changed) emit();
    }
    // LRU ownership is session-wide, never tied to a virtual row.
    function touch(id, entry) {
        entries.delete(id); entries.set(id,entry);
        return entry.url;
    }
    function get(value, px = 64, dpr = globalThis.devicePixelRatio || 1) {
        const id = key(value,px,dpr), entry = valid(value) && entries.get(id);
        return entry?.url ? touch(id,entry) : null;
    }
    function ready(value) {
        if (!valid(value)) return null;
        // Indexed: every mounted transcript row probes this on each cache notification.
        const id = bases.get(base(value)), entry = id && entries.get(id);
        return entry?.url ? touch(id,entry) : null;
    }
    function prepare(value, src, px = 64, dpr = globalThis.devicePixelRatio || 1, loadedImage) {
        // dedicated (uncropped) pack avatars are cached exactly like sprite crops.
        if (!valid(value) || !src) return Promise.resolve(null);
        const id = key(value,px,dpr), existing = entries.get(id);
        if (existing) return existing.promise;
        if (entries.size >= maxEntries) {
            const oldest = [...entries].find(([,entry]) => entry.url);
            if (!oldest) return Promise.resolve(null);
            drop(oldest[0],oldest[1]);
        }
        const generation = epoch, entry = {base:base(value),url:null};
        entries.set(id,entry);
        // Defer work until the shared promise is installed, including synchronous mock decoders.
        entry.promise = Promise.resolve().then(async () => {
            const source = loadedImage || image();
            if (!loadedImage) {
                await new Promise((resolve,reject) => {
                    source.onload = resolve; source.onerror = reject; source.src = src;
                });
                source.onload = source.onerror = null;
            }
            if (generation !== epoch || !valid(value)) return null;
            const size = Math.max(1,Math.round(px * dpr)), target = canvas();
            target.width = target.height = size;
            const crop = (typeof getStageAvatarCrop === 'function' ? getStageAvatarCrop(src,value.crop) : value.crop) || {x:0,y:0,w:1,h:1};
            const sw = source.naturalWidth * crop.w, sh = source.naturalHeight * crop.h;
            if (!(sw > 0 && sh > 0)) throw new Error('Invalid avatar dimensions');
            const scale = Math.min(size / sw,size / sh), width = sw * scale, height = sh * scale;
            // CPU-backed: encoding a GPU canvas waits on a pixel readback behind the stage's WebGL work.
            target.getContext('2d',{willReadFrequently:true}).drawImage(source,source.naturalWidth * crop.x,source.naturalHeight * crop.y,sw,sh,
                (size - width) / 2,(size - height) / 2,width,height);
            const blob = await (typeof target.convertToBlob === 'function' ? target.convertToBlob({type:'image/webp',quality:1})
                : new Promise(resolve => target.toBlob(resolve,'image/webp',1)));
            if (!blob || generation !== epoch || !valid(value)) return null;
            const url = urls.createObjectURL(blob), display = image();
            try {
                await new Promise((resolve,reject) => { display.onload = resolve; display.onerror = reject; display.src = url; });
                await display.decode?.();
            } catch (_) { /* The URL remains usable; only the first-frame guarantee is lost. */ }
            display.onload = display.onerror = null;
            if (generation !== epoch || !valid(value) || entries.get(id) !== entry) {
                urls.revokeObjectURL(url); return null;
            }
            entry.url = url; entry.image = display; bases.set(entry.base,id);
            emit(); return entry.url;
        }).catch(() => null).finally(() => {
            if (!entry.url && entries.get(id) === entry) entries.delete(id);
        });
        return entry.promise;
    }
    return {select, revision, get, ready, prepare, clear() { clear(); emit(); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get sessionId() { return session; }};
}
const avatarCache = createAvatarCache();

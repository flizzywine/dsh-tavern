'use strict';

function createStageResourcesModule() {
let stageResourceMeasureCount = 0;
const STAGE_SKIN_INLINE_SVG_BYTES = 2048;

async function stageDecodeImage(blob,url,{avatar = false} = {}) {
    if (!blob.type.startsWith('image/')) return null;
    if (avatar && typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const image = new Image();
    try {
        if (blob.type === 'image/svg+xml') {
            // Inert skin SVG needs its intrinsic geometry, not an eager full-size raster decode.
            // Chromium can defer detached SVG decode() by a throttled frame; load is sufficient for CSS art.
            await new Promise((resolve,reject) => { image.onload = resolve; image.onerror = () => reject(new Error('RESOURCE_DECODE_FAILED')); image.src = url; });
            image.onload = image.onerror = null;
        } else { image.src = url; await image.decode(); }
        return image;
    } catch (error) { image.onload = image.onerror = null; image.src = ''; throw error; }
}

// metadata follows local URLs, never transport/content identities.
const stageAvatarCrops = new Map();
function getStageAvatarCrop(url, fallback) { return stageAvatarCrops.get(url) || fallback; }
// a bundle's entry URL → its borrowed files (relative path → {url, json?, image?}),
// so a renderer that needs sibling files (a Spine atlas and its pages) borrows the owner's decoded copies.
const stageBundleFiles = new Map();
function getStageBundleFiles(url) { return stageBundleFiles.get(url) || null; }
function stageAvatarCap(dpr = globalThis.devicePixelRatio || 1) {
    // --cl-face <= (20 + 17*1.5 + 4 + 28*5.1 + 36)*1.5 = 342.45 CSS px.
    return Math.max(512, Math.ceil(342.45 * dpr / 128) * 128);
}
// OffscreenCanvas avoids main-thread canvas idle slices. Canvas WebP quality=1
// is still lossy, so automatic tiers use PNG rather than claiming losslessness.
function stageAvatarCanvas() {
    return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1,1) : document.createElement('canvas');
}
function stageAvatarEncode(target) {
    return typeof target.convertToBlob === 'function' ? target.convertToBlob({type:'image/png'})
        : new Promise(resolve => target.toBlob(resolve,'image/png'));
}
async function stageAvatarBitmap(image, crop, canvas = stageAvatarCanvas, cap = stageAvatarCap()) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    crop ||= {x:0,y:0,w:1,h:1};
    const sw = width * crop.w, sh = height * crop.h, side = Math.max(sw,sh);
    if (!(side > 0 && sw > 0 && sh > 0)) throw new Error('Invalid avatar dimensions');
    // Keep ALL left overflow. The face square is flush with the stage bottom;
    // retain its bottom letterbox plus a 1/4-square guard for the CSS drop-shadow.
    // Pixels further down the body cannot reach the visible screen.
    const right = width * (crop.x + crop.w), top = height * crop.y;
    const bottom = Math.min(height,top + sh + (side - sh) / 2 + (crop.x || crop.y || crop.w !== 1 || crop.h !== 1 ? side / 4 : 0));
    const scale = Math.min(1,cap / side), target = canvas();
    target.width = Math.max(1,Math.ceil(right * scale));
    target.height = Math.max(1,Math.ceil((bottom - top) * scale));
    try {
        // a CPU-backed canvas. With the default GPU canvas, encoding read the
        // pixels back from the GPU while Live2D was drawing: 0.5-2 s main-thread stalls per new face offline.
        const context = target.getContext('2d',{willReadFrequently:true});
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image,0,top,right,bottom-top,0,0,right*scale,(bottom-top)*scale);
        const blob = await stageAvatarEncode(target);
        if (!blob) throw new Error('Avatar encoding failed');
        return {blob,width:target.width,height:target.height,crop:{x:width*crop.x*scale/target.width,y:0,
            w:sw*scale/target.width,h:sh*scale/target.height}};
    } finally { target.width = target.height = 0; }
}

function stageMediaTier(descriptor, options = {}) {
    if (descriptor.kind === 'bundle') return null;
    if (Object.hasOwn(descriptor,'crop')) return {kind:'avatar',size:stageAvatarCap()};
    if (options.preview) {
        const {width,height,dpr = globalThis.devicePixelRatio || 1} = options.preview;
        return {kind:'preview',width:Math.max(1,Math.ceil(width*dpr)),height:Math.max(1,Math.ceil(height*dpr))};
    }
    return null;
}
async function stagePreviewBitmap(image, tier, canvas = stageAvatarCanvas) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const scale = Math.min(1,tier.width/width,tier.height/height), target = canvas();
    target.width = Math.max(1,Math.ceil(width*scale)); target.height = Math.max(1,Math.ceil(height*scale));
    try {
        const context = target.getContext('2d',{willReadFrequently:true});
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        context.drawImage(image,0,0,target.width,target.height);
        const blob = await stageAvatarEncode(target);
        if (!blob) throw new Error('Preview encoding failed');
        return {blob,width:target.width,height:target.height};
    } finally { target.width = target.height = 0; }
}

// one transport/byte owner. Presentation and replacement pins share
// content handles; tickets are transport only, never a renderer's identity.
function stageResourceMatches(descriptor, scope) {
    const ref = descriptor?.ref || descriptor;
    return !!scope.authority || !!scope.packId && ref?.packId === scope.packId ||
        (scope.refs || []).some(item => item.packId === ref?.packId && item.kind === ref?.kind && item.assetId === ref?.assetId && item.figureId === ref?.figureId) ||
        (scope.aliases || []).includes(descriptor?.alias);
}
function createStageResourceOwner({service, fetch: request = globalThis.fetch, urls = globalThis.URL,
    decode = async () => null, avatarBitmap = stageAvatarBitmap, previewBitmap = stagePreviewBitmap,
    maxTierBytes = 64 * 1024 ** 2, maxBytes = 2 * 1024 ** 3, maxItems = 2048}) {
    const allocations = new Set();
    const entries = new Map(), getService = typeof service === 'function' ? service : () => service;
    let bytes = 0, disposed = false, lastBudgetFailure = null, uses = 0;
    function diagnostics() {
        const byKind = {};
        for (const entry of entries.values()) {
            const kind = entry.descriptor.kind === 'bundle' ? 'bundle' : entry.descriptor.ref?.kind || 'media';
            const row = byKind[kind] ||= {bytes:0, entries:0, pins:0, prefetchPins:0};
            row.bytes += entry.bytes; row.entries++; row.pins += entry.pins;
            row.prefetchPins += [...entry.holders].filter(pin => pin.prefetch).length;
        }
        if (allocations.size) byKind.performance = {bytes:[...allocations].reduce((n,a) => n + a.bytes,0),entries:allocations.size,pins:allocations.size,prefetchPins:0};
        // Device-tier bytes by the usages pinning them: what a budget failure could not evict.
        const tiers = {bytes:0, maxBytes:maxTierBytes, entries:0, pinnedBytes:0, byUsage:{}};
        for (const entry of entries.values()) if (entry.tier) {
            tiers.bytes += entry.tierBytes; tiers.entries++;
            if (entry.pins) tiers.pinnedBytes += entry.tierBytes;
            for (const usage of new Set([...entry.holders].map(pin => pin.prefetch ? 'prefetch' : pin.usage))) {
                const row = tiers.byUsage[usage] ||= {bytes:0, entries:0}; row.bytes += entry.tierBytes; row.entries++;
            }
        }
        return {bytes, entries:entries.size + allocations.size, maxBytes, maxItems, byKind, tiers};
    }
    const failure = code => Object.assign(new Error(code), {code});
    const keyFor = (descriptor, authority, tier = stageMediaTier(descriptor)) => JSON.stringify([authority,descriptor.identity,
        ...(Object.hasOwn(descriptor,'crop') ? [descriptor.crop ? [descriptor.crop.x,descriptor.crop.y,descriptor.crop.w,descriptor.crop.h] : null] : []),
        ...(tier ? ['device-tier/1',tier] : [])]);
    function tierRoom(size, requester) {
        const used = () => [...entries.values()].reduce((sum,e)=>sum+e.tierBytes,0);
        for (const entry of entries.values()) {
            if (used()+size <= maxTierBytes) break;
            if (entry === requester || !entry.tier) continue;
            for (const pin of [...entry.holders]) if (pin.prefetch) pin.release();
            if (!entry.pins) destroy(entry);
        }
        if (used()+size > maxTierBytes) {
            lastBudgetFailure = {...diagnostics(), requestedBytes:size, requestedKind:'tier', identity:requester?.descriptor.identity};
            throw Object.assign(failure('RESOURCE_TIER_BUDGET'), {budget:lastBudgetFailure});
        }
    }
    function destroy(entry) {
        if (entries.get(entry.key) === entry) entries.delete(entry.key);
        entry.dead = true;
        for (const url of entry.urls) { stageAvatarCrops.delete(url); stageBundleFiles.delete(url); urls.revokeObjectURL(url); }
        for (const image of entry.decoded) image?.close?.();
        bytes -= entry.bytes; entry.bytes = 0; entry.tierBytes = 0; entry.urls.length = 0; entry.decoded.length = 0;
        if (entry.lease) void entry.service.releaseLease(entry.lease.ticket);
        entry.lease = null;
    }
    function room(size, count = 0, requester) {
        const fits = () => bytes + size <= maxBytes && entries.size + allocations.size + count <= maxItems;
        if (fits()) return;
        // least recently used speculative holders are expendable, including in-flight
        // preloads. Never evict the entry whose bytes are currently being accounted.
        for (const entry of entries.values()) {
            if (fits()) break;
            if (entry === requester) continue;
            for (const pin of [...entry.holders]) if (pin.prefetch) pin.release();
            if (!entry.pins) destroy(entry);
        }
        if (!fits()) {
            lastBudgetFailure = {...diagnostics(), requestedBytes:size, requestedEntries:count,
                requestedKind:requester?.descriptor.kind, identity:requester?.descriptor.identity};
            throw Object.assign(failure('RESOURCE_BUDGET'), {budget:lastBudgetFailure});
        }
    }
    async function issue(descriptor, service) {
        const lease = await service[descriptor.kind === 'bundle' ? 'leaseBundle' : 'leaseMedia']({packId:descriptor.ref.packId,
            ...(descriptor.kind === 'bundle' ? {bundleKey:descriptor.bundleKey} : {hash:descriptor.hash})});
        // Content identity, not the pack revision: a stage holds descriptors minted before another publication of the same
        // pack (a blink install while it plays); unchanged content stays leasable, changed content is stale.
        if (lease.revision !== descriptor.revision && lease.contentHash !== descriptor.hash) { void service.releaseLease(lease.ticket); throw failure('ASSET_STALE'); }
        return lease;
    }
    function valid(entry) { if (disposed || entry.dead) throw failure('RESOURCE_REVOKED'); }
    async function load(entry) {
        let phaseAt = globalThis.performance?.now();
        const measure = phase => {
            if (phaseAt === undefined) return;
            const end = globalThis.performance.now();
            if (++stageResourceMeasureCount > 256) { globalThis.performance.clearMeasures('dsh.stage.resource'); stageResourceMeasureCount = 1; }
            globalThis.performance.measure('dsh.stage.resource',{start:phaseAt,end,detail:{phase,kind:entry.descriptor.ref?.kind || entry.descriptor.kind}});
            phaseAt = end;
        };
        entry.service = getService();
        const lease = await issue(entry.descriptor,entry.service);
        if (disposed || entry.dead) { void entry.service.releaseLease(lease.ticket); throw failure('RESOURCE_REVOKED'); }
        // The lease covers the transfer only: once the bytes are local it is released below. A cached entry holding its
        // lease kept every Live2D bundle's files (29 on average for a large card) counted against the host's 2,048 leased-resource
        // limit, so a long session ran out and every new background, figure and skin read failed (LIMIT_EXCEEDED).
        entry.lease = lease; measure('lease');
        const absolute = url => new URL(url, 'http://stage.invalid').href;
        const files = new Map();
        const pendingFiles = [...(entry.descriptor.kind === 'bundle' ? lease.resources : [lease.url])];
        const skin = entry.descriptor.kind === 'bundle' && entry.descriptor.ref?.kind === 'skins';
        async function readBlob(url) {
            const response = await request(url, {credentials:'same-origin',
                priority:skin || entry.descriptor.ref?.kind === 'backgrounds' ? 'high' : 'auto'});
            valid(entry);
            if (!response.ok) throw Object.assign(failure('RESOURCE_READ_FAILED'),{status:response.status});
            const length = Number(response.headers.get('content-length'));
            if (length) room(length,0,entry);
            const chunks = [], reader = response.body?.getReader();
            if (reader) try {
                for (;;) {
                    const {done,value} = await reader.read(); valid(entry);
                    if (done) break;
                    room(value.byteLength,0,entry); bytes += value.byteLength; entry.bytes += value.byteLength;
                    chunks.push(value);
                }
            } catch (error) {await reader.cancel().catch(() => {}); throw error;}
            finally {reader.releaseLock();}
            const type = response.headers.get('content-type') || '';
            return {blob:new Blob(chunks,{type}),type};
        }
        async function readFile(url) { files.set(absolute(url), {...await readBlob(url), url}); }
        // Bound bundle I/O instead of serialising model, textures and every motion.
        // Settle all workers before cleanup so late reads cannot resurrect byte accounting.
        let readError;
        async function worker() {
            while (pendingFiles.length && !readError) {
                try {await readFile(pendingFiles.shift());}
                catch (error) {readError ||= error;}
            }
        }
        let transferred = false;
        if (skin) try {
            const {blob:body,type} = await readBlob(lease.url + '?bundle=1&deferFonts=1');
            const form = await new Response(body,{headers:{'Content-Type':type}}).formData();
            valid(entry);
            let payloadBytes = 0;
            for (const url of pendingFiles) {
                const blob = form.get(url);
                if (blob === 'deferred-font' && /\.woff2$/i.test(url)) {
                    files.set(absolute(url),{url,local:url,deferredFont:true});
                    continue;
                }
                if (!(blob instanceof Blob)) throw failure('RESOURCE_READ_FAILED');
                files.set(absolute(url),{blob,url}); payloadBytes += blob.size;
            }
            bytes += payloadBytes - body.size; entry.bytes += payloadBytes - body.size;
            transferred = true;
        } catch (error) { if (error.status !== 413) throw error; }
        if (!transferred) {
            await Promise.all(Array.from({length:Math.min(6,pendingFiles.length)},worker));
            if (readError) throw readError;
        }
        entry.lease = null; void entry.service.releaseLease(lease.ticket);
        measure('transfer');
        // Bundle dependencies become local resources before the model is published.
        // Rewriting all JSON references also covers deferred motions/expressions.
        const materialize = async (key, visiting = new Set()) => {
            const file = files.get(key);
            if (file.local) return file.local;
            if (visiting.has(key)) throw failure('RESOURCE_BUNDLE_CYCLE');
            const next = new Set(visiting).add(key);
            let blob = file.blob;
            if (/\.json(?:\?|$)/i.test(file.url)) {
                const rewrite = async value => {
                    if (typeof value === 'string') {
                        // Empty metadata is not a dependency: URL('', key) points back to this JSON.
                        if (!value.trim()) return value;
                        const target = absolute(new URL(value, key).href);
                        return files.has(target) ? materialize(target,next) : value;
                    }
                    if (Array.isArray(value)) return Promise.all(value.map(rewrite));
                    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k,v]) => [k,await rewrite(v)])));
                    return value;
                };
                const document = JSON.parse(await blob.text());
                file.json = document;
                // Glyph-set ids have an implicit, verified bundle path in dsh.skin/1.
                if (document.schema === 'dsh.skin/1' && document.overlay?.glyphs) document.overlay.glyphs = 'glyphs/' + document.overlay.glyphs + '.json';
                blob = new Blob([JSON.stringify(await rewrite(document))], {type:'application/json'});
                const delta = blob.size - file.blob.size;
                room(Math.max(0,delta),0,entry); bytes += delta; entry.bytes += delta; file.blob = blob;
            }
            valid(entry);
            if (entry.tier && blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') {
                const sourceUrl = urls.createObjectURL(blob);
                let source, avatar, temporaryBytes = 0;
                try {
                    source = await decode(blob,sourceUrl,{avatar:true}); valid(entry);
                    if (source) {
                        const size = (source.naturalWidth || source.width)*(source.naturalHeight || source.height)*4;
                        room(size,0,entry); bytes += size; entry.bytes += size; temporaryBytes = size;
                        avatar = entry.tier.kind === 'avatar' ? await avatarBitmap(source,entry.descriptor.crop,undefined,entry.tier.size)
                            : await previewBitmap(source,entry.tier);
                    }
                    valid(entry);
                } finally {
                    if (!entry.dead) { bytes -= temporaryBytes; entry.bytes -= temporaryBytes; }
                    if (source?.close) source.close();
                    else if (source && 'src' in source) source.src = '';
                    urls.revokeObjectURL(sourceUrl);
                }
                if (avatar) {
                    const decodedBytes = avatar.width * avatar.height * 4;
                    const delta = avatar.blob.size + decodedBytes - blob.size;
                    tierRoom(avatar.blob.size+decodedBytes,entry);
                    room(Math.max(0,delta),0,entry);
                    bytes += delta; entry.bytes += delta; entry.decodedBytes += decodedBytes;
                    entry.tierBytes = avatar.blob.size+decodedBytes;
                    file.blob = avatar.blob;
                    file.local = urls.createObjectURL(avatar.blob); entry.urls.push(file.local);
                    if (avatar.crop) stageAvatarCrops.set(file.local,avatar.crop);
                    // retain the cropped image too, not only its Blob URL.
                    // Otherwise revisiting a sprite avatar can trigger another browser decode.
                    entry.decoded.push(await decode(avatar.blob,file.local)); valid(entry);
                    return file.local;
                }
            }
            // Tiny, already-validated static skin SVG avoids one synchronous browser Blob registration per icon. Only tiny:
            // a skin's art URLs become --art-* tokens on the stage root, and every root style write re-serialises the whole
            // style text (2 KB inline art keeps it short; 128 KB made one skin's root style 1.6 MB, ~1.4 ms per property write).
            if (skin && blob.type === 'image/svg+xml' && blob.size <= STAGE_SKIN_INLINE_SVG_BYTES) file.local = 'data:image/svg+xml,' + encodeURIComponent(await blob.text());
            else { file.local = urls.createObjectURL(blob); entry.urls.push(file.local); }
            const image = await decode(blob,file.local);
            file.image = image;
            entry.decoded.push(image); valid(entry);
            // compressed image bytes do not bound retained decoded memory.
            const decodedBytes = image ? (image.naturalWidth || image.width || 0) * (image.naturalHeight || image.height || 0) * 4 : 0;
            room(decodedBytes,0,entry); bytes += decodedBytes; entry.bytes += decodedBytes; entry.decodedBytes += decodedBytes;
            return file.local;
        };
        const url = await materialize(absolute(lease.url));
        // Consumers borrow decoded bundle files under the same pin, never fetch a second copy.
        const borrowed = Object.create(null), base = new URL('.',absolute(lease.url));
        // The entry can live in a subdirectory; file keys are relative to the lease root.
        const marker = '/lease/' + encodeURIComponent(lease.ticket) + '/';
        const root = base.pathname.indexOf(marker);
        if (root >= 0) base.pathname = base.pathname.slice(0,root + marker.length);
        const freezeJson = value => {
            if (value && typeof value === 'object') {Object.values(value).forEach(freezeJson); Object.freeze(value);}
            return value;
        };
        if (entry.descriptor.kind === 'bundle') for (const [key,file] of files) {
            const path = new URL(key);
            if (path.origin !== base.origin || !path.pathname.startsWith(base.pathname)) throw failure('RESOURCE_BUNDLE_PATH');
            const relative = decodeURIComponent(path.pathname.slice(base.pathname.length));
            if (!relative || relative.split('/').some(part => part === '..' || part === '.' || part.includes('\\'))) throw failure('RESOURCE_BUNDLE_PATH');
            await materialize(key);
            // a skin's own WOFF2 face lends its bytes (FontFace from data, no font-src fetch).
            // A deferred font is read later under a lease of its own (the transfer lease is gone), so it reads at any time.
            const loadFont = file.deferredFont ? () => {
                valid(entry);
                // One lazy read shared by every font role, still accounted and revoked by the skin owner.
                return file.loading ||= (async () => {
                    const fontLease = await issue(entry.descriptor,entry.service);
                    try {
                        valid(entry);
                        const marker = '/lease/' + encodeURIComponent(fontLease.ticket) + '/';
                        const root = fontLease.url.slice(0,fontLease.url.indexOf(marker) + marker.length);
                        return (await readBlob(root + relative.split('/').map(encodeURIComponent).join('/'))).blob;
                    } finally { void entry.service.releaseLease(fontLease.ticket); }
                })().catch(error => { file.loading = null; throw error; });
            } : null;
            borrowed[relative] = Object.freeze({url:file.local,...(file.json ? {json:freezeJson(file.json)} : {}),...(file.image ? {image:file.image} : {}),...(/\.woff2$/i.test(relative) ? loadFont ? {load:loadFont} : {blob:file.blob} : {})});
        }
        entry.handle = Object.freeze({identity:entry.descriptor.identity, ref:entry.descriptor.ref, hash:entry.descriptor.hash, url, files:Object.freeze(borrowed)});
        if (entry.descriptor.kind === 'bundle') stageBundleFiles.set(url, entry.handle.files);
        entry.ready = true; measure('decode');
        return entry.handle;
    }
    async function acquire(descriptor, authority, {prefetch = false, usage = 'external', signal, preview} = {}) {
        if (signal?.aborted) throw failure('RESOURCE_CANCELLED');
        if (disposed) throw failure('RESOURCE_DISPOSED');
        const tier = stageMediaTier(descriptor,{preview}), key = keyFor(descriptor,authority,tier);
        let entry = entries.get(key);
        if (!entry) {
            room(0,1);
            entry = {key, descriptor, tier, tierBytes:0, retired:false, pins:0, holders:new Set(), bytes:0, decodedBytes:0, urls:[], decoded:[], dead:false, ready:false};
            entries.set(key,entry);
            entry.promise = load(entry).catch(error => {destroy(entry); throw error;});
        } else {
            entry.descriptor = descriptor;
            // a hit is the most recent use; room evicts in Map order (true LRU).
            entries.delete(key); entries.set(key,entry);
        }
        entry.pins++; entry.used = ++uses;
        let released = false;
        const holder = {prefetch, usage, release:() => { if (!released) {
            released = true; entry.pins--; entry.holders.delete(holder);
            // gallery scroll must not retain full-resolution decoded images in the warm cache.
            if ((entry.retired || usage === 'cg-gallery' && !entry.tier) && !entry.pins && !entry.dead) destroy(entry);
        } }};
        entry.holders.add(holder);
        const release = holder.release;
        let abort;
        const cancelled = signal && new Promise((_, reject) => {
            abort = () => {release(); reject(failure('RESOURCE_CANCELLED'));};
            signal.addEventListener('abort',abort,{once:true});
        });
        try {
            const handle = await (cancelled ? Promise.race([entry.promise,cancelled]) : entry.promise);
            valid(entry); return {handle, descriptor, release};
        } catch (error) { release(); throw error; }
        finally {if (abort) signal.removeEventListener('abort',abort);}
    }
    return {
        acquire,
        // optional performance layers account for their own canvases/textures.
        reserveBytes(size) {
            if (disposed) throw failure('RESOURCE_DISPOSED');
            if (!Number.isSafeInteger(size) || size < 0) throw failure('RESOURCE_BUDGET');
            room(size,1); bytes += size;
            const allocation = Object.freeze({bytes:size,release() {if (allocations.delete(allocation)) bytes -= size;}});
            allocations.add(allocation); return allocation;
        },
        // the BGM player co-owns the loaded track it plays, so a director handoff
        // releasing the runner's pin cannot revoke a Blob URL that is still sounding.
        retain(identity, authority) {
            const entry = entries.get(keyFor({identity},authority));
            if (!entry?.ready || entry.dead) return null;
            entries.delete(entry.key); entries.set(entry.key,entry);
            entry.pins++;
            let released = false;
            const holder = {prefetch:false, usage:'bgm', release:() => { if (!released) { released = true; entry.pins--; entry.holders.delete(holder); } }};
            entry.holders.add(holder);
            return {handle:entry.handle, release:holder.release};
        },
        // cache probes never acquire leases or publish loading state.
        isPrepared(value, authority) {
            function ready(item) {
                if (item?.resource === true) {
                    const entry = entries.get(keyFor(item,authority));
                    return !!entry?.ready && !entry.dead;
                }
                return !item || typeof item !== 'object' || Object.values(item).every(ready);
            }
            return ready(value);
        },
        // the device-tier bytes and most recent use of an already prepared value (null while any of its
        // resources is not prepared), and the tier budget with its largest prepared entry, so a display group can stay bounded.
        preparedTier(value, authority) {
            let tierBytes = 0, used = 0, ready = true;
            (function walk(item) {
                if (!ready) return;
                if (item?.resource === true) {
                    const entry = entries.get(keyFor(item,authority));
                    if (!entry?.ready || entry.dead) ready = false;
                    else { tierBytes += entry.tierBytes; used = Math.max(used,entry.used); }
                } else if (item && typeof item === 'object') Object.values(item).forEach(walk);
            })(value);
            return ready ? {bytes:tierBytes, used} : null;
        },
        tierBudget: () => ({maxBytes:maxTierBytes, largest:[...entries.values()].reduce((max,entry) => Math.max(max,entry.tierBytes),0)}),
        async prepare(value, authority, options = {}) {
            const pins = [], shared = new Map();
            const abort = () => pins.forEach(pin => pin.release());
            options.signal?.addEventListener('abort',abort,{once:true});
            // subtrees without resources are copied synchronously; awaiting every
            // JSON node of a ~0.5 MB projection chained thousands of microtasks into one long task per page.
            const holds = new WeakMap();
            const has = item => {
                if (!item || typeof item !== 'object') return false;
                if (item.resource === true) return true;
                if (!holds.has(item)) holds.set(item,(Array.isArray(item) ? item : Object.values(item)).some(has));
                return holds.get(item);
            };
            const copy = item => {
                if (Array.isArray(item)) return item.map(copy);
                if (!item || typeof item !== 'object') return item;
                const result = {}; for (const [k,v] of Object.entries(item)) result[k] = copy(v); return result;
            };
            async function walk(item) {
                if (options.signal?.aborted) throw failure('RESOURCE_CANCELLED');
                if (item?.resource === true) {
                    const key = JSON.stringify([keyFor(item,authority,stageMediaTier(item,options)),item.alias]);
                    // options.onResource(item, error?) hears each resource settle.
                    if (!shared.has(key)) shared.set(key,acquire(item,authority,options).then(pin => {pins.push(pin); options.onResource?.(item); return pin.handle.url;},
                        error => {options.onResource?.(item,error); throw error;}));
                    return shared.get(key);
                }
                if (!has(item)) return copy(item);
                if (Array.isArray(item)) return Promise.all(item.map(walk));
                if (item && typeof item === 'object') return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([k,v]) => [k,await walk(v)])));
                return item;
            }
            try { return {value:await walk(value), descriptors:value, pins, release() {pins.forEach(pin => pin.release());}}; }
            catch (error) {
                // Sibling loads can still acquire pins after the first rejection.
                await Promise.allSettled(shared.values());
                pins.forEach(pin => pin.release()); throw error;
            }
            finally {options.signal?.removeEventListener('abort',abort);}
        },
        revoke(scope, authority) {
            for (const entry of [...entries.values()]) if ((authority === undefined || JSON.parse(entry.key)[0] === authority) && stageResourceMatches(entry.descriptor,entry.pins ? {...scope,aliases:[]} : scope)) destroy(entry);
        },
        invalidateDerived(scope) {
            for (const entry of [...entries.values()]) if (entry.tier && stageResourceMatches(entry.descriptor,scope)) {
                entry.retired = true;
                // Display pins keep their pixels until handoff, but cannot warm the cache.
                if (!entry.pins) destroy(entry);
            }
        },
        snapshot: () => ({bytes, items:entries.size + allocations.size, pins:[...entries.values()].reduce((n,e) => n + e.pins,0)}),
        debug: () => ({...diagnostics(), lastBudgetFailure, resources:[...entries.values()].map(entry => ({
            identity:entry.descriptor.identity, kind:entry.descriptor.kind, ref:entry.descriptor.ref, alias:entry.descriptor.alias,
            bytes:entry.bytes, decodedBytes:entry.decodedBytes, ready:entry.ready,
            avatar:Object.hasOwn(entry.descriptor,'crop'), tier:entry.tier, tierBytes:entry.tierBytes, retired:entry.retired,
            pins:[...entry.holders].map(pin => ({prefetch:pin.prefetch,usage:pin.usage}))
        }))}),
        dispose() { disposed = true; for (const entry of [...entries.values()]) destroy(entry); for (const allocation of [...allocations]) allocation.release(); }
    };
}
return {stageDecodeImage, createStageResourceOwner, stageResourceMatches, stageAvatarBitmap, stageAvatarCap, stageMediaTier, stagePreviewBitmap, getStageAvatarCrop, getStageBundleFiles};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageResourcesModule};

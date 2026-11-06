'use strict';
function createStageLoader({getService, fetch, URL, AbortController, decodeImage, spinnerArt}) {
const reads = new Map(), done = new Map(), owners = new Set();
let disposed = false;
function galEntryLoaderKey(skin) {
    const art = !skin?.builtin && skin?.ref && skin.bundleKey ? skin.document?.art : null;
    return art?.spinner ? JSON.stringify([skin.ref.packId, skin.bundleKey, skin.entry || '', art.spinner, art.screen, art.screenWidth]) : '';
}

function read(key, skin) {
    if (disposed) return Promise.reject(new Error('Stage loader disposed'));
    if (reads.has(key)) return reads.get(key);
    const controller = new AbortController(), urls = new Set();
    let closed = false;
    const close = () => {
        closed = true;
        controller.abort();
        for (const url of urls) URL.revokeObjectURL(url);
        urls.clear();
        owners.delete(close);
    };
    owners.add(close);
    const check = () => {if (closed) throw new Error('Stage loader disposed');};
    const task = (async () => {
        const service = getService();
        const lease = await service.leaseBundle({packId:skin.ref.packId, bundleKey:skin.bundleKey});
        try {
            check();
            const {spinner, screen, screenWidth} = skin.document.art, entry = skin.entry || '';
            const dir = entry.includes('/') ? entry.replace(/[^/]*$/, '') : '';
            const names = spinner.parts ? spinner.parts.map(part => part.image) : [spinner.image];
            const marker = '/lease/' + encodeURIComponent(lease.ticket) + '/';
            const base = lease.url.slice(0, lease.url.indexOf(marker) + marker.length);
            const images = Object.fromEntries(await Promise.all([...new Set(names)].map(async name => {
                const response = await fetch(base + (dir + name).split('/').map(encodeURIComponent).join('/'),
                    {credentials:'same-origin', priority:'high', signal:controller.signal});
                if (!response.ok) throw new Error('RESOURCE_READ_FAILED ' + response.status);
                const blob = await response.blob();
                check();
                const url = URL.createObjectURL(blob);
                urls.add(url);
                const image = await decodeImage(blob, url);
                check();
                return [name, {url, width:image.naturalWidth || image.width, height:image.naturalHeight || image.height}];
            })));
            check();
            const art = spinnerArt(spinner, images, {height:screen, width:screenWidth});
            done.set(key, art);
            return art;
        } finally { await service.releaseLease(lease.ticket); }
    })().then(art => {check(); return art;}).catch(error => {
        close();
        reads.delete(key);
        if (!disposed) done.set(key, null);
        throw error;
    });
    reads.set(key,task);
    return task;
}
return {
    key:galEntryLoaderKey, read, get:key => done.get(key), has:key => done.has(key),
    dispose() {if (disposed) return; disposed = true; for (const close of [...owners]) close(); reads.clear(); done.clear();}
};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageLoader};

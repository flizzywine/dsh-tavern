// browser port for the authenticated v2 package transport.
function createPackTransport({fetch: request = fetch, interval = 2000} = {}) {
    const root = '/api/dsh-asset-library/v2/', listeners = new Set(), unavailable = new Set(), jobs = new Set();
    let active = true, ready = false, sequence = 0, timer;
    const failure = code => Object.assign(new Error(code), {code});
    async function send(path, options = {}, binary = false, timeoutMs = 30000) {
        if (!active) throw failure('ASSET_UNAVAILABLE');
        const controller = new AbortController(); jobs.add(controller);
        const timeout = setTimeout(() => controller.abort(failure('TIMEOUT')), timeoutMs);
        try {
            const response = await request(root + path, {credentials:'same-origin', ...options, signal:controller.signal});
            const result = binary && response.ok ? new Uint8Array(await response.arrayBuffer()) : await response.json();
            // the host's plain reason (download failures: the HTTP status) rides along as detail.
            if (!response.ok) throw Object.assign(failure(result.error || 'ASSET_UNAVAILABLE'), {revision:result.revision, ...(typeof result.message === 'string' ? {detail:result.message} : {})});
            if (!active) throw failure('ASSET_UNAVAILABLE');
            return result;
        } finally { clearTimeout(timeout); jobs.delete(controller); }
    }
    // cold catalogue integrity validation can exceed the ordinary RPC deadline.
    // Aborting it does not cancel server warming; it used to require a manual Reload afterward.
    const control = (method, args = {}) => send('control', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method,args})}, false,
        method === 'inspectCardBundleUrl' ? 22 * 60000 : ['exportPack','exportPacks','inspectImport'].includes(method) ? 10 * 60000 : ['listPackSummaries','getPackSnapshot'].includes(method) ? 90000 : 30000);
    // list views read listPackSummaries (a few KB); a pack's full document is read per pack
    // and kept by revision, so reopening 舞台设置 / 素材库 asks only for packs that changed. Every snapshot that passes through
    // (reads and mutation results) refreshes its entry; the change feed drops an entry whose revision moved. Bounded LRU.
    const details = new Map(), DETAILS_MAX = 16;
    function remember(snapshot) {
        const id = snapshot?.manifest?.id;
        if (typeof id !== 'string' || typeof snapshot.revision !== 'string') return snapshot;
        details.delete(id); details.set(id, snapshot);
        while (details.size > DETAILS_MAX) details.delete(details.keys().next().value);
        return snapshot;
    }
    function forget(event) {
        if (!event || event.type === 'reset' || event.type === 'unavailable') { details.clear(); return; }
        const known = typeof event.packId === 'string' && details.get(event.packId);
        if (known && known.revision !== event.revision) details.delete(event.packId);
    }
    // an upload whose caller wants progress (onProgress({loaded, total}), e.g. a
    // 205 MB card ZIP in 导入卡片) goes through XMLHttpRequest, whose upload.onprogress fetch has no equivalent here; same
    // endpoint, deadline, abort and error shape as send().
    function sendWithProgress(path, body, onProgress, timeoutMs) {
        if (!active) return Promise.reject(failure('ASSET_UNAVAILABLE'));
        const controller = new AbortController(); jobs.add(controller);
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            controller.signal.addEventListener('abort', abort);
            const done = () => { controller.signal.removeEventListener('abort', abort); jobs.delete(controller); };
            xhr.open('POST', root + path);
            xhr.withCredentials = true;
            xhr.timeout = timeoutMs;
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress({loaded:event.loaded, total:event.total}); };
            xhr.onload = () => {
                done();
                let result = null;
                try { result = JSON.parse(xhr.responseText); } catch (_) {}
                if (xhr.status < 200 || xhr.status >= 300 || !result) { reject(Object.assign(failure(result?.error || 'ASSET_UNAVAILABLE'), {revision:result?.revision, ...(typeof result?.message === 'string' ? {detail:result.message} : {})})); return; }
                if (!active) { reject(failure('ASSET_UNAVAILABLE')); return; }
                resolve(result);
            };
            xhr.onerror = () => { done(); reject(failure('ASSET_UNAVAILABLE')); };
            xhr.onabort = () => { done(); reject(new DOMException('The upload was aborted.', 'AbortError')); };
            xhr.ontimeout = () => { done(); reject(new DOMException('The upload timed out.', 'TimeoutError')); };
            xhr.send(body);
        });
    }
    async function call(method, input = {}) {
        const {onProgress, ...args} = input, tickets = [];
        const progress = typeof onProgress === 'function' && typeof XMLHttpRequest === 'function' ? onProgress : null;
        const upload = async bytes => { const result = progress ? await sendWithProgress('upload', bytes, progress, 10 * 60000) : await send('upload', {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:bytes}, false, 10 * 60000); tickets.push(result.ticket); return result.ticket; };
        try {
            if (Object.hasOwn(args, 'bytes')) args.bytes = await upload(args.bytes);
            for (const key of ['files','fileUpdates']) if (args[key]) {
                const rows = [];
                for (const [path, bytes] of args[key]) rows.push([path, bytes === null ? null : await upload(bytes)]);
                args[key] = rows;
            }
            // Origin and scope are authenticated by the carrier, never browser arguments.
            delete args.origin; delete args.scope;
            const result = await control(method,args);
            if (method === 'getPackSnapshot') remember(result); else if (result?.snapshot) remember(result.snapshot);
            return result;
        } finally { for (const ticket of tickets) void control('discardUpload',{ticket}).catch(() => {}); }
    }
    const methods = ['listPackSummaries','getPackSnapshot','createPack','patchPack','removePack','putBlob','removeBlob','putBundle','removeBundle','createFigure','patchFigure','removeFigure','removeFigureEmotion','setFigureEmotionFallback','createSimpleSprite','setFigureAvatarCrop','copyFigure','copyItems','resolveAssets','resolveFigures','inspectImport','applyImport','exportPack','exportPacks','exportCardBundle','inspectCardBundle','previewCardBundleDecisions','applyCardBundle','leaseMedia','leaseBundle',
        // the figure voice page writes through the same carrier.
        'savePackVoice','saveFigureVoiceBinding','createAndAssignPackVoice','savePackVoiceVariant','deletePackVoiceVariant','listVoiceTemplates','saveVoiceTemplate','deleteVoiceTemplate','assignVoiceTemplate',
        // same authenticated control port; offered by the UI only with 'url-install'.
        'inspectCardBundleUrl','catalogueSettings','saveCatalogueSettings','refreshCatalogue','checkPackUpdates','startPackDownload','getPackDownload','controlPackDownload',
        // 舞台设定向导, offered by the UI only with 'stage-setup-v1'.
        'getStageSetupStatus','mergeStageSetupPack'];
    const service = {apiVersion:2, capabilities:['packs'], subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        releaseLease(ticket) { return control('releaseLease',{ticket}).catch(() => {}); },
        // The pack's full document at `revision` (a summary's): the kept copy when it is that revision, else one read.
        async packDetail({packId, revision}) { const known = details.get(packId); if (known && known.revision === revision) { remember(known); return known; } return call('getPackSnapshot',{packId}); }};
    for (const method of methods) service[method] = args => call(method,args);
    async function poll() {
        try {
            if (!ready) {
                const caps = await control('capabilities');
                if (caps.apiVersion !== 2 || !caps.capabilities.includes('packs')) throw failure('ASSET_UNAVAILABLE');
                service.capabilities = [...caps.capabilities]; // optional features (catalogue) follow the host.
                ready = true; for (const fn of listeners) fn({type:'available'});
            }
            const feed = await send('changes?since=' + sequence);
            sequence = feed.sequence;
            if (feed.reset) { forget({type:'reset'}); for (const fn of listeners) fn({type:'reset'}); }
            for (const event of feed.changes) { forget(event); for (const fn of listeners) fn(event); }
        } catch (error) {
            if (ready && ['ASSET_UNAVAILABLE','FORBIDDEN','UNAUTHORIZED','NOT_FOUND'].includes(error.code)) { ready = false; sequence = 0; details.clear(); for (const fn of unavailable) fn(); for (const fn of listeners) fn({type:'unavailable'}); }
        } finally { if (active) timer = setTimeout(poll,interval); }
    }
    return {service, available:() => active && ready,
        settings:{read:() => control('settings'),save:args => control('saveSettings',args)},
        onUnavailable(fn) { unavailable.add(fn); return () => unavailable.delete(fn); },
        async bytes(result) { return result.bytes || send('download?ticket=' + encodeURIComponent(result.download.ticket), {}, true); },
        async download(result) {
            for (const archive of result.archives || [result]) {
                // Let the browser download manager stream the authenticated attachment, not a renderer-sized Blob.
                const url = archive.download ? root + 'download?ticket=' + encodeURIComponent(archive.download.ticket) : URL.createObjectURL(new Blob([archive.bytes]));
                const anchor = document.createElement('a'); anchor.href = url; anchor.download = archive.filename || 'asset-pack.zip'; anchor.click();
                if (!archive.download) setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        },
        start() { void poll(); },
        dispose() { if (!active) return; active = false; ready = false; details.clear(); clearTimeout(timer); for (const job of jobs) job.abort(failure('ASSET_UNAVAILABLE')); for (const fn of unavailable) fn(); for (const fn of listeners) fn({type:'unavailable'}); listeners.clear(); unavailable.clear(); }
    };
}

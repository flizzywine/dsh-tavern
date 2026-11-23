// Saving an export (素材包 「导出」, 素材库 batch export, 导出 DSH 人物卡) — the one implementation.
// pickExportTarget runs first, inside the click: the native save-as dialog (one file, suggested `name`) or a folder
// picker (`many`: a batch may come back as several volumes), so the player chooses where before any packing starts.
// It resolves null where the browser has no picker (phones, remote browsers): the file then goes through an ordinary
// download. It rejects with an AbortError when the dialog is closed. The dialog opens in Downloads the first time and
// then where the last export was saved (the browser remembers the folder per `id`).
// `type` is the file's media type for the dialog's filter (default ZIP; a JSON or PNG card export names its own).
const PACK_ROOT = '/api/dsh-asset-library/v2/';
function exportFileName(name) { return String(name || '').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '导出'; }
async function pickExportTarget({name, many = false, description = 'ZIP 压缩包', extension = '.zip', type = 'application/zip'}) {
    if (many ? typeof window.showDirectoryPicker !== 'function' : typeof window.showSaveFilePicker !== 'function') return null;
    if (many) return {folder:await window.showDirectoryPicker({id:'dsh-export', mode:'readwrite', startIn:'downloads'})};
    const file = await window.showSaveFilePicker({id:'dsh-export', startIn:'downloads', suggestedName:exportFileName(name) + extension, types:[{description, accept:{[type]:[extension]}}]});
    return {file};
}
// saveExportFile(result, {target, name, onProgress, signal}) writes each archive of an export result ({download:{ticket}},
// {url} of a GET that streams the file, or {bytes}) to the picked target, streamed to disk with onProgress({loaded,
// total}) per file; without a target it hands the file to an ordinary download. `name` (no extension; the archive's
// own is kept) overrides the file name of a single archive. Resolves {names:[saved file names], picked:boolean, said}: `said`
// is the one sentence every export shows when done, where the file is. A failed write removes the half-written file.
async function saveExportFile(result, {target = null, name, onProgress, signal} = {}) {
    const archives = result.archives || [result], names = [];
    const fileName = archive => archives.length === 1 && name ? exportFileName(name) + (/\.[^.]+$/.exec(archive.filename || '')?.[0] || '.zip') : archive.filename || 'asset-pack.zip';
    const source = archive => archive.download ? PACK_ROOT + 'download?ticket=' + encodeURIComponent(archive.download.ticket) : archive.url;
    async function open(archive) {
        const response = await fetch(source(archive), {credentials:'same-origin', signal});
        if (!response.ok) { const text = await response.text().catch(() => ''); throw Object.assign(new Error(text || 'HTTP ' + response.status), {status:response.status}); }
        const total = Number(response.headers.get('content-length')) || 0;
        // at most ~8 progress reports a second: one per chunk re-renders the page thousands of times for a large file.
        let loaded = 0, shown = 0;
        onProgress?.({loaded, total});
        return response.body.pipeThrough(new TransformStream({
            transform(chunk, out) { loaded += chunk.byteLength; const now = performance.now(); if (now - shown > 120) { shown = now; onProgress?.({loaded, total}); } out.enqueue(chunk); },
            flush() { onProgress?.({loaded, total}); }}));
    }
    for (const archive of archives) {
        const filename = fileName(archive);
        if (target) {
            const handle = target.file || await target.folder.getFileHandle(filename, {create:true});
            try {
                const body = archive.bytes ? new Blob([archive.bytes]).stream() : await open(archive);
                // pipeTo commits the file when the body ends and discards the write on failure.
                await body.pipeTo(await handle.createWritable(), {signal});
            } catch (error) { await handle.remove?.().catch(() => {}); throw error; }
            names.push(handle.name);
            continue;
        }
        // no picker: a ticket or url goes to the browser's download manager as is (it streams); bytes go as a Blob.
        const blob = archive.bytes ? new Blob([archive.bytes]) : archive.download ? null : await new Response(await open(archive)).blob();
        const url = blob ? URL.createObjectURL(blob) : source(archive);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
        if (blob) setTimeout(() => URL.revokeObjectURL(url), 1000);
        names.push(filename);
    }
    const files = names.map(n => '「' + n + '」').join('');
    // the page never learns the folder the dialog chose (a file handle has no path), so it names the choice instead.
    return {names, picked:!!target, said:target ? '已导出 ' + files + '，在刚才保存框里选的文件夹里。' : '已开始下载 ' + files + '，在浏览器的下载列表里。'};
}
// browser port for the authenticated v2 package transport.
function createPackTransport({fetch: request = fetch, interval = 2000, subscribeChanges} = {}) {
    const root = PACK_ROOT, listeners = new Set(), unavailable = new Set(), jobs = new Set();
    let active = true, ready = false, sequence = 0, timer, events, stopWs;
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
        method === 'inspectCardBundleUrl' ? 22 * 60000 : ['exportPack','exportPacks','inspectImport','applyImport','inspectCardBundle','applyCardBundle'].includes(method) ? 10 * 60000 : ['listPackSummaries','getPackSnapshot'].includes(method) ? 90000 : 30000);
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
    // an export with onProgress names itself (progressId) and polls exportProgress while the archive is written:
    // onProgress({loaded, total}) in input bytes, the host's own count.
    async function exportWithProgress(method, args, onProgress) {
        const progressId = 'export-' + crypto.randomUUID();
        let running = true;
        const poll = async () => {
            while (running) {
                await new Promise(resolve => setTimeout(resolve, 400));
                const row = running && await control('exportProgress', {progressId}).catch(() => null);
                if (running && row) onProgress({loaded:row.done, total:row.total});
            }
        };
        void poll();
        try { return await control(method, {...args, progressId}); } finally { running = false; }
    }
    async function call(method, input = {}) {
        const {onProgress, ...args} = input, tickets = [];
        if ((method === 'exportPack' || method === 'exportPacks') && typeof onProgress === 'function') return exportWithProgress(method, args, onProgress);
        const progress = typeof onProgress === 'function' && typeof XMLHttpRequest === 'function' ? onProgress : null;
        // an archive (a File, streamed from disk by the browser) is written to disk as it arrives, at any size
        const upload = async (bytes, archive = false) => { const path = archive ? 'upload?archive=1' : 'upload'; const result = progress ? await sendWithProgress(path, bytes, progress, 10 * 60000) : await send(path, {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:bytes}, false, 10 * 60000); tickets.push(result.ticket); return result.ticket; };
        try {
            if (Object.hasOwn(args, 'bytes')) args.bytes = await upload(args.bytes, method === 'inspectImport' || method === 'inspectCardBundle');
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
    const methods = ['listAutomaticWrites','reviewAutomaticWrite','undoAutomaticWrite','listPackSummaries','getPackSnapshot','createPack','patchPack','removePack','putBlob','removeBlob','putBundle','removeBundle','createFigure','patchFigure','removeFigure','removeFigureEmotion','setFigureEmotionFallback','createSimpleSprite','setFigureAvatarCrop','copyFigure','copyItems','resolveAssets','resolveFigures','inspectImport','applyImport','exportPack','exportPacks','exportCardBundle','inspectCardBundle','previewCardBundleDecisions','applyCardBundle','leaseMedia','leaseBundle',
        // the figure voice page writes through the same carrier.
        'savePackVoice','saveFigureVoiceBinding','createAndAssignPackVoice','savePackVoiceVariant','deletePackVoiceVariant','listVoiceCatalogue','listVoiceTemplates','saveVoiceTemplate','deleteVoiceTemplate','assignVoiceTemplate','assignPackVoiceCopy','deletePackVoice',
        // same authenticated control port; offered by the UI only with 'url-install'.
        'inspectCardBundleUrl','catalogueSettings','saveCatalogueSettings','refreshCatalogue','checkPackUpdates','startPackDownload','getPackDownload','controlPackDownload',
        // 舞台设定向导, offered by the UI only with 'stage-setup-v1'.
        'getStageSetupStatus','mergeStageSetupPack'];
    const service = {apiVersion:2, capabilities:['packs'], subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        releaseLease(ticket) { return control('releaseLease',{ticket}).catch(() => {}); },
        // The pack's full document at `revision` (a summary's): the kept copy when it is that revision, else one read.
        async packDetail({packId, revision}) { const known = details.get(packId); if (known && known.revision === revision) { remember(known); return known; } return call('getPackSnapshot',{packId}); }};
    for (const method of methods) service[method] = args => call(method,args);
    function acceptFeed(feed) {
        sequence = feed.sequence;
        if (feed.reset) { forget({type:'reset'}); for (const fn of listeners) fn({type:'reset'}); }
        for (const event of feed.changes) { forget(event); for (const fn of listeners) fn(event); }
    }
    function markUnavailable() {
        if (!ready) return;
        ready = false;
        details.clear();
        for (const fn of unavailable) fn();
        for (const fn of listeners) fn({type:'unavailable'});
    }
    async function connect() {
        try {
            const caps = await control('capabilities');
            if (!active) return;
            if (caps.apiVersion !== 2 || !caps.capabilities.includes('packs')) throw failure('ASSET_UNAVAILABLE');
            service.capabilities = [...caps.capabilities];
            if (!ready) { ready = true; for (const fn of listeners) fn({type:'available'}); }
            events?.close();
            events = new EventSource(root + 'changes?stream=1&since=' + sequence);
            events.onmessage = event => { if (active) acceptFeed(JSON.parse(event.data)); };
            // Reconnect from the last accepted sequence; no recurring requests while idle.
            events.onerror = () => { events?.close(); events = undefined; if (active) timer = setTimeout(connect, Math.max(interval,5000)); };
        } catch (error) {
            if (!active) return;
            markUnavailable();
            timer = setTimeout(connect, Math.max(interval,5000));
        }
    }
    function startStream() {
        if (!active) return;
        if (typeof subscribeChanges === 'function') {
            stopWs = subscribeChanges({
                getSince: () => sequence,
                onEvent(data) {
                    if (!active || !data) return;
                    if (Array.isArray(data.capabilities)) {
                        if (data.apiVersion !== 2 || !data.capabilities.includes('packs')) { markUnavailable(); return; }
                        service.capabilities = [...data.capabilities];
                        if (!ready) { ready = true; for (const fn of listeners) fn({type:'available'}); }
                    }
                    if (data.feed) acceptFeed(data.feed);
                },
                onUnavailable() {
                    if (active) markUnavailable();
                },
                onFallback() {
                    if (active && !events) void connect();
                },
                onReconnected() {
                    clearTimeout(timer);
                    if (events) { events.close(); events = undefined; }
                }
            });
            return;
        }
        void connect();
    }
    return {service, available:() => active && ready,
        settings:{read:() => control('settings'),save:args => control('saveSettings',args)},
        onUnavailable(fn) { unavailable.add(fn); return () => unavailable.delete(fn); },
        async bytes(result) { return result.bytes || send('download?ticket=' + encodeURIComponent(result.download.ticket), {}, true); },
        pickSave: pickExportTarget,
        download: (result, options) => saveExportFile(result, options),
        start() { startStream(); },
        dispose() { if (!active) return; active = false; ready = false; details.clear(); clearTimeout(timer); stopWs?.(); stopWs = undefined; events?.close(); events = undefined; for (const job of jobs) job.abort(failure('ASSET_UNAVAILABLE')); for (const fn of unavailable) fn(); for (const fn of listeners) fn({type:'unavailable'}); listeners.clear(); unavailable.clear(); }
    };
}

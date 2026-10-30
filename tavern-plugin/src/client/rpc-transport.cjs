// Resource Timing shows origin-bound first views queued behind startup catalogues.
// Keep the authenticated HTTP carrier and let Chromium prioritize its pending sockets.
function rpcFetchPriority(method) {
    if (['getAssetPackPresentation', 'getStagePhonePresentation', 'getRoundBody', 'getSession'].includes(method)) return 'high';
    if (['getStageMusicTracks', 'getStageBackgrounds', 'getUpdateStatus', 'getStorageMigration', 'recordPlayTelemetry', 'recordMvuRuntimeDiagnostic'].includes(method)) return 'low';
    return 'auto';
}
// Origin-bound projections stay on HTTP, but cannot occupy its entire socket pool.
function createPresentationQueue(limit = 2) {
    let active = 0;
    const pending = [];
    function drain() {
        while (active < limit && pending.length) {
            const job = pending.shift();
            job.signal?.removeEventListener('abort', job.abort);
            active++;
            Promise.resolve().then(() => {
                job.signal?.throwIfAborted();
                return job.task();
            }).then(job.resolve, job.reject).finally(() => { active--; drain(); });
        }
    }
    return (task, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(signal.reason); return; }
        const job = {task, signal, resolve, reject, abort:() => {
            pending.splice(pending.indexOf(job), 1);
            reject(signal.reason);
        }};
        pending.push(job);
        signal?.addEventListener('abort', job.abort, {once:true});
        drain();
    });
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createPresentationQueue, rpcFetchPriority};

// Both generation APIs use host-owned read-only model jobs. Streaming is an
// intentional emulation: lifecycle/token events carry the completed response.
function installTavernHelperGenerationApi({window, request, copy}) {
    const active = new Map();
    function token() { return 'dsh-job-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2); }
    async function emit(name, ...args) {
        if (!name || typeof window.eventEmit !== 'function') return;
        try { await window.eventEmit(name, ...args); }
        catch (error) { window.console?.error(error); }
    }
    function generate(method, config = {}) {
        if (!config || typeof config !== 'object' || Array.isArray(config)) return Promise.reject(new TypeError('生成参数必须是对象'));
        const payload = copy(config);
        const id = payload.generation_id == null || payload.generation_id === ''
            ? 'dsh-gen-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2) : String(payload.generation_id);
        if (active.has(id)) return Promise.reject(new Error('生成编号正在使用: ' + id));
        payload.generation_id = id;
        let rejectCancelled;
        const cancelled = new Promise(function (_resolve, reject) { rejectCancelled = reject; });
        const job = {generationId:id, generationToken:token(), cancel:function () {
            const error = new Error('生成已取消'); error.name = 'AbortError'; rejectCancelled(error);
        }};
        active.set(id, job);
        return (async function () {
            let text = '';
            const events = window.iframe_events || {};
            try {
                // Dispatch before notifying listeners so a STARTED listener can
                // immediately cancel this exact request (including queued jobs).
                const pending = request(method, {config: payload, generationToken:job.generationToken});
                void emit(events.GENERATION_STARTED || 'js_generation_started', id);
                const result = await Promise.race([pending, cancelled]);
                text = String(result?.text ?? '');
                if (payload.should_stream === true) {
                    await emit(events.STREAM_TOKEN_RECEIVED_FULLY || 'js_stream_token_received_fully', text, id);
                    await emit(events.STREAM_TOKEN_RECEIVED_INCREMENTALLY || 'js_stream_token_received_incrementally', text, id);
                }
                return text;
            } finally {
                if (active.get(id) === job) active.delete(id);
                await emit(events.GENERATION_ENDED || 'js_generation_ended', text, id);
            }
        })();
    }
    window.generate = config => generate('generateTavernHelper', config);
    window.generateRaw = config => generate('generateTavernHelperRaw', config);
    window.stopGenerationById = async id => {
        if (typeof id !== 'string' || !id) return false;
        const job = active.get(id);
        if (job) job.cancel();
        const result = await request('stopTavernHelperGeneration', {generationId: id,
            ...(job ? {generationToken:job.generationToken, pending:true} : {})});
        return !!job || result?.stopped === true;
    };
    window.stopAllGeneration = async () => {
        const jobs = Array.from(active.values());
        for (const job of jobs) job.cancel();
        const result = await request('stopAllTavernHelperGeneration', {
            pendingGenerations:jobs.map(job => ({generationId:job.generationId, generationToken:job.generationToken}))
        });
        return jobs.length > 0 || result?.stopped === true;
    };
    const helper = window.TavernHelper || (window.TavernHelper = {});
    for (const name of ['generate', 'generateRaw', 'stopGenerationById', 'stopAllGeneration']) Object.defineProperty(helper, name, {
        enumerable: true, configurable: true, get: () => window[name], set: value => {window[name] = value;}
    });
}

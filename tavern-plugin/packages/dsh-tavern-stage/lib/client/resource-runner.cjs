'use strict';

function createStageResourceRunnerModule({stageResourceMatches, stageRuntimeErrorText, createPerformanceTimeline, performanceSustained}) {
const stageResourceAuthority = source => JSON.stringify([source.sessionId,source.authorityEpoch]);
const stageResourceErrorText = stageRuntimeErrorText;
// conflicts that resolve on a re-read (the stage moved on, a lease went stale).
const STAGE_TRANSIENT_CODES = ['REVISION_CONFLICT','ASSET_STALE'], STAGE_TRANSIENT_RETRIES = 6;
const stageErrorCode = error => typeof error === 'string' ? (error.match(/^([A-Z][A-Z0-9_]+)(?::|$)/) || [])[1] || '' : typeof error?.code === 'string' ? error.code : typeof error?.message === 'string' ? (error.message.match(/^([A-Z][A-Z0-9_]+)$/) || [])[1] || '' : '';
const stageTransientError = error => STAGE_TRANSIENT_CODES.includes(stageErrorCode(error));
// The one notice when the retries run out: a plain failure, not 「…，正在重试」; the cause stays for the 调试视图.
const stageRetryFailure = error => {
    const code = stageErrorCode(error), message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
    return stageResourceErrorText({code:'PROJECTION_FAILED',message:code && message && !message.startsWith(code) ? code + ': ' + message : message || code});
};

// every page projection repeats the turn's cast catalogue (avatars, characters,
// performance: ~0.5 MB JSON). A freshly read value reuses the previous page's equal subtrees, so a cached turn
// holds one copy instead of one per page. `next` is a fresh RPC result owned by the caller; `previous` is never written.
function stageShareJson(next, previous) {
    if (next === previous) return previous;
    if (!next || !previous || typeof next !== 'object' || typeof previous !== 'object' || Array.isArray(next) !== Array.isArray(previous) || Object.isFrozen(next)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    for (const key of keys) {
        if (!Object.hasOwn(previous, key)) { same = false; continue; }
        const value = stageShareJson(next[key], previous[key]);
        if (value !== previous[key]) same = false;
        if (value !== next[key]) next[key] = value;
    }
    return same ? previous : next;
}

// Resource descriptors of a projection value not yet in `seen` (identity, crop and alias), in walk order.
const stageResourceSeenKey = item => JSON.stringify([item.identity,Object.hasOwn(item,'crop') ? item.crop : '-',item.alias]);
function stageResourceDescriptors(value, seen) {
    const out = [];
    (function collect(item) {
        if (item?.resource === true) {
            const id = stageResourceSeenKey(item);
            if (!seen.has(id)) { seen.add(id); out.push(item); }
        } else if (item && typeof item === 'object') Object.values(item).forEach(collect);
    })(value);
    return out;
}

// Faces use avatar media, never the portrait's unused sprite/mouth catalogue.
function stageAvatarResources(value) {
    return (value || []).map(figure => figure.media?.avatar ? {
        alias:figure.alias,ref:figure.ref,revision:figure.revision,outfitKey:figure.outfitKey,
        avatarOutfitKey:figure.avatarOutfitKey,avatarStateId:figure.avatarStateId,state:{id:figure.state?.id},
        avatarCrop:figure.avatarCrop,avatarUrl:figure.avatarUrl,media:{avatar:figure.media.avatar},
        views:{stage:false,portrait:true},form:'avatar'
    } : figure);
}

// Only faces needed by the page block first paint; the rest are idle prefetch.
function stageVisibleAvatars(value, cast, page, speaker) {
    const avatars = stageAvatarResources(value);
    const visibleAliases = new Set([...(cast || []),speaker].filter(Boolean));
    return page ? avatars.filter(figure => !figure.alias || visibleAliases.has(figure.alias)) : avatars;
}

// the avatars group's display pins are bounded. The page's own faces always belong; faces
// only the backlog shows join, most recently used first, while the group fits half the device-tier budget: the outgoing group
// keeps its pins until the handoff, so two groups must fit at once. Adding every cached face carried each page's faces into the
// next page's pins until the 64 MiB tier held display pins only (52 faces in a soak test), and every new face then failed
// with RESOURCE_TIER_BUDGET. An own face not prepared yet counts as the largest prepared one.
function stageBoundedAvatars(avatars, own, owner, authority) {
    const {maxBytes, largest} = owner.tierBudget(), tier = figure => owner.preparedTier(figure,authority);
    const group = avatars.filter(own);
    let room = maxBytes / 2 - group.reduce((sum,figure) => sum + (tier(figure)?.bytes ?? largest),0);
    const spare = avatars.filter(figure => !own(figure)).map(figure => ({figure,tier:tier(figure)})).filter(row => row.tier)
        .sort((a,b) => b.tier.used - a.tier.used);
    const kept = new Set(group);
    for (const row of spare) if (row.tier.bytes <= room) { room -= row.tier.bytes; kept.add(row.figure); }
    return avatars.filter(figure => kept.has(figure));
}

// Warm the same canonical first page that foreground projection requests use.
function stageParagraphPageRequest(at, pages) {
    const index = pages?.findIndex(item => (item.para ?? item.anchor?.para) === at) ?? -1;
    const item = pages?.[index];
    return index < 0 ? {at} : {at,page:{index,para:at,offset:item.offset ?? item.anchor?.offset,version:1}};
}
function stagePerformancePageRequests(envelope, pages) {
    const states = [envelope.baseline,...(envelope.entries || []).map(entry => entry.state)];
    if (!states.some(state => state?.performance)) return [];
    const indices = states.flatMap(state => state?.performance ? [state.performance.startedAt.page,state.performance.startedAt.page + 1] : []);
    return [...new Set(indices)].flatMap(index => {
        const item = pages?.[index], para = item?.para ?? item?.anchor?.para, offset = item?.offset ?? item?.anchor?.offset;
        return para && para <= envelope.through ? [{at:para,page:{index,para,offset,version:1}}] : [];
    });
}

// Whole-catalogue idle preparation must not enqueue every lease into HTTP at once. It adds catalogue faces to the page's bounded
// group (stageBoundedAvatars) while they fit, and stops before reading a face that cannot.
async function stagePrepareIdleAvatars(owner, avatars, own, authority, eligible) {
    const group = stageBoundedAvatars(avatars,own,owner,authority), kept = new Set(group);
    const rest = avatars.filter(figure => !kept.has(figure) && !owner.isPrepared(figure,authority));
    const batches = [], release = () => { for (const batch of batches) batch.release(); };
    try {
        batches.push(await owner.prepare(group,authority,{usage:'avatars'}));
        let room = owner.tierBudget().maxBytes / 2 - owner.preparedTier(group,authority).bytes;
        for (let at = 0; at < rest.length; at += 2) {
            if (!eligible()) { release(); return null; }
            const next = rest.slice(at,at + 2);
            if (next.length * owner.tierBudget().largest > room) break;
            const batch = await owner.prepare(next,authority,{usage:'avatars'});
            const bytes = next.reduce((sum,figure) => sum + owner.preparedTier(figure,authority).bytes,0);
            if (bytes > room) { batch.release(); break; }
            room -= bytes; batches.push(batch);
        }
        if (!eligible()) { release(); return null; }
        return {value:batches.flatMap(batch => batch.value), descriptors:batches.flatMap(batch => batch.descriptors),
            pins:batches.flatMap(batch => batch.pins), release};
    } catch (error) { release(); throw error; }
}

// P6 consumes replay's ruler; measurement/loading order is not a scale input.
function stagePlaybackVisual(value, requestToken, directionToken) {
    const ruler = value.state.figureScale;
    if (!ruler) throw new Error('Missing P6 replay ruler');
    return {scene:{...value.scene,state:value.state,figureScale:ruler,diagnostics:[...(value.scene?.diagnostics || []),...(value.diagnostics || [])]},
        lighting:value.state.lighting,figures:value.characters.map(figure => {
            const measurement = value.measurements?.[figure.geometry?.stage];
            return measurement ? {...figure,measurement} : figure;
        }),ruler};
}

// extends the director source's onEffect. No store, player or hook
// is created here. F supplies sinks; E's visual adapter receives both captured
// request and canonical direction tokens, never a later mutable snapshot.
// `progress` receives each foreground load's real items (stage-load-progress.cjs).
const STAGE_NO_PROGRESS = {begin() {}, plan() {}, resource() {}, settle() {}, end() {}};
function createStageResourceRunner({read, owner, clock = globalThis, foreground = clock, idle = async () => true, resolveSpeaker = (_snapshot,page) => page.voice?.character?.alias, music, preparePerformance = async () => {}, performance = () => {}, present = () => {}, play = () => {}, cancelPlayback = () => {}, visual, progress = STAGE_NO_PROGRESS}) {
    let disposed = false;
    const timelineFactory = createPerformanceTimeline;
    const sustained = performanceSustained;
    const now = () => typeof foreground.now === 'function' ? foreground.now() : foreground.now ?? globalThis.performance.now();
    const sameToken = (a,b) => a && b && JSON.stringify(a) === JSON.stringify(b);
    const refKey = ref => JSON.stringify([ref?.packId,ref?.kind,ref?.assetId]);
    function performanceLayer(id,state,layer,token,descriptor,snap=false) {
        const value=state.accepted.get('performance')?.value;
        if (!value) return;
        const track=layer.bgm && value.dependencies.find(item => refKey(item.ref) === refKey(layer.bgm.ref));
        const bgm=music?.();
        if (bgm && !descriptor?.retiring) {
            if (layer.bgm) {
                if (JSON.stringify(state.musicLock?.instanceKey) !== JSON.stringify(value.instanceKey)) {
                    const acquired=bgm.acquirePerformance({sessionId:id,authority:state.authority,instanceKey:value.instanceKey,phaseKey:value.phaseKey,
                        track:track ? {...track,fadeMs:layer.bgm.fadeMs ?? layer.bgm.fadeInMs} : null,lock:value.plan.bgm?.lock !== false,restore:value.plan.bgm?.restore || 'previous',restoreTarget:value.restore,token,snap});
                    state.musicLock={instanceKey:value.instanceKey,handle:acquired.handle,token};
                }
                if (state.musicLock) state.musicLock.token=token;
                state.musicLock?.handle?.update({phaseKey:value.phaseKey,token,track,fadeMs:layer.bgm.fadeMs ?? layer.bgm.fadeInMs,snap});
            } else if (state.musicLock) {
                state.musicLock.handle?.release({token:state.musicLock.token,reason:'restore',restoreTarget:value.restore,fadeMs:descriptor?.fadeMs,snap}); state.musicLock=null;
            }
        }
        return performance(id,{type:'layer',value,layer,token,descriptor,snap,authority:state.authority,handles:state.performanceHandles || [],cue:event => state.timeline?.cue({...event,token})});
    }
    function ensureTimeline(id,state,dispatch,getSnapshot) {
        if (state.timeline) return state.timeline;
        state.timeline=timelineFactory({foreground:{now,setTimeout:(fn,ms) => foreground.setTimeout(fn,ms),clearTimeout:id => foreground.clearTimeout(id)},
            isCurrent:token => sameToken(token,getSnapshot().performancePlayback?.token),
            ledger:{due:event => dispatch({type:'PERFORMANCE_EVENT_DUE',...event}),consumed:event => dispatch({type:'PERFORMANCE_PHASE_CONSUMED',...event}),cycle:event => dispatch({type:'PERFORMANCE_CYCLE_COMPLETED',...event})},
            sinks:{cancel:info => performance(id,{type:'cancel',...info}),sustained:options => performanceLayer(id,state,sustained(options.plan),options.token,null,true)}});
        return state.timeline;
    }
    const sessions = new Map();
    function session(id) {
        if (!sessions.has(id)) sessions.set(id,{accepted:new Map(), jobs:new Map(), shots:new Map(), handoffs:new Set(), projections:new Map(), revision:0});
        return sessions.get(id);
    }
    // keep presentation inputs with each sealed turn, independently of
    // transient player pins. Snap only changes transition duration, not projection data.
    function projection(source, direction, assetRevision, args) {
        const state = session(source.sessionId);
        const key = JSON.stringify(source), version = JSON.stringify([direction,assetRevision]);
        let entry = state.projections.get(key);
        state.projections.delete(key);
        if (!entry || entry.version !== version) entry = {version,pages:new Map()};
        state.projections.set(key,entry);
        const pages = entry.pages;
        // every cached page holds the full presentation (~0.5 MB JSON: avatars,
        // characters, performance), ~25 MiB per read turn. Keep the navigation working set only: this turn, the two
        // turns history prefetch reads on opening and the next one. One stage is shown at a time; other chats re-read.
        while (state.projections.size > 4) state.projections.delete(state.projections.keys().next().value);
        for (const [id, other] of sessions) if (id !== source.sessionId) other.projections.clear();
        const pageKey = JSON.stringify([args.at,args.page?.index ?? null,args.page?.version ?? null]);
        let job = pages.get(pageKey);
        const cached = !!job;
        if (!job) {
            job = Promise.resolve().then(() => read({...args,snap:false})).then(result => {
                if (result.cgReceipt?.displayToken || result.status !== 'ready' || JSON.stringify(result.directionToken) !== JSON.stringify(direction)) pages.delete(pageKey);
                else if (result.value && typeof result.value === 'object') { result.value = stageShareJson(result.value, entry.shared); entry.shared = result.value; }
                return result;
            },error => {pages.delete(pageKey); throw error;});
            // cache semantics, never a single-use display capability.
            pages.set(pageKey,job);
        }
        if (cached && args.cgDisplay) job = job.then(result => result.value?.scene?.cg ? read({...args,snap:false}) : result);
        return job.then(result => args.snap && result.status === 'ready'
            ? {...result,value:{...result.value,scene:{...result.value.scene,timeTransitionMs:0}}} : result);
    }
    function invalidate(sessionId) {
        const state = sessions.get(sessionId);
        if (state) {
            state.revision++; state.projections.clear();
            // a settings/catalogue refresh re-reads the round, it does not end its lookahead.
            // A cold open loads the card settings after the first page; dropping the lookahead there left it idle until
            // the first page turn. Revocation and source changes still release it (revoke, release-preload).
            const warm = state.warm;
            if (warm) {
                // Its pins go (the owner keeps the bytes unpinned, LRU); the re-read pins today's resources again.
                warm.read.clear(); warm.attempts.clear(); warm.seen.clear();
                for (const prepared of warm.prepared.splice(0)) prepared.release();
                for (const item of warm.items.values()) warm.queue.set(item.id,item);
                if (warm.started) void warm.start();
            }
            // An executable capability cannot survive permission uncertainty as last-good.
            if (state.accepted.get('performance')?.value?.executionDependencies?.length && state.dispatch) {
                const source = state.getSnapshot().source;
                state.dispatch({type:'PERFORMANCE_UNAVAILABLE',source,reason:'widget-permission-refresh'});
            }
        }
    }
    async function prefetch(source, envelope) {
        if (disposed || !envelope?.complete || !envelope.token) return;
        const state = session(source.sessionId), revision = state.revision;
        // Only adjacent boundary pages are speculative. Walking hundreds of historical
        // paragraphs transfers the same catalogue repeatedly while the current scene loads.
        const boundary = new Set([1,2,3,envelope.through-2,envelope.through-1,envelope.through].filter(at => at > 0 && at <= envelope.through));
        const requests = [...stagePerformancePageRequests(envelope,envelope.pageIndex?.pages).filter(request => boundary.has(request.at)),
            ...[...boundary].map(at => stageParagraphPageRequest(at,envelope.pageIndex?.pages))];
        const queue = [...new Map(requests.map(request => [JSON.stringify(request),request])).values()];
        const valid = () => sessions.get(source.sessionId) === state && state.revision === revision;
        // pages of a turn reference the same few resources. Prepare each resource
        // once per prefetch, not every page's whole value (an async walk over ~0.5 MB JSON per page, chained through
        // resolved promises into one long task when the pages were already cached).
        const seen = new Set();
        async function worker() {
            while (queue.length && valid()) {
                await state.foreground?.done;
                if (!valid() || !queue.length) return;
                const coordinate = queue.shift();
                try {
                    const result = await projection(source,envelope.token,envelope.assetRevision,
                        {sessionId:source.sessionId,turn:source.turn,...coordinate,history:true,expectedDirectionToken:envelope.token});
                    if (!valid() || result.status !== 'ready') continue;
                    const performance = result.value.performance;
                    const value = {...result.value,avatars:stageAvatarResources(result.value.avatars),performance:performance && !performance.unavailable ? {...performance,
                        dependencies:performance.dependencies.filter(item => item.role === 'required')} : null};
                    const pins = [], batch = stageResourceDescriptors(value,seen);
                    try {
                        for (const descriptor of batch) pins.push(await owner.prepare(descriptor,stageResourceAuthority(source),{prefetch:true}));
                    } catch (error) {
                        // Unprepared resources stay eligible for a later page, as before.
                        batch.slice(pins.length).forEach(descriptor => seen.delete(stageResourceSeenKey(descriptor)));
                        throw error;
                    } finally { pins.forEach(pin => pin.release()); }
                    for (const dependency of performance?.dependencies || []) if (dependency.role === 'restore') {
                        try {(await owner.prepare(dependency,stageResourceAuthority(source),{prefetch:true})).release();} catch (_) { /* Best effort only. */ }
                    } // The 2 GiB owner retains decoded, unpinned content.
                } catch (_) { /* Speculation cannot fail the foreground navigation. */ }
            }
        }
        await Promise.all([worker(),worker()]);
    }
    function cleanupAll(tasks) {
        const errors = [];
        for (const task of tasks) try { task(); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Stage resource cleanup failed');
    }
    function cancel(job) {
        if (!job) return;
        job.cancelled = true;
        const groups = [...job.groups?.values() || []], prepared = job.prepared;
        job.groups?.clear(); job.prepared = null;
        cleanupAll([() => job.controller?.abort(), () => job.finish?.(), () => clock.clearTimeout(job.timer),
            ...groups.map(value => () => value.release()), () => prepared?.release()]);
    }
    function releaseAccepted(state) {
        const prepared = [...state.accepted.values()]; state.accepted.clear();
        cleanupAll(prepared.map(value => () => value.release()));
    }
    // A round owns its warm pins, not page visits or prefix revisions.
    function releaseWarm(state) {
        const warm = state.warm;
        if (!warm) return;
        warm.cancelled = true; state.warm = null;
        const prepared = warm.prepared.splice(0);
        cleanupAll(prepared.map(value => () => value.release()));
    }
    // the lookahead covers every page of
    // the round, nearest-ahead first, so a forward page turn finds its projection and media ready. A page turn only
    // re-prioritises; a new prefix while streaming adds its new paragraphs (and refreshes the next pages' reads).
    function warmTimeline(state, token, direction, history, getSnapshot) {
        const snapshot = getSnapshot(), through = snapshot.director.through, pages = snapshot.text?.pages || [];
        const key = JSON.stringify([token.source,history]), version = JSON.stringify([direction,snapshot.director.assetRevision]);
        let warm = state.warm;
        if (warm?.key !== key) {
            releaseWarm(state);
            warm = state.warm = {key,cancelled:false,prepared:[],seen:new Set(),queue:new Map(),read:new Map(),attempts:new Map(),items:new Map()};
            warm.pin = async (value, page) => {
                const speaker = page && resolveSpeaker(getSnapshot(),page);
                // The page's own faces (cast + speaker), as the foreground avatars group asks for them.
                const avatars = stageVisibleAvatars(value.avatars,value.state?.cast,page,speaker);
                const performance = value.performance && !value.performance.unavailable ? {...value.performance,
                    dependencies:value.performance.dependencies.filter(item => item.role === 'required')} : null;
                const descriptors = stageResourceDescriptors({...value,avatars,performance},warm.seen);
                for (const descriptor of descriptors) {
                    await state.foreground?.done;
                    if (warm.cancelled) return;
                    try {
                        const prepared = await owner.prepare(descriptor,stageResourceAuthority(token.source),{prefetch:true});
                        if (warm.cancelled) prepared.release(); else warm.prepared.push(prepared);
                    } catch (_) {warm.seen.delete(stageResourceSeenKey(descriptor));}
                }
            };
            // Nearest page at or after the reader first, then the pages behind it (paging back).
            warm.next = () => {
                let best = null;
                for (const item of warm.queue.values()) {
                    const rank = item.index >= warm.current ? item.index - warm.current : 1e9 + warm.current - item.index;
                    if (!best || rank < best.rank) best = {item,rank};
                }
                if (best) warm.queue.delete(best.item.id);
                return best?.item;
            };
            warm.start = () => {
                warm.started = true;
                if (warm.running) return warm.running;
                async function worker() {
                    while (!warm.cancelled && warm.queue.size) {
                        await state.foreground?.done;
                        const item = !warm.cancelled && warm.next();
                        if (!item) return;
                        const {direction, assetRevision, version} = warm;
                        try {
                            // One lookahead read at a time: the client allows two projection requests, so the reader's
                            // next page always has a free one (a cold host answered ~2.5 s per read in the debug slot).
                            const read = (warm.reading || Promise.resolve()).then(() => warm.cancelled ? null : projection(token.source,direction,assetRevision,
                                {sessionId:token.source.sessionId,turn:token.source.turn,...item.coordinate,history,expectedDirectionToken:direction}));
                            warm.reading = read.catch(() => {});
                            const result = await read;
                            if (warm.cancelled || !result) return;
                            if (JSON.stringify(result.directionToken) !== JSON.stringify(direction)) continue;
                            if (result.status === 'ready') {
                                warm.read.set(item.id,version);
                                await warm.pin(result.value,getSnapshot().text?.pages?.[item.index]);
                            } else if (['pending','stale'].includes(result.status)) {
                                const attempts = (warm.attempts.get(item.id) || 0) + 1;
                                warm.attempts.set(item.id,attempts);
                                if (attempts < 3 && !warm.queue.has(item.id)) warm.queue.set(item.id,item);
                            }
                        } catch (_) { /* Off-page failures must not block the current presentation. */ }
                    }
                }
                warm.running = Promise.all([worker(),worker()]).finally(() => {
                    warm.running = null;
                    if (!warm.cancelled && warm.queue.size) warm.start();
                });
                return warm.running;
            };
        }
        const index = pages.findIndex(page => page.anchor?.para === token.anchor.para && page.anchor?.offset === token.anchor.offset);
        const changed = warm.version !== undefined && warm.version !== version, completed = !warm.complete && snapshot.director.complete;
        Object.assign(warm,{direction,assetRevision:snapshot.director.assetRevision,version,current:Math.max(0,index),complete:snapshot.director.complete});
        pages.forEach((page, at) => {
            const para = page.anchor?.para;
            if (!para || para > through) return;
            // The foreground's own canonical coordinate, so the page turn hits the same projection cache entry.
            const coordinate = {at:para,page:{index:at,para,offset:page.anchor.offset,version:1}}, id = JSON.stringify([at,para,page.anchor.offset]);
            const read = warm.read.get(id);
            if (!warm.items.has(id)) warm.items.set(id,{id,index:at,coordinate});
            // A sealed page's media do not change with a later prefix; only its read is re-validated near the reader,
            // and once for the whole round when the direction completes.
            if (read === version || warm.queue.has(id)) return;
            if (read === undefined || completed || changed && at > warm.current && at <= warm.current + 3) warm.queue.set(id,{id,index:at,coordinate});
        });
        return warm;
    }
    function revoke(state, scope, source, dispatch, getSnapshot) {
        invalidate(source.sessionId);
        releaseWarm(state);
        for (const job of state.jobs.values()) cancel(job);
        state.jobs.clear();
        const groups = {};
        // match the descriptor tree, not shared Blob URLs. Revoking
        // one alias must not erase another alias using the same content handle.
        function scrub(item, descriptor) {
            if (stageResourceMatches(descriptor,scope)) return null;
            if (!item || typeof item !== 'object') return item;
            if (Array.isArray(item)) return item.map((v,i) => scrub(v,descriptor?.[i])).filter(v => v !== null);
            return Object.fromEntries(Object.entries(item).map(([k,v]) => [k,scrub(v,descriptor?.[k])]));
        }
        const matchesTree = item => item && typeof item === 'object' && (stageResourceMatches(item,scope) || Object.values(item).some(matchesTree));
        for (const [group,prepared] of state.accepted) {
            const next = (group === 'cg' && matchesTree(prepared.descriptors) || group === 'performance' && matchesTree([prepared.descriptors?.ref,prepared.descriptors?.dependencies,prepared.descriptors?.executionDependencies]))
                ? null : scrub(prepared.value,prepared.descriptors);
            if (JSON.stringify(next) === JSON.stringify(prepared.value)) continue;
            const retained = new Set();
            function collect(item) {if (typeof item === 'string') retained.add(item); else if (item && typeof item === 'object') Object.values(item).forEach(collect);}
            collect(next);
            prepared.pins = prepared.pins.filter(pin => {if (retained.has(pin.handle.url) && !stageResourceMatches(pin.descriptor,scope)) return true; pin.release(); return false;});
            prepared.value = next;
            prepared.descriptors = scrub(prepared.descriptors,prepared.descriptors);
            groups[group] = next === null ? {kind:'clear',reason:'revoked'} : {kind:'set',value:next};
        }
        for (const [id,shot] of state.shots) if (stageResourceMatches(shot.ref,scope) || shot.prepared?.pins.some(pin => stageResourceMatches(pin.descriptor,scope))) {
            cancel(shot); state.shots.delete(id);
            dispatch({type:'ONE_SHOT_FAILED',token:shot.token,error:'revoked'});
            cancelPlayback(source.sessionId,{token:shot.token,reason:'revoked'});
        }
        // The reducer invalidates readiness before owner destruction; late promises
        // cannot publish against the retired projection token.
        dispatch({type:'RESOURCE_REVOKED',source,groups,reason:'revoked'});
        owner.revoke(scope,stageResourceAuthority(source));
    }
    function onEffect(sessionId, intent, dispatch, getSnapshot) {
        if (disposed) return;
        const state = session(sessionId), token = intent.token;
        state.dispatch = dispatch; state.getSnapshot = getSnapshot;
        switch (intent.type) {
        case 'invalidate-projection': invalidate(sessionId); break;
        case 'release-preload': releaseWarm(state); break;
        case 'project': {
            // a carry projects the predecessor turn's sealed end under its own direction token.
            const carry = intent.carry, history = getSnapshot().cursor.mode !== 'live';
            const expectedDirectionToken = carry ? carry.token : getSnapshot().director.token;
            const projectionSource = carry ? carry.source : token.source, assetRevision = () => carry ? carry.assetRevision : getSnapshot().director.assetRevision;
            if (!expectedDirectionToken) return;
            const warm = carry ? {cancelled:false,pin:async () => {},start() {}} : warmTimeline(state,token,expectedDirectionToken,history,getSnapshot);
            const job = {token,groups:new Map(),cancelled:false,failures:0,groupFailures:new Map(),controller:new AbortController()};
            job.done = new Promise(resolve => {job.finish = () => {try {progress.end(sessionId,token.id);} finally {resolve();}};});
            state.foreground = job; state.jobs.set(token.id,job);
            progress.begin(sessionId,token.id);
            const authority = stageResourceAuthority(token.source);
            state.authority = authority;
            const current = () => !job.cancelled && getSnapshot().projection?.token.id === token.id;
            // a transient conflict the runner retries by itself (the host's
            // pending / stale answers, REVISION_CONFLICT / ASSET_STALE) is not a warning: it stays silent while retrying and
            // only a retry budget that runs out shows one notice (stageRetryFailure). Real failures warn at once, as before.
            const retry = (error, answer) => {
                if (!current()) return;
                // A bare pending / stale status keeps waiting without a budget; one with a cause counts as transient.
                const waiting = ['pending','stale','resources-pending'].includes(error), transient = !waiting && (answer === 'transient' || stageTransientError(error));
                if (!waiting && ++job.failures >= (transient ? STAGE_TRANSIENT_RETRIES : 3)) {
                    dispatch({type:'PROJECTION_FAILED',token,error:transient ? stageRetryFailure(error) : stageResourceErrorText(error)});
                    job.finish(); return;
                }
                dispatch({type:'PROJECTION_PENDING',token});
                if (!waiting && !transient) dispatch({type:'READ_FAILED',source:token.source,error:stageResourceErrorText(error)});
                job.timer = clock.setTimeout(run,700);
            };
            // the host answers for a different direction than the one requested. Asking
            // again with the same token can never succeed; the reducer settles this request and follows the host.
            const superseded = result => {
                if (!current()) return false;
                if (!['pending','stale','ready'].includes(result.status) || !Object.hasOwn(result,'directionToken') ||
                    JSON.stringify(result.directionToken ?? null) === JSON.stringify(expectedDirectionToken)) return false;
                dispatch({type:'PROJECTION_STALE',token,directionToken:result.directionToken ?? null});
                job.finish(); return true;
            };
            async function run() {
                try {
                    const validateResources = [...state.accepted.entries()].flatMap(([usage,value]) => value.pins.map(pin => ({ref:pin.descriptor.ref,alias:pin.descriptor.alias,usage})));
                    job.read = projection(projectionSource,expectedDirectionToken,assetRevision(),
                        {sessionId,turn:projectionSource.turn,at:intent.at,cgDisplay:{visitId:token.visitId,requestId:token.id},...(intent.page ? {page:intent.page} : {}),snap:intent.transition === 'snap',history,expectedDirectionToken,validateResources});
                    const result = await job.read;
                    if (!current()) return;
                    if (result.status === 'revoked') {revoke(state,result.scope,token.source,dispatch,getSnapshot); return;}
                    if (superseded(result)) return;
                    // A pending / stale answer is transient whatever error it carries.
                    if (result.status !== 'ready') {retry(result.error || result.status, ['pending','stale'].includes(result.status) ? 'transient' : undefined); return;}
                    if (JSON.stringify(result.directionToken) !== JSON.stringify(expectedDirectionToken)) {retry('stale'); return;}
                    let value = result.value;
                    // A turn's end resets a close-up (asset-pack seal); the carried baseline does too.
                    if (carry && value.state?.camera?.mode === 'close') value = {...value,state:{...value.state,camera:{mode:'reset',actor:null}}};
                    const plan = await (visual || stagePlaybackVisual)(value,token,expectedDirectionToken);
                    if (!current()) return;
                    const figures = Object.fromEntries((plan.figures || []).filter(figure =>
                        !plan.scene?.state?.cast || plan.scene.state.cast.includes(figure.alias)).map((figure,index) =>
                        ['figure:' + (figure.slotId ?? figure.alias ?? index),figure]));
                    // CG preparation must never hold the base scene or avatars.
                    const {cg:cgImage, ...baseScene} = plan.scene;
                    const avatars = stageAvatarResources(value.avatars);
                    const snapshot = getSnapshot(), page = snapshot.text?.pages.find(page => page.anchor?.para === token.anchor.para && page.anchor?.offset === token.anchor.offset);
                    const speaker = page && resolveSpeaker(snapshot,page);
                    // The page's own faces, as warm.pin asks for them (stageVisibleAvatars), plus the bounded backlog faces.
                    const shownAliases = new Set([...(plan.scene?.state?.cast || []),speaker].filter(Boolean));
                    const own = figure => !page || !figure.alias || shownAliases.has(figure.alias);
                    const visibleAvatars = stageBoundedAvatars(avatars,own,owner,authority);
                    const candidates = {
                        cg:cgImage ? {...cgImage,receipt:result.cgReceipt || null,transition:result.cgTransition || 'fade'} : null,
                        background:{scene:baseScene,lighting:plan.lighting,ruler:plan.ruler}, ...figures,
                        music:{music:value.audio.music, musicRequest:value.audio.musicRequest || null}, ambience:value.audio.soundscape, avatars:visibleAvatars, widgets:value.widgets,
                        performance:value.performance?.unavailable ? null : value.performance ? {...value.performance,
                            dependencies:value.performance.dependencies.filter(item => item.role === 'required'),
                            retiring:value.performance.retiring ? {...value.performance.retiring,dependencies:[]} : null} : null
                    };
                    dispatch({type:'PROJECTION_GROUPS',token,figureKeys:Object.keys(figures),
                        layout:{state:plan.scene?.state,ruler:plan.ruler,core:plan.scene?.core}});
                    progress.plan(sessionId,token.id,candidates,{outstanding:group => !!getSnapshot().projection?.outstanding.includes(group),
                        isPrepared:item => owner.isPrepared(item,authority)});
                    // Cold entry gives its backdrop and skin first use of host I/O; later pages stay parallel.
                    const coldEntry = !snapshot.accepted.provenanceByChannel?.background;
                    let releaseBackdrop;
                    const backdropReady = new Promise(resolve => { releaseBackdrop = resolve; if (!getSnapshot().projection.outstanding.includes('background')) resolve(); });
                    // Each slot still owns its preparation, acceptance and outgoing pin.
                    await Promise.all(Object.entries(candidates).map(async ([group,candidate]) => {
                        if (!current() || !getSnapshot().projection.outstanding.includes(group)) return;
                        try {
                            if (coldEntry && group.startsWith('figure:') && ['live2d','spine'].includes(candidate?.form)) await backdropReady;
                            if (!current()) return;
                            const options = {usage:group,signal:job.controller.signal,
                                ...(group === 'avatars' ? {onResource:(item,error) => progress.resource(sessionId,token.id,item,error)} : {})};
                            let prepared, notice = value.notice;
                            const previous = state.accepted.get(group);
                            const immediate = group === 'performance' && (!candidate || candidate.phase === 'exit');
                            if (immediate) prepared = {value:candidate ? {...candidate,dependencies:previous?.value?.dependencies || []} : null,
                                descriptors:candidate,pins:[],release() {}};
                            if (group === 'performance' && candidate && !immediate) await preparePerformance(candidate);
                            if (!current()) return;
                            const prepare = async candidate => {
                                try {return await owner.prepare(candidate,authority,options);}
                                catch (error) {
                                    if (error.code !== 'RESOURCE_BUDGET') throw error;
                                    releaseWarm(state);
                                    return owner.prepare(candidate,authority,options);
                                }
                            };
                            try {prepared ||= await prepare(candidate);}
                            catch (error) {
                                // A transient failure (a publication raced the read) retries and keeps last-good; never drops the skin.
                                if (group !== 'background' || !candidate.scene?.skin || stageTransientError(error)) throw error;
                                // A skin bundle is optional; keep the independently valid base scene.
                                notice = 'skin-unavailable: ' + stageResourceErrorText(error);
                                prepared = await prepare({...candidate,scene:{...candidate.scene,skin:null,
                                    diagnostics:[...(candidate.scene.diagnostics || []),notice]}});
                            }
                            if (!current()) {prepared.release(); return;}
                            if (group === 'performance' && value.performance?.unavailable) dispatch({type:'READ_FAILED',source:token.source,error:value.performance.unavailable.code});
                            if (previous && JSON.stringify(previous.value) === JSON.stringify(prepared.value)) {
                                prepared.release();
                                dispatch({type:'PROJECTION_READY',token,error:notice,groups:{[group]:{kind:'keep'}}});
                            } else {
                                job.groups.set(group,prepared);
                                dispatch({type:'PROJECTION_READY',token,error:notice,groups:{[group]:{kind:'set',value:prepared.value}}});
                            }
                            progress.settle(sessionId,token.id,group);
                        } catch (error) {
                            if (!current()) return;
                            const failures = (job.groupFailures.get(group) || 0) + 1, transient = stageTransientError(error);
                            job.groupFailures.set(group,failures);
                            // A failed item is named at once; a retry that succeeds settles it as done again.
                            if (!transient || failures >= 3) progress.settle(sessionId,token.id,group,true);
                            // A stale lease (ASSET_STALE) is retried silently; only the last attempt warns.
                            if (!transient) dispatch({type:'PROJECTION_GROUP_ERROR',token,group,error:stageResourceErrorText(error)});
                            if (failures >= 3) {
                                // Keep last-good for this element; a first-load failure is empty.
                                dispatch({type:'PROJECTION_READY',token,error:transient ? stageRetryFailure(error) : stageResourceErrorText(error),
                                    groups:{[group]:{kind:state.accepted.has(group) && (group !== 'cg' || refKey(state.accepted.get(group).value?.ref) === refKey(candidate?.ref)) ? 'keep' : 'clear',reason:'resource-failed'}}});
                            }
                        } finally { if (group === 'background') releaseBackdrop(); }
                    }));
                    if (current()) {
                        job.timer = clock.setTimeout(run,700);
                    } else {
                        job.finish();
                        if (!job.cancelled && !warm.cancelled) {
                            const avatarToken = getSnapshot().accepted.provenanceByChannel.avatars?.token;
                            const eligible = () => !warm.cancelled && !job.cancelled && state.foreground === job && getSnapshot().opened !== false &&
                                getSnapshot().accepted.provenanceByChannel.avatars?.token === avatarToken;
                            let busy = false;
                            const afterReady = () => { if (!busy) { busy = true; void (async () => {
                                if (!await idle(sessionId,eligible) || !eligible()) return;
                                // the round lookahead first. The whole face catalogue (118
                                // faces for a large card) came first and a page turn restarted it, so the lookahead rarely began.
                                await warm.start();
                                if (!eligible()) return;
                                if (visibleAvatars.length !== avatars.length) {
                                    const prepared = await stagePrepareIdleAvatars(owner,avatars,own,authority,eligible);
                                    if (!prepared) return;
                                    const previous = state.accepted.get('avatars');
                                    state.accepted.set('avatars',prepared);
                                    dispatch({type:'AVATARS_WARMED',token:avatarToken,value:prepared.value});
                                    previous?.release();
                                }
                            })().catch(() => {}).finally(() => {busy = false;}); } };
                            // A page made ready while the stage was still closed (a cold open restores it before
                            // STAGE_OPEN) starts its idle work when the stage opens, not at the first page turn.
                            state.afterReady = afterReady;
                            afterReady();
                        }
                        if (!job.groups.size) state.jobs.delete(token.id);
                    }
                } catch (error) {retry(error);}
            }
            void run(); break;
        }
        case 'present': {
            const job = state.jobs.get(token.id), outgoing = [];
            const groups = intent.groups.includes('visual')
                ? [...intent.groups,...[...state.accepted.keys()].filter(key => key === 'background' || key.startsWith('figure:'))]
                : intent.groups;
            for (const group of groups) {
                const prepared = job?.groups.get(group);
                if (!prepared) {
                    if (intent.accepted.provenanceByChannel[group]?.kind === 'clear' || intent.groups.includes('visual')) {
                        const previous = state.accepted.get(group);
                        if (previous) outgoing.push(previous);
                        state.accepted.delete(group);
                    }
                    continue; // scoped revoke keeps the unaffected pins
                }
                job.groups.delete(group);
                const previous = state.accepted.get(group);
                if (previous) outgoing.push(previous);
                state.accepted.set(group,prepared);
            }
            // A sink's acknowledgement ends the crossfade/model handoff pin.
            const preparedPerformance = state.accepted.get('performance');
            const handles = [...(preparedPerformance?.pins || []),...outgoing.flatMap(value => value.pins)].map(pin => pin.handle);
            let finite;
            if (groups.includes('performance')) {
                state.performanceHandles=handles;
                state.retiringDependencies=outgoing.flatMap(value => value.value?.dependencies || []);
                const playback=intent.performancePlayback;
                if (!playback || playback.mode !== 'keep') for (const [id,shot] of state.shots) {
                    if (!shot.token.performance) continue;
                    cancel(shot); state.shots.delete(id);
                    dispatch({type:'ONE_SHOT_FAILED',token:shot.token,error:'Performance cancelled'});
                    cancelPlayback(sessionId,{token:shot.token,reason:'revoked'});
                }
                if (!preparedPerformance?.value || !playback) {
                    state.timeline?.dispose('unavailable'); state.finishPerformance?.();
                    performance(sessionId,{type:'clear'});
                    state.musicLock?.handle?.release({token:state.musicLock.token,reason:'unavailable',snap:true}); state.musicLock=null;
                } else {
                    const timeline=ensureTimeline(sessionId,state,dispatch,getSnapshot);
                    if (playback.mode !== 'keep') {
                        state.finishPerformance?.();
                        performanceLayer(sessionId,state,playback.layer,playback.token,null,playback.mode !== 'start');
                        const options={token:playback.token,plan:preparedPerformance.value.plan,retiring:preparedPerformance.value.retiring,handles,to:'sustained'};
                        if (playback.mode === 'start') {
                            finite=new Promise(resolve => {state.finishPerformance=resolve;});
                            timeline.start(options);
                        } else timeline.seek(options);
                    } else performanceLayer(sessionId,state,playback.layer,playback.token,null,true);
                }
            }
            const handoff = Promise.all([present(sessionId,{...intent,performanceHandles:handles}),finite]).catch(() => {}).finally(() => {
                outgoing.forEach(value => value.release()); state.handoffs.delete(handoff);
            });
            state.handoffs.add(handoff);
            break;
        }
        case 'performance-event':
            performanceLayer(sessionId,state,intent.layer,intent.token,intent.descriptor); break;
        case 'performance-sustained':
            if (intent.value) performanceLayer(sessionId,state,sustained(intent.value.plan),intent.token,{do:'phase-end'},intent.snap);
            state.finishPerformance?.(); state.finishPerformance=null; break;
        // a click skipped the blocking phase playing on this page - it lands on its
        // sustained state as a history visit does (the timeline reports it consumed, skipped).
        case 'seek-performance': {
            const value=state.accepted.get('performance')?.value;
            if (value && state.timeline) state.timeline.seek({token:intent.token,plan:value.plan,retiring:value.retiring,handles:state.performanceHandles || [],to:'sustained'});
            break;
        }
        case 'cancel-projection':
        case 'release-projection': cancel(state.jobs.get(token.id)); state.jobs.delete(token.id); break;
        case 'prepare-one-shot': {
            if (intent.descriptor.kind !== 'sfx') {
                state.shots.set(token.id,{token,cancelled:false,prepared:{value:intent.descriptor,release() {}}});
                dispatch({type:'ONE_SHOT_READY',token});
                break;
            }
            const shot = {token,ref:intent.descriptor.value,cancelled:false}; state.shots.set(token.id,shot);
            if (token.performance) {
                const value=state.accepted.get('performance')?.value;
                const dependencies=intent.descriptor.retiring ? state.retiringDependencies : value?.dependencies;
                const track=dependencies?.find(item => refKey(item.ref) === refKey(shot.ref));
                const pin=track && owner.retain(track.identity,stageResourceAuthority(token.source));
                if (!pin) { state.shots.delete(token.id); dispatch({type:'ONE_SHOT_FAILED',token,error:'Performance SFX unavailable'}); break; }
                shot.prepared={value:{...track,url:pin.handle.url,gain:10**((intent.descriptor.gainDb || 0)/20)},pins:[pin],release:pin.release};
                dispatch({type:'ONE_SHOT_READY',token}); break;
            }
            const eligible = () => !shot.cancelled && getSnapshot().ledger[token.key]?.status === 'pending';
            async function prepareShot() {
                if (!eligible()) return;
                const expectedDirectionToken = getSnapshot().director.token;
                try {
                    const result = await projection(token.source,expectedDirectionToken,getSnapshot().director.assetRevision,
                        {sessionId,turn:token.source.turn,at:token.anchor.para,expectedDirectionToken});
                    if (!eligible()) return;
                    if (result.status === 'revoked') {
                        revoke(state,result.scope,token.source,dispatch,getSnapshot);
                        dispatch({type:'ONE_SHOT_FAILED',token,error:'revoked'}); return;
                    }
                    if (result.status !== 'ready' || JSON.stringify(result.directionToken) !== JSON.stringify(expectedDirectionToken)) throw new Error('SFX pending');
                    const track = result.value.audio.sfx.find(track => stageResourceMatches(track.ref,{refs:[shot.ref]}));
                    if (!track) {dispatch({type:'ONE_SHOT_FAILED',token,error:'SFX unavailable'}); state.shots.delete(token.id); return;}
                    const prepared = await owner.prepare(track,stageResourceAuthority(token.source));
                    if (!eligible()) {prepared.release(); return;}
                    shot.prepared = prepared; dispatch({type:'ONE_SHOT_READY',token});
                } catch (error) {
                    // A partial->done race changes the direction token, not this event.
                    if (eligible()) shot.timer = clock.setTimeout(prepareShot,700);
                }
            }
            void prepareShot(); break;
        }
        case 'play-one-shot': {
            const shot = state.shots.get(token.id);
            if (!shot?.prepared || shot.cancelled) {dispatch({type:'ONE_SHOT_DONE',token}); break;}
            shot.ringing = intent.descriptor.kind === 'sfx';
            Promise.resolve(play(sessionId,intent.descriptor.kind === 'mod-performance' ? intent.descriptor : shot.prepared.value,token)).finally(() => {cancel(shot); state.shots.delete(token.id); dispatch({type:'ONE_SHOT_DONE',token});}).catch(() => {});
            break;
        }
        case 'release-one-shot': cancel(state.shots.get(token.id)); state.shots.delete(token.id); break;
        case 'cancel-playback':
            state.timeline?.dispose(intent.reason); state.finishPerformance?.(); state.finishPerformance=null;
            if (state.accepted.get('performance')?.value) {
                const value=state.accepted.get('performance').value;
                performanceLayer(sessionId,state,sustained(value.plan),state.musicLock?.token,null,true);
            }
            // a sounding SE rings out across a page turn and keeps its pin
            // until it ends (the play completion above releases it); everything else is cut.
            for (const [id,shot] of state.shots) {
                if (intent.reason === 'page-changed' && shot.ringing) continue;
                cancel(shot); state.shots.delete(id);
            }
            cancelPlayback(sessionId,intent); break;
        case 'playback-policy': present(sessionId,intent); if (intent.opened) state.afterReady?.(); break;
        case 'revoke-presentation':
        case 'release-presentation':
            invalidate(sessionId);
            for (const job of state.jobs.values()) cancel(job);
            state.timeline?.dispose(intent.type); state.finishPerformance?.();
            state.musicLock?.handle?.release({token:state.musicLock.token,reason:intent.type,snap:true}); state.musicLock=null;
            state.jobs.clear(); releaseWarm(state); releaseAccepted(state); present(sessionId,intent);
            if (state.authority) owner.revoke({authority:true},state.authority);
            if (intent.type === 'release-presentation') sessions.delete(sessionId);
            break;
        }
    }
    // read-only lookahead state for the debug snapshot (forkStageResourceDebug).
    const lookahead = sessionId => {
        const warm = sessions.get(sessionId)?.warm;
        return warm ? {queued:warm.queue.size, read:warm.read.size, running:!!warm.running, pins:warm.prepared.length, current:warm.current} : null;
    };
    return {onEffect, prefetch, invalidate, lookahead, revoke(sessionId,scope,dispatch,getSnapshot) {
        if (disposed) return;
        const source = getSnapshot().source;
        if (source) revoke(session(sessionId),scope,source,dispatch,getSnapshot);
    },
    // the asset library connection dropped.
    // Reads in flight (the page's projection and the round lookahead) stop instead of failing through their retry budget;
    // every accepted resource keeps its pins and decoded bytes. Reconnecting re-projects the page (REFRESH_BEGIN).
    suspend(sessionId) {
        const state = sessions.get(sessionId);
        if (!state) return;
        invalidate(sessionId); releaseWarm(state);
        for (const job of state.jobs.values()) cancel(job);
        state.jobs.clear();
    }, dispose() {
        if (disposed) return;
        disposed = true;
        const states = [...sessions.values()]; sessions.clear();
        cleanupAll([...states.flatMap(state => [
            () => state.timeline?.dispose(), () => state.finishPerformance?.(),
            () => state.musicLock?.handle?.release({token:state.musicLock.token,reason:'dispose',snap:true}),
            ...[...state.jobs.values(), ...state.shots.values()].map(job => () => cancel(job)),
            () => releaseWarm(state), () => releaseAccepted(state)
        ]), () => owner.dispose()]);
    }};
}
return {createStageResourceRunner, stageResourceAuthority, stagePlaybackVisual, stageAvatarResources, stageVisibleAvatars, stageBoundedAvatars, stagePrepareIdleAvatars};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageResourceRunnerModule};

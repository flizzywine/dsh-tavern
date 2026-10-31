'use strict';

// All collaborators are explicit: this kernel can run outside the application closure.
function createStageRuntimeKernel({performanceStateKernel, modProjectionKernel, phoneBeatKernel, performanceKindsKernel}) {
// a page turn under this long after the previous one is continuous paging;
// history then waits this long on a page before it plays (recorded danmaku, a settled history page's performances).
const STAGE_HISTORY_SETTLE_MS = 1000;
const performancePhaseLedgerKey = token => JSON.stringify(['performance-phase',token.instanceKey,token.phaseKey]);
const samePerformanceToken = (a,b) => !!a && !!b && sameSource(a.source,b.source) &&
    JSON.stringify(a.instanceKey) === JSON.stringify(b.instanceKey) && JSON.stringify(a.phaseKey) === JSON.stringify(b.phaseKey) && a.visitId === b.visitId && a.playbackEpoch === b.playbackEpoch;

// Phase A kernel. Inputs are immutable, validated adapter snapshots, never transport URLs.
const SOURCE_FIELDS = ['sessionId', 'authorityEpoch', 'branchId', 'turn', 'sourceKey', 'generation'];
const GROUPS = {
    visual: ['scene', 'lighting', 'figures', 'ruler'], // Explicit whole-scene clear only.
    background: ['scene', 'lighting', 'ruler'],
    music: ['music', 'musicRequest'], ambience: ['ambience'], avatars: ['avatars'], widgets: ['widgets'], performance: ['performance'], cg: ['cg'] // independent readiness
};
const sourceKey = source => source && JSON.stringify(SOURCE_FIELDS.map(key => source[key]));
const sameSource = (a, b) => sourceKey(a) === sourceKey(b);
const sameContext = (a, b) => a && b && ['sessionId', 'authorityEpoch', 'branchId'].every(key => a[key] === b[key]);
const emptyText = () => ({revision: -1, streaming: false, pages: [], hasReadableText: false});
const emptyDirector = () => ({phase: 'unknown', revision: -1, bindingKey: null, prefixRevision: -1, through: 0, complete: false, baseline: null, entries: []});
const emptyAccepted = (revision = 0) => ({presentationRevision: revision, provenanceByChannel: {}, figuresBySlot: {}, layout: null, scene: null, lighting: null, figures: null, ruler: null, music: null, musicRequest: null, ambience: null, avatars: null, widgets: null, performance: null, cg: null});
const emptyObservation = () => ({flight: null, timer: null, dirty: false, failures: 0, error: null});
// skip never waits for a one-shot and is silent.
// One rule picks what it still shows: a one-shot plays while skipping only when it is page DOM alone - no sound, no media
// to load, no Pixi effect, Live2D motion or timeline - so the next page turn removes it whole and nothing outlives its
// page. Text cards (文字演出卡片) and titles (报幕) pass and flash by; voice, SE, acts, emotes, screen beats, item shows
// and other mod performances are consumed unplayed (reason 'skip'); a ritual phase seeks to its sustained state.
const stageTextcardKind = kind => /^dsh\.textcard(?:\.|$)/.test(kind || '');
const stageSkipShows = descriptor => descriptor.kind === 'title' || descriptor.kind === 'mod-performance' && stageTextcardKind(descriptor.performance?.kind);

function createStageRuntimeState() {
    return {
        source: null, latestSource: null, text: emptyText(), director: emptyDirector(), liveStreamSeen: false, visitStaged: false,
        // an undirected turn presents its baseline (the last directed turn's end), never the last page viewed.
        carry: null, carryRequest: null,
        // cursor mode 'replay' re-plays one round as if live for a clip export (the player
        // has no replay since); {phase: baseline | play, request}.
        replay: null,
        // the working latest round while the reader browses an earlier round
        // (cursor 'history'): {source, body, phase, complete, revision, flight, dirty} - see stageRoundPhase.
        round: null,
        // session inputs survive stage close and do not own media effects.
        textIndex: new Map(), settings: null, preferences: null,
        // a history page the reader settles on plays its own
        // one-shots (HISTORY_DWELL): dwell = {anchor, kinds (the registry's replayable kinds)} once it has; still = this page
        // never plays (reached by a restore, a refresh or a skip).
        // beatSkip: {visitId, anchor} of the page whose blocking performances a click skipped (BEAT_SKIP).
        cursor: {mode: 'live', anchor: null, visitId: 0, readThrough: 0, skipping: false, firstPageEligible: false, afterEligible: false, still: false, dwell: null, beatSkip: null},
        accepted: emptyAccepted(), pending: {text: false, director: false, projection: false, resources: false, error: null},
        projection: null, observation: emptyObservation(), ledger: {}, serial: 0, playbackEpoch:0, performancePlayback:null, performanceFlashes:[],
        // retryable: the interruption is a failed native turn the host can replay (the stage notice's 重新生成).
        visible: true, opened: true, interrupted: false, retryable: false, disposed: false,
        // the opened stage is on screen - its loading veil or 入场演出
        // has ended (STAGE_REVEAL). A consumer without a loader opens revealed (STAGE_OPEN).
        revealed: true,
        // The session's performance kind declarations (stage-performance-kinds.cjs) once the stage publishes core and the
        // installed managed mods' (SESSION_INPUTS performanceKinds); null reads as the core kinds.
        performanceKinds: null,
        // the session reconciled to no round at all (a new chat started without an opening);
        // the first-entry veil has nothing to wait for then (gal-entry.js).
        empty: false
    };
}

function stageRuntimeStatus(state) {
    if (!state.source) return 'idle';
    if (state.cursor.skipping) return 'skipping';
    if (state.cursor.mode === 'history') return 'historical-read';
    if (state.cursor.mode === 'replay') return 'replaying';
    if (!state.text.hasReadableText && state.pending.text) return 'awaiting-text';
    if (state.director.phase === 'done') return 'directed';
    if (state.director.through > 0) return 'director-partial';
    return 'streaming-without-direction';
}

// RPC failures carry structured diagnostics; presentation must always receive text.
function stageRuntimeErrorText(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (typeof error !== 'object') return String(error);
    const code = typeof error.code === 'string' ? error.code : '';
    const message = typeof error.message === 'string' ? error.message : '';
    const label = {PROJECTION_FAILED:'\u821e\u53f0\u8d44\u6e90\u6295\u5f71\u5931\u8d25', PLAYBACK_FAILED:'\u821e\u53f0\u56de\u653e\u8bfb\u53d6\u5931\u8d25',
        ASSET_STALE:'\u7d20\u6750\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u91cd\u8bd5',
        REVISION_CONFLICT:'\u6f14\u51fa\u72b6\u6001\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u91cd\u8bd5'}[code] || '\u821e\u53f0\u8d44\u6e90\u8bfb\u53d6\u5931\u8d25';
    return (code ? code + ': ' : '') + label + (message ? '\uff08' + message + '\uff09' : '');
}

// retain code + message for debug consumers, never stringify diagnostic objects.
// Normal stage warnings show prose only, including for older persisted "code: message" strings.
function stageDiagnosticText(diagnostic, debug = false) {
    if (!diagnostic) return '';
    let code = '', message = '';
    if (typeof diagnostic === 'string') {
        const match = diagnostic.match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[A-Z][A-Z0-9_]+)(?::\s*(.*))?$/s);
        if (match) { code = match[1]; message = match[2] || ''; }
        else message = diagnostic;
    } else if (typeof diagnostic === 'object') {
        code = typeof diagnostic.code === 'string' ? diagnostic.code : '';
        message = typeof diagnostic.message === 'string' ? diagnostic.message : '';
    } else return '';
    // raw validator prose belongs to diagnostics, never player details.
    if (!debug) {
        const reasons = {
            'Enter this actor first or choose a current cast actor.': '目标人物尚未入场，无法执行此演出',
            'Value not in catalogue': '指定值不在当前可用目录中',
            'Required field': '演出指令缺少必要参数',
            'Unknown field': '演出指令包含不支持的参数',
            'Event actor must be on stage': '目标人物尚未入场，无法执行此演出',
            'Failed to fetch': '网络连接失败，无法载入演出资源'
        };
        return reasons[message] || {
            PACING: '已按演出节奏保留原状态',
            ARG_INVALID: '演出指令参数未通过校验', INVALID_ASSET_PACK: '演出指令未通过素材校验',
            INVALID_JSON: '演出指令格式无效', REF_UNAVAILABLE: '所需素材不存在或当前不可用',
            PRECONDITION: '当前舞台状态不满足此演出的执行条件',
            DISABLED: '此演出能力未启用或没有可用素材', CAP_EXCEEDED: '演出指令超出安全限制',
            ACCEPTED_CONFLICT: '演出修正与已应用的内容冲突', INTERNAL: '演出处理失败',
            PROJECTION_FAILED: '舞台资源投影失败', PLAYBACK_FAILED: '舞台回放读取失败',
            ASSET_STALE: '素材已更新，正在重试',
            REVISION_CONFLICT: '演出状态已更新，正在重试',
            'time-look-missing': '缺少对应时段的灯光预设',
            'time-look-ambiguous': '对应时段存在多个灯光预设',
            'background-variant-missing': '没有可用的背景变体',
            'legacy-media-reconstructed': '旧存档未记录素材版本，已按当前素材重建'
        }[code] || (/^[^a-zA-Z]*[\u3400-\u9fff][^a-zA-Z]*$/.test(message) ? message : '本轮演出没能套用，正文不受影响');
    }
    if (!message) {
        const time = typeof diagnostic.timeOfDay === 'string' ? diagnostic.timeOfDay : '';
        message = {
            'time-look-missing': 'No time lighting preset is available',
            'time-look-ambiguous': 'Multiple time lighting presets match',
            'background-variant-missing': 'No background variant is available',
            'legacy-media-reconstructed': 'Original media versions are unknown'
        }[code] || 'Stage presentation is degraded';
        if (time) message += ' (' + time + ')';
    }
    return debug && code ? code + ': ' + message : message;
}

const stageNoDrops = Object.freeze([]);
// what a mod surface outside the stage surface may replay
// on the settled history page (HISTORY_DWELL), [{kind, key}]: the dwell's replayable mod kinds under the visit's key, on its
// paragraph's first page. The surface decides from its own data whether the page holds such a line - a phone line is the
// director's mark (mod.command) on the page, not a stored mod performance (chats keep none for it) - and sounds it once per
// key (the phone's incoming tone).
const stageNoPlays = Object.freeze([]);
function stageHistoryModPlays(state) {
    const cursor = state.cursor;
    if (cursor.mode !== 'history' || !cursor.dwell || cursor.anchor?.offset !== 0) return stageNoPlays;
    const core = performanceKindsKernel.STAGE_PERFORMANCE_CORE, key = JSON.stringify(['history-dwell', cursor.visitId, cursor.anchor.paragraphId]);
    const plays = cursor.dwell.kinds.filter(kind => !core.some(row => row.kind === kind)).map(kind => ({kind, key}));
    return plays.length ? plays : stageNoPlays;
}
function stageRuntimeIndicators(state) {
    return {
        writing: !state.text.hasReadableText && state.pending.text,
        // the stage notice has two layers, one authority each. The page layer
        // 「正在生成演出…」 is awaitingDirection below; the round layer is this phase of the round on screen, whatever page
        // of it is read: 'body' while its body streams, 'staging' once the body is done and later director windows are still
        // being staged, null when the round has nothing left to do.
        roundPhase: stageRoundPhase(state),
        // media loading is shown by its real progress (stage-load-progress.cjs), not here.
        // a failed direction warns on every visit to that turn, not only while the failure is fresh.
        error: state.pending.error ? stageRuntimeErrorText(state.pending.error)
            : state.director.phase === 'error' ? stageRuntimeErrorText(state.director.error || 'DIRECTION_FAILED') : null,
        degraded: ['off', 'error'].includes(state.director.phase) ? state.director.phase : null,
        // Optional command failures belong to the director/debug record, not the player.
        drops: stageNoDrops,
        // Auto holds here; manual paging never does.
        awaitingDirection: stageAwaitingDirection(state),
        // a one-shot of this page is still preparing or playing (an SE still sounds, a text card still shows) or
        // a performance ritual still plays; the story timer counts it as a caption (timer-stage.js). Skip never waits for it.
        performing: Object.values(state.ledger).some(entry => entry.status === 'pending' || entry.status === 'playing'),
        // why this page's line still waits (stageBeatHold), or null.
        beatHold: stageBeatHold(state)
    };
}
// The round layer reads the same host facts the reducer already keeps for the live round: the body's streaming flag
// (pending.text / text.streaming, from the session's running state) and the director envelope's running/partial phase
// (pending.director, cleared by done, off, error and a stop). While the reader browses an earlier round (history) the same
// two facts are kept for the latest round in state.round: its body flag from the session reconcile (TURN_CHANGED text) and
// its director phase from a read of that round's direction on every wake. Clip replays are not the working round.
function stageRoundPhase(state) {
    if (state.cursor.mode === 'history') return state.round?.body ? 'body' : state.round && stageRoundStaging(state.round) ? 'staging' : null;
    if (!state.source || state.cursor.mode !== 'live' || state.interrupted) return null;
    if (state.pending.text || state.text.streaming) return 'body';
    return state.pending.director ? 'staging' : null;
}
const stageRoundStaging = round => !round.complete && ['running', 'partial'].includes(round.phase);
// The live page's paragraph has no director prefix yet although one is coming (body still streaming or director
// running). Off/error/done, history and cancelled turns never wait; auto and skip both hold here.
function stageAwaitingDirection(state) {
    const anchor = state.cursor.anchor, config = state.settings?.config;
    if (!state.source || !anchor || state.cursor.mode !== 'live' || state.interrupted) return false;
    if (!config || config.enabled === false || config.stage?.director !== true) return false;
    if (state.director.complete || ['done', 'off', 'error'].includes(state.director.phase) || state.director.through >= anchor.para) return false;
    return state.pending.director || state.pending.text || state.text.streaming;
}

// the one sequencing point of a page. Its line - the text reveal,
// the voice and AUTO - starts only once the stage is revealed (the loading veil and the 入场演出 always block) and the page's
// blocking performances have ended; parallel ones play alongside. A performance placed on a paragraph (director entry
// `at`) comes with that paragraph's first page, so a blocking one precedes the line, a parallel one accompanies it; a text
// card placed after the paragraph follows it and never holds it. Returns why the line waits ('loading' | 'performance') or
// null. Skip never waits; a click skips the page's blocking performances (BEAT_SKIP), never the loader.
function stageBeatHold(state) {
    const cursor = state.cursor, anchor = cursor.anchor;
    if (!state.opened || cursor.skipping) return null;
    if (!state.revealed) return 'loading';
    if (!anchor || cursor.beatSkip && cursor.beatSkip.visitId === cursor.visitId && sameAnchor(cursor.beatSkip.anchor, anchor)) return null;
    const kinds = () => state.performanceKinds || performanceKindsKernel.STAGE_PERFORMANCE_CORE;
    for (const entry of Object.values(state.ledger)) {
        if ((entry.status === 'pending' || entry.status === 'playing') && !entry.performanceEvent && entry.token?.visitId === cursor.visitId &&
            sameAnchor(entry.token.anchor, anchor) && performanceKindsKernel.stagePerformanceBlocks(kinds(), entry.descriptor)) return 'performance';
    }
    // A performance combination starting (or exiting) live on this page, until its phase has played.
    const playback = state.performancePlayback;
    if (playback?.mode === 'start' && state.accepted.performance && state.ledger[performancePhaseLedgerKey(playback.token)]?.status === 'pending' &&
        performanceKindsKernel.stagePerformancePhaseBlocks(kinds(), state.accepted.performance)) return 'performance';
    // This paragraph starts or ends one that is still being prepared: whether it blocks is known once it is accepted.
    if (cursor.firstPageEligible && anchor.offset === 0 && state.projection && !state.projection.carry && state.projection.outstanding.includes('performance') &&
        state.director.entries.some(entry => entry.at === anchor.para && entry.ops?.some(op => op.op === 'perform' || op.op === 'perform.off'))) return 'performance';
    // History paging follows the same rule: a settled history page replays its own one-shots (HISTORY_DWELL), so until it has,
    // the first page of a paragraph that places a blocking replayable one-shot waits for it. Without the session's kinds the
    // stage never dwells, so nothing waits; a restored or skip-reached page (still) never plays.
    if (cursor.mode === 'history' && !cursor.dwell && !cursor.still && anchor.offset === 0 && state.performanceKinds) {
        const replays = descriptor => state.performanceKinds.find(row => row.kind === performanceKindsKernel.stagePerformanceKindOf(descriptor))?.replay.stage === true &&
            performanceKindsKernel.stagePerformanceBlocks(state.performanceKinds, descriptor);
        const through = state.director.through;
        if (state.director.entries.some(entry => entry.at === anchor.para && entry.at <= through && entry.events?.some(replays)) ||
            (state.director.modPerformances || []).some(performance => performance.at === anchor.para && performance.at <= through && replays({kind: 'mod-performance', performance}))) return 'performance';
    }
    return null;
}

const stageVisualGroup = key => key === 'cg' || key === 'background' || key === 'avatars' || key.startsWith('figure:');
const sameAnchor = (a, b) => a === b || !!a && !!b && a.paragraphId === b.paragraphId && a.para === b.para && a.offset === b.offset;
function pageAt(text, anchor) {
    return text.pages.find(page => sameAnchor(page.anchor, anchor));
}
function reconcileAnchor(text, anchor) {
    if (!anchor) return text.pages[0]?.anchor || null;
    const pages = text.pages.filter(page => page.anchor.paragraphId === anchor.paragraphId);
    return pages.filter(page => page.anchor.offset <= anchor.offset).at(-1)?.anchor || pages[0]?.anchor || text.pages[0]?.anchor || null;
}
const directionToken = state => ({bindingKey: state.director.bindingKey, prefixRevision: state.director.prefixRevision});
const sameDirection = (a, b) => a?.bindingKey === b?.bindingKey && a?.prefixRevision === b?.prefixRevision;
function sameRequest(a, b) {
    return !!a && !!b && a.id === b.id && sameSource(a.source, b.source) &&
        sameDirection(a.direction, b.direction) && a.visitId === b.visitId && sameAnchor(a.anchor, b.anchor);
}

function reduceStageRuntime(previous, event) {
    if (previous.disposed) {
        const type = event.type === 'PROJECTION_READY' ? 'release-projection' : event.type === 'ONE_SHOT_READY' ? 'release-one-shot' : null;
        return {state: previous, effects: type ? [{type, token: event.token}] : []};
    }
    let state = previous;
    const effects = [];
    const patch = value => { state = {...state, ...value}; };
    const pending = value => patch({pending: {...state.pending, ...value}});
    const observation = value => patch({observation: {...state.observation, ...value}});
    const nextId = () => { patch({serial: state.serial + 1}); return state.serial; };
    const effect = (type, value = {}) => effects.push({type, ...value});
    const scoped = () => sameSource(event.source, state.source) && !!state.source;

    function cancelTimer() {
        if (state.observation.timer) effect('cancel-timer', {token: state.observation.timer});
        observation({timer: null});
    }
    function cancelProjection() {
        if (state.projection) effect('cancel-projection', {token: state.projection.token});
        patch({projection: null});
        pending({projection: false, resources: false});
    }
    function cancelPlayback(reason) {
        let ledger = state.ledger;
        for (const [key, entry] of Object.entries(ledger)) {
            if (entry.status !== 'pending' && entry.status !== 'playing') continue;
            if (ledger === state.ledger) ledger = {...ledger};
            // What already started is played; the consumer cuts it (cancel-playback), except that a page turn lets a
            // sounding one-shot SE ring out (option A; stage-sfx.js caps it).
            if (entry.status === 'playing') ledger[key] = {...entry, status: 'played'};
            // skip ends the blocking performances the line waited for; the line's voice
            // already held ready at the page's sequencing point stays with its page and starts when the skip stops there.
            else if (reason === 'skip' && entry.ready) continue;
            else if (entry.descriptor.kind === 'mod-performance') delete ledger[key];
            else ledger[key] = {...entry, status: 'skipped', reason};
        }
        patch({ledger, playbackEpoch:state.playbackEpoch+1, performancePlayback:null});
        effect('cancel-playback', {source: state.source, visitId: state.cursor.visitId, reason});
    }
    function cancelSource() {
        cancelTimer(); cancelProjection(); cancelPlayback('source-changed');
        effect('release-preload');
        if (state.observation.flight) effect('cancel-read', {token: state.observation.flight});
        if (state.source) effect('unwatch-director', {source: state.source});
        patch({observation: emptyObservation()});
    }
    function requestRead() {
        if (!state.source) { observation({dirty: true}); return; }
        if (state.observation.flight) { observation({dirty: true}); return; }
        cancelTimer();
        const token = {id: nextId(), source: state.source};
        observation({flight: token, dirty: false});
        effect('read-director', {token, sinceRevision: state.director.revision, readOnly: true});
    }
    function scheduleRead() {
        cancelTimer();
        if (!state.source || state.cursor.mode !== 'live') return;
        const converged = ['done', 'off', 'error'].includes(state.director.phase);
        if (converged && !state.opened) return;
        const delay = state.observation.failures ? Math.min(5000, 700 * 2 ** (state.observation.failures - 1)) : converged ? 5000 : 700;
        const token = {id: nextId(), source: state.source};
        observation({timer: token});
        effect('schedule-read', {token, delay});
    }
    function finishRead(failed) {
        const dirty = state.observation.dirty;
        observation({flight: null, failures: failed ? state.observation.failures + 1 : 0,
            error: failed ? state.observation.error : null, dirty: false});
        if (dirty && !failed) requestRead();
        else scheduleRead();
    }
    // the latest round keeps working while the reader browses an earlier
    // round. Its direction stays watched; a wake reads it (read-round), the session reconcile (TURN_CHANGED) brings its body
    // flag. Once neither its body streams nor its director stages, it is dropped and unwatched.
    function dropRound() {
        const round = state.round;
        if (!round) return;
        if (round.flight) effect('cancel-read', {token: round.flight});
        effect('unwatch-director', {source: round.source});
        patch({round: null});
    }
    function readRound() {
        if (!state.round) return;
        if (state.round.flight) { patch({round: {...state.round, dirty: true}}); return; }
        const token = {id: nextId(), source: state.round.source};
        patch({round: {...state.round, flight: token, dirty: false}});
        effect('read-round', {token, sinceRevision: state.round.revision});
    }
    function settleRound() {
        if (state.round && !state.round.flight && !state.round.body && !stageRoundStaging(state.round)) dropRound();
    }
    function followRound(source, text) {
        const body = !!text?.streaming;
        if (state.round && sameSource(state.round.source, source)) {
            const finished = state.round.body && !body;
            if (state.round.body !== body) patch({round: {...state.round, body}});
            if (finished) readRound();
            settleRound();
        } else if (body) {
            dropRound();
            patch({round: {source, body, phase: 'unknown', complete: false, revision: -1, flight: null, dirty: false}});
            effect('watch-director', {source});
            readRound();
        } else dropRound();
    }
    const directed = () => !!state.director.bindingKey && (state.director.complete || state.director.through > 0);
    // Before the opening prefix, use the same authoritative predecessor as a failed turn.
    const carryNeeded = () => !!state.source && state.director.revision >= 0 && !directed() &&
        ['running', 'partial', 'error', 'unknown'].includes(state.director.phase);
    function requestCarry() {
        if (state.carry || state.carryRequest || !carryNeeded()) return;
        const token = {id: nextId(), source: state.source};
        patch({carryRequest: token});
        effect('resolve-carry', {token});
    }
    // The predecessor's sealed end, folded at its last paragraph; nothing of this turn is played.
    function projectCarry(carry, transition, replayBaseline = false) {
        const envelope = carry.envelope;
        const token = {id: nextId(), source: state.source, direction: {bindingKey: envelope.bindingKey, prefixRevision: envelope.prefixRevision}, visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        patch({projection: {token, carry: true, replayBaseline, outstanding: Object.keys(GROUPS).filter(key => key !== 'visual')}});
        pending({projection: true});
        effect('project', {token, at: envelope.through, carry: {source: carry.source, token: envelope.token, assetRevision: envelope.assetRevision},
            baseline: envelope.baseline, entries: envelope.entries, complete: true, transition});
    }
    function requestProjection() {
        // A replay shows its round's starting state (the predecessor's end) before its first page.
        if (state.replay?.phase === 'baseline') return;
        cancelProjection();
        if (!state.cursor.anchor) return;
        if (!directed()) {
            if (state.carry?.envelope) projectCarry(state.carry, state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal');
            return;
        }
        const token = {id: nextId(), source: state.source, direction: directionToken(state), visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        patch({projection: {token, outstanding: Object.keys(GROUPS).filter(key => key !== 'visual')}});
        pending({projection: true});
        effect('project', {
            token, at: Math.min(state.cursor.anchor.para, state.director.through),
            ...(state.cursor.anchor.para <= state.director.through ? {page:{index:state.text.pages.findIndex(page => sameAnchor(page.anchor,state.cursor.anchor)),para:state.cursor.anchor.para,offset:state.cursor.anchor.offset,version:1}} : {}),
            baseline: state.director.baseline, entries: state.director.entries,
            complete: state.director.complete,
            transition: state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal'
        });
    }
    function ledgerEvent(key, at, descriptor, late = false, after = false) {
        const cursor = state.cursor;
        // on a settled history page only that page's own replayable one-shots play, under their
        // own visit-scoped keys - the round's consumption records stay as they were (no write, no consumption).
        const dwell = cursor.mode === 'history' && cursor.dwell && sameAnchor(cursor.dwell.anchor, cursor.anchor);
        if (dwell) {
            if (at !== cursor.anchor.para || !cursor.dwell.kinds.includes(performanceKindsKernel.stagePerformanceKindOf(descriptor))) return;
            // A click before the dwell already skipped this page's blocking ones (BEAT_SKIP); its line is under way.
            if (cursor.beatSkip && cursor.beatSkip.visitId === cursor.visitId && sameAnchor(cursor.beatSkip.anchor, cursor.anchor) &&
                performanceKindsKernel.stagePerformanceBlocks(state.performanceKinds || performanceKindsKernel.STAGE_PERFORMANCE_CORE, descriptor)) return;
            key = JSON.stringify(['history-dwell', cursor.visitId, cursor.anchor.paragraphId, cursor.anchor.offset, key]);
        }
        if (state.ledger[key] || at > cursor.anchor.para) return;
        // An echo placed after its paragraph plays on that paragraph's last page; everything else on its first page.
        const page = dwell && after ? pageAt(state.text, cursor.anchor) : null, next = page && state.text.pages[state.text.pages.indexOf(page) + 1];
        // every consumed-without-playing event records why (diagnostics; no replay).
        // skip shows only what stageSkipShows allows; the rest is consumed, never replayed.
        const reason = late ? 'late' : at < cursor.anchor.para ? 'passed' : cursor.skipping && !stageSkipShows(descriptor) ? 'skip' : !state.opened ? 'stage-closed'
            : cursor.mode === 'history' ? (!dwell ? 'history' : (after ? next?.anchor.para === at : cursor.anchor.offset !== 0 && !descriptor.narration) ? 'not-first-page' : null)
            // a narration voice belongs to its own page (stageVoiceDescriptor), reached reading forward like an echo.
            : (after || descriptor.narration ? !cursor.afterEligible : cursor.anchor.offset !== 0 || !cursor.firstPageEligible) ? 'not-first-page' : null;
        const eligible = !reason;
        // One-shot presentations are consumed by history reading, never queued for a later visit; a replay plays them all again.
        const token = {key, id: nextId(), source: state.source, visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        patch({ledger: {...state.ledger, [key]: {status: eligible ? 'pending' : 'skipped', token, descriptor, ...(reason ? {reason} : {}), ...(dwell ? {dwell: true} : {})}}});
        if (eligible) effect('prepare-one-shot', {token, descriptor});
    }
    function scanEvents(late = false) {
        if (!state.cursor.anchor || state.replay?.phase === 'baseline') return;
        for (const entry of state.director.entries) {
            if (entry.at > state.director.through || entry.at > state.cursor.anchor.para) break;
            for (const op of entry.events || []) {
                const key = JSON.stringify([sourceKey(state.source), state.director.generation ?? 0, entry.ordinal, op.ordinal, state.cursor.visitId]);
                ledgerEvent(key, entry.at, op, late);
            }
        }
        for (const performance of state.director.modPerformances || []) {
            if (performance.at > state.director.through) continue;
            const after = stageTextcardKind(performance.kind) && performance.payload?.placement === 'after';
            if (after && performance.at === state.cursor.anchor.para && state.cursor.mode !== 'history' && state.opened && !late && state.cursor.afterEligible) {
                const page = pageAt(state.text, state.cursor.anchor), next = state.text.pages[state.text.pages.indexOf(page) + 1];
                // Echoes wait for the entire anchored paragraph, including its final page, to be revealed.
                if (!page || page.pending || typeof page.text !== 'string' || next?.anchor.para === performance.at ||
                    state.cursor.readThrough < page.anchor.offset + page.text.length) continue;
            }
            const key = modProjectionKernel.modPerformanceLedgerKey(sourceKey(state.source),performance.id,state.director.generation ?? 0);
            ledgerEvent(key, performance.at, {kind:'mod-performance',performance}, late, after);
        }
        const page = pageAt(state.text, state.cursor.anchor);
        // Voice starts only after the mounted consumer opens the stage, never during closed-session observation.
        if (state.opened && page?.voice && (!page.voice.narration || state.settings?.config?.narrator) && phoneBeatKernel.phoneModAutoVoiceAllowed(state.director,page.anchor.para,state.settings?.config?.stage?.director===true)) {
            // narration speaks per page (stageVoiceDescriptor); a line once per paragraph, its subtitle cards sharing the clip.
            const key = JSON.stringify([sourceKey(state.source), 'voice', page.anchor.paragraphId, state.cursor.visitId, ...(page.voice.narration ? [page.anchor.offset] : [])]);
            ledgerEvent(key, page.anchor.para, {kind: 'voice', ...page.voice});
        }
    }
    // follow: the cursor reached this turn by following the live latest turn, so the presentation on
    // screen is this turn's starting point. Navigation (history jump, resume, a SEND that pulls a
    // historical cursor forward) still shows the departure position until this visit stages a page.
    // eligible: the landing page plays its one-shots (live arrival).
    function selectSource(source, mode, text, anchor, generating, follow = false, eligible = mode === 'live') {
        const old = state.source;
        // Leaving the working live round for an earlier one keeps that round's phase (indicator v2); any other move drops it.
        const leaving = mode === 'history' && !state.round && state.cursor.mode === 'live' ? stageRoundPhase(state) : null;
        const round = leaving ? {source: old, body: leaving === 'body', phase: state.director.phase, complete: state.director.complete,
            revision: state.director.revision, flight: null, dirty: false} : mode === 'history' ? state.round : null;
        if (!round) dropRound();
        cancelSource();
        const revoke = old && !sameContext(old, source);
        if (revoke) {
            patch({accepted: emptyAccepted(state.accepted.presentationRevision + 1)});
            effect('revoke-presentation', {source: old, groups: Object.keys(GROUPS), reason: 'context-changed'});
        }
        const nextText = text || emptyText(), replay = mode === 'replay';
        // Mod one-shots are consumed for the session, not for a reading visit; a replay of their round consumes them anew.
        // A settled history page's plays belong to that visit only.
        const ledger = Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => entry.descriptor.kind === 'mod-performance' && !entry.dwell && !(replay && sameSource(entry.token.source, source))));
        patch({source, text: nextText, director: emptyDirector(), carry: null, carryRequest: null, ledger, liveStreamSeen: mode === 'live' && (!!generating || nextText.streaming),
            visitStaged: mode === 'live' && follow, replay: replay ? {phase: 'baseline', request: null} : null,
            cursor: {mode, anchor: anchor || nextText.pages[0]?.anchor || null, visitId: state.cursor.visitId + 1, readThrough: 0, skipping: state.cursor.skipping, firstPageEligible: eligible, afterEligible: eligible, still: false, dwell: null},
            interrupted: false, retryable: false, empty: false,
            pending: {text: !!generating || nextText.streaming, director: false, projection: false, resources: false, error: null}});
        if (mode === 'live') patch({latestSource: source});
        patch({round});
        if (leaving) effect('watch-director', {source: old});
        if (source) {
            effect('watch-director', {source});
            if (replay) {
                const token = {id: nextId(), source};
                patch({replay: {phase: 'baseline', request: token}});
                effect('resolve-carry', {token});
            }
            requestRead(); scanEvents();
        }
    }
    // The round's starting state is on screen (or there is none): play the round from its first page, as if live.
    function playReplay() {
        patch({replay: {phase: 'play', request: null}, cursor: {...state.cursor, firstPageEligible: state.cursor.anchor?.offset === 0, afterEligible: true}});
        requestProjection(); requestCarry(); scanEvents();
    }
    function acceptDirector(envelope) {
        if (!scoped() || envelope.revision <= state.director.revision) return;
        // The source adapter verifies digest/units/sealed entries. Revision is the watch
        // envelope version; prefixRevision only changes when persistent semantics change.
        // an explicit host retry is a new semantic generation even
        // when native text is unchanged. Keep presentation and paragraph voice.
        if (envelope.generation !== undefined && state.director.generation !== undefined && envelope.generation !== state.director.generation) {
            if (envelope.generation < state.director.generation) return;
            if (state.replay?.phase !== 'baseline') cancelProjection();
            patch({director: emptyDirector(), carry: null, carryRequest: null, ledger: Object.fromEntries(Object.entries(state.ledger)
                .filter(([,entry]) => entry.descriptor.kind === 'voice' || entry.descriptor.kind === 'mod-performance' && entry.status !== 'pending'))});
        }
        const hasPrefix = envelope.prefixRevision !== undefined;
        if (hasPrefix && (envelope.prefixRevision < state.director.prefixRevision || envelope.through < state.director.through)) return;
        // a tokenless envelope means the host no longer serves any direction for this
        // turn (a stopped or failed stream, a removed preview, direction turned off). Its old prefix cannot be
        // projected any more, so the turn becomes undirected and carries its baseline; accepted media stay until then.
        const dropped = !hasPrefix && dropUnservedPrefix();
        const before = directionToken(state);
        // The failure text is part of the turn's direction state (R10), replaced by every newer envelope.
        const director = hasPrefix ? {...state.director, ...envelope, error: envelope.error || null} : {...state.director, phase: envelope.phase, revision: envelope.revision, generation: envelope.generation, assetRevision: envelope.assetRevision, error: envelope.error || null};
        patch({director, liveStreamSeen: state.liveStreamSeen || state.cursor.mode === 'live' && envelope.streaming === true});
        if (envelope.modCorrectionRevision !== previous.director.modCorrectionRevision) {
            const performances = new Map((director.modPerformances || []).map(row => [row.id,row]));
            let ledger = state.ledger;
            for (const [key,entry] of Object.entries(ledger)) {
                if (entry.status !== 'pending' || entry.descriptor.kind !== 'mod-performance') continue;
                if (ledger === state.ledger) ledger = {...ledger};
                const performance = performances.get(entry.descriptor.performance.id);
                ledger[key] = performance ? {...entry,descriptor:{kind:'mod-performance',performance}} : {...entry,status:'skipped'};
                if (!performance) effect('release-one-shot',{token:entry.token});
            }
            if (ledger !== state.ledger) patch({ledger});
        }
        pending({director: !state.interrupted && !director.complete && ['running', 'partial'].includes(director.phase), error: envelope.error || (state.interrupted ? state.pending.error : null)});
        // Late prefixes fill persistent channels at the current cursor. The read fence
        // still consumes late one-shots, so staging cannot replay already read actions.
        const readFence = state.liveStreamSeen && state.visitStaged && !!envelope.binding?.stream && state.cursor.mode === 'live' && state.text.hasReadableText;

        if (hasPrefix && (!sameDirection(before, directionToken(state)) || envelope.complete && !previous.director.complete)) {
            requestProjection();
        }
        if (dropped && state.carry) requestProjection();
        requestCarry();
        scanEvents(readFence);
    }
    function dropUnservedPrefix() {
        if (!state.director.bindingKey) return false;
        cancelProjection();
        const {phase, revision, generation, assetRevision, error} = state.director;
        patch({director: {...emptyDirector(), phase: ['running', 'partial', 'done'].includes(phase) ? 'unknown' : phase, revision, generation, assetRevision, error: error || null}});
        pending({director: false});
        return true;
    }
    function performanceBoundaryPlayback() {
        const value=state.accepted.performance, old=state.performancePlayback;
        if (!value) {
            const ledger=Object.fromEntries(Object.entries(state.ledger).map(([key,entry]) => [key,entry.performanceEvent && entry.status === 'pending' ? {...entry,status:'skipped'} : entry]));
            patch({ledger,performancePlayback:null,playbackEpoch:state.playbackEpoch+1}); return;
        }
        if (old && JSON.stringify(old.token.instanceKey) === JSON.stringify(value.instanceKey) && JSON.stringify(old.token.phaseKey) === JSON.stringify(value.phaseKey) &&
            old.token.playbackEpoch === state.playbackEpoch && sameSource(old.token.source,state.source)) {
            patch({performancePlayback:{...old,mode:'keep'}}); return;
        }
        const token={source:state.source,instanceKey:value.instanceKey,phaseKey:value.phaseKey,visitId:state.cursor.visitId,playbackEpoch:state.playbackEpoch+1};
        const key=performancePhaseLedgerKey(token), summary=state.ledger[key];
        // Turning forward onto the trigger page plays the phase in real time (live, or a replay of the round); history,
        // jumps, page-back and revisits in this visit (ledger summary) snap.
        // Skip seeks it (stageSkipShows: a timeline with skin, look and sound is never played at skip pace).
        const live=!summary && state.opened && state.cursor.firstPageEligible && !state.cursor.skipping && value.phase !== 'idle';
        const layer=performanceStateKernel.performanceSustained(value.plan);
        let initial=layer;
        if (live) {
            initial={skin:null,bgm:value.plan.bgm || null,look:null,ambience:null,widgets:{}};
            if (value.phase === 'exit' && old) initial=old.layer;
            if (value.phase !== 'entry') for (const event of value.plan.sustainedEvents || []) {
                if (event.block === 'entry') initial=performanceStateKernel.reducePerformanceEvent(initial,event);
            }
        }
        // Older cycles collapse into the phase summary; no per-frame or unbounded idle history.
        const ledger=Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => !entry.performanceEvent));
        ledger[key]=summary || {status:live ? 'pending' : 'skipped',descriptor:{kind:'performance-phase'},lastCompletedCycle:-1};
        patch({ledger,playbackEpoch:token.playbackEpoch,performancePlayback:{token,mode:live ? 'start' : 'seek',layer:initial}});
    }
    function commitGroups(groups, token, transition) {
        let accepted = state.accepted;
        const changed = [];
        for (const [group, intent] of Object.entries(groups)) {
            const figure = group.startsWith('figure:');
            const fields = figure ? ['figures'] : GROUPS[group];
            if (!fields || !['set', 'clear'].includes(intent.kind)) continue;
            const values = intent.kind === 'clear' ? Object.fromEntries(fields.map(field => [field, null])) :
                figure ? {figures:intent.value} : ['visual','background','music'].includes(group) ? intent.value : {[group]: intent.value};
            if (fields.some(field => !Object.hasOwn(values, field))) throw new TypeError('Incomplete presentation group: ' + group);
            const provenance = {token, kind: intent.kind, reason: intent.reason || null};
            if (accepted === state.accepted) accepted = {...accepted, provenanceByChannel: {...accepted.provenanceByChannel}};
            if (figure) {
                accepted.figuresBySlot = {...accepted.figuresBySlot};
                if (intent.kind === 'clear') delete accepted.figuresBySlot[group];
                else accepted.figuresBySlot[group] = intent.value;
                const order = state.projection?.figureKeys || Object.keys(accepted.figuresBySlot);
                const keys = [...order, ...Object.keys(accepted.figuresBySlot).filter(key => !order.includes(key))];
                accepted.figures = keys.map(key => accepted.figuresBySlot[key]).filter(Boolean);
            } else {
                for (const field of fields) accepted[field] = values[field];
                if (group === 'visual') {accepted.figuresBySlot = {}; accepted.layout = null;}
            }
            if ((figure || group === 'background') && state.projection?.layout) accepted.layout = state.projection.layout;
            accepted.provenanceByChannel[group] = provenance;
            changed.push(group);
        }
        if (changed.length) {
            accepted.presentationRevision++;
            patch({accepted});
            if (changed.includes('performance')) performanceBoundaryPlayback();
            effect('present', {token, groups: changed, accepted, transition, performancePlayback:state.performancePlayback});
        }
    }

    switch (event.type) {
    case 'SESSION_INPUTS': {
        const inputs = {};
        for (const key of ['textIndex', 'settings', 'preferences', 'performanceKinds']) {
            if (Object.hasOwn(event, key) && event[key] !== state[key]) inputs[key] = event[key];
        }
        if (Object.keys(inputs).length) patch(inputs);
        break;
    }
    case 'SESSION_EMPTY':
        selectSource(null, 'live', emptyText(), null, false);
        patch({empty: true});
        break;
    case 'SEND':
    case 'SEND_ACK':
    case 'TURN_CHANGED':
        if (state.cursor.mode !== 'live' && event.type === 'TURN_CHANGED' && sameContext(state.source, event.source)) {
            patch({latestSource: event.source});
            if (state.cursor.mode === 'history') followRound(event.source, event.text);
        } else if (!sameSource(state.source, event.source)) {
            selectSource(event.source, 'live', event.text, null, event.type !== 'TURN_CHANGED' || event.generating, state.cursor.mode === 'live' && !!state.source);
        } else if (event.type !== 'TURN_CHANGED' && state.cursor.mode !== 'live') {
            // SEND can precede the new native node. Leave history/replay now, or its later
            // TURN_CHANGED would keep following the old turn forever.
            patch({cursor: {...state.cursor, mode: 'live'}, replay: null, latestSource: event.source});
            requestRead();
        }
        break;
    case 'HISTORY_JUMP':
        selectSource(event.source, 'history', event.text, event.anchor, false);
        // still: a restored position (reload, a refresh) shows its page as it stands and never plays it.
        if (event.still) patch({cursor: {...state.cursor, still: true}});
        break;
    // the reader settled on this history page (the stage's
    // dwell, ~1 s while paging continuously): its own replayable one-shots play from the page's projected state, as on a
    // forward live arrival, under visit-scoped keys - nothing persistent is written and no consumption record changes.
    // kinds: the registry's kinds with replay {stage:true}. A skip or restore landing (still) never plays.
    case 'HISTORY_DWELL': {
        const cursor = state.cursor;
        if (cursor.mode !== 'history' || cursor.still || cursor.skipping || cursor.dwell || !state.opened ||
            event.visitId !== cursor.visitId || !sameAnchor(event.anchor, cursor.anchor)) break;
        patch({cursor: {...cursor, dwell: {anchor: cursor.anchor, kinds: event.kinds}}});
        scanEvents();
        break;
    }
    case 'RESUME_LIVE':
        selectSource(event.source || state.latestSource, 'live', event.text, event.anchor, event.generating);
        break;
    // a clip export's replay of one round, from its starting state, everything as if live.
    case 'REPLAY_START':
        selectSource(event.source, 'replay', event.text, event.anchor || null, false, false, false);
        break;
    case 'TEXT_APPEND':
    case 'TEXT_RECONCILE': {
        if (!scoped() || event.text.revision <= state.text.revision) break;
        const oldAnchor = state.cursor.anchor;
        // readThrough is the end of the text read (exclusive): the reader stays on the page holding its last read character.
        // a streaming paragraph that split at exactly that end moved the
        // reader onto the new, unread page (the reply jumped ahead while it was still being written).
        const anchor = reconcileAnchor(event.text, oldAnchor && {...oldAnchor, offset: Math.max(oldAnchor.offset, state.cursor.readThrough - 1)});
        const sameParagraph = oldAnchor?.paragraphId === anchor?.paragraphId;
        patch({text: event.text, liveStreamSeen: state.liveStreamSeen || state.cursor.mode === 'live' && event.text.streaming, cursor: {...state.cursor, anchor,
            readThrough: sameParagraph ? state.cursor.readThrough : 0,
            firstPageEligible: state.cursor.firstPageEligible && (!oldAnchor || sameParagraph) && anchor?.offset === 0}});
        pending({text: event.text.streaming && !state.interrupted});
        if (!sameAnchor(anchor, oldAnchor)) {
            cancelPlayback('anchor-changed'); requestProjection();
        }
        scanEvents();
        if (!event.text.streaming && previous.text.streaming) { requestRead(); requestCarry(); }
        break;
    }
    case 'SEND_FAILED':
    case 'SEND_CANCELLED':
        if (state.round && sameSource(event.source, state.round.source)) dropRound();
        if (scoped()) {
            patch({text: {...state.text, streaming: false}, interrupted: true, retryable: event.retryable === true});
            pending({text: false, director: false, error: event.error || 'cancelled'});
            requestRead();
            // a failed/cancelled (re)generation is undirected; show its baseline, never blank.
            requestCarry();
        }
        break;
    case 'READ_PROGRESS':
        if (scoped() && (!event.anchor || sameAnchor(event.anchor,state.cursor.anchor))) {
            patch({cursor: {...state.cursor, readThrough: Math.max(state.cursor.readThrough, event.readThrough)}});
            scanEvents();
        }
        break;
    case 'PAGE': {
        const page = state.text.pages[event.index];
        if (!page || sameAnchor(page.anchor, state.cursor.anchor)) break;
        cancelPlayback('page-changed');
        const forward = !state.cursor.anchor || page.anchor.para > state.cursor.anchor.para;
        // History reading never plays; live reading and a replay play what a forward page turn reaches.
        const plays = state.cursor.mode !== 'history';
        // A page reached while skipping stays still once the skip stops there.
        patch({cursor: {...state.cursor, anchor: page.anchor, readThrough: page.anchor.offset, still: state.cursor.skipping || event.still === true, dwell: null,
            afterEligible: plays && (forward && page.anchor.offset === 0 || state.cursor.afterEligible && page.anchor.para === state.cursor.anchor?.para && page.anchor.offset > state.cursor.anchor.offset),
            firstPageEligible: plays && forward && page.anchor.offset === 0}});
        requestProjection(); scanEvents();
        break;
    }
    // skip is fast forward reading (the stage turns the pages, PAGE) that is silent and
    // never waits: persistent changes snap, one-shots follow stageSkipShows. Starting it cuts what this page still plays
    // (a sounding SE - including one rung over from an earlier page -, a ritual - which lands on its sustained state).
    case 'SKIP_START':
        patch({cursor: {...state.cursor, skipping: true, still: true}});
        cancelPlayback('skip');
        break;
    case 'SKIP_END':
        patch({cursor: {...state.cursor, skipping: false}});
        break;
    case 'ACCEPT_PREFIX':
    case 'DIRECTOR_SNAPSHOT':
        acceptDirector(event.envelope);
        if (scoped() && !state.observation.flight) scheduleRead();
        break;
    case 'DIRECTOR_READ_RESULT':
    case 'DIRECTOR_READ_FAILED':
        if (event.token?.id !== state.observation.flight?.id || !sameSource(event.token?.source, state.source)) break;
        if (event.type === 'DIRECTOR_READ_FAILED') {
            observation({error: event.error});
            pending({error: event.error});
        } else {
            if (state.observation.error && state.pending.error === state.observation.error) pending({error: null});
            if (event.envelope) {
                // Completion events carry their source in the read token, not a second identity.
                event = {...event, source: event.token.source};
                acceptDirector(event.envelope);
            }
        }
        finishRead(event.type === 'DIRECTOR_READ_FAILED');
        break;
    case 'CARRY_RESULT':
        // carry: {source, envelope} of the nearest earlier complete direction, or null (none / unreadable).
        if (event.token?.id === state.replay?.request?.id && sameSource(event.token.source, state.source)) {
            patch({replay: {...state.replay, request: null}});
            if (event.carry) projectCarry(event.carry, 'snap', true); else playReplay();
            break;
        }
        if (event.token?.id !== state.carryRequest?.id || !sameSource(event.token?.source, state.source)) break;
        patch({carryRequest: null, carry: event.carry || null});
        if (event.carry && !directed()) requestProjection();
        break;
    case 'RECONCILE':
    case 'DIRECTOR_WAKE':
        if (!event.source || scoped()) requestRead();
        if (state.round && (!event.source || sameSource(event.source, state.round.source))) readRound();
        break;
    case 'ROUND_READ_RESULT':
    case 'ROUND_READ_FAILED': {
        const round = state.round;
        if (!round || event.token?.id !== round.flight?.id) break;
        const envelope = event.type === 'ROUND_READ_RESULT' ? event.envelope : null;
        patch({round: {...round, flight: null, dirty: false, ...(envelope ? {phase: envelope.phase, complete: envelope.complete === true,
            revision: envelope.revision ?? round.revision} : {})}});
        if (round.dirty) readRound(); else settleRound();
        break;
    }
    case 'READ_TIMER':
        if (event.token?.id === state.observation.timer?.id && sameSource(event.token?.source, state.source)) {
            observation({timer: null}); requestRead();
        }
        break;
    case 'VISIBILITY':
        patch({visible: event.visible});
        // Visibility may pause painting, never source reads or incremental state.
        if (event.visible) { requestRead(); readRound(); }
        break;
    case 'STAGE_OPEN':
        patch({opened: event.opened, revealed: event.opened && event.revealed !== false});
        effect('playback-policy', {opened:event.opened});
        if (event.opened) {
            // opening a settled stream is an explicit restore, not a late delta.
            if (!previous.opened && state.liveStreamSeen && state.director.complete && !state.text.streaming) {
                patch({liveStreamSeen: false}); requestProjection();
            }
            requestRead();
            scanEvents();
            if (state.accepted.performance && !state.performancePlayback) {
                performanceBoundaryPlayback();
                effect('present',{token:{id:nextId(),source:state.source},groups:['performance'],accepted:state.accepted,transition:'snap',performancePlayback:state.performancePlayback});
            }
        } else {
            cancelPlayback('stage-closed');
            patch({cursor: {...state.cursor, firstPageEligible: false, afterEligible: false}});
            scheduleRead();
        }
        break;
    case 'READ_PENDING':
    case 'REFRESH_BEGIN':
        if (scoped()) {
            if (event.type === 'REFRESH_BEGIN') effect('invalidate-projection');
            pending({error: null}); requestProjection();
        }
        break;
    case 'READ_FAILED':
        if (scoped()) pending({error: event.error});
        break;
    case 'PROJECTION_PENDING':
        if (sameRequest(event.token, state.projection?.token)) pending({projection: false, resources: true});
        break;
    // the host no longer serves the direction this request names (a cancelled or failed
    // stream, a redirected or removed record). Re-asking with that token can only be answered stale again, so the
    // request settles here instead of waiting forever; accepted presentation is kept until a replacement is accepted.
    case 'PROJECTION_STALE': {
        if (!sameRequest(event.token, state.projection?.token)) break;
        const carried = !!state.projection.carry;
        if (state.projection.replayBaseline) { cancelProjection(); playReplay(); break; }
        cancelProjection();
        // A stale carry is resolved again only by a changed direction read, never in a loop on the same answer.
        if (carried) { patch({carry: null}); break; }
        // The host has no direction for this turn at all: the turn is undirected and presents its baseline.
        if (!event.directionToken && dropUnservedPrefix()) {
            if (state.carry) requestProjection(); else requestCarry();
        }
        // A newer direction is picked up by the ordinary read; its new token projects the current page.
        requestRead();
        break;
    }
    // discovery registers directed slots before any asynchronous group can finish.
    case 'PROJECTION_GROUPS':
        if (sameRequest(event.token, state.projection?.token) && !state.projection.figureKeys) {
            patch({projection:{...state.projection, figureKeys:event.figureKeys, layout:event.layout,
                outstanding:[...state.projection.outstanding, ...event.figureKeys]}});
        }
        break;
    case 'PROJECTION_GROUP_ERROR':
        if (sameRequest(event.token, state.projection?.token) && state.projection.outstanding.includes(event.group)) {
            patch({projection:{...state.projection, errors:{...state.projection.errors,[event.group]:event.error}}});
            pending({error:event.error});
        }
        break;
    case 'PROJECTION_FAILED':
        if (sameRequest(event.token, state.projection?.token)) {
            const baseline = state.projection.replayBaseline;
            cancelProjection(); pending({error: event.error});
            if (baseline) playReplay();
        }
        break;
    case 'PROJECTION_READY': {
        if (!sameRequest(event.token, state.projection?.token)) {
            effect('release-projection', {token: event.token}); break;
        }
        const groups = Object.fromEntries(Object.entries(event.groups).filter(([key]) => state.projection.outstanding.includes(key)));
        const retired = {};
        if (groups.background && groups.background.kind !== 'unknown' && state.projection.figureKeys) {
            for (const key of Object.keys(state.accepted.figuresBySlot)) {
                if (!state.projection.figureKeys.includes(key)) retired[key] = {kind:'clear',reason:'slot-removed'};
            }
        }
        const baseline = state.projection.replayBaseline;
        commitGroups({...groups,...retired}, event.token, baseline || state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal');
        const resolved = Object.keys(groups).filter(key => groups[key].kind !== 'unknown');
        if (resolved.some(stageVisualGroup) && !state.visitStaged) patch({visitStaged: true});
        const outstanding = state.projection.outstanding.filter(key => !resolved.includes(key));
        const errors = {...state.projection.errors};
        for (const key of resolved) {if (event.error) errors[key] = event.error; else delete errors[key];}
        patch({projection: outstanding.length ? {...state.projection, outstanding, errors} : null});
        pending({projection: outstanding.length > 0, resources: outstanding.length > 0,
            // a carried scene must not erase the failed generation's notice.
            error: Object.values(errors)[0] || (state.interrupted ? state.pending.error : null)});
        if (baseline && !outstanding.length) playReplay();
        break;
    }
    case 'AVATARS_WARMED':
        if (sameRequest(event.token,state.accepted.provenanceByChannel.avatars?.token))
            patch({accepted:{...state.accepted,avatars:event.value}});
        break;
    case 'PERFORMANCE_UNAVAILABLE':
        if (scoped()) {
            const token = {id:nextId(),source:state.source,direction:directionToken(state),visitId:state.cursor.visitId,anchor:state.cursor.anchor};
            commitGroups({performance:{kind:'clear',reason:event.reason}},token,'snap');
        }
        break;
    case 'RESOURCE_REVOKED':
        if (scoped()) {
            cancelProjection();
            const token = {id:nextId(),source:state.source,direction:directionToken(state),visitId:state.cursor.visitId,anchor:state.cursor.anchor};
            commitGroups(event.groups,token,'snap');
        }
        break;
    case 'CLEAR':
    case 'REVOKE': {
        if (!scoped()) break;
        // Revocation invalidates the whole in-flight candidate, but only clears named groups.
        cancelProjection();
        if (event.type === 'REVOKE') cancelPlayback('revoked');
        const token = {id: nextId(), source: state.source, direction: directionToken(state), visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        const groups = Object.fromEntries(event.groups.map(group => [group, {kind: 'clear', reason: event.reason}]));
        commitGroups(groups, token, 'snap');
        break;
    }
    case 'PERFORMANCE_EVENT_DUE': {
        const playback=state.performancePlayback;
        // Only a started (first forward visit) playback schedules events, in live and history alike.
        if (!samePerformanceToken(event.token,playback?.token) || !state.opened || state.ledger[event.key]) break;
        const summary=state.ledger[performancePhaseLedgerKey(event.token)];
        if (event.descriptor.cueId !== 'type' && (event.descriptor.cycle ?? 0) <= (summary?.lastCompletedCycle ?? -1)) break;
        const descriptor=event.descriptor, token={...event.token,key:event.key,id:nextId(),anchor:state.cursor.anchor,performance:true};
        const audio=descriptor.do === 'sfx';
        if (descriptor.do === 'flash') {
            const flashes=state.performanceFlashes.filter(at => event.atMs-at<1000);
            if(flashes.length>=3) {
                patch({ledger:{...state.ledger,[event.key]:{status:'skipped',token,descriptor,performanceEvent:true}}});break;
            }
            patch({performanceFlashes:[...flashes,event.atMs]});
        }
        const layer=descriptor.retiring ? playback.layer : performanceStateKernel.reducePerformanceEvent(playback.layer,descriptor);
        patch({performancePlayback:{...playback,layer},ledger:{...state.ledger,[event.key]:{status:audio ? 'pending' : 'played',token,descriptor,performanceEvent:true}}});
        if (audio) effect('prepare-one-shot',{token,descriptor:{...descriptor,kind:'sfx',value:descriptor.ref}});
        else effect('performance-event',{token:playback.token,descriptor,layer});
        break;
    }
    case 'PERFORMANCE_PHASE_CONSUMED':
    case 'PERFORMANCE_CYCLE_COMPLETED': {
        if (!samePerformanceToken(event.token,state.performancePlayback?.token)) break;
        const key=performancePhaseLedgerKey(event.token), old=state.ledger[key];
        if (!old) break;
        const cycle=event.cycle ?? old.lastCompletedCycle;
        const ledger=Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => !entry.performanceEvent || (entry.descriptor.cycle ?? 0)>cycle || entry.status === 'pending'));
        ledger[key]={...old,status:event.skipped ? 'skipped' : 'played',lastCompletedCycle:Math.max(old.lastCompletedCycle,cycle)};
        patch({ledger});
        if (event.type === 'PERFORMANCE_PHASE_CONSUMED') effect('performance-sustained',{token:event.token,value:state.accepted.performance,snap:!!event.skipped});
        break;
    }
    case 'ONE_SHOT_READY': {
        const entry = state.ledger[event.token?.key];
        if (!entry || entry.status !== 'pending' || entry.token.id !== event.token.id ||
            !sameSource(event.token.source, state.source) || event.token.visitId !== state.cursor.visitId ||
            (event.token.performance && !samePerformanceToken(event.token,state.performancePlayback?.token)) ||
            !sameAnchor(event.token.anchor, state.cursor.anchor) || !state.opened) {
            effect('release-one-shot', {token: event.token}); break;
        }
        // The line's voice is prepared early and waits here for the page's sequencing point (stageBeatHold, releaseBeats).
        if (entry.descriptor.kind === 'voice' && stageBeatHold(state)) { patch({ledger: {...state.ledger, [event.token.key]: {...entry, ready: true}}}); break; }
        patch({ledger: {...state.ledger, [event.token.key]: {...entry, status: 'playing'}}});
        effect('play-one-shot', {token: event.token, descriptor: entry.descriptor});
        break;
    }
    // the stage's loading veil / 入场演出 has ended (true) or the stage is loading.
    case 'STAGE_REVEAL':
        patch({revealed: event.revealed === true});
        break;
    // A click while the line waits for this page's blocking performances skips them: a combination's phase lands on its
    // sustained state (the consumer ends a title or text card itself) and the line starts at once. It never skips the loader.
    case 'BEAT_SKIP': {
        if (stageBeatHold(state) !== 'performance') break;
        patch({cursor: {...state.cursor, beatSkip: {visitId: state.cursor.visitId, anchor: state.cursor.anchor}}});
        const playback = state.performancePlayback;
        if (playback?.mode === 'start' && state.ledger[performancePhaseLedgerKey(playback.token)]?.status === 'pending') effect('seek-performance', {token: playback.token});
        break;
    }
    // The consumer finished (or cut) a one-shot it played.
    case 'ONE_SHOT_DONE': {
        const entry = state.ledger[event.token?.key];
        if (entry?.status === 'playing' && entry.token.id === event.token.id) patch({ledger: {...state.ledger, [event.token.key]: {...entry, status: 'played'}}});
        break;
    }
    case 'ONE_SHOT_FAILED': {
        const entry = state.ledger[event.token?.key];
        if (entry?.status === 'pending' && entry.token.id === event.token.id) {
            patch({ledger: {...state.ledger, [event.token.key]: {...entry, status: 'skipped', reason: 'failed'}}});
        }
        break;
    }
    case 'DISPOSE':
        dropRound(); cancelSource();
        effect('release-presentation', {accepted: state.accepted});
        patch({disposed: true});
        break;
    default:
        throw new TypeError('Unknown stage runtime event: ' + event.type);
    }
    // A voice that waited for the page's sequencing point plays once nothing holds the line any more.
    if (!state.disposed) {
        let ready = null;
        for (const [key, entry] of Object.entries(state.ledger)) if (entry.ready && entry.status === 'pending') (ready ||= []).push(key);
        if (ready && !state.cursor.skipping && !stageBeatHold(state)) {
            const ledger = {...state.ledger};
            for (const key of ready) {
                const {ready: _ready, ...entry} = ledger[key];
                ledger[key] = {...entry, status: 'playing'};
                effect('play-one-shot', {token: entry.token, descriptor: entry.descriptor});
            }
            patch({ledger});
        }
    }
    return {state, effects};
}

return {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus, stageRuntimeIndicators, stageHistoryModPlays, stageBeatHold, stageRuntimeErrorText, stageDiagnosticText, stageSkipShows, sourceKey, sameSource, sameAnchor, STAGE_HISTORY_SETTLE_MS};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageRuntimeKernel};

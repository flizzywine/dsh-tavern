'use strict';
// the one
// loading-progress feature. The stage resource runner reports each foreground load (one projection request) here: the
// presentation read, then the media it really has to fetch and decode (resources already in the owner's cache are not
// counted). Nothing is estimated: the bar is settled items / items, the label names the kind still loading. A load that
// ends within STAGE_LOAD_SHOW_MS never shows; a failed item is named once the load settles and the stage carries on.
// Panels without countable work use PanelLoading: placeholders shaped like the page, then the elapsed seconds after 2 s.
const STAGE_LOAD_SHOW_MS = 300, STAGE_LOAD_MIN_MS = 500, STAGE_LOAD_FADE_MS = 250, STAGE_LOAD_ERROR_MS = 4000;
const STAGE_LOAD_KINDS = [['background', '背景'], ['figure', '立绘'], ['avatars', '头像'], ['cg', 'CG'], ['music', '音乐'],
    ['ambience', '环境音'], ['widgets', '组件'], ['performance', '演出组合']];
const STAGE_LOAD_LABEL = Object.fromEntries(STAGE_LOAD_KINDS);
// the entry veil names the step that is really running, in this
// order when several run at once. Each is one of the runner's real groups (a figure split by form: a Live2D / Spine bundle
// is a model with its textures, a sprite is its images); no step is invented. Weights share the bar between the items a load
// counts: a step that fetches and decodes more weighs more. Before the items are known the host is replaying the direction
// to this page (the read); after they settle the stage draws its first frame (fonts, images, the scene) - each owns a share.
const STAGE_LOAD_STEPS = ['background', 'model:live2d', 'model:spine', 'figure', 'avatars', 'cg', 'music', 'ambience', 'widgets', 'performance'];
const STAGE_LOAD_STEP_LINES = {background: '正在铺设背景', 'model:live2d': '正在唤醒 Live2D 模型', 'model:spine': '正在唤醒 Spine 模型',
    figure: '正在展开立绘', avatars: '正在描绘头像', cg: '正在冲印 CG', music: '正在装填 BGM', ambience: '正在铺开环境音', widgets: '正在摆放小组件',
    performance: '正在准备演出组合'};
const STAGE_LOAD_WEIGHTS = {background: 3, 'model:live2d': 4, 'model:spine': 4, figure: 2, avatars: .5, cg: 2, music: 1.5, ambience: 1, widgets: 1, performance: 1.5};
const STAGE_LOAD_READ_SHARE = .12, STAGE_LOAD_DRAW_SHARE = .08, STAGE_LOAD_THROTTLE_MS = 120;
const stageLoadStep = item => item.kind === 'figure' && (item.form === 'live2d' || item.form === 'spine') ? 'model:' + item.form : item.kind;
// A background that brings the skin's bundle (its art and fonts) does twice the work.
const stageLoadWeight = item => STAGE_LOAD_WEIGHTS[stageLoadStep(item)] + (item.skin ? 2 : 0);
// A retried lease (the runner re-reads silently) or a cancelled load is not a failed item.
const STAGE_LOAD_QUIET = ['ASSET_STALE', 'REVISION_CONFLICT', 'RESOURCE_CANCELLED', 'RESOURCE_REVOKED', 'RESOURCE_DISPOSED'];
const stageLoadQuiet = error => STAGE_LOAD_QUIET.includes(error?.code);
const stageLoadKind = group => group.startsWith('figure:') ? 'figure' : group;
const stageLoadResourceKey = item => JSON.stringify([item.identity, Object.hasOwn(item, 'crop') ? item.crop : null]);
function stageLoadResources(value, out = []) {
    if (value?.resource === true) out.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(item => stageLoadResources(item, out));
    return out;
}
// One item per figure, background, CG and audio group; one per face for the avatars (each is its own file).
function stageLoadPlanItems(candidates, {outstanding = () => true, isPrepared = () => false} = {}) {
    const items = new Map();
    for (const [group, candidate] of Object.entries(candidates || {})) {
        const kind = stageLoadKind(group);
        if (!candidate || !STAGE_LOAD_LABEL[kind] || !outstanding(group)) continue;
        if (group === 'avatars') {
            for (const figure of candidate) for (const item of stageLoadResources(figure)) {
                const key = 'avatars:' + stageLoadResourceKey(item);
                if (!items.has(key) && !isPrepared(item)) items.set(key, {key, group, kind, alias: figure.alias || null});
            }
        } else if (stageLoadResources(candidate).length && !isPrepared(candidate)) items.set(group, {key: group, group, kind, alias: candidate.alias || null,
            // What the entry veil's step line says (stageLoadEntryLine): a figure's form and outfit, a background's skin bundle.
            form: kind === 'figure' ? candidate.form || null : null, outfit: kind === 'figure' ? candidate.outfit?.label || null : null,
            skin: kind === 'background' && !!candidate.scene?.skin});
    }
    return [...items.values()];
}
function stageLoadView(load) {
    const items = [...load.items.values()], settled = items.filter(item => item.status !== 'pending');
    const failed = items.filter(item => item.status === 'failed').map(item => ({kind: item.kind, alias: item.alias}));
    const kind = STAGE_LOAD_KINDS.map(([id]) => id).find(id => items.some(item => item.kind === id && item.status === 'pending')) || null;
    const ofKind = items.filter(item => item.kind === kind);
    const step = STAGE_LOAD_STEPS.find(id => items.some(item => item.status === 'pending' && stageLoadStep(item) === id)) || null;
    const ofStep = items.filter(item => stageLoadStep(item) === step), weight = list => list.reduce((sum, item) => sum + stageLoadWeight(item), 0);
    const current = ofStep.find(item => item.status === 'pending');
    return Object.freeze({id: load.id, startedAt: load.startedAt, visibleAt: load.visibleAt, endedAt: load.endedAt,
        phase: load.planned ? 'media' : 'read', total: items.length, settled: settled.length, failed,
        weight: weight(items), weightSettled: weight(settled), step, stepTotal: ofStep.length, stepSettled: ofStep.filter(item => item.status !== 'pending').length,
        stepItem: current ? {alias: current.alias, outfit: current.outfit} : null, skin: items.some(item => item.skin),
        kind, kindLabel: kind ? STAGE_LOAD_LABEL[kind] : '', kindTotal: ofKind.length, kindSettled: ofKind.filter(item => item.status !== 'pending').length});
}
// What the stage shows at `now`: pending (not yet), shown, error (a settled load with failed items), out (fading), hidden.
function stageLoadDisplay(view, now) {
    if (!view) return 'hidden';
    if (view.endedAt === null) return now >= view.visibleAt ? 'shown' : 'pending';
    const failed = view.failed.length > 0, until = stageLoadUntil(view);
    // A failed item is named however fast the load settled.
    if (!failed && view.endedAt < view.visibleAt) return 'hidden';
    // a page whose read and media were all prefetched waited on nothing; continuing a
    // previous load's bar must not flash 「载入完成」 for it.
    if (!failed && !view.total && view.endedAt - view.startedAt < STAGE_LOAD_SHOW_MS) return 'hidden';
    return now < until ? (failed ? 'error' : 'shown') : now < until + STAGE_LOAD_FADE_MS ? 'out' : 'hidden';
}
const stageLoadUntil = view => view.failed.length ? view.endedAt + STAGE_LOAD_ERROR_MS : Math.max(view.endedAt, view.visibleAt + STAGE_LOAD_MIN_MS);
// The next instant stageLoadDisplay can change, for the component's single timer.
function stageLoadNextChange(view, now) {
    if (!view) return null;
    const marks = [view.visibleAt];
    if (view.endedAt !== null) marks.push(stageLoadUntil(view), stageLoadUntil(view) + STAGE_LOAD_FADE_MS);
    const next = marks.filter(at => at > now).sort((a, b) => a - b)[0];
    return next === undefined ? null : next - now;
}
function createStageLoadProgress({now = () => performance.now()} = {}) {
    const loads = new Map(), views = new Map(), listeners = new Set();
    const emit = sessionId => {
        const load = loads.get(sessionId);
        views.set(sessionId, load ? stageLoadView(load) : null);
        listeners.forEach(listener => listener());
    };
    const current = (sessionId, id) => { const load = loads.get(sessionId); return load && load.id === id ? load : null; };
    function finishIfSettled(load) {
        if (load.endedAt === null && load.planned && [...load.items.values()].every(item => item.status !== 'pending')) load.endedAt = now();
    }
    return {
        // A new request replaces the previous one; while that one is on screen the new one continues it without a gap.
        begin(sessionId, id) {
            const previous = views.get(sessionId), at = now();
            const showing = previous && ['shown', 'error', 'out'].includes(stageLoadDisplay(previous, at));
            loads.set(sessionId, {id, startedAt: at, visibleAt: showing ? at : at + STAGE_LOAD_SHOW_MS, endedAt: null, planned: false, items: new Map()});
            emit(sessionId);
        },
        // The presentation read answered: the media this request still has to prepare. Repeated runs add new items only.
        plan(sessionId, id, candidates, options) {
            const load = current(sessionId, id);
            if (!load) return;
            for (const item of stageLoadPlanItems(candidates, options)) if (!load.items.has(item.key)) load.items.set(item.key, {...item, status: 'pending'});
            load.planned = true; finishIfSettled(load); emit(sessionId);
        },
        // One face finished (or failed); the owner reports it from inside the avatars group.
        resource(sessionId, id, item, error) {
            const entry = current(sessionId, id)?.items.get('avatars:' + stageLoadResourceKey(item));
            if (!entry || error && stageLoadQuiet(error)) return;
            entry.status = error ? 'failed' : 'done';
            finishIfSettled(loads.get(sessionId)); emit(sessionId);
        },
        // A group was accepted (or failed for real / gave up): its items still pending settle with it. A later success
        // after a failure turns the item back to done.
        settle(sessionId, id, group, failed = false) {
            const load = current(sessionId, id);
            if (!load) return;
            let changed = false;
            for (const item of load.items.values()) if (item.group === group && (item.status === 'pending' || !failed && item.status === 'failed')) {
                item.status = failed ? 'failed' : 'done'; changed = true;
            }
            if (changed) { finishIfSettled(load); emit(sessionId); }
        },
        // The request settled, was replaced or cancelled.
        end(sessionId, id) {
            const load = current(sessionId, id);
            if (!load || load.endedAt !== null) return;
            load.endedAt = now(); emit(sessionId);
        },
        get: sessionId => views.get(sessionId) || null,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    };
}

// Text for a view: 「读取场景…」 before the read answers, 「载入立绘 3/5」 while media loads, and the failed items once settled.
function stageLoadFailureText(failed, nameOf) {
    const names = failed.map(item => {
        const name = item.alias && nameOf ? nameOf(item.alias) : '';
        return STAGE_LOAD_LABEL[item.kind] + (name ? '「' + name + '」' : '');
    });
    const unique = [...new Set(names)];
    return (unique.length > 2 ? unique.slice(0, 2).join('、') + ' 等 ' + failed.length + ' 项' : unique.join('、')) + '没能载入';
}
function stageLoadText(view, nameOf) {
    if (view.endedAt !== null && view.failed.length) return stageLoadFailureText(view.failed, nameOf);
    if (view.phase === 'read') return '读取场景…';
    if (!view.kind) return '载入完成';
    return '载入' + view.kindLabel + ' ' + view.kindSettled + '/' + view.kindTotal;
}

// The entry veil's line at a moment: {key, line, detail, fraction}. key changes with the step (the line cross-fades then);
// the count follows the item being worked on; fraction is the weighted share of the work that has really finished.
function stageLoadEntryLine(view, nameOf, fallback) {
    if (!view) return {key: 'wait', line: fallback, detail: '', fraction: 0};
    if (view.phase === 'read') return {key: 'read', line: '正在复原导演分镜', detail: '', fraction: 0};
    const media = STAGE_LOAD_READ_SHARE + (1 - STAGE_LOAD_READ_SHARE - STAGE_LOAD_DRAW_SHARE) * (view.weight ? view.weightSettled / view.weight : 1);
    if (!view.step || view.endedAt !== null) return {key: 'draw', line: '正在点亮舞台', detail: '', fraction: media};
    const base = view.step === 'background' && view.skin ? '正在铺设背景与舞台皮肤' : STAGE_LOAD_STEP_LINES[view.step];
    const count = view.stepTotal > 1 ? '（' + Math.min(view.stepSettled + 1, view.stepTotal) + '/' + view.stepTotal + '）' : '';
    const name = view.stepItem?.alias && nameOf ? nameOf(view.stepItem.alias) : '';
    return {key: view.step, line: base + count, detail: name ? name + (view.stepItem.outfit ? ' · ' + view.stepItem.outfit : '') : '', fraction: media};
}
// Store notifications reach the stage at most every STAGE_LOAD_THROTTLE_MS (the last one always arrives): a load with dozens
// of faces re-renders the stage a few times a second, not once per file.
function stageLoadThrottle(subscribe, listener, clock = globalThis, now = () => performance.now()) {
    let timer = null, last = -Infinity;
    const fire = () => { timer = null; last = now(); listener(); };
    const stop = subscribe(() => {
        if (timer !== null) return;
        const wait = STAGE_LOAD_THROTTLE_MS - (now() - last);
        if (wait <= 0) fire(); else timer = clock.setTimeout(fire, wait);
    });
    return () => { stop(); if (timer !== null) clock.clearTimeout(timer); };
}

const stageLoadProgress = createStageLoadProgress();
function useStageLoadProgress(sessionId, store = stageLoadProgress) {
    const subscribe = React.useCallback(listener => stageLoadThrottle(store.subscribe, listener), [store]);
    const view = React.useSyncExternalStore(subscribe, () => sessionId ? store.get(sessionId) : null);
    const [, tick] = React.useState(0);
    const now = performance.now(), display = stageLoadDisplay(view, now), wait = stageLoadNextChange(view, now);
    React.useEffect(function () {
        if (wait === null) return undefined;
        const timer = setTimeout(() => tick(value => value + 1), wait + 1);
        return () => clearTimeout(timer);
    }, [view, display, wait]);
    return {view, display};
}
// The stage's bar: on the text box's top edge, right end (theme.css "stage load progress"). Not interactive.
function StageLoadProgress({progress, nameOf}) {
    const h = React.createElement, {view, display} = progress;
    if (!view || display === 'hidden' || display === 'pending') return null;
    const error = view.endedAt !== null && view.failed.length > 0, text = stageLoadText(view, nameOf);
    return h('div', {className: 'fork-gal-load-progress', 'data-state': display, 'data-error': error || undefined,
        'data-indeterminate': view.phase === 'read' || undefined, role: error ? 'alert' : 'status'},
        h('span', {className: 'fork-gal-load-label'}, error ? h('span', {className: 'fork-gal-load-warn', 'aria-hidden': true}, '⚠') : null, text),
        error ? null : h(StageLoadTrack, {view, text}));
}
function StageLoadTrack({view, text}) {
    const h = React.createElement, determinate = view.phase === 'media';
    return h('span', {className: 'fork-gal-load-track', role: 'progressbar', 'aria-label': '载入进度', 'aria-valuemin': 0,
        'aria-valuemax': determinate ? view.total : undefined, 'aria-valuenow': determinate ? view.settled : undefined, 'aria-valuetext': text},
        h('i', {style: determinate ? {width: (view.total ? 100 * view.settled / view.total : 100).toFixed(1) + '%'} : undefined}));
}
// The entry overlay: the step really running (stageLoadEntryLine), the item it works on, and one bar of the weighted
// progress that never moves back while the veil is up (a later request of the same entry adds work; the bar waits for it
// to catch up). The line cross-fades when the step changes (theme.css; instant under 「减少动态」); `revealed`: the
// first frame is drawn, the bar completes as the veil fades.
function StageLoadLine({progress, fallback, nameOf, revealed}) {
    const h = React.createElement, next = stageLoadEntryLine(progress.view, nameOf, fallback);
    const [now, setNow] = React.useState(next), changedAt = React.useRef(performance.now());
    // Parent renders can read the latest store snapshot between throttled notifications.
    // Hold the displayed text too, including a retry that goes from draw back to read.
    React.useLayoutEffect(function () {
        if (now.key === next.key && now.line === next.line && now.detail === next.detail) return undefined;
        const commit = () => { changedAt.current = performance.now(); setNow(next); };
        const wait = STAGE_LOAD_THROTTLE_MS - (performance.now() - changedAt.current);
        if (wait <= 0) { commit(); return undefined; }
        const timer = setTimeout(commit, wait);
        return () => clearTimeout(timer);
    }, [next.key, next.line, next.detail, now]);
    const reached = React.useRef(0), shown = React.useRef(now), [leaving, setLeaving] = React.useState(null);
    reached.current = Math.max(reached.current, revealed ? 1 : next.fraction);
    // The step that just ended stays for its fade-out, under the new one.
    React.useLayoutEffect(function () {
        if (shown.current.key !== now.key) setLeaving(shown.current);
        shown.current = now;
    });
    React.useEffect(function () {
        if (!leaving) return undefined;
        const timer = setTimeout(() => setLeaving(null), 320);
        return () => clearTimeout(timer);
    }, [leaving]);
    const percent = Math.round(reached.current * 100);
    // data-generic: no real step yet - the line is only the overlay's 「正在载入…」 (a skin loader that says it hides it).
    return h('span', {className: 'fork-gal-entry-progress', 'data-generic': now.key === 'wait' ? '' : undefined},
        h('span', {className: 'fork-gal-entry-step', role: 'status'},
            leaving && leaving.key !== now.key ? h('span', {key: 'out:' + leaving.key, className: 'is-out', 'aria-hidden': true}, leaving.line) : null,
            h('span', {key: 'in:' + now.key, className: 'is-in'}, now.line)),
        h('span', {className: 'fork-gal-entry-detail'}, now.detail || '\u00a0'),
        h('span', {className: 'fork-gal-load-track', role: 'progressbar', 'aria-label': '载入进度', 'aria-valuemin': 0, 'aria-valuemax': 100,
            'aria-valuenow': percent, 'aria-valuetext': now.line + ' ' + percent + '%'}, h('i', {style: {width: (reached.current * 100).toFixed(1) + '%'}})));
}

// Panels: an honest indeterminate wait drawn as the page it becomes (the corner spinner +「正在载入… 5 秒」
// was 「太丑了」). Placeholder rows / fields / tiles in the real list's geometry with a soft wave (theme.css「panel
// skeleton」), fading in after SPINNER_DELAY_MS like the spinner (a fast load never flashes). The elapsed seconds
// (a long wait says so) stay: after PANEL_ELAPSED_MS one quiet line 「正在载入… N 秒」 centred under
// the placeholders. props: { shape: 'rows' | 'fields' | 'tiles' | 'line', count, lead, label, className }.
//   rows   - list rows (素材包, 条目, 模组, 预设): name · meta · state pill; `lead` adds the row's picture square.
//   fields - settings rows: a short name and a longer value.
//   tiles  - a picture grid (立绘 / 背景 strips, the setup wizard's library).
//   line   - one value placeholder inside a row (InlineRow); no hint.
const PANEL_ELAPSED_MS = 2000;
const PANEL_SHAPES = {rows: 6, fields: 5, tiles: 8, line: 1};
// Fixed, uneven widths (percent of the row) so the placeholders read as names of different lengths, never as a bar chart.
const PANEL_WIDTHS = [46, 64, 38, 56, 72, 42, 60, 34];
function panelElapsedText(ms) { return ms < PANEL_ELAPSED_MS ? '' : Math.floor(ms / 1000) + ' 秒'; }
function panelSkeletonItem(h, shape, index, lead) {
    const share = PANEL_WIDTHS[index % PANEL_WIDTHS.length], style = {'--fork-skel-n': index, '--fork-skel-w': share + '%', '--fork-skel-k': share / 100};
    if (shape === 'tiles') return h('span', {key: index, className: 'fork-skel-item', style}, h('i', {className: 'fork-skel-tile'}), h('i', {className: 'fork-skel-caption'}));
    if (shape === 'fields') return h('span', {key: index, className: 'fork-skel-item', style}, h('i', {className: 'fork-skel-label'}), h('i', {className: 'fork-skel-value'}));
    return h('span', {key: index, className: 'fork-skel-item', style}, lead ? h('i', {className: 'fork-skel-lead'}) : null,
        h('i', {className: 'fork-skel-name'}), h('i', {className: 'fork-skel-meta'}), h('i', {className: 'fork-skel-pill'}));
}
function PanelLoading(props) {
    const h = React.createElement, p = props || {};
    const shape = Object.hasOwn(PANEL_SHAPES, p.shape) ? p.shape : 'rows', label = p.label || '正在载入…';
    const started = React.useRef(null);
    if (started.current === null) started.current = Date.now();
    const [elapsed, setElapsed] = React.useState(0);
    React.useEffect(function () {
        if (shape === 'line') return undefined;
        const timer = setInterval(() => setElapsed(Date.now() - started.current), 1000);
        return () => clearInterval(timer);
    }, [shape]);
    const className = (p.className ? p.className + ' ' : '') + 'ap-loading fork-panel-loading';
    if (shape === 'line') return h('span', {className, 'data-shape': shape, role: 'status', 'aria-label': label, 'aria-busy': true},
        h('span', {className: 'fork-skel', 'aria-hidden': true}, h('span', {className: 'fork-skel-item', style: {'--fork-skel-n': 0}}, h('i', {className: 'fork-skel-value'}))));
    const count = Number.isInteger(p.count) && p.count > 0 ? p.count : PANEL_SHAPES[shape], items = [];
    for (let i = 0; i < count; i++) items.push(panelSkeletonItem(h, shape, i, !!p.lead));
    const seconds = panelElapsedText(elapsed);
    // The status names the wait once; the ticking seconds are visual only (a screen reader is not told every second).
    return h('div', {className, 'data-shape': shape, role: 'status', 'aria-label': label, 'aria-busy': true},
        h('div', {className: 'fork-skel', 'aria-hidden': true}, items),
        seconds ? h('p', {className: 'fork-panel-loading-hint', 'aria-hidden': true}, label, ' ', h('span', {className: 'fork-panel-loading-elapsed'}, seconds)) : null);
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageLoadProgress, stageLoadPlanItems, stageLoadDisplay, stageLoadEntryLine, stageLoadThrottle, STAGE_LOAD_THROTTLE_MS,
    stageLoadNextChange, stageLoadText, stageLoadFailureText, panelElapsedText, STAGE_LOAD_SHOW_MS, STAGE_LOAD_ERROR_MS, STAGE_LOAD_FADE_MS, STAGE_LOAD_MIN_MS};

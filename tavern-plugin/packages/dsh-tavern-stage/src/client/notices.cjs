'use strict';
function createStageNotices({React, document, foreground, displayPreferences, getSelection, StageWaitStop, Spinner, Icon, providerRefusal:tavernProviderRefusalNotice, errorText:stageRuntimeErrorText, diagnosticText:stageDiagnosticText, shortcuts:galShortcuts}) {
let disposed = false;
const notifiedSessions = new Set(), pendingNotices = new Set();
function useCapabilityNotice(sessionId, live, rows) {
    const [notice, setNotice] = React.useState(null);
    React.useEffect(() => {
        if (disposed || !live || notifiedSessions.has(sessionId)) return;
        const missing = rows?.find(row => row.message);
        if (!missing) return;
        notifiedSessions.add(sessionId);
        setNotice({sessionId, message:missing.message});
    }, [sessionId, live, rows]);
    React.useEffect(() => {
        if (disposed || !notice || notice.sessionId !== sessionId) return;
        let active = true;
        const timer = foreground.setTimeout(() => {
            if (!disposed && active) setNotice(current => current === notice ? null : current);
            pendingNotices.delete(stop);
        }, 6000);
        const stop = () => { active = false; foreground.clearTimeout(timer); pendingNotices.delete(stop); };
        pendingNotices.add(stop);
        return stop;
    }, [sessionId, notice]);
    return live && notice?.sessionId === sessionId ? notice.message : null;
}
function useAlive() {
    const ref = React.useRef(null);
    React.useEffect(() => { const token = {}; ref.current = token; return () => { if (ref.current === token) ref.current = null; }; }, []);
    return () => { const token = ref.current; return () => !disposed && !!token && ref.current === token; };
}
// localized, theme-matching runtime notices. Display only;
// they stack under the top-right controls, clear of the place/music HUD; Chinese failure details list right under the title. No reassurance
// subtitles (panel-ui-design.md §一.5): a short title is the whole notice.
// Scene diagnostics are internal: only the 调试视图 (body.dsh-fork-debug) shows them.
const GAL_DIAGNOSTIC_TEXT = { 'legacy-media-reconstructed': '旧存档未记录素材版本，已按当前素材重建' };
const GAL_DEBUG_HOWTO = '打开「设置 › DSH Tavern › 调试视图」，这里会显示具体原因。';
// with the shared display preference in scope (features/settings.js) the line is
// one action instead — 「打开调试视图」 turns the same switch on, and the technical line shows in place.
const GAL_DEBUG_PREFS = () => typeof displayPreferences === 'object' && displayPreferences && typeof displayPreferences.save === 'function' ? displayPreferences : null;
// The shared display preference snapshot (settings.js displayPreferences): null until read, then { hideContextAndReasoning, … }.
const galDebugHidden = snapshot => snapshot ? snapshot.hideContextAndReasoning : null;
// every display fallback of a missing 差分 image in this
// session (packSpriteFallbacks rows), once per figure · outfit · 差分, in the order they first happened. Rows are kept
// across pages until the session changes; nothing is written anywhere.
function useGalSpriteFallbacks(sessionId, rows) {
    const seen = React.useRef(null);
    if (!seen.current || seen.current.sessionId !== sessionId) seen.current = { sessionId, rows: new Map(), list: [] };
    const current = seen.current;
    let added = false;
    for (const row of rows) if (!current.rows.has(row.key)) { current.rows.set(row.key, row); added = true; }
    if (added) current.list = [...current.rows.values()];
    return current.list;
}
// 「大肥鱼 · 女仆装 · 平和 → 喜悦」: figure · outfit · requested 差分 → what the stage showed instead.
function galSpriteFallbackLine(row, nameOf) {
    const shown = row.shown === '@avatar' ? '头像（小图）' : row.shown ? row.shownLabel || row.shown : '没有可显示的图';
    return [row.figure || (nameOf && nameOf(row.alias)) || row.alias, row.outfit, row.requestedLabel || row.requested].filter(Boolean).join(' · ') + ' → ' + shown;
}
function galSpriteFallbackTitle(rows) {
    return rows.every(row => row.shown === 'calm') ? '差分缺图，已临时显示平和' : '差分缺图，已临时替代显示';
}

// a notice row's raw technical text (code: message) sits right under its
// reason in the same list — secondary mono ink, selectable. Longer than three lines it is clamped and a click (not a text
// selection) or Enter / Space unfolds it in place.
function GalRawText({ text }) {
    const h = React.createElement, ref = React.useRef(null);
    const [open, setOpen] = React.useState(false), [long, setLong] = React.useState(false);
    React.useLayoutEffect(function () {
        const el = ref.current;
        if (el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
    }, [text, open]);
    const toggle = () => setOpen(value => !value);
    const expandable = long || open;
    return h('code', { ref, className: 'fork-gal-runtime-raw', 'data-clamped': open ? undefined : '',
        ...(expandable ? { role: 'button', tabIndex: 0, 'aria-expanded': open,
            onClick: () => { const selection = typeof getSelection === 'function' ? getSelection() : null; if (!selection || selection.isCollapsed) toggle(); },
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); toggle(); } } } : {}) }, text);
}
// With the shared preference the raw text follows the 调试视图 switch (re-rendered when it changes, here or in 设置).
function GalRawLine({ text }) {
    const prefs = GAL_DEBUG_PREFS();
    const hidden = galDebugHidden(React.useSyncExternalStore(prefs.subscribe, prefs.snapshot, prefs.snapshot));
    return hidden === false ? React.createElement(GalRawText, { text }) : null;
}
// The list's last row while the 调试视图 is off: one action 「打开调试视图」, and the raw text shows under each reason.
function GalDebugLine() {
    const h = React.createElement, prefs = GAL_DEBUG_PREFS();
    const hidden = galDebugHidden(React.useSyncExternalStore(prefs.subscribe, prefs.snapshot, prefs.snapshot));
    const [opening, setOpening] = React.useState(false), [failed, setFailed] = React.useState(false);
    const alive = useAlive();
    if (hidden === false) return null;
    async function open() {
        const live = alive();
        if (opening || !live()) return;
        setOpening(true); setFailed(false);
        try { await prefs.save({ hideContextAndReasoning: false }); } catch (_) { if (live()) setFailed(true); } finally { if (live()) setOpening(false); }
    }
    return h('li', { className: 'fork-gal-runtime-howto' }, failed ? '⚠ 没能打开调试视图 ' : null,
        h('button', { type: 'button', className: 'fork-gal-runtime-open-debug', disabled: opening, onClick: open }, opening ? '正在打开…' : '打开调试视图'));
}

// a notice with rows starts folded to its header chip; the
// open / folded choice per notice is kept for the current session view only (module memory, reset when the session changes).
const galNoticeFolds = { scope: undefined, open: new Map() };
function galNoticeOpen(scope) {
    if (galNoticeFolds.scope !== scope) { galNoticeFolds.scope = scope; galNoticeFolds.open = new Map(); }
    return galNoticeFolds.open;
}
// the failure notice's one action, the host's replay of the failed turn (the
// chat error row's 重新生成本轮). It lives in the title line; a click never folds the notice or turns the page.
function GalRetryBody({ onRetry }) {
    const [busy, setBusy] = React.useState(false);
    const alive = useAlive();
    async function retry(event) {
        event.preventDefault(); event.stopPropagation();
        const live = alive();
        if (busy || !live()) return;
        setBusy(true);
        try { await onRetry(); } finally { if (live()) setBusy(false); }
    }
    return React.createElement('button', { type: 'button', className: 'fork-gal-runtime-action', 'data-action': 'retry-body', disabled: busy, 'aria-busy': busy || undefined, onClick: retry }, busy ? '正在重新生成…' : '重新生成');
}
// 「画面载入失败」 says what failed in plain words. A picture failure is not fixed by
// regenerating the story, so the notice never hints at 重新生成 (AGENTS 「玩家界面不显示…「重新生成」提示」); its one action is
// 重新载入, which retries the failed models (or starts the renderer again). The raw error is the 调试视图's only.
function galSceneFailureText(error) {
    const text = String(error || '');
    const network = /Failed to fetch|Network error|Load failed|NetworkError|ERR_|资源读取失败|网络/i.test(text);
    const what = /^(Spine )?模型加载失败/.test(text) ? '人物模型没能载入'
        : /Live2D|Cubism|live2d/.test(text) ? 'Live2D 运行组件没能载入'
        : /pixi|WebGL|renderer|canvas/i.test(text) ? '画面渲染组件没能载入'
        : network ? '画面资源没能载入' : '部分画面没能载入';
    return network ? what + '：网络连接失败' : what;
}
function GalSceneReload({ onReload }) {
    const click = event => { event.preventDefault(); event.stopPropagation(); onReload(); };
    return React.createElement('button', { type: 'button', className: 'fork-gal-runtime-action', 'data-action': 'reload-scene', onClick: click }, '重新载入');
}

// page = this page's beats are not accepted yet (「正在生成演出…」, a spinner and
// no progress bar);
// round = the round's phase, 'body' | 'staging' | null (「正在生成正文…」 / 「正在生成后续演出…」, the round's 停止 when onStop is given).
// The stop's label is the phrase without the ellipsis, like the text box's 「正在生成选项」.
const GAL_ROUND_TEXT = { body: '正在生成正文', staging: '正在生成后续演出' };
function GalRuntimeStatus({ interopNotice, page = false, round = null, onStop, stopping, hints, danmaku, error, bodyFailure = false, onRetry = null, diagnostics, sceneError, onReloadScene = null, cgNotice, spriteFallbacks = [], nameOf, scope }) {
    const h = React.createElement;
    const notes = diagnostics || [], cancelled = error === 'cancelled';
    const icon = h('svg', { className: 'fork-gal-runtime-icon', width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M12 4.5 20.5 19h-17L12 4.5zM12 10v4.2M12 16.8v.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    // one flat notice — the title line, then directly one list (a single
    // opaque panel), each row 「第 N 段 · reason」 with its raw technical line (code: message) attached under it. The title is
    // the only fold (native details, folded by default, galNoticeOpen). Raw text renders only while the 调试视图 is on (body.dsh-fork-debug,
    // read each render, or the shared preference); otherwise the list ends with 「打开调试视图」. rows: [{ at, text, raw,
    // always }] — always: the whole notice is debug-only already (scene diagnostics). Raw validator prose never reaches
    // the player's DOM.
    const debugView = typeof document !== 'undefined' && !!document.body && document.body.classList.contains('dsh-fork-debug');
    const prefs = GAL_DEBUG_PREFS();
    const debugOn = prefs ? galDebugHidden(prefs.snapshot()) === false : debugView;
    const rawOf = row => !row.raw ? null : row.always || (!prefs && debugView) ? h(GalRawText, { text: row.raw }) : prefs ? h(GalRawLine, { text: row.raw }) : null;
    const opened = galNoticeOpen(scope);
    const keys = event => { if ([' ', 'Enter'].includes(event.key) && event.target.closest?.('summary, button')) event.stopPropagation(); };
    // action: one control after the title (「⚠ 正文生成失败 · 重新生成」, ui-design §三.18).
    const notice = (key, tone, mark, title, rows, action, after = null) => {
        rows = (rows || []).filter(row => row && row.text);
        const hiddenRaw = rows.some(row => row.raw && !row.always);
        return h('div', { key, className: 'fork-gal-runtime-status', 'data-tone': tone, role: 'status', onKeyDown: rows.length || action ? keys : undefined }, mark,
            h('div', { className: 'fork-gal-runtime-text' }, !rows.length ? action ? h('div', { className: 'fork-gal-runtime-head' }, h('strong', null, title), ' · ', action) : h(React.Fragment, null, title ? h('strong', null, title) : null, after) : h('details', { open: opened.get(key) === true, onToggle: event => opened.set(key, event.currentTarget.open) },
                h('summary', null, h('strong', null, title), action ? ' · ' : null, action, rows.length > 1 ? h('span', { className: 'fork-gal-runtime-count' }, rows.length) : null),
                h('ul', { className: 'fork-gal-runtime-rows' }, rows.map((row, index) => h('li', { key: index, 'data-at': row.at ? '' : undefined },
                    row.at ? h('span', { className: 'fork-gal-runtime-at' }, '第 ' + row.at + ' 段') : null, h('span', { className: 'fork-gal-runtime-reason' }, row.text), rawOf(row))),
                    hiddenRaw ? prefs ? h(GalDebugLine, { key: 'debug' }) : debugView ? null : h('li', { key: 'debug', className: 'fork-gal-runtime-howto' }, GAL_DEBUG_HOWTO) : null))));
    };
    // The round line: one quiet line under the page layer (or alone, page staged); while the round works it is the stage's
    // 停止 (gal-stage.js stopReply), the same StageWaitStop as the text box's wait.
    const roundText = GAL_ROUND_TEXT[round] || null;
    const roundLine = roundText ? h('span', { className: 'fork-gal-runtime-round', 'data-round': round },
        onStop ? h(StageWaitStop, { className: 'is-plain', label: roundText, busy: stopping, onStop }, roundText + '…') : roundText + '…') : null;
    const providerRefusal = bodyFailure && error && tavernProviderRefusalNotice(stageRuntimeErrorText(error));
    const errorTitle = providerRefusal ? '正文模型被服务商内容审核拒绝' : cancelled ? '正文生成已停止' : '正文生成失败';
    // The player sees the title and its action; a provider refusal adds its one plain line. The technical text is the
    // 调试视图's only (AGENTS 「玩家界面不显示错误码、开发文案」).
    const failureRaw = bodyFailure && error && !cancelled ? stageDiagnosticText(stageRuntimeErrorText(error), true) : '';
    const failureRows = providerRefusal ? [{ text: providerRefusal, raw: debugOn ? failureRaw : '', always: true }] : debugOn ? [{ text: failureRaw }] : [];
    const direction = bodyFailure && error ? notice('direction', 'error', icon, errorTitle, cancelled ? [] : failureRows, cancelled || !onRetry ? null : h(GalRetryBody, { onRetry }))
        : page ? notice('direction', 'busy', h(Spinner, { className: 'fork-gal-runtime-spinner' }), '正在生成演出…', null, null, roundLine)
        : roundLine ? notice('direction', 'round', h(Spinner, { className: 'fork-gal-runtime-spinner' }), null, null, null, roundLine) : null;
    // first-run hints ride the same stack (no modal): 「点任意处开启声音」 while the
    // browser holds the BGM back, and the stage's real shortcuts once (useGalFirstRunHints).
    return h('div', { className: 'fork-gal-notices', onWheel: event => event.stopPropagation(), onClick: event => event.stopPropagation() },
        hints?.sound ? notice('sound', 'hint', h('span', { className: 'fork-gal-runtime-icon', 'aria-hidden': true }, h(Icon, { name: 'speaker', size: 15 })), '点任意处开启声音') : null,
        hints?.keys ? h('div', { key: 'keys', className: 'fork-gal-runtime-status fork-gal-runtime-keys', 'data-tone': 'hint', role: 'note', 'aria-label': '快捷键' },
            h('dl', null, galShortcuts(danmaku).map(([label, key]) => h(React.Fragment, { key: label }, h('dt', null, h('kbd', null, key)), h('dd', null, label))))) : null,
        direction,
        interopNotice ? notice('interop', 'hint', null, interopNotice) : null,
        null,
        notes.length ? notice('diagnostics', 'debug', icon, '场景诊断', notes.map(note => ({
            text: GAL_DIAGNOSTIC_TEXT[typeof note === 'string' ? note.split(':')[0] : note?.code] || stageDiagnosticText(note), raw: stageDiagnosticText(note, true), always: true }))) : null,
        spriteFallbacks.length ? notice('sprite-fallback', 'error', icon, galSpriteFallbackTitle(spriteFallbacks),
            spriteFallbacks.map(row => ({ text: galSpriteFallbackLine(row, nameOf) }))) : null,
        cgNotice ? notice('cg-gallery', 'error', icon, cgNotice) : null,
        sceneError ? notice('scene', 'error', icon, '画面载入失败', [{ text: galSceneFailureText(sceneError), raw: String(sceneError) }],
            onReloadScene ? h(GalSceneReload, { onReload: onReloadScene }) : null) : null);
}

return {useCapabilityNotice, Status:GalRuntimeStatus, Retry:GalRetryBody, useSpriteFallbacks:useGalSpriteFallbacks, dispose() {
    if (disposed) return;
    disposed = true; galNoticeFolds.open.clear(); notifiedSessions.clear();
    const errors = [];
    for (const stop of [...pendingNotices]) { try {stop();} catch (error) {errors.push(error);} }
    pendingNotices.clear();
    if (errors.length) throw new AggregateError(errors, "Stage notice cleanup failed");
}};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageNotices};

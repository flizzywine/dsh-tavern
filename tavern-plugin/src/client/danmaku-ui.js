// the stage side of the mod's settings. Where each
// setting lives:
//  - DanmakuToggle — the stage top-right quick entry: the danmaku switch icon (bilibili style: a screen with comment
//    lines, accent while on, struck with a ⊘ badge while off) whose menu picks 飘屏 / 直播风格 / 关闭; D toggles 关闭
//    and back. Only the highest-frequency control.
//  - DanmakuStageConfig — a section for the stage CONFIG screen (Esc › 设置): the per-session 飘屏 appearance
//    (显示区域 / 不透明度 / 字号). Mounted through the stage-config hook requested in P6-REQUESTS.md F6.
// Both write the mod's global settings (saveModSettings, CAS on the mod revision). (skin mod options, lead
// 2026-10-23, R21): 显示密度 and 弹幕来源 are user options with one home, 舞台设置 › 模组 › 弹幕 (two layers,
// danmaku-pages.js). The renderers (danmaku-stage.cjs) follow the DanmakuView the mod sends back. Styled only
// through the stage UI tokens (theme.css danmaku section).

const DANMAKU_MOD = 'dsh.danmaku';
function danmakuViewOptions(manifest){return stageViews.danmakuSettings.options(manifest);}
function danmakuShortcut(event,state){return stageViews.danmakuSettings.shortcut(event,state);}
function danmakuStageFields(manifest){return stageViews.danmakuSettings.fields(manifest);}
function danmakuSave(...args){return stageViews.danmakuSettings.save(...args);}
// The mod's global settings as the stage needs them: enabled (global scope), values, manifest, view choices, set(patch).
function useDanmakuMod(rpc) {
    const [state, setState] = React.useState({ loading: true, enabled: false, authorized: false, values: {}, manifest: null, options: [], error: '' });
    const confirm = useTavernConfirm(DANMAKU_MOD);
    const life = React.useRef(0), last = React.useRef('overlay'), pending = React.useRef(0), queue = React.useRef(Promise.resolve()), sequence = React.useRef(0);
    const read = React.useCallback(async () => {
        const own = life.current;
        if (pending.current) return;
        try {
            const data = await rpc('getMod', { modId: DANMAKU_MOD });
            if (own !== life.current || pending.current) return;
            const values = data?.settings?.values || {};
            window.dispatchEvent(new CustomEvent('dsh-tavern-mod-presentation', { detail: { modId: DANMAKU_MOD, values: Object.fromEntries((data?.manifest?.settingsSchema.fields || []).filter(field => field.presentation).map(field => [field.key, values[field.key]])) } }));
            if (values.view && values.view !== 'off') last.current = values.view;
            setState({ loading: false, enabled: data?.scope === 'global', authorized: data?.authorized === true, values, manifest: data?.manifest || null, options: danmakuViewOptions(data?.manifest), error: '' });
        } catch (_) { if (own === life.current) setState(s => ({ ...s, loading: false, enabled: false })); } // not installed / unavailable: nothing
    }, [rpc]);
    React.useEffect(() => {
        life.current++; read();
        const refresh = () => read();
        window.addEventListener('dsh-tavern-mods-changed', refresh);
        return () => { life.current++; window.removeEventListener('dsh-tavern-mods-changed', refresh); };
    }, [read]);
    async function set(patch, failure) {
        if (Object.entries(patch).every(([k, v]) => state.values[k] === v) && (state.authorized || !patch.view || patch.view === 'off')) return;
        if (patch.view && patch.view !== 'off') last.current = patch.view;
        const display = Object.keys(patch).every(key => state.manifest?.settingsSchema.fields.find(field => field.key === key)?.presentation);
        const preview = values => window.dispatchEvent(new CustomEvent('dsh-tavern-mod-presentation', { detail: { modId: DANMAKU_MOD, values } }));
        if (state.authorized || patch.view === 'off') {
            if (display) preview(patch);
            setState(s => ({ ...s, values: { ...s.values, ...patch }, error: '' }));
        }
        const own = ++sequence.current;
        pending.current++;
        const task = queue.current.catch(() => {}).then(() => danmakuSave(rpc, patch, display, confirm));
        queue.current = task;
        try { await task; }
        catch (_) {
            if (own === sequence.current) {
                if (display) preview(Object.fromEntries(Object.keys(patch).map(key => [key, state.values[key]])));
                setState(s => ({ ...s, error: failure || '没能保存弹幕设置' }));
            }
        } finally { if (--pending.current === 0) read(); }
    }
    return { ...state, view: state.authorized ? state.values.view || 'overlay' : 'off', last: last.current, set };
}

// The switch glyph: a screen with three comment lines; while off a ⊘ badge cuts into its corner (masked, so it reads on
// any scene without a plate).
function DanmakuIcon({ off }) {
    const h = React.createElement, id = 'fork-dm-cut-' + (React.useId ? React.useId().replace(/[^a-zA-Z0-9_-]/g, '') : 'x');
    const body = h('g', off ? { mask: 'url(#' + id + ')' } : null,
        h('path', { d: 'M5.5 4.5h13A2.5 2.5 0 0 1 21 7v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V7a2.5 2.5 0 0 1 2.5-2.5z' }),
        h('path', { d: 'M6.8 8.6h5.4M14.6 8.6h2.8M9.2 11.8h8M6.8 15h4.2' }));
    return h('svg', { className: 'fork-gal-danmaku-icon', width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
        off ? h('mask', { id }, h('rect', { x: 0, y: 0, width: 24, height: 24, fill: 'white', stroke: 'none' }), h('circle', { cx: 18.6, cy: 17.6, r: 5.6, fill: 'black', stroke: 'none' })) : null,
        body,
        off ? h('g', { className: 'fork-gal-danmaku-cut' }, h('circle', { cx: 18.6, cy: 17.6, r: 3.6 }), h('path', { d: 'M16.1 20.1l5-5' })) : null);
}

// props: { rpc }. Nothing when the mod is off or not installed.
function DanmakuToggle({ rpc }) {
    const h = React.createElement;
    const dm = useDanmakuMod(rpc);
    const [open, setOpen] = React.useState(false);
    const button = React.useRef(null), panel = React.useRef(null);
    const sfx = name => { if (typeof forkUiSfx === 'object' && forkUiSfx) forkUiSfx.play(name); };
    const choose = view => dm.set({ view }, '没能切换弹幕视图');
    React.useEffect(() => {
        if (!open) return undefined;
        (panel.current?.querySelector('[aria-checked="true"]') || panel.current?.querySelector('button'))?.focus({ preventScroll: true });
        function close(refocus) { sfx('close'); setOpen(false); if (refocus) button.current?.focus(); }
        // Esc closes the menu before the stage sees it (the stage would open its system menu on Esc).
        function onKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } }
        let timer = 0;
        function swallow(event) { event.stopPropagation(); event.preventDefault(); }
        function outside(event) {
            if (panel.current?.contains(event.target) || button.current?.contains(event.target)) return;
            close(false);
            // A click on the bare stage only dismisses; it does not also turn the page.
            if (!event.target?.closest?.('button, input, select, textarea, a')) {
                document.addEventListener('click', swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener('click', swallow, true), 600);
            }
        }
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', outside, true);
        return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', outside, true); clearTimeout(timer); };
    }, [open]);
    React.useEffect(() => {
        if (!dm.enabled) return undefined;
        function onKey(event) { const next = danmakuShortcut(event, { current: dm.view, last: dm.last, options: dm.options }); if (next) { event.preventDefault(); choose(next); } }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dm.enabled, dm.view, dm.last, dm.options]);
    // the entry's state for the skin's menu; nothing usable = nowhere (rule 15).
    if (typeof useStageEntryState === 'function') useStageEntryState('mod:' + DANMAKU_MOD, { available: Boolean(dm.enabled && dm.options.length), on: dm.view !== 'off',
        detail: dm.error ? '⚠ ' + dm.error : stageViews.danmakuSettings.viewNames[dm.view] || '' });
    if (!dm.enabled || !dm.options.length) return null;
    const off = dm.view === 'off';
    const label = '弹幕：' + (!dm.authorized ? '需要授权' : stageViews.danmakuSettings.viewNames[dm.view] || stageViews.danmakuSettings.viewNames.overlay) + (dm.error ? '（' + dm.error + '）' : '');
    const stop = event => event.stopPropagation();
    const keys = event => {
        event.stopPropagation();
        const items = [...panel.current.querySelectorAll('[role="menuitemradio"]')], i = items.indexOf(document.activeElement), n = items.length;
        const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key];
        if (next !== undefined && n) { event.preventDefault(); items[(next + n) % n].focus(); }
        if (event.key === 'Tab') setOpen(false);
    };
    return h('div', { className: 'fork-gal-danmaku-anchor', onClick: stop, onWheel: stop, onContextMenu: stop },
        h('button', { ref: button, type: 'button', className: 'fork-gal-danmaku', 'data-view': dm.view, 'data-warn': dm.error ? true : undefined, 'aria-haspopup': 'menu', 'aria-expanded': open,
            title: label, 'aria-label': label,
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') event.stopPropagation(); if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } },
            onClick: () => { sfx(open ? 'close' : 'open'); setOpen(!open); } }, h(DanmakuIcon, { off })),
        open ? h('div', { ref: panel, className: 'fork-gal-danmaku-menu', role: 'menu', 'aria-label': '弹幕', onKeyDown: keys },
            dm.options.map(o => h('button', { key: o.value, type: 'button', role: 'menuitemradio', 'aria-checked': o.value === dm.view, className: 'fork-gal-danmaku-item' + (o.value === 'off' ? ' is-off' : ''),
                onClick: () => { sfx('confirm'); setOpen(false); button.current?.focus(); choose(o.value); } },
                h('span', null, o.label), o.value === 'off' ? h('kbd', { 'aria-hidden': true }, 'D') : null))) : null);
}

// props: { rpc, sessionId, compact }. The stage CONFIG section (gal-config.js building blocks; include after it): the 飘屏
// appearance. Sliders preview while dragging and save on release; nothing when the mod is off or declares none of these fields.
function DanmakuStageConfig({ rpc }) {
    const h = React.createElement, dm = useDanmakuMod(rpc), [draft, setDraft] = React.useState({});
    const rows = danmakuStageFields(dm.manifest);
    if (!dm.enabled || !rows.length) return null;
    const value = (key, field) => draft[key] ?? dm.values[key] ?? field.default;
    const slider = (key, field, ends, label) => {
        const v = Number(value(key, field)), text = n => Math.round(n) + '%';
        return galConfigSlider(ends, { min: field.min ?? 10, max: field.max ?? 100, step: field.step || 5, value: v, label, valueText: text(v), output: text(v),
            onChange: n => setDraft(d => ({ ...d, [key]: n })), onCommit: n => { setDraft(d => { const { [key]: _, ...rest } = d; return rest; }); dm.set({ [key]: n }); } });
    };
    const row = ({ key, field }) => {
        if (key === 'area') return galConfigRow('飘屏区域', galConfigSegmented({ label: '飘屏区域', value: value(key, field),
            options: (field.choices || []).filter(c => stageViews.danmakuSettings.areaNames[c.value]).map(c => [c.value, stageViews.danmakuSettings.areaNames[c.value]]), onChange: v => dm.set({ area: v }) }),
            '飘屏的滚动和顶部弹幕只用画面上方这一部分；底部弹幕照常贴在文本框上沿。');
        if (key === 'opacity') return galConfigRow('飘屏不透明度', slider(key, field, ['淡', '浓'], '飘屏不透明度'));
        return galConfigRow('飘屏字号', slider(key, field, ['小', '大'], '飘屏字号'));
    };
    const error = dm.error ? h('span', { key: 'error', className: 'fork-gal-config-caption-alert', role: 'alert' }, '⚠ ' + dm.error) : null;
    return galConfigGroup(['弹幕', error], null, ...rows.map(r => h(React.Fragment, { key: r.key }, row(r))));
}
// The stage CONFIG tab entry for the host's STAGE_CONFIG_SECTIONS (P6-REQUESTS.md F6): one name to reference.
const DANMAKU_STAGE_CONFIG = Object.freeze({ label: '弹幕', en: 'DANMAKU', Component: DanmakuStageConfig });
// First-party static registration in the host's application-owned slots (F6 stage CONFIG tab, gal-config.js, included
// before this file; F7 the stage entry, stage-entries.js).
if (typeof STAGE_CONFIG_SECTIONS === 'object' && STAGE_CONFIG_SECTIONS) STAGE_CONFIG_SECTIONS[DANMAKU_MOD] = DANMAKU_STAGE_CONFIG;
if (typeof stageEntries === 'object') stageEntries.register({ id: 'mod:' + DANMAKU_MOD, priority: 85, group: 'feature', icon: 'danmaku', label: '弹幕',
    render: ctx => React.createElement(DanmakuToggle, { rpc: ctx.rpc, sessionId: ctx.sessionId }) });


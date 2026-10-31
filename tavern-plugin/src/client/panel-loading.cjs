'use strict';
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

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {panelElapsedText};

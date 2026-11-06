'use strict';
// 「文字演出」 stage renderer data.
// Pure — no DOM, no React — so plans, timing and the photosensitivity gate are unit-tested in Node
// (tests/fork-textcard-presets.test.mjs). One renderer, many styles: a style is ONE entry of TEXTCARD_STYLES
// (palette, type, layout, motif, timing, intensity behaviour). Layouts are the only code; adding a style means adding
// an entry that names an existing layout.

const TEXTCARD_FPS = 24, TEXTCARD_MIN_F = 3;
// A state that changes the full-screen colour (card in/out included) lasts at least 9 frames (375 ms), every intensity.
const TEXTCARD_COLOUR_F = 9;
// 减少闪烁 (the stage's own CONFIG 「减少动态」, never the OS setting): sequences keep at most four states of at least
// 11 frames (458 ms) on one background, without inversions; single cards last at least 12 frames.
const TEXTCARD_REDUCED = {maxStates: 4, stateF: 11, cardF: 12};
// Photosensitivity: at most 3 full-screen colour changes in any 1 s window (+50 ms for timer/paint jitter), every
// intensity, across cards and the return to the scene. Text-only changes do not count.
const TEXTCARD_GATE = {windowMs: 1050, max: 3};

// Palette (contract v1) → stage tokens --gal-tc-<name> (theme.css, stage UI tokens). `figure` is the speaker's
// 形象色, resolved by the stage at playback (fallback vermilion). Dark grounds take paper-coloured text.
const TEXTCARD_PALETTE = ['ink', 'paper', 'vermilion', 'gold'];
const TEXTCARD_DARK = ['ink', 'vermilion'];
// 色义 (#22): a colour word takes its own ground and English line; other words alternate speaker accent / paper.
const TEXTCARD_COLOUR_WORDS = [[/^[赤红紅朱]/, 'vermilion', 'RED'], [/^白/, 'paper', 'WHITE'], [/^[黑黒]/, 'ink', 'BLACK'], [/^[金黄黃]/, 'gold', 'GOLD']];
const TEXTCARD_MARKERS = {recall: ['回想', 'RECALL'], aside: ['閑話休題', 'DIGRESSION'], ad: ['以下廣告', 'COMMERCIAL'], next: ['次回', 'NEXT']};
const TEXTCARD_PUNCT = {'赤齣': 'vermilion', '黒齣': 'ink', '黑齣': 'ink', '白齣': 'paper'};
// #10: preset component sets (same table as tavern-plugin/mods/textcard/presets.js MORPHS); no arbitrary outline morphing.
const TEXTCARD_MORPHS = {'明': ['日', '月'], '林': ['木', '木'], '森': ['木', '木', '木'], '休': ['人', '木'], '好': ['女', '子'], '蟹': ['角', '刀', '牛', '虫']};

// Medians in whole 24 fps frames from the sample clip, as fixed by the
// contract (sample medians take precedence over the catalogue's cut-point windows). `per`: card | state | event.
const TEXTCARD_TIMING = {
    punct: {f: 12, per: 'card', src: '标点／间隔卡 n=13'},
    title: {f: 58, per: 'card', src: '章节／标题 n=4'},
    name: {f: 18, per: 'card', src: '姓名 n=1'},
    word: {f: 20, per: 'card', src: '大字／短语 n=21'},
    narr: {f: 30, per: 'card', src: '可读叙述 n=12'},
    pattern: {f: 21, per: 'card', src: '重复文字背景 n=1'},
    split: {f: 72, per: 'event', src: '分屏文字（整段事件）'},
    morph: {f: 48, per: 'event', src: '汉字形变（整段事件）'},
    big: {f: 4, per: 'state', src: '闪序列大字 n=30'},
    build: {f: 82, per: 'event', src: '渐进文字（整段事件）'},
    count: {f: 4, per: 'state', src: '倒数 n=3'},
    code: {f: 41, per: 'card', src: '符号／代码 5W1H'},
    diagram: {f: 152, per: 'card', src: '家系图'},
    flash: {f: 8, per: 'state', src: '全部闪卡 n=107'},
};
// Intensity (the mod's 强度 setting, carried in the payload): duration scale and how many alternations a pair makes.
const TEXTCARD_INTENSITY = {
    restrained: {label: '克制', scale: 1.3, pairStates: 4},
    standard: {label: '标准', scale: 1, pairStates: 6},
    intense: {label: '浓烈', scale: 0.75, pairStates: 8},
};

// The styles (contract ids; CATALOGUE.md numbering, #17–21 and #24 out of scope). Fields:
//   cat     catalogue number        layout  renderer template (textcard-stage.js TEXTCARD_LAYOUTS)
//   tag     履历 label              bg      default ground (palette name or 'figure')
//   type    {face: mincho|mono, size}       motif   layout decoration
//   timing  TEXTCARD_TIMING key     seq     single | sequence | pair | build | colour | split | morph
const TEXTCARD_STYLES = {
    punct: {cat: 1, tag: '齣', layout: 'punct', bg: 'ink', type: {face: 'mincho', size: 'xs'}, motif: 'reading', timing: 'punct', seq: 'single'},
    title: {cat: 2, tag: '章节', layout: 'title', bg: 'ink', type: {face: 'mincho', size: 'm'}, motif: 'frame', timing: 'title', seq: 'single'},
    name: {cat: 3, tag: '人名', layout: 'name', bg: 'figure', type: {face: 'mincho', size: 'l'}, motif: 'rule', timing: 'name', seq: 'single'},
    kanji: {cat: 4, tag: '单字', layout: 'card', bg: 'paper', type: {face: 'mincho', size: 'xl'}, motif: 'reading', timing: 'word', seq: 'single'},
    word: {cat: 5, tag: '字卡', layout: 'card', bg: 'paper', type: {face: 'mincho', size: 'auto'}, motif: 'reading', timing: 'word', seq: 'single'},
    vertical: {cat: 6, tag: '竖排', layout: 'card', bg: 'paper', type: {face: 'mincho', size: 'm'}, motif: 'reading', timing: 'narr', seq: 'single', dir: 'v'},
    page: {cat: 7, tag: '长文', layout: 'page', bg: 'paper', type: {face: 'mincho', size: 's'}, motif: 'margin', timing: 'narr', seq: 'single', dir: 'v'},
    pattern: {cat: 8, tag: '字海', layout: 'wall', bg: 'paper', type: {face: 'mincho', size: 's'}, motif: 'drift', timing: 'pattern', seq: 'single'},
    split: {cat: 9, tag: '分屏', layout: 'split', bg: 'paper', type: {face: 'mincho', size: 'xl'}, motif: 'rules', timing: 'split', seq: 'split'},
    morph: {cat: 10, tag: '形变', layout: 'morph', bg: 'paper', type: {face: 'mincho', size: 'xl'}, motif: 'gloss', timing: 'morph', seq: 'morph'},
    pair: {cat: 11, tag: '对字', layout: 'flash', bg: 'ink', type: {face: 'mincho', size: 'xl'}, motif: 'invert', timing: 'big', seq: 'pair'},
    build: {cat: 12, tag: '输入', layout: 'ime', bg: 'paper', type: {face: 'mincho', size: 'm'}, motif: 'caret', timing: 'build', seq: 'build'},
    count: {cat: 13, tag: '倒数', layout: 'flash', bg: 'ink', type: {face: 'mincho', size: 'xl'}, motif: 'none', timing: 'count', seq: 'sequence'},
    code: {cat: 14, tag: '符号', layout: 'code', bg: 'paper', type: {face: 'mono', size: 'l'}, motif: 'bars', timing: 'code', seq: 'single'},
    diagram: {cat: 15, tag: '图解', layout: 'diagram', bg: 'paper', type: {face: 'mincho', size: 's'}, motif: 'lines', timing: 'diagram', seq: 'single'},
    marker: {cat: 16, tag: '标记', layout: 'marker', bg: 'vermilion', type: {face: 'mincho', size: 'l'}, motif: 'triangle', timing: 'narr', seq: 'single'},
    colour: {cat: 22, tag: '色义', layout: 'flash', bg: 'paper', type: {face: 'mincho', size: 'xl'}, motif: 'english', timing: 'flash', seq: 'colour'},
    oversized: {cat: 23, tag: '巨字', layout: 'card', bg: 'vermilion', type: {face: 'mincho', size: 'crop'}, motif: 'crop', timing: 'word', seq: 'single'},
    flash: {cat: 5, tag: '快闪', layout: 'flash', bg: 'ink', type: {face: 'mincho', size: 'auto'}, motif: 'none', timing: 'flash', seq: 'sequence'},
};

const textcardChars = value => [...String(value ?? '').replace(/\s/g, '')].length;
const textcardClean = (value, max = 800) => String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').slice(0, max);
function textcardItems(payload) {
    const list = Array.isArray(payload.steps) && payload.steps.length ? payload.steps : Array.isArray(payload.parts) && payload.parts.length ? payload.parts
        : typeof payload.text === 'string' ? [payload.text] : [];
    return list.map(item => textcardClean(item).trim()).filter(Boolean).slice(0, 16);
}
// Payload frames are accepted only when they are whole, in range and one per state; otherwise the table decides.
function textcardStepFrames(payload, count) {
    const list = payload.stepFrames;
    return Array.isArray(list) && list.length === count && list.every(f => Number.isInteger(f) && f >= TEXTCARD_MIN_F && f <= 24 * 60) ? list : null;
}
function textcardInk(bg) { return bg === 'figure' ? 'auto' : TEXTCARD_DARK.includes(bg) ? 'paper' : 'ink'; }
function textcardFrames(f, scale) { return Math.max(TEXTCARD_MIN_F, Math.round(f * scale)); }
const textcardMs = f => f * 1000 / TEXTCARD_FPS;
function textcardSize(text, preferred, dir) {
    if (preferred !== 'auto') return preferred;
    if (dir === 'v') return 'm';
    const n = textcardChars(text);
    return n <= 2 ? 'xl' : n <= 8 ? 'l' : 'm';
}

// Payload (contract v1: {version, style, parts, steps, sub?, intensity, stepFrames, minColourFrames, history}) →
// renderer plan {style, layout, frames:[{f, ms, bg, fg, state}], tag, history, sr}. options.reduced = 减少闪烁.
// Returns null for an unknown style or nothing to show.
function planTextcard(payload, options = {}) {
    const p = payload && typeof payload === 'object' ? payload : {};
    if (p.template && p.version === 1 && Array.isArray(p.frames)) return planTextcardCompound(p, options);
    if (!Object.hasOwn(TEXTCARD_STYLES, p.style)) return null;
    const style = TEXTCARD_STYLES[p.style], items = textcardItems(p);
    if (!items.length) return null;
    const intensityId = Object.hasOwn(TEXTCARD_INTENSITY, p.intensity) ? p.intensity : 'standard';
    const intensity = TEXTCARD_INTENSITY[intensityId], reduced = options.reduced === true;
    const colourF = Math.max(TEXTCARD_COLOUR_F, Number.isInteger(p.minColourFrames) ? Math.min(p.minColourFrames, 48) : 0);
    const sub = textcardClean(p.sub, 96).trim(), table = TEXTCARD_TIMING[style.timing];
    const dir = style.dir || 'h';
    const own = textcardStepFrames(p, items.length);
    const frameOf = (i, fallback) => own ? own[i] : fallback;
    const scaled = f => textcardFrames(f, intensity.scale);
    let bg = style.bg;
    const frames = [];
    const push = (f, state, paint = {}) => frames.push({f, bg: paint.bg || bg, fg: paint.fg || textcardInk(paint.bg || bg), state});
    let history = items;

    switch (style.seq) {
    case 'single': {
        let text = items[0];
        const state = {text, sub};
        if (style.layout === 'punct') bg = TEXTCARD_PUNCT[text] || 'ink';
        if (style.layout === 'marker') {
            const marker = TEXTCARD_MARKERS[text];
            if (marker) { text = marker[0]; Object.assign(state, {text, roman: marker[1]}); }
            history = [text];
        }
        if (style.layout === 'wall') state.fill = sub || text;
        if (style.layout === 'diagram') Object.assign(state, {text: items[0], items: items.slice(1), kind: items.length > 5 ? 'grid' : 'tree'});
        if (style.layout === 'diagram' && items.length === 1) return null;
        state.size = style.layout === 'card' ? textcardSize(text, style.type.size, dir) : style.type.size;
        if (style.type.size === 'crop') state.anchor = 'center';
        push(frameOf(0, scaled(table.f)), state);
        if (style.layout === 'diagram') history = items;
        break;
    }
    case 'sequence': {
        // 闪序列 / 倒数: states change only the text, on one stable ground.
        items.forEach((text, i) => push(frameOf(i, scaled(table.f)), {text, sub, size: textcardSize(text, style.type.size, dir)}));
        break;
    }
    case 'pair': {
        // 反色交替: two glyphs swap in place; every other pair of states inverts ground and text.
        if (items.length < 2) return null;
        const f = frameOf(0, scaled(table.f));
        for (let i = 0; i < intensity.pairStates; i++) {
            const invert = Math.floor(i / 2) % 2 === 1;
            push(f, {text: items[i % 2], sub, size: 'xl'}, invert ? {bg: 'paper', fg: 'ink'} : {});
        }
        history = items.slice(0, 2);
        break;
    }
    case 'colour': {
        // 色义: same composition; a colour word takes its colour as ground, other words alternate accent / paper.
        let other = 0;
        items.forEach((text, i) => {
            const match = TEXTCARD_COLOUR_WORDS.find(([re]) => re.test(text));
            const ground = match ? match[1] : other++ % 2 ? 'paper' : 'figure';
            push(frameOf(i, scaled(table.f)), {text, sub: sub || (match ? match[2] : ''), size: textcardSize(text, 'auto', dir)}, {bg: ground});
        });
        break;
    }
    case 'build': {
        // 渐进输入: committed text grows, the uncommitted tail is underlined with a caret; the finished line holds.
        const last = items.length - 1, finalF = Math.round(table.f / 2), each = Math.max(TEXTCARD_MIN_F, Math.floor(table.f / 2 / Math.max(1, last)));
        items.forEach((step, i) => {
            const previous = i ? items[i - 1] : '';
            const committed = i === last ? step : step.startsWith(previous) ? previous : '';
            push(frameOf(i, i === last ? scaled(finalF) : scaled(each)), {committed, typing: i === last ? '' : step.slice(committed.length), caret: i !== last, final: items[last]});
        });
        history = [items[last]];
        break;
    }
    case 'split': {
        // 分屏: white panes with fine rules; the words move through the cells in three states.
        const panes = items.slice(0, 3), total = frameOf(0, scaled(table.f)), n = 3;
        for (let i = 0; i < n; i++) push(Math.max(TEXTCARD_MIN_F, Math.round(total / n)), {cells: panes.length, panes: panes.map((_, k) => panes[(k + i) % panes.length]), sub});
        history = panes;
        break;
    }
    case 'morph': {
        // 部件聚合: preset components start apart and converge, then the finished glyph with its gloss.
        const glyph = items[0], parts = TEXTCARD_MORPHS[glyph];
        if (!parts) return null;
        const total = frameOf(0, scaled(table.f));
        push(Math.max(TEXTCARD_MIN_F, Math.round(total * 34 / 48)), {parts, text: glyph, converge: true, sub});
        push(Math.max(TEXTCARD_MIN_F, Math.round(total * 14 / 48)), {parts: [], text: glyph, sub, final: true});
        history = [glyph];
        break;
    }
    default: return null;
    }
    if (reduced) textcardReduce(frames, style);
    // Every full-screen colour change holds at least 9 frames: the first state, each state on a new ground and the
    // state before the return to the scene.
    frames.forEach((frame, i) => {
        const changed = i === 0 || frame.bg !== frames[i - 1].bg || i === frames.length - 1;
        if (changed) frame.f = Math.max(frame.f, colourF);
        frame.ms = textcardMs(frame.f);
    });
    const recorded = Array.isArray(p.history?.parts) && p.history.parts.length ? p.history.parts.map(part => textcardClean(part, 800)).filter(Boolean) : history;
    return {style: p.style, layout: style.layout, type: style.type, motif: style.motif, dir, intensity: intensityId, reduced,
        frames, tag: style.tag, history: recorded, sr: recorded.join('、'), totalMs: frames.reduce((sum, frame) => sum + frame.ms, 0)};
}
// Compound v1 stores the concrete plan at admission; replay never consults the current template compiler.
function planTextcardCompound(payload, {reduced = false} = {}) {
    const tags = {show:'字卡', title:'章节', sequence:'词序', count:'倒数', relate:'关系', compare:'对照', reveal:'揭晓', repeat:'回响', read:'档案'};
    let frames = payload.frames.map(frame => ({...payload.view, ...frame, state:{...payload.view?.state, ...payload.graph, ...frame.state}, ms:textcardMs(frame.f)}));
    if (reduced && payload.template !== 'count') {
        const last = frames.at(-1), f = Math.max(12, frames.reduce((sum, frame) => sum + frame.f, 0));
        frames = [{...last, f, ms:textcardMs(f), state:{...last.state, converge:false}}];
    }
    const history = payload.history.parts;
    return {style:payload.template, frames, reduced, tag:tags[payload.template], history, sr:history.join('、'),
        intensity:payload.intensity, totalMs:frames.reduce((sum, frame) => sum + frame.ms, 0)};
}
// 减少闪烁: at most four states (first and last kept), one ground, longer states; single cards at least 12 frames.
function textcardReduce(frames, style) {
    if (style.seq === 'pair') frames.splice(TEXTCARD_REDUCED.maxStates);
    else if (frames.length > 1 && style.seq !== 'morph' && style.seq !== 'build') {
        const kept = textcardPick(frames, TEXTCARD_REDUCED.maxStates);
        frames.splice(0, frames.length, ...kept.map(frame => ({...frame, state: {...frame.state}})));
    }
    const ground = frames[0].bg, ink = frames[0].fg;
    for (const frame of frames) {
        frame.bg = ground; frame.fg = ink;
        frame.f = Math.max(frame.f, frames.length > 1 ? TEXTCARD_REDUCED.stateF : TEXTCARD_REDUCED.cardF);
        if (frame.state.converge) frame.state.converge = false;
    }
}
// Evenly spaced subset that keeps the first and the last item (a sequence's ending is its point).
function textcardPick(list, n) {
    if (list.length <= n) return list.slice();
    if (n <= 1) return [list[list.length - 1]];
    return Array.from({length: n}, (_, i) => list[Math.round(i * (list.length - 1) / (n - 1))]);
}
// 履历 row: one muted line per performance; a whole sequence is one line. Prefers the payload's recorded history.
function textcardHistory(payload) {
    const plan = planTextcard(payload, {});
    return plan && plan.history.length ? {tag: plan.tag, parts: plan.history, sub: textcardClean(payload.sub, 96).trim()} : null;
}

// The gate is per stage and shared by every card. slot(now): earliest time a colour change may paint;
// mark(t): record a painted change.
function createTextcardGate({windowMs = TEXTCARD_GATE.windowMs, max = TEXTCARD_GATE.max} = {}) {
    const times = [];
    return {
        slot(now) {
            let t = now;
            if (times.length) t = Math.max(t, times[times.length - 1] + TEXTCARD_COLOUR_F * 1000 / TEXTCARD_FPS);
            if (times.length >= max) t = Math.max(t, times[times.length - max] + windowMs);
            return t;
        },
        mark(t) { times.push(t); if (times.length > 16) times.splice(0, times.length - 16); },
        times: () => times.slice(),
    };
}
// Largest number of changes inside any window (tests and the debug hook).
function textcardPeak(times, windowMs = 1000) {
    let best = 0, j = 0;
    const sorted = times.slice().sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) { while (sorted[i] - sorted[j] >= windowMs) j++; best = Math.max(best, i - j + 1); }
    return best;
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {TEXTCARD_STYLES, TEXTCARD_TIMING, TEXTCARD_INTENSITY, TEXTCARD_PALETTE,
    TEXTCARD_GATE, TEXTCARD_REDUCED, TEXTCARD_COLOUR_F, TEXTCARD_MORPHS, TEXTCARD_FPS, planTextcard, textcardHistory, createTextcardGate, textcardPeak, textcardPick};

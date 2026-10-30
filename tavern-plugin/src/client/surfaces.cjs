// the only surface palette and glass implementation. Shared with Node tests.
const forkSurfaces = (() => {
    const levels = ['base', 'raised', 'popover', 'modal', 'toast', 'stage-hud', 'stage-panel', 'stage-textbox'];
    // Design seeds: [base, ink, muted ink, accent, textbox plate]. The textbox plate is the galgame dialogue window:
    // a little lifted from the stage base so it reads as a window over the scene, never a hole in it.
    const palettes = {
        'chat-light': ['#ffffff', '#0f1115', '#555a60', '#4176e6'],
        'chat-dark': ['#232324', '#f9fafb', '#cfd3d6', '#679efe'],
        'stage-classic': ['#0c0a14', '#f5f2fa', '#bcb8c6', '#e9e4f3', '#1a1628'],
        'stage-gothic': ['#0c0816', '#f6f1fb', '#c2b8cc', '#e8d8a8', '#110b1d'],
        'stage-magical': ['#fffafd', '#6b2f55', '#80506d', '#b7457b', '#fff5fa'],
        // 显像管 (crt): tube-black glass, pale phosphor ink, excited P1 green.
        'stage-crt': ['#06110c', '#c8f5d2', '#7fbf95', '#4dff88', '#0a1a12'],
        // 千禧晴空 (aero): sky-white glass, deep navy ink, Aero blue.
        'stage-aero': ['#f2f9ff', '#0e2c48', '#3b5f80', '#0a5fae', '#f6fbff']
    };
    // Decorative, never text-bearing paints (validated where text can sit on them). Scene/page dimmers behind sheets,
    // the caption scrim over artwork and the small dark chip used for badges/buttons drawn over images or the scene.
    const veils = {
        'chat-light': 'rgb(15 17 21 / .42)', 'chat-dark': 'rgb(0 0 0 / .58)',
        'stage-classic': 'rgb(8 6 14 / .64)', 'stage-gothic': 'rgb(6 4 12 / .7)', 'stage-magical': 'rgb(255 244 250 / .58)',
        'stage-crt': 'rgb(2 8 5 / .72)', 'stage-aero': 'rgb(212 235 251 / .55)'
    };
    // Emotion chips (舞台设置 / 角色窗口 / 对白设置). Builtin colours mirror tests/fixtures/legacy-dialogue-moods.json (a test keeps
    // them in sync); card-defined emotions take a deterministic colour from `custom`, picked in the same saturation and
    // lightness band as the builtin set on hues it leaves open. Every chip is a filled pill: fill = 14% colour over the
    // surface, text = `chipInk` colour over the surface ink. `chipInk` is the largest colour share that keeps every
    // reference colour at 4.5:1 on that fill, so it adapts to host colours instead of failing validation.
    const EMOTIONS = {
        builtin: ['#e0932a', '#e0524c', '#4a86e0', '#c9a012', '#3fa36b', '#1fa5b8', '#8b67d6', '#e0609a', '#659bc4'],
        custom: ['#d9714a', '#2fa68a', '#5b6fd6', '#9a9a2a', '#b05fc9', '#cc5274', '#6a9a3a', '#b0784a'],
        fill: .14
    };
    // Card emotion ids → colours, in list order: each id hashes to a palette slot and probes to the next free one, so a
    // card's (at most 8) emotions never share a colour and an emotion keeps its colour when others are added.
    function emotionColors(ids) {
        const used = new Set(), n = EMOTIONS.custom.length;
        return (ids || []).map(id => {
            let hash = 2166136261;
            for (const ch of String(id)) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
            let slot = hash % n;
            for (let step = 0; step < n && used.has(slot); step++) slot = (slot + 1) % n;
            used.add(slot);
            return EMOTIONS.custom[slot];
        });
    }
    const MEDIA = { mediaScrim: 'linear-gradient(180deg, rgb(0 0 0 / 0), rgb(0 0 0 / .56) 42%, rgb(0 0 0 / .8))', mediaChip: 'rgb(16 14 22 / .8)', mediaFg: '#ffffff' };
    function color(value) {
        const s = String(value).trim();
        if (/^#[\da-f]{3,8}$/i.test(s)) {
            let hex = s.slice(1); if (hex.length === 3 || hex.length === 4) hex = [...hex].map(x => x + x).join('');
            if (hex.length !== 6 && hex.length !== 8) throw Error('Invalid colour: ' + s);
            return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
        }
        const m = s.match(/^rgba?\(([^)]+)\)$/i);
        if (m) { const n = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); if ((n.length === 3 || n.length === 4) && n.every(Number.isFinite)) return n.length === 3 ? [...n, 1] : n; }
        throw Error('Unsupported colour: ' + s);
    }
    // One emotion chip's solid paints on a level record (what the CSS color-mix() resolves to).
    const chipPaint = (c, s) => ({ bg: mix(c, s.bgSolid, EMOTIONS.fill), fg: mix(c, s.fg, parseFloat(s.chipInk) / 100) });
    const composite = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3])).concat(1);
    function luminance(c) { return c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0); }
    function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
    const onAccent = accent => contrast(color('#ffffff'), color(accent)) >= 4.5 ? '#ffffff' : '#0c0a14';
    // Solid sRGB mix: t of a over b. Every derived state paint is opaque, so it is valid on any underlay.
    const mix = (a, b, t) => { const under = color(b); return '#' + color(a).slice(0, 3).map((v, i) => Math.round(v * t + under[i] * (1 - t)).toString(16).padStart(2, '0')).join(''); };
    // Emotion chip readability is a pure function of (surface, ink, ink share); host refreshes revisit the same few pairs.
    const chipChecks = new Map(), chipInks = new Map();
    function chipsReadable(paint, fg, ink) {
        const key = paint + '|' + fg + '|' + ink;
        if (!chipChecks.has(key)) chipChecks.set(key, [...EMOTIONS.builtin, ...EMOTIONS.custom].every(c => { const p = chipPaint(c, { bgSolid: paint, fg, chipInk: ink }); return contrast(color(p.fg), color(p.bg)) >= 4.5; }));
        return chipChecks.get(key);
    }
    function validate(table) {
        for (const [context, entries] of Object.entries(table)) for (const level of levels) {
            const s = entries[level], bg = color(s.bg);
            if (context.startsWith('chat-') && ['popover', 'modal', 'toast'].includes(level) && bg[3] < .96) throw Error(context + '/' + level + ': alpha below .96');
            if (bg[3] < .96 && (!s.scrim || color(s.scrim)[3] !== 1)) throw Error('Translucent surface needs solid scrim');
            if (color(s.bgSolid)[3] !== 1 || !s.onAccent) throw Error('Missing solid background or onAccent');
            for (const under of [[0, 0, 0, 1], [255, 255, 255, 1]]) {
                const effective = composite(bg, s.scrim ? composite(color(s.scrim), under) : under);
                for (const [prop, min] of [['fg', 4.5], ['fgMuted', 3], ['icon', 3]]) if (contrast(composite(color(s[prop]), effective), effective) < min) throw Error(context + '/' + level + ': ' + prop + ' contrast');
                // Text over an image/scene sits on the media chip; check it over the worst artwork.
                if (s.mediaChip && contrast(color(s.mediaFg), composite(color(s.mediaChip), under)) < 4.5) throw Error(context + '/' + level + ': media chip contrast');
            }
            // Row states are solid paints that keep the surface ink readable.
            for (const state of ['hover', 'selected']) if (s[state] && (color(s[state])[3] !== 1 || contrast(color(s.fg), color(s[state])) < 4.5)) throw Error(context + '/' + level + ': ' + state + ' contrast');
            // Stage quick menu: plate-less icons on the textbox (idle muted ink, hover ink on the hover chip, toggled accent
            // on the selected chip) keep WCAG non-text contrast.
            if (context.startsWith('stage-') && level === 'stage-textbox' && [[s.fgMuted, s.bgSolid], [s.fg, s.hover], [s.accent, s.selected], [s.accent, s.bgSolid]]
                .some(([ink, paint]) => contrast(color(ink), color(paint)) < 3)) throw Error(context + '/' + level + ': quick menu icon contrast');
            if (contrast(color(s.onAccent), color(s.fill || s.accent)) < 4.5) throw Error(context + '/' + level + ': onAccent contrast');
            if (s.accentHover && contrast(color(s.onAccent), color(s.accentHover)) < 4.5) throw Error(context + '/' + level + ': accentHover contrast');
            if (s.chipInk && !chipsReadable(s.bgSolid, s.fg, s.chipInk)) for (const c of [...EMOTIONS.builtin, ...EMOTIONS.custom]) if (contrast(color(chipPaint(c, s).fg), color(chipPaint(c, s).bg)) < 4.5) throw Error(context + '/' + level + ': emotion chip contrast ' + c);
        }
        return table;
    }
    function chipInk(paint, fg) {
        const key = paint + '|' + fg;
        if (chipInks.has(key)) return chipInks.get(key);
        const ok = t => chipsReadable(paint, fg, t * 100 + '%');
        let t = 82;
        while (t > 0 && !ok(t / 100)) t -= 2;
        chipInks.set(key, t + '%');
        return t + '%';
    }
    function build(host = {}) {
        const table = {};
        for (const [context, p] of Object.entries(palettes)) {
            let [bg, fg, muted, accent, plate] = p, menu = null;
            if (host[context]) {
                const h = host[context];
                try { if (color(h.bg)[3] === 1) bg = h.bg; } catch (_) {}
                const readable = (candidate, fallback, min) => { try { if (color(candidate)[3] === 1 && contrast(color(candidate), color(bg)) >= min) return candidate; } catch (_) {} return contrast(color(fallback), color(bg)) >= min ? fallback : onAccent(bg); };
                fg = readable(h.fg, fg, 4.5); muted = readable(h.fgMuted, muted, 3);
                // Floating levels (popover/modal/toast) take the host's menu colour when it is solid and keeps both inks readable.
                try { if (color(h.menu)[3] === 1 && contrast(color(fg), color(h.menu)) >= 4.5 && contrast(color(muted), color(h.menu)) >= 3) menu = h.menu; } catch (_) {}
                try { if (color(h.accent)[3] === 1) accent = h.accent; } catch (_) {}
            }
            // Design-owned seeds preserve the former 94% base / 6% accent raised stage paint.
            const stage = context.startsWith('stage-'), dark = contrast(color(bg), [0, 0, 0, 1]) < 8;
            const raised = stage ? mix(accent, bg, .06) : bg;
            // Accent fills (buttons, play glyph discs): keep white glyphs by deepening the fill up to 40% toward black; a pale
            // accent that cannot get there keeps its colour and takes the dark glyph. The accent itself stays the text colour.
            let fill = accent;
            for (let t = .96; contrast([255, 255, 255, 1], color(fill)) < 4.5 && t >= .6; t -= .04) fill = mix(accent, '#000000', t);
            if (contrast([255, 255, 255, 1], color(fill)) < 4.5) fill = accent;
            const ink = onAccent(fill), accentHover = mix(fill, ink === '#ffffff' ? '#000000' : '#ffffff', .86);
            table[context] = Object.fromEntries(levels.map(level => {
                const paint = !stage ? (menu && ['popover', 'modal', 'toast'].includes(level) ? menu : bg) : level === 'stage-textbox' ? plate : level === 'stage-hud' ? mix(accent, bg, .04)
                    : ['raised', 'popover', 'modal', 'toast', 'stage-panel'].includes(level) ? raised : bg;
                // Stage rows tint toward the accent (the theme's jewel); chat rows toward the ink like host menus.
                const hover = stage ? mix(accent, paint, dark ? .1 : .12) : mix(fg, paint, .06);
                const selected = stage ? mix(accent, paint, dark ? .18 : .16) : mix(accent, paint, .13);
                return [level, { bg: paint, bgSolid: paint, border: 'color-mix(in srgb, ' + accent + ' 24%, transparent)',
                    line: stage ? mix(accent, paint, .28) : mix(fg, paint, .13),
                    shadow: stage ? (dark ? '0 10px 30px rgb(0 0 0 / .42), 0 1px 0 rgb(255 255 255 / .04) inset' : '0 10px 28px rgb(183 69 123 / .16), 0 1px 0 rgb(255 255 255 / .9) inset')
                        : dark ? '0 12px 32px rgb(0 0 0 / .45), 0 2px 6px rgb(0 0 0 / .24)' : '0 12px 32px rgb(15 17 21 / .14), 0 2px 6px rgb(15 17 21 / .06)',
                    veil: veils[context], blur: 'none', fg, fgMuted: muted, fgDisabled: mix(fg, paint, .42), icon: fg,
                    // Disabled / hidden content renders dimmed (desaturated toward the surface) instead of see-through.
                    dim: dark ? 'grayscale(1) contrast(.75) brightness(.6)' : 'grayscale(1) contrast(.3) brightness(1.55)',
                    hover, selected, accent, fill, accentHover, onAccent: ink, scrim: paint, ...MEDIA, chipInk: chipInk(paint, fg) }];
            }));
        }
        return validate(table);
    }
    const SURFACES = build();
    function css(table = SURFACES) {
        let text = Object.entries(table).map(([context, entries]) => {
            const theme = context.slice(6);
            // Stage roots carry data-fk-context; theme previews and bare stage fixtures resolve from data-theme.
            const selector = '[data-fk-context="' + context + '"]' + (context.startsWith('stage-') ? ',.fork-gal-theme-scope[data-theme="' + theme + '"],.fork-gal-stage[data-theme="' + theme + '"]:not([data-fk-context])' + (theme === 'classic' ? ',.fork-gal-stage:not([data-theme]):not([data-fk-context])' : '') : '');
            return selector + '{' + Object.entries(entries).flatMap(([level, props]) => Object.entries(props).map(([prop, value]) => '--fk-s-' + level + '-' + prop + ':' + value + ';')).join('') + '}';
        }).join('\n');
        const props = Object.keys(SURFACES['chat-light'].base);
        // Outside any primitive, descendants resolve "current" paints from their context's base level.
        text += '\n[data-fk-context],.fork-gal-theme-scope,.fork-gal-stage{' + props.map(prop => '--fk-current-' + prop + ':var(--fk-s-base-' + prop + ');').join('') + '}';
        for (const level of levels) text += '\n.fk-surface[data-level="' + level + '"]{' + props.map(prop => '--fk-current-' + prop + ':var(--fk-s-' + level + '-' + prop + ');').join('') + '}';
        return text + `
.fk-surface.fk-surface { position: relative; isolation: isolate; background: var(--fk-current-bgSolid); border: 1px solid var(--fk-current-border); box-shadow: var(--fk-current-shadow); color: var(--fk-current-fg); }
.fk-surface::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none; background: linear-gradient(var(--fk-current-bg),var(--fk-current-bg)),var(--fk-current-scrim); backdrop-filter: var(--fk-current-blur); }
.fk-surface .fk-on-accent.fk-on-accent { background: var(--fk-current-fill); color: var(--fk-current-onAccent); }
.fk-surface .fk-on-accent.fk-on-accent:hover:not(:disabled) { background: var(--fk-current-accentHover); }
`;
    }
    return { SURFACES, levels, build, validate, css, color, contrast, composite, mix, EMOTIONS, emotionColors, chipPaint };
})();
// Node tests only: in the client bundle (evaluated as a CommonJS module by the host loader) exporting would replace the
// bundle's own exports.
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = forkSurfaces;

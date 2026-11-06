// Self-contained built-in definition; evaluated as an expression by the client assembler.
(function () {
    const type = "countdown";
    const STAGE_WIDGET_TONES = ['theme', 'pink', 'info', 'warning'];
    const STAGE_WIDGET_ICONS = ['none', 'alarm', 'message', 'letter', 'clock'];
    const STYLES = ['watch', 'flip', 'deadline'];
    const stageWidgetObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
    const pad = value => String(value).padStart(2, '0');
    const clockText = seconds => pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60);
    // Urgency bands drive colour and motion only through data attributes; CSS owns every visual.
    const urgencyOf = seconds => seconds <= 0 ? 'zero' : seconds <= 10 ? 'critical' : seconds <= 60 ? 'low' : 'calm';
    const CAPTIONS = { calm: '\u5269\u4f59', low: '\u6700\u540e\u4e00\u5206\u949f', critical: '\u5373\u5c06\u5f52\u96f6', zero: '\u65f6\u95f4\u5230' };
    // A looping animation of `period` seconds, phased by the absolute remaining time: a remount at any second resumes the
    // same phase. Computed once per mounted element, so a re-render never moves a running animation.
    const phase = (seconds, period) => -((period - seconds % period) % period) + 's';

    // Pocket watch: the minute hand walks a 60-minute dial and the second hand sweeps; both reach twelve at zero.
    function watch(h, s, anchor) {
        const minute = Math.min(s, 3600) / 10;
        return h('div', { className: 'fork-cd-watch' },
            h('i', { className: 'fork-cd-bow' }), h('i', { className: 'fork-cd-crown' }),
            h('div', { className: 'fork-cd-case' },
                h('div', { className: 'fork-cd-face' },
                    h('i', { className: 'fork-cd-guilloche' }),
                    h('i', { className: 'fork-cd-wedge', style: { WebkitMaskImage: 'conic-gradient(transparent ' + (360 - minute) + 'deg, #000 0)', maskImage: 'conic-gradient(transparent ' + (360 - minute) + 'deg, #000 0)' } }),
                    h('i', { className: 'fork-cd-ticks' }), h('i', { className: 'fork-cd-hours' }),
                    h('b', { className: 'fork-cd-numeral is-12' }, 'XII'), h('b', { className: 'fork-cd-numeral is-3' }, 'III'), h('b', { className: 'fork-cd-numeral is-9' }, 'IX'),
                    h('i', { className: 'fork-cd-heart' }, h('i', { className: 'fork-cd-balance' })),
                    h('i', { className: 'fork-cd-hand is-minute', style: { transform: 'rotate(' + (-s / 10) + 'deg)' } }),
                    h('i', { className: 'fork-cd-hand is-second', style: { transform: 'rotate(' + (-s * 6) + 'deg)' } }),
                    h('i', { className: 'fork-cd-pin' }),
                    h('i', { className: 'fork-cd-glass', style: { animationDelay: phase(anchor, 9) } }),
                    s === 0 ? h('span', { className: 'fork-cd-stamp' }, CAPTIONS.zero) : null)));
    }
    // One split-flap tile. It is keyed by its character, so a digit that changes mounts a new tile; only a tile mounted
    // after the face itself flips (from the previous second's character), and it decides that once, at its own mount.
    function CountdownTile({ React, char, from, afterMount, unit }) {
        const h = React.createElement;
        const [flipFrom] = React.useState(() => afterMount && from !== char ? from : '');
        return h('span', { className: 'fork-cd-tile' + (flipFrom ? ' is-flipping' : ''), 'data-unit': unit },
            h('span', { className: 'fork-cd-leaf is-top' }, h('b', null, char)),
            h('span', { className: 'fork-cd-leaf is-bottom' }, h('b', null, flipFrom || char)),
            flipFrom ? h('span', { className: 'fork-cd-leaf is-top is-flap' }, h('b', null, flipFrom)) : null,
            flipFrom ? h('span', { className: 'fork-cd-leaf is-bottom is-flap' }, h('b', null, char)) : null);
    }
    // Split-flap board: minutes and seconds on four tiles, a blinking colon, engraved units.
    function flip(h, React, s, afterMount) {
        // Tiles are keyed from the right, so 100:00 -> 99:59 keeps the stable places.
        const tiles = (text, previous, unit) => [...text].map((char, index) => {
            const place = text.length - index;
            return h(CountdownTile, { key: unit + place + ':' + char, React, char, from: previous[previous.length - place] || '', afterMount, unit });
        });
        const group = (text, previous, unit, name) => h('span', { className: 'fork-cd-group' }, h('span', { className: 'fork-cd-digits' }, tiles(text, previous, unit)), h('small', null, name));
        return h('div', { className: 'fork-cd-board' },
            h('div', { className: 'fork-cd-tiles' }, group(pad(Math.floor(s / 60)), pad(Math.floor((s + 1) / 60)), 'm', '\u5206'), h('span', { className: 'fork-cd-colon' }, h('i'), h('i')), group(pad(s % 60), pad((s + 1) % 60), 's', '\u79d2')));
    }
    // Deadline gauge: the outer ring drains over the director's stated limit, a bead orbits once per minute.
    function deadline(h, s, total) {
        const left = 100 - Math.min(1, s / total) * 100;
        return h('div', { className: 'fork-cd-gauge' },
            h('i', { className: 'fork-cd-ticks' }),
            h('svg', { viewBox: '0 0 120 120', 'aria-hidden': true },
                h('circle', { className: 'fork-cd-ring-track', cx: 60, cy: 60, r: 50 }),
                h('circle', { className: 'fork-cd-ring-fill', cx: 60, cy: 60, r: 50, pathLength: 100, style: { strokeDashoffset: left } })),
            h('i', { className: 'fork-cd-orbit', style: { transform: 'rotate(' + (-s * 6) + 'deg)' } }));
    }
    function CountdownFace({ React, props: p, options, seconds, remaining }) {
        const h = React.createElement;
        const s = Number.isSafeInteger(seconds) ? Math.max(0, seconds) : p.remainingSeconds;
        // Mount-time anchors: loop phases and the "flip from the previous digit" state never change on a re-render.
        const [anchor] = React.useState(s);
        const mounted = React.useRef(false), sawTime = React.useRef(false);
        React.useEffect(() => { mounted.current = true; }, []);
        const arrived = s === 0 && sawTime.current;
        if (s > 0) sawTime.current = true;
        const style = STYLES.includes(p.style) ? p.style : STYLES.includes(options && options.style) ? options.style : 'watch';
        const urgency = urgencyOf(s), live = p.tick === 'page-live' && s > 0;
        const total = Math.max(1, p.remainingSeconds, Number.isSafeInteger(remaining) ? remaining : 0, s);
        const time = h('span', { className: 'fork-widget-number fork-cd-time', role: 'timer', 'aria-label': p.label || '\u5012\u8ba1\u65f6' }, clockText(s));
        const caption = h('small', { className: 'fork-cd-caption' }, CAPTIONS[urgency]);
        const body = style === 'watch' ? watch(h, s, anchor) : style === 'flip' ? flip(h, React, s, mounted.current) : deadline(h, s, total);
        return h('div', { className: 'fork-cd', 'data-cd-style': style, 'data-urgency': urgency, 'data-cd-live': live || undefined, 'data-cd-zero': s === 0 ? (arrived ? 'arrived' : 'shown') : undefined, 'data-cd-alarm': s === 0 && p.alarmRing || undefined },
            h('i', { className: 'fork-cd-edge', 'aria-hidden': true, style: { animationDelay: phase(anchor, 3) } }),
            h('div', { className: 'fork-cd-prop', 'aria-hidden': true },
                h('div', { className: 'fork-cd-beat' }, h('div', { className: 'fork-cd-body' }, s === 0 && p.alarmRing ? h('i', { className: 'fork-cd-burst' }) : null, body))),
            h('div', { className: 'fork-cd-readout' }, time, caption));
    }
    const definition = {
        id: type, version: 2, title: "\u5012\u8ba1\u65f6",
        // shared safety/ticking/alarm semantics belong to Widget rules.
        note: "A visible time-limit prop. label names what runs out (e.g. \u8ddd\u79bb\u9b54\u5973\u7ed3\u754c\u6d88\u5931). style picks the prop: watch (pocket watch, default), flip (split-flap board, for stations or machines), deadline (draining ring, for bombs, rituals and ultimatums); omit it to use the card default.",
        propsSchema: {"type":"object","properties":{"tone":{"type":"string","enum":["theme","pink","info","warning"]},"icon":{"type":"string","enum":["none","alarm","message","letter","clock"]},"label":{"type":"string","maxLength":40},"remainingSeconds":{"type":"integer","minimum":0,"maximum":86400},"format":{"type":"string","enum":["mm:ss"]},"tick":{"type":"string","enum":["frozen","page-live"]},"alarmRing":{"type":"boolean"},"style":{"type":"string","enum":["watch","flip","deadline"]}},"required":["remainingSeconds"],"additionalProperties":false},
        optionsSchema: {"type":"object","properties":{"style":{"type":"string","enum":["watch","flip","deadline"],"default":"watch","description":"Look used when the director does not choose one; a tuned value overrides the director."}},"required":[],"additionalProperties":false},
        caps: { bytes: 12288, active: 1 },
        slot: "top-center",
        samples: [
            {"label":"\u8ddd\u79bb\u9b54\u5973\u7ed3\u754c\u6d88\u5931","remainingSeconds":900,"tick":"page-live","tone":"pink","icon":"alarm"},
            {"label":"\u672b\u73ed\u8f66\u53d1\u8f66","remainingSeconds":45,"tick":"page-live","tone":"warning","style":"flip"},
            {"label":"\u5f15\u7206\u5012\u6570","remainingSeconds":8,"tick":"page-live","style":"deadline","alarmRing":true},
            {"label":"\u7ea6\u5b9a\u7684\u65f6\u523b","remainingSeconds":0,"style":"watch","alarmRing":true}
        ],
        normalize(raw) {
            if (!stageWidgetObject(raw)) return null;
            if (Object.keys(raw).some(key => !["tone","icon","label","remainingSeconds","format","tick","alarmRing","style"].includes(key))) return null;
            const text = (value, cap, required) => typeof value === 'string' && [...value].length <= cap && (!required || value.trim().length > 0);
            const pick = (name, values, fallback) => raw[name] === undefined ? fallback : values.includes(raw[name]) ? raw[name] : null;
            const props = { tone: pick('tone', STAGE_WIDGET_TONES, 'theme'), icon: pick('icon', STAGE_WIDGET_ICONS, 'none') };
            if (!props.tone || !props.icon) return null;
            if (!Number.isSafeInteger(raw.remainingSeconds) || raw.remainingSeconds < 0 || raw.remainingSeconds > 86400 || (raw.label !== undefined && !text(raw.label, 40, false))) return null;
            Object.assign(props, { label: raw.label || '', remainingSeconds: raw.remainingSeconds, format: pick('format', ['mm:ss'], 'mm:ss'), tick: pick('tick', ['frozen', 'page-live'], 'frozen'), alarmRing: raw.alarmRing ?? false });
            if (!props.format || !props.tick || typeof props.alarmRing !== 'boolean') return null;
            // Absent style stays absent so the author option (tuning default) decides at render time.
            if (raw.style !== undefined) { if (!STYLES.includes(raw.style)) return null; props.style = raw.style; }
            return props;
        },
        render({ React, widget, seconds }) {
            return React.createElement(CountdownFace, { React, props: widget.props, options: widget.options, seconds, remaining: widget.remainingSeconds });
        }
    };
    if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = definition;
    return definition;
})()

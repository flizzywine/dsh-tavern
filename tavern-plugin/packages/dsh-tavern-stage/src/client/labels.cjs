'use strict';
// The 语音服务 messages (dsh-presentation-protocol tts-messages.cjs): inlined into the stage bundle, required under node.
function stageTtsMessages() {
    return typeof ttsErrorMessage === 'function' ? {ttsErrorMessage} : require('../../../dsh-presentation-protocol/src/tts-messages.cjs');
}
function createStageLabels({React, Icon, document, getComputedStyle, ResizeObserver, requestAnimationFrame, cancelAnimationFrame}) {
// HUD change moments. One step per render for a top-left label
// (place or track): the first value, a cleared label, a new session or a change outside live playback (history,
// skip) just shows; a change in place gets a new key, so the label remounts and a newer change cuts a running
// one short (latest wins). A label appearing from nothing animates only when opts.fromEmpty allows it.
function galHudStep(prev, value, opts) {
    value = value || "";
    const scope = opts && opts.scope || "";
    if (!prev || prev.scope !== scope) return { value, scope, key: prev ? prev.key + 1 : 0, from: "", animate: false };
    if (prev.value === value) return prev;
    return { value, scope, key: prev.key + 1, from: prev.value, animate: Boolean(value && opts.live && (prev.value || opts.fromEmpty)) };
}
// The place and track labels of the top-left HUD. props: { place, track: { name, usage }, scope (session), live
// (in-place playback: not history, not skipping) }. Music starting from silence animates only once the place
// already shows and the stage has been open a while (not while the first scene loads). props.music (the BGM
// player, bgm-player.js: { ref, open, paused, toggle() }) makes the track label its chip, shown even in silence;
// props.scene (the manual background, bg-manual.js: { ref, open, toggle() }) does the same for the place label.
function GalHudLabels(props) {
    const h = React.createElement;
    const openedAt = React.useRef(Date.now()), placeRef = React.useRef(null), trackRef = React.useRef(null);
    const place = props.place || "", track = props.track || null, chip = props.music || null, sceneChip = props.scene || null;
    const placeBefore = placeRef.current ? placeRef.current.value : "";
    const placeHud = placeRef.current = galHudStep(placeRef.current, place, { scope: props.scope, live: props.live });
    const trackHud = trackRef.current = galHudStep(trackRef.current, track ? track.name : "", { scope: props.scope, live: props.live,
        fromEmpty: Boolean(placeBefore) && Date.now() - openedAt.current > 1500 });
    const from = hud => hud.animate && hud.from ? h("span", { className: "fork-gal-hud-from", "aria-hidden": true }, hud.from) : null;
    // one line for place and track; phones truncate it (theme.css), wider
    // screens lay it out as before (display: contents).
    // props.only ("place" | "track") draws one half - the background and the BGM are
    // separate stage entries; the stage holds both halves in one .fork-gal-hud-line (entryDock), the track still times its
    // change moment from the place it is given.
    const placeLabel = props.only === "track" ? null : place || sceneChip ? h(sceneChip ? "button" : "span", { key: "place:" + placeHud.key, className: "fork-gal-place" + (placeHud.animate ? " is-changing" : "") + (sceneChip ? " fork-bg-chip" : ""),
            ...(sceneChip ? { ref: sceneChip.ref, type: "button", title: "背景", "aria-label": "背景" + (place ? "：" + place : ""), "aria-haspopup": "dialog", "aria-expanded": sceneChip.open, onClick: sceneChip.toggle,
                onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } } : null) },
            sceneChip ? h(Icon, { name: "image", size: 15 }) : null, place ? h("span", { className: "fork-gal-place-name" }, place) : null, from(placeHud)) : null;
    const trackLabel = props.only === "place" ? null : track || chip ? h(chip ? "button" : "span", { key: "track:" + trackHud.key, className: "fork-gal-track" + (trackHud.animate ? " is-changing" : "") + (chip ? " fork-bgm-chip" + (chip.paused ? " is-paused" : "") : ""),
            ...(chip ? { ref: chip.ref, type: "button", title: "BGM", "aria-label": "BGM" + (track ? "：" + track.name : ""), "aria-haspopup": "dialog", "aria-expanded": chip.open, onClick: chip.toggle,
                // Enter / Space open the player instead of turning the page (the stage listens on window).
                onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } } : { title: track.usage || track.name }) },
            h(Icon, { name: "music", size: 16 }), track ? h("span", { className: "fork-gal-track-name" }, track.name) : null, from(trackHud)) : null;
    return props.only ? (placeLabel || trackLabel) : h("span", { className: "fork-gal-hud-line" }, placeLabel, trackLabel);
}

// Name plate of the text box: the name (classic: 【名字】 unless in film mode), the mood tag (other themes) and,
// only when the line is voiced, a small replay button right after the name (V does the same).
// props: { name, mood, classic, film, voiceState ("" | ready | loading | playing | paused | error), voiceError, onReplay() }.
// a name as [family lead, family rest, given lead, given rest] - the
// given name is the longest of the figure's other names (aliases) that ends the name; without one the name is all family.
function galNameParts(name, character) {
    const given = (character?.aliases || []).filter(alias => typeof alias === "string" && alias.length && alias.length < name.length && name.endsWith(alias))
        .reduce((a, b) => b.length > a.length ? b : a, "");
    const family = Array.from(name.slice(0, name.length - given.length)), rest = Array.from(given);
    return [family[0] || "", family.slice(1).join(""), rest[0] || "", rest.slice(1).join("")];
}
function GalNamePlate(props) {
    const h = React.createElement;
    const state = props.voiceState || "";
    // a name longer than a fixed image plate's room (theme.css
    // 「art.nameplate.image」) is set smaller to fit (--fk-name-fit, down to .6 and never under 14 px) instead of losing its end
    // to an ellipsis. A drawn plate without a declared room (art.nameplate.w) grows with the name: its room (--fk-name-room,
    // theme.css「art name room」) ends at the box's edge, the viewport's edge and a face window beside it, whichever is nearest.
    const nameRef = React.useRef(null);
    (React.useLayoutEffect || React.useEffect)(function () {
        const b = nameRef.current;
        if (!b || !b.style) return;
        let waits = 0, frame = null;
        const fit = () => {
            // A plate still scaled down (nameplate.motion's frames, where the glyph run's rect does not scale with its box:
            // bauhaus d2's sx 0 set every new name at .6) is measured on the next frames, so a name fits the same as at rest.
            const size = () => getComputedStyle(b).writingMode.startsWith("vertical") ? [b.getBoundingClientRect().height, b.offsetHeight] : [b.getBoundingClientRect().width, b.offsetWidth];
            const [shown0, layout0] = size();
            if (layout0 > 0 && shown0 < layout0 * .98) { if (waits++ < 60 && frame === null) frame = requestAnimationFrame(() => { frame = null; if (live) fit(); }); return; }
            waits = 0;
            b.style.removeProperty("--fk-name-fit");
            b.style.removeProperty("--fk-name-room");
            const plate = b.parentElement, box = plate?.closest?.(".fork-gal-box");
            if (box && getComputedStyle(b).getPropertyValue("--fk-name-free").trim()) {
                plate.style.removeProperty("margin-left");
                const run = document.createRange();
                run.selectNodeContents(b);
                const r = b.getBoundingClientRect(), t = run.getBoundingClientRect(), p = plate.getBoundingClientRect(), edge = box.getBoundingClientRect(), gap = 6;
                // start-anchored plates grow right, end-aligned ones (sides … align end: translated back) grow left
                const end = parseFloat(getComputedStyle(plate).translate) < 0;
                let left = end ? Math.max(gap, edge.left) : gap, right = Math.min(document.defaultView.innerWidth - gap, edge.right), start = r.left;
                for (const face of box.querySelectorAll(":scope > .fork-gal-side.is-on")) {
                    const f = face.getBoundingClientRect();
                    if (f.width <= 0 || f.bottom <= p.top || f.top >= p.bottom) continue;
                    if (end) { if (f.right <= r.right) left = Math.max(left, f.right + gap); }
                    else if (f.left >= r.left) right = Math.min(right, f.left - gap);
                    else left = Math.max(left, f.right + gap);
                }
                // a start-anchored plate under a face window or off the screen's edge steps right, clear of both
                if (!end && start < left) { plate.style.marginLeft = Math.ceil(left - start) + "px"; start = left; }
                const room = Math.max(0, end ? r.right - left : right - start);
                if (t.width > room + .5) b.style.setProperty("--fk-name-room", Math.floor(room) + "px");
            }
            // Padding and spacing do not scale with the face, so narrow in a few measured steps. Measured in fractional px
            // (the glyph run plus padding against the box): whole-px scrollWidth hid a sub-px overflow that still
            // ellipsised the last glyphs (on the Vita tag).
            const range = document.createRange();
            let scale = 1;
            // a plate that grows with the name (--fk-name-free) shrinks it no further than the 14 px reading floor; a fixed plate's
            // room is the drawn tab, so its name may go to .6 rather than lose its end (a full name of up to 8 CJK glyphs).
            const free = Boolean(box && getComputedStyle(b).getPropertyValue("--fk-name-free").trim());
            const floor = free ? Math.min(1, Math.max(.6, 14 / (parseFloat(getComputedStyle(b).fontSize) || 14))) : .6;
            for (let i = 0; i < 4 && scale > floor; i++) {
                const style = getComputedStyle(b);
                range.selectNodeContents(b);
                const vertical = style.writingMode.startsWith("vertical");
                const extent = vertical ? "height" : "width";
                const padding = vertical ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
                // the run against the box on screen (a ratio: a transform scales both), the padding against its layout size in
                // fractional px (offsetWidth rounds: a short name that fits read 0.2% over and was set smaller)
                const shown = size()[0], content = parseFloat(style[extent]);
                const layout = style.boxSizing === "border-box" ? content : content + padding;
                const over = range.getBoundingClientRect()[extent] / Math.max(1, shown) + padding / Math.max(1, layout);
                if (over <= 1.001) break;
                scale = Math.max(.6, floor, Math.floor(1000 * scale / over - 10) / 1000);
                b.style.setProperty("--fk-name-fit", String(scale));
            }
        };
        fit();
        // Again once the skin's face has loaded and whenever the plate itself resizes (a skin's art applied, the window).
        let live = true;
        if (typeof document !== "undefined" && document.fonts?.ready) document.fonts.ready.then(() => { if (live) fit(); });
        const observer = typeof ResizeObserver === "function" && b.parentElement ? new ResizeObserver(fit) : null;
        observer?.observe(b.parentElement);
        return () => { live = false; if (frame !== null) cancelAnimationFrame(frame); observer?.disconnect(); };
    }, [props.name, state]);
    // The player-facing sentence for the failure code (the 语音服务 message authority); a code without one stays generic.
    const reason = state === "error" ? stageTtsMessages().ttsErrorMessage(props.voiceError) : null;
    const label = state === "error" ? (reason ? "配音失败：" + reason.replace(/。$/, "") + "；点击重试" : "配音失败，点此重试") : state === "loading" ? "语音准备中" : "重播这一句";
    const voice = state ? h("button", { type: "button", className: "fork-gal-voice", "data-state": state, title: state === "loading" ? label : label + "（V）", "aria-label": label, "aria-keyshortcuts": "V",
        onClick: event => { event.stopPropagation(); props.onReplay(); },
        // Enter / Space activate the focused button instead of turning the page (the stage listens on window).
        onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } }, state === "error" ? "⚠ 配音" : h("b", { className: "fork-gal-voice-glyph", "data-figure-ink": "4.5", "aria-hidden": true }, "\uE900")) : null;
    // The glyph stands right after the name, measured: centred on the name's ink and GAL_VOICE_GAP name em from it (galVoiceAlign).
    const plateRef = React.useRef(null);
    (React.useLayoutEffect || React.useEffect)(function () {
        const plate = plateRef.current;
        if (!state || !plate || typeof document === "undefined") return;
        galVoiceGlyphFont();
        let live = true;
        const align = () => { if (live) galVoiceAlign(plate); };
        align();
        document.fonts?.ready?.then(align);
        // again once the plate is at rest: an entrance (nameplate.motion, the box's page turn) turns and scales it as it plays
        const moving = [];
        for (let node = plate; node && node.nodeType === 1; node = node.parentElement) moving.push(...node.getAnimations?.({ subtree: node === plate }) || []);
        const ending = moving.filter(a => a.effect?.getComputedTiming?.().endTime !== Infinity).map(a => a.finished.catch(() => {}));
        if (ending.length) Promise.all(ending).then(align);
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(align) : null;
        observer?.observe(plate);
        return () => { live = false; observer?.disconnect(); };
    }, [props.name, props.mood, state]);
    if (props.classic) return h("div", { ref: plateRef, className: "fork-gal-name", "data-figure-plate": "4.5" }, h("b", { "data-figure-ink": "4.5" }, props.film ? props.name : "【" + props.name + "】"), voice);
    // every glyph of the name is its own cut-out block. The
    // block look (paint, face, size, tilt) is one of a few closed variants picked from the name itself, so a name always
    // reads the same; neighbours never repeat one. Only Latin glyphs (data-latin) take the condensed title face: it has no CJK,\n    // and a CJK fallback would come out thin. The plain name stays for screen readers; the blocks are decoration.
    if (props.ransom) {
        const glyphs = galRansomGlyphs(props.name);
        return h("div", { ref: plateRef, className: "fork-gal-name is-ransom" }, h("b", null, h("bdi", { className: "fork-gal-ransom-text" }, props.name),
            h("bdi", { className: "fork-gal-ransom", "aria-hidden": true, "data-long": glyphs.length > 7 || undefined }, galRansomBlocks(h, glyphs))), voice);
    }
    // the plate (and the emotion pill on it) is the image colour under the theme's own text:
    // figure-color-contrast.js moves the plate's lightness until that text reads (data-figure-plate).
    // art.nameplate.initials: the parts as glyph runs, sized by theme.css; the text stays the name.
    const parts = props.parts ? props.parts.map((text, index) => text ? h("i", { key: index, "data-np": ["lead", "rest", "given-lead", "given-rest"][index] }, text) : null) : props.name;
    // art.nameplate.latin (bauhaus C01): the speaker's Latin alias as a decorative layer (theme.css «art name latin»); none without one.
    const latin = props.latin ? h("i", { className: "fork-gal-name-latin", "aria-hidden": true }, props.latin) : null;
    return h("div", { ref: plateRef, className: "fork-gal-name", "data-figure-plate": "4.5" }, h("i", { className: "fork-gal-name-gem", "aria-hidden": true }), h("b", { ref: nameRef, "data-figure-ink": "4.5", "data-text": props.name }, parts), voice, props.mood ? h("span", { "data-figure-plate": "4.5", "data-figure-ink": "4.5" }, props.mood) : null, latin);
}

// The replay glyph against the name (skin checklist「语音按钮」: the icon must sit right after the name, its middle on the name's middle):
// both inks are measured - each visible text run's box with its face's own glyph bounds (canvas TextMetrics: the face's
// ascent and descent place the baseline in the run's box, the glyph's actual bounds the ink round it) - in the plate's own
// axes (the turn, skew and scale of the plate and its ancestors held off for the measurement: no paint between), and the
// button is moved so its ink's middle is the name's (a translate: no layout change) and its ink starts GAL_VOICE_GAP name
// em after the name's last ink (its margin). Box centring could not do it: a face's ascent and descent are uneven, so a
// line box's middle is not its glyphs' middle. A button the skin places itself (absolute: on a portrait frame, beside a
// vertical plate) keeps its place.
const GAL_VOICE_GAP = .45;
let galInkContext = null;
function galInk(root) {
    const context = galInkContext || (galInkContext = document.createElement("canvas").getContext("2d"));
    const range = document.createRange(), walker = document.createTreeWalker(root, document.defaultView.NodeFilter.SHOW_TEXT);
    let ink = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!node.nodeValue.trim() || el.getBoundingClientRect().width <= 1.5) continue; // a screen-reader copy (1 px, clipped)
        const s = getComputedStyle(el);
        context.font = s.fontStyle + " " + s.fontWeight + " " + s.fontSize + " " + s.fontFamily;
        // glyph by glyph (letter spacing and kerning stay out of it): the glyph's box from its own pen position, the face's
        // metrics round its baseline (the box's middle less half the ascent-descent difference)
        const value = node.nodeValue;
        for (let i = 0; i < value.length;) {
            const glyph = String.fromCodePoint(value.codePointAt(i)), end = i + glyph.length;
            if (/\S/.test(glyph)) {
                range.setStart(node, i); range.setEnd(node, end);
                const r = range.getBoundingClientRect(), m = context.measureText(glyph);
                if (r.height >= 1) {
                    const base = (r.top + r.bottom) / 2 + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2;
                    const box = [r.left - m.actualBoundingBoxLeft, base - m.actualBoundingBoxAscent, r.left + m.actualBoundingBoxRight, base + m.actualBoundingBoxDescent];
                    ink = ink ? [Math.min(ink[0], box[0]), Math.min(ink[1], box[1]), Math.max(ink[2], box[2]), Math.max(ink[3], box[3])] : box;
                }
            }
            i = end;
        }
    }
    return ink;
}
const GAL_HELD = ["transform", "rotate", "scale", "translate"];
function galVoiceAlign(plate) {
    const button = plate.querySelector(".fork-gal-voice"), glyph = button?.querySelector(".fork-gal-voice-glyph"), name = plate.querySelector("b");
    if (!glyph || !name || !document.fonts?.check?.('1em "DSH Voice Glyph"')) return;
    button.style.removeProperty("margin-inline-start");
    button.style.removeProperty("translate");
    const s = getComputedStyle(button);
    if (s.display === "none" || s.position === "absolute" || s.position === "fixed") return;
    // the plate's own axes: its and its ancestors' transforms (and the button's hover scale) held off, then put back
    const held = [button];
    for (let node = plate; node && node.nodeType === 1; node = node.parentElement) held.push(node);
    const saved = held.map(node => GAL_HELD.map(p => [p, node.style.getPropertyValue(p), node.style.getPropertyPriority(p)]));
    let a, g;
    try {
        for (const node of held) for (const p of GAL_HELD) node.style.setProperty(p, "none", "important");
        a = galInk(name); g = galInk(glyph);
    } finally {
        held.forEach((node, i) => { for (const [p, value, priority] of saved[i]) value ? node.style.setProperty(p, value, priority) : node.style.removeProperty(p); });
    }
    if (!a || !g) return;
    const dy = (g[1] + g[3] - a[1] - a[3]) / 2, gap = g[0] - a[2], want = GAL_VOICE_GAP * parseFloat(getComputedStyle(name).fontSize);
    button.style.setProperty("margin-inline-start", (parseFloat(s.marginLeft) + want - gap).toFixed(2) + "px");
    button.style.setProperty("translate", "0 " + (-dy).toFixed(2) + "px");
}

// The replay glyph as a one-glyph font (tools/voice-glyph-font.py, U+E900): the box's replay button is a character of its
// name plate, so it takes the plate's ink, outline, shadow, size and weight as the name does (skin-checklist「语音按钮」); it is
// a `b` with the name's data-figure-ink, so the rules that dress the name (.fork-gal-name b: halo, tint, lift, contrast) dress it too.
// Registered from bytes (FontFace: no font request), once, when a plate first shows the button.
const GAL_VOICE_GLYPH = "d09GMgABAAAAAAHYAAoAAAAAA3QAAAGQAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAANAqCBIIJATYCJAMICwYABCAFeAcsG8ICIJ4D7moai02bc3WRm/ipOI7RCKI1nd29YBk1oQUUrkZExck6WWXrEqN+YJzOUqIPKTHBcaEvnXElHKV8b2uAgUTbWf3pPXVTv7YG+PcU0IM+vmEDu84fsDVsCkQc+NZFFNCyW3ZJZ1SQScb/p6r6iytQjRGruGcGMFevpt25ALMDAMIpl7Cw6QT1zSlaOZjrOnR2AhAwCGl0mQCYApR/QfXvTDV0qRXH61tOAWwSWToFBG6rJaXMlBlAYQ+5bEgsjpaK/g2+MnB0YMY873J/vp7xeLhcHE6NcDRTn9+/vHiuFQrRmN0mpwuHADt3ltvssWihcPoSEIFHho/nM0kVEnmWnDl/HBolCuDG/372r1d7ITMFDN40h3qr1/3P38dAILg67GpbeM8/Alwz+H/rBLtiJsrmHYCSIGwFn/kSKwsoMptI/YqhNAHuSbLVPAkQVkhZGhBUtY2EY9tQlZY9fOQST9uj+MLuysx3WJcBETkJAj+WzeqZJPBtwa4VM7IlbdrmAB1rQLyQRPYOCA==";
let galVoiceGlyphAdded = false;
function galVoiceGlyphFont() {
    if (galVoiceGlyphAdded) return;
    galVoiceGlyphAdded = true;
    const { FontFace, atob } = document.defaultView;
    const face = new FontFace("DSH Voice Glyph", Uint8Array.from(atob(GAL_VOICE_GLYPH), c => c.charCodeAt(0)), { display: "block" });
    document.fonts.add(face);
    face.load();
}


// Ransom glyph blocks (the name plate, art.menu rows and title with letter ransom): each glyph of a word one of six closed
// variants (0..5; the first glyph is the lead), picked from the word itself so a word always reads the same, neighbours never
// the same one; whitespace is a gap. The single picker for every ransom word.
// tiles (art.menu.glyphTiles.tiles, §18 N34): each glyph also takes one of the skin's tiles ({ground, ink, weight}, by relative
// weight in list order), hashed from the glyph and its place in the word, so a word always reads the same.
function galRansomGlyphs(text, tiles) {
    const glyphs = Array.from(String(text));
    const picks = (tiles || []).flatMap((tile, index) => Array(tile.weight || 1).fill(index));
    let seed = 0, previous = -1;
    for (const glyph of glyphs) seed = (seed * 31 + glyph.codePointAt(0)) >>> 0;
    return glyphs.map((glyph, index) => {
        if (/\s/.test(glyph)) { previous = -1; return { glyph, gap: true }; }
        let variant = (seed + index * 7 + glyph.codePointAt(0)) % 6;
        if (variant === previous) variant = (variant + 1) % 6;
        previous = variant;
        const block = { glyph, r: index === 0 ? "lead" : variant, latin: /^[\x21-\x7e]$/.test(glyph) };
        if (picks.length) {
            let k = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ glyph.codePointAt(0), 0x85ebca6b);
            k = Math.imul(k ^ k >>> 13, 0xc2b2ae35);
            block.tile = picks[((k ^ k >>> 16) >>> 0) % picks.length];
        }
        return block;
    });
}
// tiles: the list the glyphs were picked from; a picked glyph carries its tile's ground and ink (theme.css «glyph tiles»).
function galRansomBlocks(h, glyphs, tiles) {
    return glyphs.map((block, index) => block.gap ? h("i", { key: index, className: "fork-gal-ransom-gap" })
        : h("i", { key: index, "data-r": block.r, "data-t": block.tile, "data-latin": block.latin || undefined,
            style: block.tile === undefined ? undefined : { "--gt-ground": tiles[block.tile].ground, "--gt-ink": tiles[block.tile].ink } }, block.glyph));
}

return {HudLabels:GalHudLabels, NamePlate:GalNamePlate, nameParts:galNameParts, ransomGlyphs:galRansomGlyphs, ransomBlocks:galRansomBlocks};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageLabels};

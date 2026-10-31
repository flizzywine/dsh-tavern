'use strict';
function createStagePortraits({React, document, window, foreground:forkForeground, SpriteImage, PackImage, emoteDataUrl:galEmoteDataUrl, cssColor:galCssColor, MutationObserver, getComputedStyle, matchMedia}) {
// Dialogue box dressing: filigree corners (generated art, runtime-assets/gal-stage) and a
// light sweep along the top edge; purely decorative.
function GalBoxFrame() {
    const h = React.createElement;
    // look / grain: the stage look pressed onto the box (vignette and haze on the edges, a light film grain).
    return h("span", { className: "fork-gal-frame", "aria-hidden": true }, h("i", { className: "look" }), h("i", { className: "grain" }), h("i", { className: "tl" }), h("i", { className: "br" }), h("i", { className: "sweep" }), h("i", { className: "bow" }),
        [0, 1, 2, 3, 4, 5].map(n => h("i", { key: n, className: "spark s" + n })));
}
// Face window at the left of the text box: the speaker's static mood avatar (the stage figure is
// already the moving portrait, so the face stays a still picture).
function GalFace(props) {
    const h = React.createElement;
    const face = props.face;
    const emote = props.emote;
    return h("div", { className: "fork-gal-face" + (face ? " is-on" : ""), "aria-hidden": true },
        face && face.spriteBundle ? h(SpriteImage, { className: "fork-gal-face-img", bundle: face.spriteBundle, audio: face.audio, enabled: face.enabled, voiceKey: face.voiceKey }) : face && face.src ? h(PackImage, { key: face.key, identity:face.identity, className: "fork-gal-face-img", src: face.src, crop:face.crop, avatar:face.avatar, alt: "" }) : null,
        // An emote for a speaker who is not standing on stage pops up on their face window instead.
        face && emote ? h("img", { key: emote.nonce, className: "fork-gal-face-emote", "data-kind": emote.kind, src: galEmoteDataUrl(emote.kind, galCssColor(emote.color)), alt: "" }) : null);
}
// Classic theme side image: the speaker's mood avatar unframed at the bottom-left, rising out of the box.
// A mood change crossfades; a new speaker slides in from the left; no face (narration) clears it quickly
// (props.clearMs, the hold of the next page's text in useGalFaceHandoff). Leaving layers stay mounted for their
// animation, then are dropped. props.snap (skip, page back / jump, a click that finished a held page): no animation,
// leaving layers go at once and a new face is simply there. props.calm: the clear is a plain fade (reduced motion).
function GalSide(props) {
    const h = React.createElement;
    const face = props.face && (props.face.src || props.face.glyph) ? props.face : null;
    const emote = props.emote;
    const seq = React.useRef(1), snap = React.useRef(false);
    snap.current = Boolean(props.snap);
    const [layers, setLayers] = React.useState(() => face ? [{ id: 0, key: face.key, identity:face.identity, src: face.src, glyph: face.glyph, crop:face.crop, avatar:face.avatar, spriteBundle: face.spriteBundle, revision: JSON.stringify(face.crop || face.spriteBundle?.revision || ""), enter: "none", out: "" }] : []);
    const faceKey = face ? face.key : "", faceSrc = face ? face.src || "glyph:" + face.glyph : "", faceIdentity = face?.identity, faceRevision = JSON.stringify(face?.crop || face?.spriteBundle?.revision || "");
    React.useLayoutEffect(function () {
        setLayers(function (list) {
            const top = list.filter(layer => !layer.out).pop() || null;
            if (!faceSrc) return snap.current ? [] : top ? list.map(layer => layer.out ? layer : Object.assign({}, layer, { out: "clear" })) : list;
            if (top && top.key === faceKey && top.identity === faceIdentity && top.revision === faceRevision) return list;
            const same = Boolean(top && top.key === faceKey);
            const next = { id: seq.current++, key: faceKey, identity:faceIdentity, src: face.src, glyph: face.glyph, crop:face?.crop, avatar:face?.avatar, spriteBundle: face && face.spriteBundle, revision: faceRevision, enter: snap.current ? "none" : same ? "fade" : "slide", out: "" };
            if (snap.current) return [next];
            // Fast paging keeps at most the two newest leaving layers.
            return list.map(layer => layer.out ? layer : Object.assign({}, layer, { out: same ? "fade" : "slide" })).slice(-2).concat([next]);
        });
        const timer = forkForeground.setTimeout(() => setLayers(list => list.filter(layer => !layer.out)), 420);
        return () => forkForeground.clearTimeout(timer);
    }, [faceKey, faceIdentity, faceRevision]);
    // A snap that arrives while a layer is still leaving drops it in the same frame (state follows, so it never returns).
    React.useLayoutEffect(function () { if (props.snap && layers.some(layer => layer.out)) setLayers(list => list.filter(layer => !layer.out)); }, [props.snap, layers]);
    const shown = props.snap ? layers.filter(layer => !layer.out) : layers;
    // the frame's caption names the 差分
    // the face shows - its readable label through the shared resolver (props.moodOf); no label, no caption.
    const mood = face && props.moodOf ? props.moodOf(face.avatar?.stateId) : "";
    // a new speaker's face (a slide-in layer) names its entrance a
    // or b by turn, so the next new face restarts the skin's frame motion (theme.css «art portrait frame motion»); a snap
    // (a click that finished the page, skip, history) drops it and the side stands at rest at once.
    const entering = shown.filter(layer => !layer.out).pop();
    const faceIn = entering && entering.enter === "slide" && !props.snap ? (entering.id % 2 ? "a" : "b") : undefined;
    // The frame waits at its first pose until the new face is decoded and shown (a crop stays hidden until its image loads),
    // so the face rides up with the frame instead of popping in mid-rise; decode() keeps the work off the entrance's frames.
    // It starts after 500 ms whatever happens, so a slow image never holds the speaker back.
    const sideRef = React.useRef(null), [shownIn, setShownIn] = React.useState(0);
    const enteringId = faceIn ? entering.id : 0;
    React.useLayoutEffect(function () {
        const root = sideRef.current;
        if (!enteringId || !root) return undefined;
        let done = false, frame = 0, revealFrame = 0;
        const start = () => { if (!done) { done = true; setShownIn(enteringId); } };
        const check = () => {
            frame = 0;
            const layer = [...root.querySelectorAll(".fork-gal-side-img:not([data-out])")].pop();
            if (layer && layer.classList.contains("fork-gal-side-glyph")) { start(); return; } // a placeholder glyph has nothing to decode
            const img = layer && (layer.tagName === "IMG" ? layer : layer.querySelector("img"));
            if (!img || !img.complete || !img.naturalWidth || img.style.visibility === "hidden") return;
            (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => { if (!done) revealFrame = forkForeground.requestAnimationFrame(start); });
        };
        const later = () => { if (!frame) frame = forkForeground.requestAnimationFrame(check); };
        root.addEventListener("load", later, true);
        const watch = new MutationObserver(later);
        watch.observe(root, { subtree: true, attributes: true, attributeFilter: ["style", "src"] });
        check();
        const cap = forkForeground.setTimeout(start, 500);
        return () => { done = true; root.removeEventListener("load", later, true); watch.disconnect(); forkForeground.clearTimeout(cap); if (frame) forkForeground.cancelAnimationFrame(frame); if (revealFrame) forkForeground.cancelAnimationFrame(revealFrame); };
    }, [enteringId]);
    return h("div", { ref: sideRef, className: "fork-gal-side" + (face ? " is-on" : "") + (props.calm ? " is-calm" : ""), "aria-hidden": true, "data-face-in": faceIn, "data-face-wait": faceIn && shownIn !== enteringId ? "" : undefined, style: props.clearMs ? { "--gal-face-clear-ms": props.clearMs + "ms" } : undefined },
        // identify each layer so its orientation follows its own stage actor.
        shown.map(layer => layer.glyph ? h("span", { key: layer.id, "data-face-actor": layer.key, className: "fork-gal-side-img fork-gal-side-glyph", "data-enter": layer.enter, "data-out": layer.out || undefined }, h("b", null, layer.glyph)) : layer.spriteBundle ? h(SpriteImage, { key: layer.id, faceActor: layer.key, className: "fork-gal-side-img", bundle: !layer.out && face?.identity === layer.identity ? face.spriteBundle : layer.spriteBundle, enter: layer.enter, out: layer.out, audio: !layer.out && face ? face.audio : null, enabled: !layer.out && face && face.enabled, voiceKey: !layer.out && face ? face.voiceKey : "out:" + layer.id }) : h(PackImage, { key: layer.id, identity:layer.identity, "data-face-actor": layer.key, cropOverflow:true, className: "fork-gal-side-img", "data-enter": layer.enter, "data-out": layer.out || undefined, src: !layer.out && face?.identity === layer.identity ? face.src : layer.src, crop:!layer.out && face?.identity === layer.identity ? face.crop : layer.crop, avatar:!layer.out && face?.identity === layer.identity ? face.avatar : layer.avatar, alt: "", draggable: false })),
        face && emote ? h("img", { key: "e" + emote.nonce, className: "fork-gal-face-emote", "data-kind": emote.kind, src: galEmoteDataUrl(emote.kind, galCssColor(emote.color)), alt: "" }) : null,
        mood ? h("span", { key: "mood", className: "fork-gal-side-mood" }, mood) : null,
        // the frame's masked part in the speaker colour, a layer of the side itself.
        face && props.tint ? h("i", { key: "tint", className: "fork-gal-side-tint" }) : null,
        face && props.nameArc && props.name ? h(GalSideName, { key: "name", arc: props.nameArc, name: props.name }) : null);
}
// the speaker's name set along the frame's circle, in the
// frame image's own px (the svg covers the side, which is the frame): the glyphs' middles on the circle, centred on its lowest
// (or highest) point; engraved - a dark copy a hair above, a light one below, the ink (a gradient down the glyphs) on top. Any
// name (live text: two glyphs or eight, CJK or Latin) stays inside the span's arc, never over the frame's ornaments past it:
// set smaller first, down to .72; then its tracking closed, down to -.04em; then smaller again as far as it takes (to the
// skin's min, default .25 of the font); past that (or a measure off by a hair) pressed to the arc - narrower glyphs at the
// same height. Legibility (skin-interface.md「框上的名字」): bed = a soft dark band under the run (the channel darkened behind
// it); stroke = an outline on the ink itself (paint-order: stroke, then fill - one crisp vector edge); shadow = one hard copy
// of the outlined glyphs offset behind them. Nothing over the glyphs is filtered or rasterised: the bed's blur is its own
// layer under them (an svg filter on the ink softened its whole edge - measured 2.75 px against 1.65 px). The plain line
// beside it is the same name for a phone's small side (theme.css: shown under the side there, never with the arc).
// Decoration only: the box's plate keeps the name for screen readers.
function GalSideName(props) {
    const h = React.createElement, a = props.arc, name = String(props.name);
    const id = "fk-face-name-" + React.useId().replace(/[^a-z0-9]/gi, "");
    const ink = React.useRef(null), [fit, setFit] = React.useState({ name: "", scale: 1, spacing: a.spacing, press: 0 });
    const top = a.side === "top", room = a.r * a.span * Math.PI / 180;
    (React.useLayoutEffect || React.useEffect)(function () {
        const text = ink.current;
        if (!text || typeof document === "undefined") return;
        let live = true;
        // The run measured at the full size in the glyphs' own face (a canvas: the svg's run is already fitted), so a refit
        // never reads its own result; the length scales with the size.
        const measure = () => {
            const context = live && document.createElement("canvas").getContext("2d");
            if (!context) return;
            context.font = a.weight + " " + a.font + "px " + getComputedStyle(text).fontFamily;
            // the run at full size: its glyphs alone, and its gaps (one spacing after every glyph, as the svg sets it)
            const glyphs = context.measureText(name).width, gaps = Array.from(name).length * a.font, run = em => glyphs + em * gaps;
            let scale = 1, spacing = a.spacing;
            // a phone's own floor (narrow.nameMin, CSS px): the frame px it takes at the side's drawn scale
            const svg = text.ownerSVGElement, k = svg && svg.getScreenCTM ? svg.getScreenCTM()?.a : 0;
            const phone = a.narrowMin && k > 0 && typeof matchMedia === "function" && matchMedia("(max-width: 640px)").matches ? a.narrowMin / k : 0;
            const floor = Math.min(1, Math.max(a.min || a.font * .25, phone) / a.font);
            if (run(spacing) > room) scale = Math.max(.72, floor, room / run(spacing));
            if (run(spacing) * scale > room) spacing = Math.max(-.04, Math.min(spacing, (room / scale - glyphs) / gaps));
            if (run(spacing) * scale > room) scale = Math.max(floor, Math.min(scale, room / run(spacing)));
            scale = Math.round(scale * 1000) / 1000; spacing = Math.round(spacing * 1000) / 1000;
            const press = run(spacing) * scale > room + .5 ? Math.round(room) : 0;
            setFit(previous => previous.name === name && previous.scale === scale && previous.spacing === spacing && previous.press === press ? previous : { name, scale, spacing, press });
        };
        measure();
        if (typeof document !== "undefined" && document.fonts?.ready) document.fonts.ready.then(measure);
        // the side's drawn scale changes with the viewport (a phone's floor is in CSS px)
        const resized = () => measure();
        if (a.narrowMin && typeof window !== "undefined") window.addEventListener("resize", resized);
        return () => { live = false; if (a.narrowMin && typeof window !== "undefined") window.removeEventListener("resize", resized); };
    }, [name, room, a.narrowMin]);
    const scale = fit.name === name ? fit.scale : 1, press = fit.name === name ? fit.press : 0, spacing = fit.name === name ? fit.spacing : a.spacing;
    const point = angle => [a.x + a.r * Math.cos(angle * Math.PI / 180), a.y + a.r * Math.sin(angle * Math.PI / 180)].map(n => Math.round(n * 100) / 100).join(" ");
    // Left to right: under the middle the way runs counter-clockwise (the glyphs' tops toward the centre), over it clockwise.
    const from = top ? 270 - a.span / 2 : 90 + a.span / 2, to = top ? 270 + a.span / 2 : 90 - a.span / 2;
    const path = "M" + point(from) + " A" + a.r + " " + a.r + " 0 " + (a.span > 180 ? 1 : 0) + " " + (top ? 1 : 0) + " " + point(to);
    const size = a.font * scale, shift = Math.round(a.font * .045 * 100) / 100;
    const layer = (key, fill, dy, extra) => h("text", Object.assign({ key, ref: key === "ink" ? ink : undefined, className: "fork-gal-side-name-" + key, fill, transform: dy ? "translate(0 " + dy + ")" : undefined,
        textLength: press || undefined, lengthAdjust: press ? "spacingAndGlyphs" : undefined, dominantBaseline: "central", textAnchor: "middle",
        "data-fit": scale + " " + spacing, style: { fontSize: size + "px", fontWeight: a.weight, letterSpacing: spacing + "em" } }, extra), h("textPath", { href: "#" + id, startOffset: "50%" }, name));
    const box = { x: "-25%", y: "-60%", width: "150%", height: "220%" };
    const outline = color => a.stroke ? { stroke: color, strokeWidth: a.stroke.width * 2, strokeLinejoin: "round", paintOrder: "stroke fill" } : {};
    return h(React.Fragment, null,
        h("svg", { className: "fork-gal-side-name", viewBox: "0 0 " + a.view[0] + " " + a.view[1], "aria-hidden": true, focusable: "false" },
            h("defs", null, h("path", { id, d: path, fill: "none" }),
                h("linearGradient", { id: id + "-ink", x1: 0, y1: 0, x2: 0, y2: 1 }, h("stop", { offset: 0, stopColor: a.ink[0] }), h("stop", { offset: 1, stopColor: a.ink[1] || a.ink[0] })),
                a.bed ? h("filter", Object.assign({ id: id + "-bed" }, box), h("feGaussianBlur", { stdDeviation: Math.round(a.bed.width * 25) / 100 }),
                    h("feComponentTransfer", null, h("feFuncA", { type: "linear", slope: a.bed.alpha }))) : null,
                null),
            a.bed ? layer("bed", a.bed.color, 0, { stroke: a.bed.color, strokeWidth: Math.max(0, a.bed.width - size), strokeLinejoin: "round", filter: "url(#" + id + "-bed)" }) : null,
            a.engrave ? layer("dark", a.engrave.dark, -shift) : null,
            a.engrave ? layer("light", a.engrave.light, shift) : null,
            a.shadow ? layer("shadow", a.shadow.color, 0, Object.assign({ transform: "translate(" + a.shadow.dx + " " + a.shadow.dy + ")" }, outline(a.shadow.color))) : null,
            layer("ink", "url(#" + id + "-ink)", 0, a.stroke ? outline(a.stroke.color) : undefined)),
        h("span", { className: "fork-gal-side-caption", style: { "--name-len": Array.from(name).length } }, name));
}
// the stand-in face for a named line without one - the skin's
// image, or (initial) the engine's disc with the displayed name's first letter (a Latin one upper-cased); keyed by the name,
// so a change of speaker enters as a new face does. Display only: the avatar resolver stays the one source of faces.
function galPlaceholderFace(spec, name) {
    const key = "placeholder:" + name;
    if (spec.image) return { key, identity: key, src: spec.image };
    const glyph = (String(name).match(/[\p{L}\p{N}]/u) || Array.from(String(name)))[0] || "";
    return glyph ? { key, identity: key, src: "", glyph: glyph.toUpperCase() } : null;
}

return {Face:GalFace, Side:GalSide, SideName:GalSideName, BoxFrame:GalBoxFrame, placeholderFace:galPlaceholderFace};
}
if (typeof module !== "undefined" && typeof window === "undefined") module.exports = {createStagePortraits};

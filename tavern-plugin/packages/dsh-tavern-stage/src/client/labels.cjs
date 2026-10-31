'use strict';
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
// only when the line is voiced, a small replay button right after the name (R does the same).
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
    // 「art.nameplate.image」) is set smaller to fit (--fk-name-fit, down to .6) instead of losing its end to an ellipsis.
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
            // Padding and spacing do not scale with the face, so narrow in a few measured steps. Measured in fractional px
            // (the glyph run plus padding against the box): whole-px scrollWidth hid a sub-px overflow that still
            // ellipsised the last glyphs (on the Vita tag).
            const range = document.createRange();
            let scale = 1;
            for (let i = 0; i < 4 && scale > .6; i++) {
                const style = getComputedStyle(b);
                range.selectNodeContents(b);
                const vertical = style.writingMode.startsWith("vertical");
                const extent = vertical ? "height" : "width";
                const padding = vertical ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
                // the run against the box on screen (a ratio: a transform scales both), the padding against its layout size
                const [shown, layout] = size();
                const over = range.getBoundingClientRect()[extent] / Math.max(1, shown) + padding / Math.max(1, layout);
                if (over <= 1.001) break;
                scale = Math.max(.6, Math.floor(1000 * scale / over - 10) / 1000);
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
    const reason = {VOICE_NOT_FOUND:"声音绑定未解析，请重新选择该人物的声音","voice-unbound":"声音绑定未解析，请重新选择该人物的声音",QWEN_MODEL_NOT_FOUND:"Qwen 配音模型不存在，请在声音预设中选择服务当前提供的模型",QWEN_AUDIO_NOT_FOUND:"Qwen 合成音频下载失败（404），请重试",QWEN_RESOURCE_NOT_FOUND:"Qwen 语音服务资源不存在（404），请检查区域、模型与音色",FISH_AUTH_FAILED:"Fish Audio 密钥无效（401）",FISH_BILLING_REQUIRED:"Fish Audio 额度或余额不足（402），未切换付费模型",FISH_RATE_LIMITED:"Fish Audio 请求受限（429），请稍后重试",FISH_REQUEST_FAILED:"Fish Audio 请求失败，请检查声音模型 ID 与服务状态",QWEN_BILLING_REQUIRED:"千问额度或账户余额不足，请检查阿里云用量与账单",QWEN_AUTH_FAILED:"千问密钥无效",QWEN_RATE_LIMITED:"千问请求过于频繁或达到限额",QWEN_ACCESS_DENIED:"千问访问被拒绝，请检查模型权限与账户状态",QWEN_REQUEST_FAILED:"千问服务请求失败",SERVICE_OFFLINE:"配音服务暂时不可用",TIMEOUT:"配音请求超时"}[props.voiceError] || props.voiceError || "配音服务暂时不可用";
    const label = state === "error" ? "配音失败：" + reason + "；点击重试" : state === "loading" ? "语音准备中" : "重播这一句";
    const voice = state ? h("button", { type: "button", className: "fork-gal-voice", "data-state": state, title: state === "loading" ? label : label + "（R）", "aria-label": label, "aria-keyshortcuts": "R",
        onClick: event => { event.stopPropagation(); props.onReplay(); },
        // Enter / Space activate the focused button instead of turning the page (the stage listens on window).
        onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } }, state === "error" ? "⚠ 配音" : h(Icon, { name: "speaker", size: 14 })) : null;
    if (props.classic) return h("div", { className: "fork-gal-name", "data-figure-plate": "4.5" }, h("b", { "data-figure-ink": "4.5" }, props.film ? props.name : "【" + props.name + "】"), voice);
    // every glyph of the name is its own cut-out block. The
    // block look (paint, face, size, tilt) is one of a few closed variants picked from the name itself, so a name always
    // reads the same; neighbours never repeat one. Only Latin glyphs (data-latin) take the condensed title face: it has no CJK,\n    // and a CJK fallback would come out thin. The plain name stays for screen readers; the blocks are decoration.
    if (props.ransom) {
        const glyphs = Array.from(String(props.name));
        let seed = 0, previous = -1;
        for (const glyph of glyphs) seed = (seed * 31 + glyph.codePointAt(0)) >>> 0;
        const blocks = glyphs.map((glyph, index) => {
            if (/\s/.test(glyph)) { previous = -1; return h("i", { key: index, className: "fork-gal-ransom-gap" }); }
            let variant = (seed + index * 7 + glyph.codePointAt(0)) % 6;
            if (variant === previous) variant = (variant + 1) % 6;
            previous = variant;
            return h("i", { key: index, "data-r": index === 0 ? "lead" : variant, "data-latin": /^[\x21-\x7e]$/.test(glyph) || undefined }, glyph);
        });
        return h("div", { className: "fork-gal-name is-ransom" }, h("b", null, h("bdi", { className: "fork-gal-ransom-text" }, props.name),
            h("bdi", { className: "fork-gal-ransom", "aria-hidden": true, "data-long": glyphs.length > 7 || undefined }, blocks)), voice);
    }
    // the plate (and the emotion pill on it) is the image colour under the theme's own text:
    // figure-color-contrast.js moves the plate's lightness until that text reads (data-figure-plate).
    // art.nameplate.initials: the parts as glyph runs, sized by theme.css; the text stays the name.
    const parts = props.parts ? props.parts.map((text, index) => text ? h("i", { key: index, "data-np": ["lead", "rest", "given-lead", "given-rest"][index] }, text) : null) : props.name;
    return h("div", { className: "fork-gal-name", "data-figure-plate": "4.5" }, h("i", { className: "fork-gal-name-gem", "aria-hidden": true }), h("b", { ref: nameRef, "data-figure-ink": "4.5", "data-text": props.name }, parts), props.mood ? h("span", { "data-figure-plate": "4.5", "data-figure-ink": "4.5" }, props.mood) : null, voice);
}


return {HudLabels:GalHudLabels, NamePlate:GalNamePlate, nameParts:galNameParts};
}
if (typeof window === 'undefined' && typeof module !== 'undefined') module.exports = {createStageLabels};

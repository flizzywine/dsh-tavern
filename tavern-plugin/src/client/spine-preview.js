// the 素材库 figure editor's Spine reader and live preview. The asset-pack
// factory gets them through forkSpineKit() (injected like the Live2D preview kit). A `source` is {identity, open()}:
// open() resolves {source, close()} where `source` is spineSources(leaseUrl) or forkSpineLocalSource(files, entry).

// The skeleton's names (animations, skins, slots), read once per source identity.
const spineInfoCache = new Map();
function spineInspect(source) {
    if (spineInfoCache.has(source.identity)) return spineInfoCache.get(source.identity);
    const job = (async function () {
        const opened = await source.open();
        try {
            const loaded = await spineLoadData(null, opened.source), data = loaded.data;
            loaded.textures.forEach(texture => texture.destroy());
            return { version: data.version || "", animations: data.animations.map(item => item.name), skins: data.skins.map(item => item.name), slots: data.slots.map(item => item.name) };
        } finally { if (opened.close) opened.close(); }
    })();
    spineInfoCache.set(source.identity, job);
    job.catch(() => spineInfoCache.delete(source.identity));
    while (spineInfoCache.size > 32) spineInfoCache.delete(spineInfoCache.keys().next().value);
    return job;
}
// Live preview on a small pixi canvas, framed like the stage body (same frame, hidden slots and bottom fade).
// props: {source, config: outfit spine block (defaultAnimation, hideSlots, skin, frame, anatomy, bottomFade),
// animation (track 0), talk, talking (track 1 on while true), label}. The rig reloads only when its geometry changes.
function SpinePreview(props) {
    const h = React.createElement, host = React.useRef(null), latest = React.useRef(props);
    latest.current = props;
    const [status, setStatus] = React.useState("loading");
    const source = props.source, config = props.config || {};
    const geometry = JSON.stringify([source && source.identity, config.defaultAnimation || "", config.hideSlots || [], config.skin || null, config.frame || null, config.anatomy || null, config.bottomFade ?? null]);
    React.useEffect(function () {
        let live = true, opened = null, figure = null, app = null, stopRatio = null;
        setStatus("loading");
        (async function () {
            opened = await source.open();
            if (!live) return;
            const loaded = await spineLoadData(null, opened.source), PIXI = window.PIXI;
            if (!live || !host.current) { loaded.textures.forEach(texture => texture.destroy()); return; }
            figure = spineFigure(PIXI, loaded, config);
            app = new PIXI.Application({ resizeTo: host.current, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: galResolution("high") });
            stopRatio = galFollowResolution(app);
            host.current.appendChild(app.view);
            const frame = spineFrame(figure.spine, config.frame), anatomy = config.anatomy || null;
            const measured = anatomy ? null : spineMeasure(figure.spine, frame, geometry, app.renderer, PIXI);
            const fade = packSpineBottomFade(config.bottomFade, anatomy, measured && measured.candidate.auto, frame[3]);
            if (fade) spineBottomFade(PIXI, figure, frame, fade);
            const body = spineBody(PIXI, figure.spine, frame);
            app.stage.addChild(body);
            app.ticker.add(function () {
                const p = latest.current, W = app.screen.width, H = app.screen.height, pad = Math.round(H * 0.04);
                body.scale.set(Math.max(0.01, Math.min((W - pad * 2) / frame[2], (H - pad * 2) / frame[3])));
                body.position.set(W / 2, H - pad);
                figure.mood(p.animation);
                figure.voice(p.talking ? 1 : 0, p.talk, performance.now());
                figure.update(app.ticker.deltaMS / 1000);
            });
            setStatus("ready");
        })().catch(function (error) { if (live) { console.warn("Spine preview", error); setStatus("error"); } });
        return function () {
            live = false;
            if (figure) figure.destroy();
            stopRatio?.();
            if (app) app.destroy(true, { children: true });
            if (opened && opened.close) opened.close();
        };
    }, [geometry]);
    return h("div", { className: "fork-spine-preview", "data-status": status, role: "img", "aria-label": props.label || "Spine", "aria-busy": status === "loading" || undefined },
        h("div", { className: "fork-spine-preview-canvas", ref: host, "aria-hidden": true }),
        status === "loading" ? h(Spinner, { key: source && source.identity || "", fill: true }) : null,
        status === "error" ? h("span", { className: "ap-hint-chip fork-spine-preview-error", role: "alert" }, "⚠ 无法预览这个模型") : null);
}
function forkSpineKit() { return { Preview: SpinePreview, inspect: spineInspect, localSource: (...args) => forkSpineLocalSource(...args), leaseSource: (...args) => spineSources(...args) }; }

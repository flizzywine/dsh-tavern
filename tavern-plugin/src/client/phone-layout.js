// where and how big the stage phone is, on this
// device. A browser preference (localStorage, never the chat, the card or the director), kept per layout - wide (a desktop
// window) and narrow (a phone, under 700px) each remember their own size (percent of the automatic band size, 50–150; narrow
// 70–150: smaller is too cramped on a phone, and a smaller stored value reads as 70) and
// place (fractions of the free stage, as stageWidgetPlaces, so a resize keeps the phone inside); `unlocked` lets the reader
// drag the phone by its edge (gal-widgets.js ring) and nudge it with the arrow keys. Without a place the phone sits
// centred in the band above the dialogue box as before, so by default it never covers the box; a moved phone stays where
// it was put. The stage CONFIG › 模组 › 手机 section edits it (ui-design R21: a per-play, often-adjusted setting).
const PHONE_SIZE = Object.freeze({ min: 50, narrowMin: 70, max: 150, step: 5, default: 100 });
// The smallest size percent of a layout ("wide" / "narrow").
function phoneModSizeMin(name) { return name === "narrow" ? PHONE_SIZE.narrowMin : PHONE_SIZE.min; }
const phoneModPrefs = (function () {
    const KEY = "fork-phone-layout", listeners = new Set(); let cached = null;
    const layout = (saved, name) => ({ size: Number.isFinite(saved?.size) ? Math.min(PHONE_SIZE.max, Math.max(phoneModSizeMin(name), Math.round(saved.size))) : PHONE_SIZE.default,
        place: Array.isArray(saved?.place) && saved.place.length === 2 && saved.place.every(n => Number.isFinite(n) && n >= 0 && n <= 1) ? saved.place : null });
    const normalize = saved => ({ unlocked: saved?.unlocked === true, wide: layout(saved?.wide, "wide"), narrow: layout(saved?.narrow, "narrow") });
    function get() {
        if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = normalize(saved); }
        return cached;
    }
    function set(patch) {
        cached = normalize({ ...get(), ...patch });
        try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
        for (const listener of listeners) listener();
    }
    return { get, set, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        // The layout the stage is in: narrow under 700px (the widget owner's own narrow test).
        current(width) { return (width ?? innerWidth) < 700 ? "narrow" : "wide"; },
        // One layout's entry changed (size / place); null place forgets the reader's spot.
        update(name, patch) { set({ [name]: { ...get()[name], ...patch } }); } };
})();
function usePhonePrefs() { return React.useSyncExternalStore(phoneModPrefs.subscribe, phoneModPrefs.get, phoneModPrefs.get); }

// the direct path.
// A long press (holdMs) on the open stage phone's frame - the edge ring over its bezel - or its status bar (time, signal,
// battery: no controls) enters adjust mode, the one `unlocked` state CONFIG's switch also sets: a short pulse and the outline,
// a haptic tick on touch, and the same press goes on as a drag. App content (lists, messages, the call button) has no hit
// area over it, so its own taps, scrolls and long presses are untouched. In adjust mode a cover takes the whole phone (the
// apps rest): one pointer drags, two fingers pinch, the corner handle or the wheel (+ / - keys) resize within 50–150%, the
// phone always clamped on stage. The wheel zooms wherever it lands on the stage (over the phone or the dimmed stage around
// it, never the phone's content scroll while adjusting); each 5% step glides there. A gesture paints a translate/scale preview and stores once, on release (size, and the spot
// where it was left). Letting go and doing nothing for idleMs, a press outside the phone or Esc locks it again and the outline
// fades. A touch hold that keeps still on to menuMs opens the widget menu, as a long press did before (mouse: right-click).
const PHONE_ADJUST = Object.freeze({ holdMs: 500, menuMs: 1100, idleMs: 2500, slop: 6, wheelPx: 100, glideMs: 160 });
function usePhoneAdjust(item, owner, panel, menu) {
    const h = React.createElement, unlocked = Boolean(item.unlocked);
    const pointers = React.useRef(new Map()), tracking = React.useRef(null), gesture = React.useRef(null), idle = React.useRef(0), wheel = React.useRef(0), pending = React.useRef(0), frame = React.useRef(0), pulse = React.useRef(null), glide = React.useRef(null), live = React.useRef(null);
    live.current = { item, owner, menu };
    const lockNow = () => { clearTimeout(idle.current); idle.current = 0; live.current.owner.adjust(false); };
    const arm = () => { clearTimeout(idle.current); idle.current = setTimeout(lockNow, PHONE_ADJUST.idleMs); };
    const unpaint = () => {
        clearTimeout(pending.current); pending.current = 0;
        const node = panel.current; if (!node) return;
        node.classList.remove("is-dragging"); node.style.translate = node.style.scale = node.style.transformOrigin = "";
    };
    // The preview is a paint-only translate/scale from the laid-out rect; the stored layout replaces it in the same frame.
    const paint = () => {
        if (frame.current) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            const node = panel.current, from = live.current.item.bounds, g = gesture.current;
            if (!node || !from || !g?.rect) return;
            node.classList.add("is-dragging"); node.style.transformOrigin = "0 0";
            node.style.translate = (g.rect.x - from.x) + "px " + (g.rect.y - from.y) + "px"; node.style.scale = String(g.rect.width / from.width);
        });
    };
    // A wheel / key step glides from the rect it left (FLIP) once the stored size is laid out.
    React.useLayoutEffect(() => {
        if (pending.current) unpaint();
        const from = glide.current, to = item.bounds, node = panel.current; glide.current = null;
        if (!from || !to || !node || item.presentation.reducedMotion) return;
        const at = { transformOrigin: "0 0", translate: (from.x - to.x) + "px " + (from.y - to.y) + "px", scale: String(from.width / to.width) };
        node.animate([at, { transformOrigin: "0 0", translate: "0px 0px", scale: "1" }], { duration: PHONE_ADJUST.glideMs, easing: "cubic-bezier(.2,.8,.2,1)" });
    }, [item.bounds?.x, item.bounds?.y, item.bounds?.width, item.bounds?.height]);
    // A rect `scale` times `origin` about `anchor`, moved by (dx, dy): kept within the layout's min–150% of the band size and on stage.
    const shape = (origin, scale, anchor, dx, dy) => {
        const v = live.current.owner.viewport, base = live.current.item.phoneBase, pad = STAGE_WIDGET_PLACE_PAD;
        const max = Math.min(base.width * PHONE_SIZE.max / 100, v.width - 2 * pad, (v.height - 2 * pad) * origin.width / origin.height);
        const s = Math.max(base.width * base.min / 100, Math.min(max, origin.width * scale)) / origin.width, width = origin.width * s, height = origin.height * s;
        const x = anchor.x - (anchor.x - origin.x) * s + dx, y = anchor.y - (anchor.y - origin.y) * s + dy;
        return { x: Math.min(v.x + v.width - pad - width, Math.max(v.x + pad, x)), y: Math.min(v.y + v.height - pad - height, Math.max(v.y + pad, y)), width, height };
    };
    // The stored percent is a whole number: the rect is redrawn at that size (as the layout will draw it) about its anchor -
    // the top-left for the corner handle, else the centre - so the spot does not drift by the rounding.
    const store = (size, shown, anchor) => {
        const { item, owner } = live.current, b = item.bounds, v = owner.viewport, pad = STAGE_WIDGET_PLACE_PAD, ratio = shown.width / shown.height;
        const width = Math.min(item.phoneBase.width * size / 100, v.width - 2 * pad, (v.height - 2 * pad) * ratio), height = width / ratio;
        const rect = anchor === "corner" ? { x: shown.x, y: shown.y, width, height } : { x: shown.x + (shown.width - width) / 2, y: shown.y + (shown.height - height) / 2, width, height };
        const same = size === item.phoneBase.size && Math.abs(rect.x - b.x) < .5 && Math.abs(rect.y - b.y) < .5 && Math.abs(rect.width - b.width) < .5;
        if (same) { unpaint(); return false; }
        clearTimeout(pending.current); pending.current = setTimeout(unpaint, 400);
        owner.resize(item.key, size, rect);
        return true;
    };
    const sizeOf = rect => Math.min(PHONE_SIZE.max, Math.max(live.current.item.phoneBase.min, Math.round(100 * rect.width / live.current.item.phoneBase.width)));
    const enter = g => {
        const { item, owner } = live.current;
        owner.adjust(true);
        if (g.touch) try { navigator.vibrate?.(12); } catch (_) {}
        if (!item.presentation.reducedMotion) pulse.current = panel.current?.animate([{ scale: "1" }, { scale: "1.03" }, { scale: "1" }], { duration: 240, easing: "ease-out" }) || null;
        if (g.touch) g.timer = setTimeout(() => toMenu(g), PHONE_ADJUST.menuMs - PHONE_ADJUST.holdMs);
    };
    const toMenu = g => {
        if (g.moved || gesture.current !== g) return;
        g.cancelled = true; g.menu = true; lockNow(); live.current.menu(g.x, g.y, true);
    };
    const k = () => {
        // Stage units per screen pixel: a docked stage is only scaled (createModStageDock).
        const stage = panel.current?.closest(".fork-gal-stage"), outer = stage?.getBoundingClientRect();
        return outer && outer.width > 0 && Math.abs(outer.width - stage.offsetWidth) >= 1 ? stage.offsetWidth / outer.width : 1;
    };
    // The gesture's pointers are followed on the window, not on the grip pressed: entering adjust mode swaps the ring for the
    // cover, which unmounts that grip (and its pointer capture), and a drag that outruns the cover's edge must still move the phone.
    const track = () => {
        if (tracking.current) return;
        const win = panel.current?.ownerDocument.defaultView || window, onMove = event => move(event), onUp = event => up(event, false), onCancel = event => up(event, true);
        win.addEventListener("pointermove", onMove, true); win.addEventListener("pointerup", onUp, true); win.addEventListener("pointercancel", onCancel, true);
        tracking.current = () => { win.removeEventListener("pointermove", onMove, true); win.removeEventListener("pointerup", onUp, true); win.removeEventListener("pointercancel", onCancel, true); tracking.current = null; };
    };
    const down = (event, kind) => {
        panel.current?.setAttribute("data-pointer", "");
        if (event.button !== 0) return;
        event.stopPropagation(); event.currentTarget.setPointerCapture?.(event.pointerId); track();
        const { item } = live.current, old = gesture.current;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        clearTimeout(idle.current);
        if (pointers.current.size >= 2) {
            // A second finger turns the gesture into a pinch about the phone's centre (adjust mode only), from where it is now.
            if (!item.unlocked && !old?.entered) return;
            clearTimeout(old?.timer); pulse.current?.cancel();
            const [a, b] = [...pointers.current.values()], origin = old?.rect || item.bounds;
            gesture.current = { mode: "pinch", k: k(), origin: { ...origin }, dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, entered: true, rect: old?.rect || null };
            return;
        }
        const g = { mode: kind === "corner" ? "corner" : "drag", id: event.pointerId, k: k(), touch: event.pointerType !== "mouse", x: event.clientX, y: event.clientY, origin: { ...item.bounds }, entered: item.unlocked, moved: false, cancelled: false, timer: 0, rect: null };
        if (kind === "corner") pulse.current?.cancel();
        if (!g.entered) g.timer = setTimeout(() => { g.entered = true; enter(g); }, PHONE_ADJUST.holdMs);
        else if (g.touch && kind !== "corner") g.timer = setTimeout(() => toMenu(g), PHONE_ADJUST.holdMs);
        gesture.current = g;
    };
    const move = event => {
        const point = pointers.current.get(event.pointerId); if (!point) return;
        point.x = event.clientX; point.y = event.clientY;
        const g = gesture.current; if (!g || g.cancelled) return;
        if (g.mode === "pinch") {
            const [a, b] = [...pointers.current.values()]; if (!b) return;
            const centre = { x: g.origin.x + g.origin.width / 2, y: g.origin.y + g.origin.height / 2 };
            g.rect = shape(g.origin, Math.hypot(b.x - a.x, b.y - a.y) / g.dist, centre, ((a.x + b.x) / 2 - g.mid.x) * g.k, ((a.y + b.y) / 2 - g.mid.y) * g.k);
            paint(); return;
        }
        if (g.id !== event.pointerId) return;
        const dx = (event.clientX - g.x) * g.k, dy = (event.clientY - g.y) * g.k;
        if (!g.moved && Math.hypot(dx, dy) < PHONE_ADJUST.slop) return;
        clearTimeout(g.timer);
        // Moving before the hold completes is not a long press: the locked phone stays where it is.
        if (!g.entered) { g.cancelled = true; return; }
        g.moved = true;
        g.rect = g.mode === "corner" ? shape(g.origin, ((g.origin.width + dx) / g.origin.width + (g.origin.height + dy) / g.origin.height) / 2, g.origin, 0, 0) : shape(g.origin, 1, g.origin, dx, dy);
        paint();
    };
    const up = (event, cancelled) => {
        if (!pointers.current.delete(event.pointerId)) return;
        if (!pointers.current.size) tracking.current?.();
        const g = gesture.current; if (!g || g.mode !== "pinch" && g.id !== event.pointerId) return;
        gesture.current = null; clearTimeout(g.timer); cancelAnimationFrame(frame.current); frame.current = 0;
        if (g.rect && !cancelled) store(g.mode === "drag" ? live.current.item.phoneBase.size : sizeOf(g.rect), g.rect, g.mode);
        else unpaint();
        if (g.entered && !g.menu) arm();
    };
    const reset = event => { event.stopPropagation(); if (live.current.item.placed) live.current.owner.place(live.current.item.key, null, null); };
    // One wheel notch (or + / -) is 5%, about the phone's centre.
    const step = steps => {
        const { item } = live.current, base = item.phoneBase, b = item.bounds;
        const size = Math.min(PHONE_SIZE.max, Math.max(base.min, Math.round((base.size + steps * PHONE_SIZE.step) / PHONE_SIZE.step) * PHONE_SIZE.step));
        if (size !== base.size) glide.current = store(size, shape(b, base.width * size / 100 / b.width, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 0, 0)) ? { ...b } : null;
        arm();
    };
    const zoom = event => {
        wheel.current += event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 400 : 1);
        const steps = Math.trunc(wheel.current / PHONE_ADJUST.wheelPx);
        if (steps) { wheel.current -= steps * PHONE_ADJUST.wheelPx; step(-steps); } else arm();
    };
    React.useEffect(() => {
        if (!unlocked) return undefined;
        // A press outside the phone locks it; on the bare stage that press only locks and does not also turn the page.
        const doc = panel.current?.ownerDocument || document, swallow = event => { event.stopPropagation(); event.preventDefault(); };
        const outside = event => {
            const node = panel.current, target = event.target;
            if (!node || node.contains(target) || target?.closest?.(".fork-gal-config, .fork-widget-context, .fork-widget-context-veil")) return;
            lockNow();
            if (!target?.closest?.("button, input, select, textarea, a, [role=button]")) {
                doc.addEventListener("click", swallow, { capture: true, once: true });
                setTimeout(() => doc.removeEventListener("click", swallow, true), 600);
            }
        };
        // While adjusting, a wheel anywhere on the stage zooms the phone (not the stage's 履历 / page turn, not the phone's
        // content); open menus and CONFIG keep their own scroll, Ctrl+wheel stays the reading size.
        const onWheel = event => {
            const target = event.target, stage = panel.current?.closest(".fork-gal-stage");
            if (event.ctrlKey || !stage?.contains(target) || target.closest?.(".fork-gal-config, .fork-widget-context, .fork-widget-menu")) return;
            event.stopPropagation(); event.preventDefault();
            if (!gesture.current) zoom(event);
        };
        const win = doc.defaultView || window, wheelOptions = { capture: true, passive: false };
        doc.addEventListener("pointerdown", outside, true); win.addEventListener("wheel", onWheel, wheelOptions);
        return () => { doc.removeEventListener("pointerdown", outside, true); win.removeEventListener("wheel", onWheel, wheelOptions); wheel.current = 0; };
    }, [unlocked]);
    React.useEffect(() => () => { tracking.current?.(); clearTimeout(gesture.current?.timer); cancelAnimationFrame(frame.current); clearTimeout(pending.current); if (idle.current) lockNow(); }, []);
    if (!item.phoneBase || !owner.adjust) return null;
    const grip = (kind, side) => h("div", { key: kind + (side || ""), className: "fork-widget-grip is-" + kind + (side ? " is-" + side : ""), "aria-hidden": true,
        onPointerDown: event => down(event, kind),
        onDoubleClick: kind === "ring" || kind === "adjust" ? reset : undefined });
    return {
        grips: unlocked ? [grip("adjust"), grip("corner")] : [...["top", "right", "bottom", "left"].map(side => grip("ring", side)), grip("status")],
        // The panel asks first: true when adjust mode used the event.
        holding: () => Boolean(gesture.current),
        // (Adjust mode takes the wheel on the window, above; a press still being held swallows it.)
        wheel: () => Boolean(gesture.current),
        key: event => {
            if (!live.current.item.unlocked) return false;
            if (event.key === "Escape") { event.preventDefault(); lockNow(); return true; }
            if (event.target === event.currentTarget && ["+", "=", "-", "_"].includes(event.key)) { event.preventDefault(); step(event.key === "-" || event.key === "_" ? -1 : 1); return true; }
            if (event.key.startsWith("Arrow")) arm();
            return false;
        },
    };
}

// The stage CONFIG › 模组 › 手机 section (gal-config.js building blocks; include after it). props: { compact }.
function PhoneStageConfig() {
    const h = React.createElement, prefs = usePhonePrefs(), name = phoneModPrefs.current(), layout = prefs[name];
    const [draft, setDraft] = React.useState(null), size = draft ?? layout.size;
    return galConfigGroup("手机", null,
        galConfigRow("解锁手机位置", h("span", { className: "fork-gal-config-inline" },
                h(GalConfigSwitch, { label: "解锁手机位置", checked: prefs.unlocked, onChange: value => phoneModPrefs.set({ unlocked: value }) }),
                layout.place ? h(ResetButton, { label: "恢复默认位置", onClick: () => phoneModPrefs.update(name, { place: null }) }) : null),
            "打开后在舞台上拖动手机移动，拖右下角、滚轮或双指缩放；也可以直接长按手机边框或顶部状态栏。松手几秒后或点手机外面即锁定；双击手机回到默认位置。", null, "toggle"),
        galConfigRow("手机大小", galConfigSlider(["小", "大"], { min: phoneModSizeMin(name), max: PHONE_SIZE.max, step: PHONE_SIZE.step, value: size, label: "手机大小",
                valueText: size + "%", output: size + "%", onChange: value => setDraft(value), onCommit: value => { setDraft(null); phoneModPrefs.update(name, { size: value }); } },
                size === PHONE_SIZE.default ? null : { label: "恢复为 100%", onClick: () => { setDraft(null); phoneModPrefs.update(name, { size: PHONE_SIZE.default }); } }),
            "100% 是手机自动填满文本框上方空间的大小；缩小后可以一边读故事一边看手机。电脑和手机各自记住。"));
}
const PHONE_STAGE_CONFIG = Object.freeze({ label: "手机", en: "PHONE", Component: PhoneStageConfig });
if (typeof STAGE_CONFIG_SECTIONS === "object" && STAGE_CONFIG_SECTIONS) STAGE_CONFIG_SECTIONS["dsh.phone"] = PHONE_STAGE_CONFIG;

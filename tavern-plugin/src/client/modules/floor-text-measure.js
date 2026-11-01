// Reserve height for a floor whose content is not mounted yet.
//
// A deferred floor used to reserve a flat 800 px, so a floor that turned out to be
// three lines tall or thirty lines tall both pushed the scroller by the same wrong
// amount. Pretext measures the text with canvas and lays it out arithmetically, so
// the reservation can follow the real paragraph height without mounting the floor,
// which is exactly what a deferred floor cannot afford to do.
//
// The asset is a single-file ESM build (zero imports, no npm dependency); it loads
// on the first deferred floor that asks and every later floor reuses it. Browsers
// without canvas text measurement simply keep the 800 px fallback.
const TAVERN_TEXT_MEASURE_ASSET = "/api/dsh-tavern/vendor/runtime-assets/pretext/index.mjs";
const TAVERN_TEXT_MEASURE_FALLBACK = 800;
const TAVERN_TEXT_MEASURE_CACHE_LIMIT = 160;
// Rendered paragraphs carry their own block margin, which a pure text layout does
// not know about. The host's markdown body sets it per theme, so this is a shape
// constant, not a copy of one stylesheet: 0.6 line at the reading face's 1.5.
const TAVERN_TEXT_MEASURE_PARAGRAPH_GAP = 0.6;

const tavernTextMeasureState = { status: "idle", api: null, listeners: new Set(), cache: new Map() };

function tavernTextMeasureSupported() {
    if (typeof document === "undefined" || typeof window === "undefined") return false;
    // jsdom ships neither the canvas context type nor the implementation; asking for a
    // 2d context there only logs a jsdom "not implemented" error, so rule it out first.
    if (typeof window.CanvasRenderingContext2D !== "function") return false;
    try {
        if (typeof window.OffscreenCanvas === "function") return true;
        return Boolean(document.createElement("canvas").getContext("2d"));
    } catch (_) {
        return false;
    }
}

function tavernTextMeasureNotify(ready) {
    const listeners = Array.from(tavernTextMeasureState.listeners);
    tavernTextMeasureState.listeners.clear();
    for (const listener of listeners) {
        try { listener(ready === true); } catch (_) {}
    }
}

function tavernTextMeasureLoad() {
    if (tavernTextMeasureState.status !== "idle") return;
    if (!tavernTextMeasureSupported()) {
        tavernTextMeasureState.status = "unavailable";
        return;
    }
    tavernTextMeasureState.status = "loading";
    let request = null;
    try {
        request = import(new URL(TAVERN_TEXT_MEASURE_ASSET, document.baseURI).href);
    } catch (_) {
        tavernTextMeasureState.status = "unavailable";
        tavernTextMeasureNotify(false);
        return;
    }
    request.then(function (api) {
        if (!api || typeof api.prepare !== "function" || typeof api.layout !== "function") {
            tavernTextMeasureState.status = "unavailable";
            return;
        }
        tavernTextMeasureState.api = api;
        tavernTextMeasureState.status = "ready";
    }, function () {
        tavernTextMeasureState.status = "unavailable";
    }).then(function () {
        tavernTextMeasureNotify(tavernTextMeasureState.status === "ready");
    });
}

// Callers register before the first reserve is asked for; the listener fires once,
// when the measurement module is ready or has been ruled out.
function tavernTextMeasureWhenReady(listener) {
    if (typeof listener !== "function") return function () {};
    tavernTextMeasureState.listeners.add(listener);
    tavernTextMeasureLoad();
    return function () { tavernTextMeasureState.listeners.delete(listener); };
}

function tavernTextMeasureFallback() {
    return TAVERN_TEXT_MEASURE_FALLBACK;
}

function tavernTextMeasureFace(node) {
    let size = 16, family = "sans-serif", lineHeight = 24;
    if (node && typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
        const style = window.getComputedStyle(node);
        const parsedSize = parseFloat(style && style.fontSize);
        const parsedLine = parseFloat(style && style.lineHeight);
        if (Number.isFinite(parsedSize) && parsedSize > 0) size = parsedSize;
        if (style && style.fontFamily) family = style.fontFamily;
        if (Number.isFinite(parsedLine) && parsedLine > 0) lineHeight = parsedLine;
    }
    return { font: Math.round(size * 100) / 100 + "px " + family, lineHeight: Math.max(1, Math.round(lineHeight)) };
}

function tavernTextMeasurePrepare(font, text) {
    const api = tavernTextMeasureState.api;
    if (!api) return null;
    const key = font + "\u0000" + text;
    const cached = tavernTextMeasureState.cache.get(key);
    if (cached) return cached;
    let prepared = null;
    try {
        prepared = api.prepare(text, font, { whiteSpace: "pre-wrap" });
    } catch (_) {
        return null;
    }
    if (tavernTextMeasureState.cache.size >= TAVERN_TEXT_MEASURE_CACHE_LIMIT) {
        const oldest = tavernTextMeasureState.cache.keys().next();
        if (!oldest.done) tavernTextMeasureState.cache.delete(oldest.value);
    }
    tavernTextMeasureState.cache.set(key, prepared);
    return prepared;
}

// Paragraph text of a floor's text blocks, as the deferred floor would have painted it.
function tavernFloorMeasureText(blocks) {
    if (!Array.isArray(blocks)) return "";
    const parts = [];
    for (const block of blocks) {
        if (!block || block.kind !== "text") continue;
        const text = String(block.text || "");
        if (text.trim() !== "") parts.push(text);
    }
    return parts.join("\n");
}

// Height the floor would occupy at `width`, or 0 when the measurement module is not
// ready yet (the caller keeps its flat fallback until then).
function tavernFloorReserveHeight(node, text) {
    const api = tavernTextMeasureState.api;
    const content = String(text || "");
    if (!api || !node || content.trim() === "") return 0;
    const width = Math.floor(Number(node.clientWidth) || 0);
    if (!(width > 0)) return 0;
    const face = tavernTextMeasureFace(node);
    const paragraphs = content.split(/\n{2,}/).filter(function (paragraph) { return paragraph.trim() !== ""; });
    let height = 0;
    for (let index = 0; index < paragraphs.length; index++) {
        const prepared = tavernTextMeasurePrepare(face.font, paragraphs[index]);
        if (!prepared) return 0;
        try {
            height += api.layout(prepared, width, face.lineHeight).height;
        } catch (_) {
            return 0;
        }
        // A paragraph break costs its margin; the last paragraph has none below it.
        if (index < paragraphs.length - 1) height += face.lineHeight * TAVERN_TEXT_MEASURE_PARAGRAPH_GAP;
    }
    if (!(height > 0)) return 0;
    return Math.max(face.lineHeight, Math.min(32000, Math.ceil(height)));
}

// A floor that has been painted once remembers what it really took. Reopening a long
// chat then reserves the measured height without re-importing the module or laying the
// text out again; the text is still laid out for floors this tab has never shown.
// Width is part of the record — the same prose is taller in a narrow column — and a
// changed text length or a resized column retires the record, so an edit or a resize
// falls back to a fresh measurement instead of a stale one.
const TAVERN_TEXT_MEASURE_HEIGHT_PREFIX = "dsh-tavern-floor-height:";
const TAVERN_TEXT_MEASURE_HEIGHT_TOLERANCE = 8;
const TAVERN_TEXT_MEASURE_HEIGHT_LIMIT = 600;
const tavernFloorHeightPrune = { writes: 0 };

function tavernFloorHeightStorageKey(sessionId, turn, text) {
    const session = String(sessionId || "");
    if (session === "") return "";
    return TAVERN_TEXT_MEASURE_HEIGHT_PREFIX + session + ":" + String(Number(turn) || 0) + ":" + String(text || "").length;
}

function tavernFloorHeightStorage() {
    try {
        if (typeof window === "undefined" || !window.sessionStorage) return null;
        return window.sessionStorage;
    } catch (_) {
        return null;
    }
}

function tavernFloorHeightCollect(store) {
    const keys = [];
    try {
        for (let index = 0; index < store.length; index++) {
            const key = store.key(index);
            if (key && key.indexOf(TAVERN_TEXT_MEASURE_HEIGHT_PREFIX) === 0) keys.push(key);
        }
    } catch (_) {
        return keys;
    }
    return keys;
}

function tavernFloorHeightRemember(key, width, height) {
    const store = tavernFloorHeightStorage();
    const column = Math.round(Number(width) || 0), value = Math.round(Number(height) || 0);
    if (!store || !key || !(column > 0) || !(value > 0)) return;
    try {
        if (++tavernFloorHeightPrune.writes % 50 === 0) {
            const keys = tavernFloorHeightCollect(store);
            for (let index = 0; index < keys.length - TAVERN_TEXT_MEASURE_HEIGHT_LIMIT; index++) store.removeItem(keys[index]);
        }
        store.setItem(key, JSON.stringify({ w: column, h: Math.max(48, Math.min(32000, value)) }));
    } catch (_) {}
}

function tavernFloorHeightRecall(key, width) {
    const store = tavernFloorHeightStorage();
    const column = Math.round(Number(width) || 0);
    if (!store || !key || !(column > 0)) return 0;
    let record = null;
    try {
        record = JSON.parse(store.getItem(key) || "null");
    } catch (_) {
        return 0;
    }
    if (!record || !(record.w > 0) || !(record.h > 0)) return 0;
    if (Math.abs(record.w - column) > TAVERN_TEXT_MEASURE_HEIGHT_TOLERANCE) return 0;
    return Math.max(48, Math.min(32000, Math.round(record.h)));
}

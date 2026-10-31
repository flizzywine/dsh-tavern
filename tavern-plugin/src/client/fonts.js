// local font metadata is cheap; faces are registered only when used.
// Defaults come from the stage skin's `font` declaration (dsh.skin/1): built-in skins in
// BUILTIN_STAGE_SKINS, pack skins in their skin.json. options.builtinFont(theme) returns a built-in's declaration.
function createTavernFonts(options) {
    const roles = ["stage", "film", "reading"], prefix = "dsh-tavern-font-";
    const doc = options.document, store = options.storage;
    const builtinFont = options.builtinFont || function () { return null; };
    const listeners = new Set(), registered = new Set(), overrides = {};
    // A skin's own faces (fonts.md「皮肤自带字体」): id -> {id, label, family, fallback, blob, face}, loaded from the skin
    // bundle's bytes by provide(); only a skin whose font.faces declares the id resolves to it.
    const provided = new Map(), providing = new Map();
    let fonts = [], loading = null, loaded = false, revision = 0, faceStyle = null, generation = 0;
    let skinFont = null, currentTheme = "classic", currentSkin = null, currentKey = "";
    const sans = '"Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
    function validId(id) { return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(id); }
    function checkRole(role) { if (!roles.includes(role)) throw new TypeError("Unknown font role: " + role); }
    function readOverrides() {
        roles.forEach(function (role) {
            try { const id = store && store.getItem(prefix + role); overrides[role] = validId(id) ? id : null; }
            catch (_) { overrides[role] = null; }
        });
    }
    readOverrides();
    function notify() { revision++; listeners.forEach(function (fn) { fn(); }); }
    function fallback(role, theme) {
        if (role === "reading") return "var(--fork-font-ui)";
        if (role === "stage" && theme === "gothic") return '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif';
        if (role === "stage" && theme === "magical") return '"M PLUS Rounded 1c", "Yuanti SC", "YouYuan", ' + sans;
        if (role === "stage" && theme === "aero") return '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", ' + sans;
        return sans;
    }
    // The skin layer of each role, in order. stage: the stage skin's body (part "name" / "ui" / "title" try their
    // own field first); film: film, then the skin's stage font; reading (unchanged, not a stage-skin role): the app
    // (Dream) skin's `font`.
    function declared(role, skin, part, appFont) {
        if (role === "film") return [skin.film, skin.body];
        if (role === "reading") return [appFont];
        return [part && skin[part], part === "title" ? skin.ui : null, skin.body];
    }
    // context: { theme, skin (a stage skin's font declaration; omitted = the theme's built-in when a theme is given,
    // else the active stage's), skinFont (app skin reading font), part, skinWins (performance skins: stage only) }.
    function resolve(role, context) {
        checkRole(role);
        context = context || {};
        const theme = context.theme === undefined ? currentTheme : context.theme;
        const skin = (context.skin !== undefined ? context.skin : context.theme === undefined ? currentSkin : builtinFont(theme)) || {};
        const appFont = context.skinFont === undefined ? skinFont : context.skinFont;
        const own = skin.faces && typeof skin.faces === "object" ? skin.faces : null;
        const installed = function (id) {
            if (!id) return null;
            return own && Object.hasOwn(own, id) && provided.get(id) || fonts.find(function (item) { return item.id === id; }) || null;
        };
        const fromSkin = declared(role, skin, context.part, appFont).map(installed).find(Boolean) || null;
        const override = installed(overrides[role]), skinFirst = context.skinWins === true && role === "stage" && fromSkin;
        const font = skinFirst ? fromSkin : override || fromSkin;
        const stack = fallback(role, theme);
        // A skin face lacks glyphs (a Japanese game font and Simplified Chinese): its library fallback comes next.
        const backup = font && font.blob && font.fallback ? fonts.find(function (item) { return item.id === font.fallback; }) : null;
        return Object.freeze({ role: role, id: font ? font.id : null, source: !font ? "fallback" : skinFirst || !override ? "skin" : "override",
            family: font ? JSON.stringify(font.family) + ", " + (backup ? JSON.stringify(backup.family) + ", " : "") + stack : stack, override: overrides[role], default: fromSkin ? fromSkin.id : null });
    }
    function list() {
        if (loaded) return Promise.resolve(fonts);
        const epoch = generation;
        if (!loading) loading = Promise.resolve().then(function () { return options.readFonts(); }).then(function (result) {
            if (epoch !== generation) return fonts;
            fonts = Object.freeze((result && Array.isArray(result.fonts) ? result.fonts : []).filter(function (font) {
                return validId(font.id) && typeof font.family === "string" && /^[a-zA-Z0-9 _-]{1,120}$/.test(font.family) && Array.isArray(font.files);
            }).map(function (font) { return Object.freeze(font); }));
            loaded = true; loading = null; notify(); return fonts;
        }, function (error) { loading = null; throw error; });
        return loading;
    }
    function register(id) {
        const own = provided.get(id);
        if (own) { if (own.fallback) register(own.fallback); return own; }
        const font = fonts.find(function (item) { return item.id === id; });
        if (!font || registered.has(id) || !doc) return font || null;
        if (options.library) {
            void options.library()?.ensure(id).catch(() => {});
            return font;
        }
        return font;
    }
    function ensure(id) {
        const current = generation;
        return list().then(function () { return current === generation ? register(id) : null; });
    }
    // A skin's own face from its bundle bytes (a Blob), read through a blob: URL: the browser decodes a URL source off the
    // main thread, while FontFace(ArrayBuffer) sanitises it synchronously (a whole 9.3 MB 思源宋体: a ~190 ms
    // frame). The same Blob is a no-op, a new one (a new skin revision) replaces the face. Resolves to the entry, or null
    // when unsupported.
    function provide(id, source) {
        const FaceType = typeof FontFace === "function" ? FontFace : null;
        if (!validId(id) || !source || !source.blob || !doc || !doc.fonts || !FaceType) return Promise.resolve(null);
        const known = provided.get(id);
        if (known && known.blob === source.blob) return Promise.resolve(known);
        const pending = providing.get(id);
        if (pending && pending.blob === source.blob) return pending.ready;
        const weight = Number.isInteger(source.weight) && source.weight >= 100 && source.weight <= 900 ? source.weight : 400, current = generation;
        const entry = { id: id, label: "皮肤自带字体", category: "sans", family: "DSH Skin " + id, fallback: validId(source.fallback) ? source.fallback : null, blob: source.blob, face: null, files: [] };
        const url = URL.createObjectURL(source.blob);
        entry.ready = new FaceType(entry.family, "url(" + JSON.stringify(url) + ")", { weight: String(weight), style: "normal", display: "swap" }).load().finally(function () {
            URL.revokeObjectURL(url);
        }).then(function (face) {
            if (providing.get(id) !== entry || current !== generation) return null;
            providing.delete(id);
            const old = provided.get(id);
            if (old && old.face) doc.fonts.delete(old.face);
            entry.face = face; doc.fonts.add(face);
            provided.set(id, Object.freeze(entry));
            if (entry.fallback) ensure(entry.fallback).catch(function () {});
            notify();
            return entry;
        }, function (error) { if (providing.get(id) === entry) providing.delete(id); throw error; });
        providing.set(id, entry);
        return entry.ready;
    }
    function setOverride(role, id) {
        checkRole(role);
        if (id !== null && !validId(id)) throw new TypeError("Invalid font id");
        overrides[role] = id;
        try { if (store) { if (id === null) store.removeItem(prefix + role); else store.setItem(prefix + role, id); } } catch (_) {}
        notify();
    }
    return Object.freeze({ list: list, get: id => fonts.find(font => font.id === id) || provided.get(id) || null, ensure: ensure, resolve: resolve, setOverride: setOverride, provide: provide,
        getOverride: function (role) { checkRole(role); return overrides[role]; },
        subscribe: function (fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
        getSnapshot: function () { return revision; },
        setContext: function (context) {
            const nextFont = context.skinFont || null, nextTheme = context.theme || "classic";
            const nextSkin = context.skin === undefined ? builtinFont(nextTheme) : context.skin, key = JSON.stringify(nextSkin || null);
            if (nextFont === skinFont && nextTheme === currentTheme && key === currentKey) return;
            skinFont = nextFont; currentTheme = nextTheme; currentSkin = nextSkin; currentKey = key; notify();
        },
        syncStorage: function () { readOverrides(); notify(); },
        invalidateLibrary: function () { generation++; fonts = []; loaded = false; loading = null; registered.clear(); notify(); },
        dispose: function () {
            generation++; if (faceStyle) faceStyle.remove(); faceStyle = null; registered.clear();
            provided.forEach(function (entry) { if (entry.face && doc && doc.fonts) doc.fonts.delete(entry.face); }); provided.clear(); providing.clear();
        }
    });
}
const tavernFonts = createTavernFonts({ document: typeof document === "undefined" ? null : document,
    storage: (function () { try { return window.localStorage; } catch (_) { return null; } })(),
    library: () => typeof window === 'undefined' ? null : window.dshSkinFonts,
    readFonts: async function () { return {fonts:await (typeof window !== 'undefined' && window.dshSkinFonts?.list() || Promise.resolve([]))}; },
    // Read lazily: the stage skin contract is bundled later in the same client scope.
    builtinFont: function (theme) { const skin = Object.hasOwn(BUILTIN_STAGE_SKINS, theme) ? BUILTIN_STAGE_SKINS[theme] : null; return skin ? skin.font : null; } });
// A stage root's declaration: data-fk-fonts (JSON, set by useStageSkin) or the built-in of its data-theme.
// data-fk-fonts-lead="skin" marks a director-applied performance skin, whose stage fonts beat the override.
function fontContext(element) {
    const theme = element.getAttribute("data-theme") || "", raw = element.getAttribute("data-fk-fonts");
    let skin;
    if (raw) try { skin = JSON.parse(raw); } catch (_) { skin = undefined; }
    return { theme: theme, skin: skin && typeof skin === "object" ? skin : undefined, skinWins: element.getAttribute("data-fk-fonts-lead") === "skin" };
}

function installForkFonts(ctx) {
    const doc = document, rootSelector = ".fork-gal-stage, .fork-gal-theme-scope";
    let disposed = false, queued = false;
    window.tavernFonts = tavernFonts;
    // Compatibility rules are font-only: old text boxes still use --gal-serif,
    // while newer overlays and choices consume the semantic font token directly.
    const typography = doc.createElement("style");
    typography.dataset.forkFontRoles = "";
    typography.textContent = ".fork-gal-stage{font-family:var(--gal-ui-font)}" +
        ".fork-gal-stage .fork-gal-name span{font-family:var(--gal-ui-font)}" +
        ".fork-gal-stage.is-film[data-theme] .fork-gal-text{font-family:var(--gal-film-font)}" +
        '[data-dsh-fork-session="play"] .dsh-tavern-user-bubble,[data-dsh-fork-session="play"] [class*="_userRow"] [class*="_bubble"]{font-family:var(--fork-font-reading)}';
    doc.head.appendChild(typography);
    function set(element, name, value) { if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value); }
    function use(role, context) {
        const resolved = tavernFonts.resolve(role, context);
        if (resolved.id) tavernFonts.ensure(resolved.id).catch(function () {});
        return resolved.family;
    }
    function refresh() {
        queued = false;
        if (disposed) return;
        const skin = window.__dshDreamSkin;
        const roots = Array.from(doc.querySelectorAll(rootSelector));
        const active = roots.find(function (element) { return element.classList.contains("fork-gal-stage"); });
        const snapshot = ctx.theme && ctx.theme.getTheme ? ctx.theme.getTheme() : null;
        // The active stage's skin is "the current skin" for the CONFIG 舞台字体 / 字幕字体 pickers.
        const current = active ? fontContext(active) : {};
        tavernFonts.setContext({ theme: current.theme || "classic", skin: current.skin,
            skinFont: skin && typeof skin.readingFont === "function" ? skin.readingFont() : snapshot && snapshot.active && snapshot.active.font });
        if (doc.body) set(doc.body, "--fork-font-reading-resolved", use("reading"));
        roots.forEach(function (element) {
            // CONFIG's miniature cards contain only CSS shapes, not text. Registering all
            // three theme faces here forces expensive first-open font/layout work for no pixels.
            if (element.classList.contains("fork-gal-config-theme-art")) return;
            const context = fontContext(element);
            const stage = use("stage", context);
            set(element, "--gal-base-font", stage);
            // Same value as the skin adapter's --gal-ui-font (stage-skin-adapter.cjs), so neither writer flips it.
            set(element, "--gal-ui-font", use("stage", Object.assign({ part: "ui" }, context)));
            set(element, "--gal-serif", stage);
            // Film: the skin's film font, else its stage font; only registered while film mode is on.
            set(element, "--gal-film-font", element.classList.contains("is-film") ? use("film", context) : tavernFonts.resolve("film", context).family);
        });
    }
    function schedule() { if (!disposed && !queued) { queued = true; Promise.resolve().then(refresh); } }
    const unsubscribe = tavernFonts.subscribe(schedule);
    function libraryChanged() {tavernFonts.invalidateLibrary();tavernFonts.list().then(schedule, () => {});}
    window.addEventListener('dsh-font-library-changed', libraryChanged);
    const offTheme = ctx.on("theme/change", schedule);
    const observer = new MutationObserver(function (changes) {
        if (changes.some(function (change) {
            if (change.type === "attributes") return change.target.matches(rootSelector);
            return Array.from(change.addedNodes).concat(Array.from(change.removedNodes)).some(function (node) {
                return node.nodeType === 1 && (node.matches(rootSelector) || node.querySelector(rootSelector));
            });
        })) schedule();
    });
    observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-theme", "class", "data-fk-fonts", "data-fk-fonts-lead"] });
    function storage(event) { if (event.key === null || /^dsh-tavern-font-(stage|film|reading)$/.test(event.key)) tavernFonts.syncStorage(); }
    window.addEventListener("storage", storage);
    refresh();
    tavernFonts.list().then(schedule, function (error) { console.warn("dsh-tavern: font library unavailable", error); });
    return function () {
        disposed = true; observer.disconnect(); unsubscribe(); if (typeof offTheme === "function") offTheme();
        window.removeEventListener("dsh-font-library-changed", libraryChanged);
        window.removeEventListener("storage", storage); typography.remove(); tavernFonts.dispose();
        if (doc.body) doc.body.style.removeProperty("--fork-font-reading-resolved");
        doc.querySelectorAll(rootSelector).forEach(function (element) {
            ["--gal-base-font", "--gal-ui-font", "--gal-serif", "--gal-film-font"].forEach(function (name) { element.style.removeProperty(name); });
        });
        if (window.tavernFonts === tavernFonts) delete window.tavernFonts;
    };
}

// the
// generic UI of the two-layer mod settings (全局 / 本卡). a field shows
// its value control in its row (enum → menu, bool → switch, number → slider / number, text → text); 自动 is one menu
// option only for a field with a real automatic source (guessHints / autoRef / a record list), never a separate layer.
// Outer level next to
// InlineField (main.js bundles it after data-picker.js); dormant until a mod page mounts it. Styles:
// `.fork-cfg-*` in lib/client-assets/mod-config.css.
//
// useModConfig({call, modId, cardId?, sessionId?, cardName?, fileUrl?}) → config — the one adapter to the backend.
//   call(method, args) → Promise is the host's authenticated RPC (getModConfig, setModConfig, clearModConfig,
//   listModConfigSources, evaluateModConfigFormula, uploadModConfigFile); fileUrl({modId, layer, cardId, path}) → url
//   of an uploaded file for thumbnails (the contract has no read RPC yet). Writes are queued with the revision (CAS);
//   a conflict reloads. config: {data, loading, error, reload, fields: Map(key → field), scope, setScope, cardName,
//   layerFor(key), set(key, value), clear(key), dotFor(key), sources, sourcesError, needSources(), evaluate(text),
//   upload(key, file), fileUrl(layer, fixed)}.
// <ScopeSwitch value onChange cardName> — 「全局 | 本卡」 (Segmented): which layer edits write to; the card name is
// only the 本卡 segment's tooltip.
// <OverrideDot layer warn> — the 7px marker: 本卡 green, 全局 blue (R8 colours), ⚠ colour when it cannot be read.
// <CfgField config fieldKey label? help? bare?> — one setting as a row: label (?) · override dot · control · reset
//   (only when the edited layer sets it). `bare` drops the label / dot / reset (the popover's head has them).
// <ValueEditor config fieldKey anchor onClose placement beside> — the popover of one setting (a CfgField), anchored to an
//   element: beside it (or beside `beside`, e.g. the whole preview) when there is room, else under / over it
//   (`placement: 'below'` for list rows); a bottom sheet at ≤720px. Outside press / Esc close it through the popup stack.
// <PreviewHotspots config width height hotspots children label placement editor> — a mod's preview with clickable regions
//   [{key, label, rect:[x, y, w, h], round?}] in the preview's own `width` × `height` units; a click opens the editor
//   there (`editor(key, {anchor, beside, placement, onClose})` may return a mod's own popover instead). Hotspots show a
//   quiet outline on hover / focus only.
const CFG_AUTO = "\u0000auto", CFG_FIXED = "\u0000fixed", CFG_REFD = "\u0000ref", CFG_PICK = "\u0000pick", CFG_FORMULA = "\u0000formula";
const CFG_AUTO_LABEL = "自动（跟随状态）";
const cfgHas = (layer, key) => !!layer && Object.prototype.hasOwnProperty.call(layer, key);
function cfgKindOf(value) {
    if (!value || typeof value !== "object") return "auto";
    for (const kind of ["fixed", "ref", "formula"]) if (cfgHas(value, kind)) return kind;
    return "auto";
}
// Player wording through the one shared playerErrorText (asset-pack-ui.js): no code, no English.
function cfgErrorText(error) { return playerErrorText(error || "出错了"); }
// A declared field (configSchema.fields[]) → what the editor needs. valueType number / boolean pick the control; a string
// field names its control in `ui.control` (text · time · colour · choice · image), with `ui.choices` [{value, label}] and
// `ui.unit`. `auto` — the field has a real automatic source (a guessed MVU / ledger
// variable, a stage value, a record list read from the card); only then are 自动, 引用 (and 公式 for numbers) offered.
// Every other field is a plain value: 固定 only, its default when unset.
function cfgField(field) {
    const f = field || {}, ui = f.ui || {}, valueType = f.valueType || "string";
    const type = valueType === "number" ? "number" : valueType === "boolean" ? "boolean" : ui.control || f.control || (valueType === "string" ? "text" : valueType === "array" || f.fieldMapping ? "list" : "json");
    const auto = !!(f.guessHints || f.autoRef || type === "list");
    // a number without an automatic source (电量, 信号) may still follow a
    // variable: 固定 · 选择变量… · 公式…, no 自动 (unset reads as its default). A `fixedOnly` field (弹幕量, 调用节奏) takes a
    // fixed value or its default, nothing else.
    const bindable = !auto && (type === "number" || f.bindable) && !f.fixedOnly;
    // A record list (背包) is read from the card: 自动 or 引用 of an array / object branch, never typed in.
    const kinds = bindable ? ["fixed", "ref", ...(type === "number" ? ["formula"] : [])] : !auto ? ["fixed"] : type === "number" ? ["auto", "fixed", "ref", "formula"] : type === "list" ? ["auto", "ref"] : ["text", "time"].includes(type) ? ["auto", "fixed", "ref"] : ["auto", "fixed"];
    const choices = (ui.choices || f.choices || []).map(c => Array.isArray(c) ? { value: c[0], label: String(c[1]) } : { value: c.value, label: String(c.label ?? c.value) });
    // an option the player may not adjust (a skin's art, placement) is not a setting row.
    return { key: f.key, label: String(f.label ?? f.key), type, auto, kinds, min: f.min, max: f.max, unit: ui.unit ?? f.unit, integer: !!(ui.integer ?? f.integer), maxLength: ui.maxLength ?? f.maxLength,
        round: !!ui.round, recordAssetMedia: f.recordAssetMedia, choices, globalOnly: f.scope === "global", default: f.default, autoLabel: f.autoLabel, hidden: f.userAdjustable === false };
}
// an option the active skin locks reads its value, read-only, with
// this one short note; the player's stored values stay and apply again under a skin that does not lock it.
const cfgLockText = skinName => "由皮肤「" + skinName + "」锁定";
// The player's rows of a schema: every declared key but those that are not user-adjustable.
const cfgUserKeys = (config, keys) => keys.filter(key => config.fields.has(key) && !config.fields.get(key).hidden);
const CFG_WANT = { number: "number", colour: "colour", text: "text", time: "text", boolean: "boolean", list: "list" };
function cfgShow(field, value) {
    if (value === null || value === undefined) return "—";
    if (field.type === "choice") { const c = field.choices.find(o => o.value === value); return c ? c.label : String(value); }
    if (field.type === "boolean") return value ? "开" : "关";
    if (field.type === "image") return value && value.file ? String(value.file).split("/").pop() : "—";
    if (field.type === "images") return Array.isArray(value) && value.length ? value.length + " 张" : "—";
    if (field.type === "list") return Array.isArray(value) ? value.length + " 项" : value && typeof value === "object" ? Object.keys(value).length + " 项" : "—";
    if (field.type === "colour") return String(value).toUpperCase();
    if (field.type === "number" && typeof value === "number") return cfgFormat(value) + (field.unit ? (field.unit === "%" ? "%" : " " + field.unit) : "");
    if (value === "") return "（不显示）";
    return cfgFormat(value);
}

function useModConfig(options) {
    const o = options || {}, call = o.call;
    const [data, setData] = React.useState(null), [loading, setLoading] = React.useState(true), [error, setError] = React.useState("");
    const [scope, setScope] = React.useState(o.cardId ? "card" : "global");
    const [sources, setSources] = React.useState(null), [sourcesError, setSourcesError] = React.useState("");
    const latest = React.useRef(null), queue = React.useRef(Promise.resolve()), life = React.useRef(0), wantSources = React.useRef(false);
    const ctx = React.useMemo(() => ({ cardId: o.cardId || undefined, sessionId: o.sessionId || undefined }), [o.cardId, o.sessionId]);
    const accept = next => { latest.current = next; setData(next); };
    const load = React.useCallback(async function () {
        const mine = life.current; setLoading(true);
        try { const next = await call("getModConfig", { modId: o.modId, ...ctx }); if (mine === life.current) { accept(next); setError(""); } }
        catch (e) { if (mine === life.current) setError(cfgErrorText(e)); }
        finally { if (mine === life.current) setLoading(false); }
    }, [call, o.modId, ctx]);
    const loadSources = React.useCallback(async function () {
        const mine = life.current;
        try { const list = await call("listModConfigSources", { ...ctx }); if (mine === life.current) { setSources(list && list.sources || []); setSourcesError(""); } }
        catch (e) { if (mine === life.current) setSourcesError(cfgErrorText(e)); }
    }, [call, ctx]);
    React.useEffect(function () {
        life.current++; latest.current = null; setData(null); setSources(null); setScope(o.cardId ? "card" : "global");
        load(); if (wantSources.current) loadSources();
    }, [load, loadSources]);
    const fields = React.useMemo(() => {
        const schema = data && data.schema, list = Array.isArray(schema) ? schema : schema && schema.fields || [];
        return new Map(list.map(f => [f.key, cfgField(f)]));
    }, [data && data.schema]);
    const layerFor = key => { const f = fields.get(key); return f && f.globalOnly || !o.cardId ? "global" : scope; };
    // One write at a time, each with the newest revision; a conflict reloads and says so. set / clear answer the new get
    // DTO; an upload answers {revision, file} and its value is written right after, in the same turn of the queue.
    const write = (method, args, then, prepare) => {
        const mine = life.current;
        const run = queue.current.then(async function () {
            if (mine !== life.current) return null;
            try {
                // uploadModConfigFile takes no sessionId (the file belongs to the layer, not to a chat).
                const where = method === "uploadModConfigFile" ? { cardId: ctx.cardId } : ctx;
                if (prepare) args = await prepare(args);
                let next = await call(method, { modId: o.modId, ...where, ...args, expectedRevision: latest.current && latest.current.revision });
                if (then && mine === life.current) { latest.current = { ...latest.current, revision: next.revision }; next = await call("setModConfig", { modId: o.modId, ...ctx, ...then(next), expectedRevision: next.revision }); }
                if (mine === life.current) { accept(next); setError(""); if (wantSources.current) loadSources(); }
                // The stage's resolved options (mod-options.js) follow a stored change.
                if (typeof window !== "undefined" && method !== "uploadModConfigFile") window.dispatchEvent(new CustomEvent("dsh-tavern-mod-options-changed", { detail: { modId: o.modId } }));
                return next;
            } catch (e) {
                if (mine !== life.current) return null;
                if (e && e.code === "REVISION_CONFLICT") await load();
                setError(cfgErrorText(e)); return null;
            }
        });
        queue.current = run.catch(() => null);
        return run;
    };
    const evaluate = React.useCallback(text => call("evaluateModConfigFormula", { formula: text, ...ctx }), [call, ctx]);
    return {
        modId: o.modId, cardId: o.cardId, cardName: o.cardName, data, loading, error, reload: load, fields, scope, setScope, layerFor,
        listAssets: key => call('listModConfigAssets', { modId: o.modId, key, ...ctx }),
        // `layer`: a writer outside the scope switch (the stage CONFIG) names the layer it edits.
        set: (key, value, layer) => write("setModConfig", { key, layer: layer || layerFor(key), value }),
        clear: key => write("clearModConfig", { key, layer: layerFor(key) }),
        copyAndSet: (key, value, from) => {
            const layer = layerFor(key);
            return write('setModConfig', { key, layer, value: structuredClone(value) }, null, async args => {
                if (from === layer) return args;
                const copied = new Map();
                for (const row of args.value.fixed || []) if (row.icon && row.icon.file) {
                    const old = row.icon.file;
                    if (!copied.has(old)) {
                        const media = await call('readModConfigFile', { modId: o.modId, layer: from, cardId: ctx.cardId, path: old });
                        const result = await call('uploadModConfigFile', { modId: o.modId, layer, cardId: ctx.cardId, mime: media.file.mime, data: media.data, expectedRevision: latest.current.revision });
                        latest.current = { ...latest.current, revision: result.revision }; copied.set(old, result.file.path);
                    }
                    row.icon.file = copied.get(old);
                }
                return args;
            });
        },
        // the page-level reset — the keys the edited layer sets (全局 → all 自动, 本卡 → all 全局),
        // cleared one queued write at a time.
        ownKeys: () => { const layer = o.cardId ? scope : "global", mine = data && data[layer]; return mine ? Object.keys(mine).filter(key => fields.has(key) && layerFor(key) === layer) : []; },
        clearAll: keys => Promise.all(keys.map(key => write("clearModConfig", { key, layer: layerFor(key) }))),
        dotFor: key => { const layer = layerFor(key), own = !!data && cfgHas(data[layer], key), r = data && data.resolved && data.resolved[key]; return own && r && r.error ? "warn" : own ? layer : ""; },
        sources, sourcesError, needSources: () => { if (!wantSources.current) { wantSources.current = true; loadSources(); } }, evaluate,
        // An uploaded image: the file goes to the layer's files/, then the value points at it.
        // toValue(path, latest get DTO) builds the stored value (default {fixed: {file}}), e.g. one contact's avatar in a map.
        upload: (key, file, toValue) => {
            const layer = layerFor(key);
            return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, "")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); })
                .then(base64 => write("uploadModConfigFile", { layer, mime: file.type, data: base64 }, done => ({ key, layer, value: toValue ? toValue(done.file.path, latest.current) : { fixed: { file: done.file.path } } })), e => { setError(cfgErrorText(e)); return null; });
        },
        fileUrl: (layer, fixed) => fixed && fixed.file && o.fileUrl ? o.fileUrl({ modId: o.modId, layer, cardId: o.cardId, path: fixed.file }) : null
    };
}

// The reset of one value: 本卡 goes back to the global value, 全局 to 自动 (a field with an automatic source) or its default.
const cfgResetLabel = (layer, field) => layer === "card" ? "恢复为全局" : field && field.auto ? "恢复为自动" : "恢复默认";
function OverrideDot(props) {
    const h = React.createElement, p = props || {};
    const name = p.warn ? "算不出来" : p.layer === "card" ? "本卡已改" : "全局已改";
    return h("span", { className: "fork-cfg-dot", "data-layer": p.warn ? "warn" : p.layer || "global", role: "img", "aria-label": p.label || name, title: p.label || name });
}
// `data-fork-cfg-keep`: pressing the switch while an editor is open keeps the editor (it shows the other layer).
function ScopeSwitch(props) {
    const h = React.createElement, p = props || {};
    return h("div", { className: "fork-cfg-scope" + (p.className ? " " + p.className : ""), "data-fork-cfg-keep": true },
        h(Segmented, { label: "设置范围", value: p.value, onChange: p.onChange, disabled: p.disabled,
            options: [["global", "全局"], ["card", "本卡", !p.cardName, p.cardName ? "本卡：" + p.cardName : undefined]] }));
}

// Placement of the editor next to its anchor: beside it when there is room (a preview hotspot), else under / over it.
function cfgPlace(a, size, view, placement) {
    const edge = 8, gap = 10, w = Math.min(size.width, view.width - 2 * edge), height = Math.min(size.height, view.height - 2 * edge);
    const clampTop = top => Math.max(edge, Math.min(top, view.height - edge - height));
    if (placement !== "below") {
        if (a.right + gap + w <= view.width - edge) return { left: Math.round(a.right + gap), top: Math.round(clampTop(a.top - 8)) };
        if (a.left - gap - w >= edge) return { left: Math.round(a.left - gap - w), top: Math.round(clampTop(a.top - 8)) };
    }
    const left = Math.max(edge, Math.min(a.left, view.width - edge - w)), below = view.height - a.bottom - gap - edge, above = a.top - gap - edge;
    const top = height <= below || below >= above ? Math.min(a.bottom + gap, view.height - edge - height) : a.top - gap - height;
    return { left: Math.round(left), top: Math.round(Math.max(edge, top)) };
}
// Placement of a settings popover (ValueEditor, or a mod's own editor such as the phone's contacts): beside / under
// p.anchor (beside p.beside when given); a bottom sheet on a narrow window. Follows scrolling, resizing and growth.
function useCfgPlacement(pop, p, setPlace, setSheet) {
    (React.useLayoutEffect || React.useEffect)(function () {
        if (typeof window === "undefined") return undefined;
        const update = () => {
            const narrow = !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches); setSheet(narrow);
            const node = pop.current, rect = p.anchor && p.anchor.getBoundingClientRect ? p.anchor.getBoundingClientRect() : null, frame = p.beside && p.beside.getBoundingClientRect ? p.beside.getBoundingClientRect() : null;
            // `beside`: the editor of a preview hotspot sits beside the whole preview, level with the hotspot.
            const anchor = rect && frame ? { left: frame.left, right: frame.right, top: rect.top, bottom: rect.bottom } : rect;
            if (narrow || !node || !anchor) { setPlace(narrow ? {} : null); return; }
            const next = cfgPlace(anchor, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, p.placement);
            setPlace(prev => prev && prev.left === next.left && prev.top === next.top ? prev : next);
        };
        update();
        const grow = typeof ResizeObserver === "function" && pop.current ? new ResizeObserver(update) : null; if (grow) grow.observe(pop.current);
        window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
        return () => { if (grow) grow.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
    }, [p.anchor, p.beside, p.placement]);
}
function CfgImage({ config, field, layer, fixed, busy, onUpload }) {
    const h = React.createElement, input = React.useRef(null), url = config.fileUrl(layer, fixed);
    return h("div", { className: "fork-cfg-image" },
        h("span", { className: "fork-cfg-thumb" + (field.round ? " is-round" : ""), "data-empty": url ? undefined : true }, url ? h("img", { src: url, alt: "" }) : null),
        h("span", { className: "fork-cfg-image-side" },
            h("button", { type: "button", className: "fork-cfg-link", disabled: busy, onClick: () => input.current && input.current.click() }, busy ? h(Spinner, null) : null, "上传"),
            fixed && fixed.file ? h("span", { className: "fork-cfg-meta fork-cfg-file" }, String(fixed.file).split("/").pop()) : null),
        h("input", { ref: input, type: "file", accept: "image/*", hidden: true, onChange: event => { const file = event.target.files && event.target.files[0]; event.target.value = ""; if (file) onUpload(file); } }));
}
// What one key shows on the layer being edited: its own stored value, else what that layer inherits (本卡 ← 全局 ← 自动).
// `resolved` is the backend's resolution for the card; it is not this layer's value while 全局 is edited and the card
// overrides the key, so the global value is shown from the store (自动 → the declared default).
function cfgState(config, key) {
    const field = config.fields.get(key), data = config.data || {}, layer = config.layerFor(key), own = cfgHas(data[layer], key);
    const inherited = layer === "card" && cfgHas(data.global, key) ? data.global[key] : { auto: true };
    const stored = own ? data[layer][key] : inherited, kind = cfgKindOf(stored);
    const hidden = config.scope === "global" && !!config.cardId && cfgHas(data.card, key);
    const resolved = !hidden && data.resolved && data.resolved[key] || null;
    // A skin lock wins over both layers: the row shows the skin's value whichever layer is edited.
    const lock = data.resolved && data.resolved[key] && data.resolved[key].locked === true ? data.resolved[key] : null;
    const value = lock ? lock.value : kind === "fixed" ? stored.fixed : resolved && !resolved.error ? resolved.value : field ? field.default : null;
    return { field, layer, own, stored, kind, inheritedKind: cfgKindOf(inherited), resolved, value,
        locked: lock ? cfgLockText(data.skin && data.skin.name) : "",
        readOnly: !!field && field.globalOnly && config.scope === "card" && !!config.cardId };
}
// 自动: clear the key when the layer then inherits 自动 anyway (全局, or 本卡 over an automatic global value); else write an
// explicit {auto:true} so 本卡 skips a fixed global value.
function cfgSetAuto(config, key, st) {
    if (st.layer === "global" || st.inheritedKind === "auto") return st.own ? config.clear(key) : null;
    return config.set(key, { auto: true });
}
// The row of one setting. A plain field is its control; a field with an automatic source is one menu —
// 自动（跟随状态） · 固定 · 选择变量… · 公式… — with the fixed control (固定) or the value it reads after it, and the data picker
// / formula box opening under the row. A stored kind the field no longer offers (an old 引用 / 公式 on a plain number) still
// reads: its value shows with a quiet chip, and editing the control writes a fixed value.
function CfgAssetPicker({ config, fieldKey, label, value, onChange, disabled }) {
    const h = React.createElement, [rows, setRows] = React.useState(null), [error, setError] = React.useState(''), [attempt, setAttempt] = React.useState(0);
    React.useEffect(() => {
        let active = true;
        config.listAssets(fieldKey).then(result => { if (active) { setRows(result.assets); setError(''); } }, e => { if (active) setError(cfgErrorText(e)); });
        return () => { active = false; };
    }, [config.modId, fieldKey, attempt]);
    const key = ref => ref?.packId ? JSON.stringify([ref.packId, ref.kind, ref.assetId]) : '';
    const options = [{ value: '', label: '无' }, ...(rows || []).map(row => ({ value: key(row.ref), label: row.label }))];
    if (key(value) && !options.some(row => row.value === key(value))) options.push({ value: key(value), label: '素材不可用' });
    return h(React.Fragment, null,
        h(InlineField, { kind: 'menu', label, hideLabel: true, value: key(value), options, disabled: disabled || !rows, onCommit: selected => onChange(rows.find(row => key(row.ref) === selected)?.ref || {}) }),
        !rows && !error ? h(Spinner, { label: '正在载入素材' }) : null,
        error ? h('span', { role: 'alert', className: 'fork-cfg-result is-warn' }, error, h('button', { type: 'button', className: 'fork-cfg-link', onClick: () => setAttempt(n => n + 1) }, '重试')) : null);
}
function CfgField(props) {
    const h = React.createElement, p = props || {}, config = p.config, key = p.fieldKey, st = cfgState(config, key), field = st.field;
    const [extra, setExtra] = React.useState(null), [formula, setFormula] = React.useState(st.kind === "formula" ? st.stored.formula || "" : "");
    const latest = React.useRef(config), timer = React.useRef(null), draft = React.useRef(null), [busy, setBusy] = React.useState(false);
    latest.current = config;
    const pick = React.useRef(null);
    React.useEffect(() => { if (extra === "ref" && pick.current && pick.current.focus) pick.current.focus(); }, [extra]);
    const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } if (draft.current !== null) { const text = draft.current; draft.current = null; latest.current.set(key, { formula: text }); } };
    React.useEffect(() => flush, []);
    React.useEffect(() => { setExtra(null); }, [config.scope]);
    React.useEffect(() => { if (st.kind === "formula" && draft.current === null) setFormula(st.stored.formula || ""); }, [st.kind === "formula" && st.stored.formula, config.scope]);
    if (!field) return null;
    const disabled = st.readOnly || !!st.locked || !!p.disabled, name = p.label || field.label;
    const set = value => { flush(); setExtra(null); return config.set(key, value); };
    const auto = () => { flush(); setExtra(null); return cfgSetAuto(config, key, st); };
    const labels = Object.fromEntries((config.sources || []).map(s => [s.id, s.label || s.id]));
    const chip = ref => h(CfgChip, { label: labels[ref.source] || ref.source, path: ref.path });
    const shown = h("span", { key: "shown", className: "fork-cfg-meta fork-cfg-shown" }, st.resolved && st.resolved.error ? "⚠" : st.value === "" ? "不显示" : cfgShow(field, st.value));
    const legacy = !field.kinds.includes(st.kind) ? h("span", { key: "legacy", className: "fork-cfg-meta fork-cfg-from" }, st.kind === "ref" && st.stored.ref ? chip(st.stored.ref) : CFG_KINDS_TEXT[st.kind] || "") : null;
    const common = { label: name, hideLabel: true, disabled };
    const fixedControl = value => {
        if (field.type === "number") {
            const min = field.min, max = field.max, step = field.integer ? 1 : max - min > 0 ? (max - min) / 100 : 1, n = typeof value === "number" ? value : Number(value) || 0;
            if (Number.isFinite(min) && Number.isFinite(max) && (max - min) / step <= 200)
                return h(Slider, { key: "slider", label: name, value: n, min, max, step, disabled, className: "fork-cfg-slider", valueText: v => cfgShow(field, v), output: v => cfgShow(field, v), onCommit: v => set({ fixed: v }) });
            return h(InlineField, { key: "num", kind: "number", ...common, value: typeof value === "number" ? value : null, min, max, unit: field.unit, integer: field.integer, onCommit: v => set({ fixed: v }) });
        }
        if (field.type === 'asset') return h(CfgAssetPicker, { key: 'asset', config, fieldKey: key, label: name, value, disabled, onChange: ref => set({ fixed: ref }) });
        if (field.type === "boolean") return h(Switch, { key: "switch", bare: true, label: name, checked: !!value, disabled, onChange: v => set({ fixed: v }) });
        if (field.type === "image") return h(CfgImage, { key: "img", config, field, layer: st.own ? st.layer : "global", fixed: st.kind === "fixed" ? st.stored.fixed : undefined, busy,
            onUpload: file => { setBusy(true); Promise.resolve(config.upload(key, file)).finally(() => setBusy(false)); } });
        return h(InlineField, { key: "text", kind: "text", ...common, value: value === null || value === undefined ? "" : String(value), maxLength: field.maxLength, trim: false, placeholder: "（不显示）", onCommit: v => set({ fixed: v }) });
    };
    let control, trail = [], kindMenu = false;
    if (field.type === "choice" || field.type === "boolean" && field.auto) {
        const options = field.type === "boolean" ? [{ value: true, label: "开" }, { value: false, label: "关" }] : field.choices;
        control = { kind: "menu", value: field.auto && st.kind === "auto" ? CFG_AUTO : st.value, options: (field.auto ? [{ value: CFG_AUTO, label: CFG_AUTO_LABEL }] : []).concat(options),
            onCommit: v => v === CFG_AUTO ? auto() : set({ fixed: v }) };
    } else if (field.type === "colour") {
        const hex = v => typeof v === "string" && CFG_HEX.test(v) ? v : undefined, source = st.resolved && st.resolved.autoSource && st.resolved.autoSource.label || field.autoLabel;
        control = { kind: "color", value: st.kind === "fixed" ? hex(st.stored.fixed) || "" : field.auto ? "" : hex(st.value) || "", allowAuto: field.auto,
            auto: (st.kind === "auto" ? hex(st.value) : null) || hex(field.default), autoLabel: source ? "自动（" + source + "）" : CFG_AUTO_LABEL,
            onCommit: v => v ? set({ fixed: v.toLowerCase() }) : auto() };
    } else if (field.kinds.length > 1) {
        kindMenu = true;
        // A field without an automatic source reads an unset value as its default: that is 固定.
        const kindValue = st.kind === "auto" && !field.auto ? CFG_FIXED : { auto: CFG_AUTO, fixed: CFG_FIXED, ref: CFG_REFD, formula: CFG_FORMULA }[st.kind];
        const options = field.auto ? [{ value: CFG_AUTO, label: CFG_AUTO_LABEL }] : [];
        if (st.kind === "ref" && st.stored.ref) options.push({ value: CFG_REFD, label: "跟随 " + (labels[st.stored.ref.source] || st.stored.ref.source) + " " + st.stored.ref.path });
        if (field.kinds.includes("fixed")) options.push({ value: CFG_FIXED, label: "固定" });
        if (field.kinds.includes("ref")) options.push({ value: CFG_PICK, label: "选择变量…" });
        if (field.kinds.includes("formula")) options.push({ value: CFG_FORMULA, label: st.kind === "formula" ? "公式" : "公式…" });
        control = { kind: "menu", value: kindValue, options, onCommit: v => {
            if (v === CFG_AUTO) return auto();
            if (v === CFG_PICK) { config.needSources(); setExtra("ref"); return null; }
            if (v === CFG_FORMULA) {
                config.needSources(); setExtra("formula");
                if (st.kind === "formula") return null;
                const was = st.kind === "ref" && st.stored.ref ? cfgRefText(st.stored.ref) : String(typeof st.value === "number" ? st.value : field.min ?? 0);
                setFormula(was); return config.set(key, { formula: was });
            }
            if (v === CFG_FIXED) return set({ fixed: field.type === "number" ? (typeof st.value === "number" ? st.value : field.min ?? 0) : st.value === null || st.value === undefined ? "" : String(st.value) });
            return null;
        } };
        if (kindValue === CFG_FIXED) trail.push(fixedControl(st.value));
        else trail.push(shown);
    } else if (["images", "json", "categories"].includes(field.type)) {
        control = null; trail.unshift(shown);
    } else if (field.type === "number" || field.type === "boolean" || field.type === "image" || field.type === 'asset') {
        control = null;
    } else control = { kind: "text", value: st.value === null || st.value === undefined ? "" : String(st.value), maxLength: field.maxLength, trim: false, placeholder: "（不显示）", onCommit: v => set({ fixed: v }) };
    if (legacy) trail.push(legacy);
    if (st.locked) trail.push(h("span", { key: "lock", className: "fork-cfg-meta fork-cfg-lock" }, st.locked));
    const dot = st.own && !st.locked && !p.bare ? h(OverrideDot, { key: "dot", layer: st.layer, warn: !!(st.resolved && st.resolved.error) }) : null;
    const reset = st.own && !disabled && !p.bare ? h(ResetButton, { key: "reset", label: cfgResetLabel(st.layer, field), onClick: () => { flush(); draft.current = null; setExtra(null); config.clear(key); } }) : null;
    if (reset) trail.push(reset);
    const help = p.help || dot ? h(React.Fragment, null, p.help || null, dot) : null;
    const row = control
        ? h(InlineField, { kind: control.kind, label: name, hideLabel: !!p.bare, help, disabled, className: "fork-cfg-field" + (kindMenu ? " is-bound" : ""), trail, ...control })
        : h(p.bare ? "div" : InlineRow, p.bare ? { className: "fork-cfg-bare" } : { label: name, help, className: "fork-cfg-field" }, ["images", "json", "categories"].includes(field.type) ? null : fixedControl(st.value), ...trail);
    const below = [];
    if (extra === "ref") below.push(h(DataPicker, { key: "pick", sources: config.sources, error: config.sourcesError, value: st.kind === "ref" ? st.stored.ref : null, want: CFG_WANT[field.type] || "any",
        selfKey: key, selfModId: config.modId, inline: true, inputRef: pick, onPick: ref => set({ ref }) }));
    if (extra === "formula" && st.kind === "formula") below.push(h(FormulaInput, { key: "fx", value: formula, sources: config.sources, sourcesError: config.sourcesError, evaluate: config.evaluate, unit: field.unit, min: field.min, max: field.max,
        selfKey: key, selfModId: config.modId, inline: true, onChange: text => { setFormula(text); draft.current = text; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 500); } }));
    if (st.resolved && st.resolved.error && extra !== "formula") below.push(h("div", { key: "err", className: "fork-cfg-result is-warn", role: "alert" }, "⚠ ", cfgErrorText(st.resolved.error)));
    return below.length ? h(React.Fragment, null, row, h("div", { className: "fork-cfg-below", "data-key": key }, below)) : row;
}
const CFG_KINDS_TEXT = { ref: "引用", formula: "公式" };
// The popover of one setting (a preview hotspot): its name, override dot, reset and ✕ over the same control as the row.
// A menu / colour control opens at once, so a part of the preview is one click from its choices.
function ValueEditor(props) {
    const h = React.createElement, p = props || {}, config = p.config, key = p.fieldKey, field = config.fields.get(key);
    const pop = React.useRef(null), focused = React.useRef(false), titleId = (React.useId ? React.useId() : "fork-cfg-pop").replace(/:/g, "") + "-t";
    const [place, setPlace] = React.useState(null), [sheet, setSheet] = React.useState(false);
    const close = reason => { if (p.onClose) p.onClose(reason); if (reason === "escape" && p.anchor && p.anchor.focus) p.anchor.focus(); };
    useOverlay(true, () => [pop.current, p.anchor, ...(typeof document !== "undefined" && document.querySelectorAll ? document.querySelectorAll("[data-fork-cfg-keep]") : [])], close);
    // Source labels name the reference chips, so the list is wanted as soon as an editor opens.
    React.useEffect(() => { config.needSources(); }, []);
    useCfgPlacement(pop, p, setPlace, setSheet);
    // Focus goes in once the editor is placed (a hidden element cannot take focus); a plain menu / colour also opens (not the
    // source menu of a bound field: its fixed control is what is wanted most).
    React.useEffect(function () {
        if (focused.current || !(place || sheet) || !pop.current) return;
        focused.current = true;
        const body = pop.current.querySelector(".fork-cfg-pop-body"), trigger = body && body.querySelector("button.fork-inline-trigger:not(:disabled)");
        const first = trigger || body && body.querySelector("input:not([type=file]):not(:disabled), [role=slider], button:not(:disabled)") || pop.current.querySelector("button");
        if (first) first.focus({ preventScroll: true });
        if (trigger && !body.querySelector(".fork-cfg-field.is-bound") && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    }, [place, sheet]);
    if (!field) return null;
    const st = cfgState(config, key);
    const style = sheet || !place ? (sheet ? undefined : { visibility: "hidden", left: -9999, top: 0 }) : { left: place.left, top: place.top };
    const node = h("section", { ref: pop, className: "fork-cfg-pop fk-surface is-field", "data-level": "popover", "data-sheet": sheet || undefined, role: "dialog", "aria-modal": false, "aria-labelledby": titleId, style },
        h("header", { className: "fork-cfg-pop-head" },
            h("span", { className: "fork-cfg-pop-title", id: titleId }, field.label),
            st.own && !st.locked ? h(OverrideDot, { layer: st.layer, warn: !!(st.resolved && st.resolved.error) }) : null,
            st.own && !st.readOnly && !st.locked ? h(ResetButton, { label: cfgResetLabel(st.layer, field), onClick: () => config.clear(key) }) : null,
            h("button", { type: "button", className: "fork-cfg-icon", "aria-label": "关闭", title: "关闭", onClick: () => close("button") }, h(InlineGlyph, { name: "close" }))),
        h("div", { className: "fork-cfg-pop-body" },
            h(CfgField, { config, fieldKey: key, bare: true }),
            st.readOnly ? h("div", { className: "fork-cfg-meta" }, "只有全局") : null,
            config.error ? h("div", { className: "fork-cfg-result is-warn", role: "alert" }, "⚠ ", config.error) : null));
    return inlineCanPortal() ? ReactDOM.createPortal(h("div", { className: "ap-ui ap-layer fork-cfg-layer" }, node), document.body) : node;
}
function PreviewHotspots(props) {
    const h = React.createElement, p = props || {}, config = p.config, [open, setOpen] = React.useState(null), frame = React.useRef(null);
    const ready = !!(config && config.data), w = p.width || 1, hgt = p.height || 1, pct = v => (v * 100) + "%";
    // a spot with a `target` (a selector inside the preview art) sits exactly on
    // that part's box, measured after every render and on resize (fractions of the frame); `rect` is the fallback while the
    // part has no box (an empty 运营商).
    const [boxes, setBoxes] = React.useState({}), measure = React.useRef(null);
    measure.current = function () {
        const node = frame.current, f = node && node.getBoundingClientRect();
        if (!f || !f.width || !f.height) return;
        const next = {};
        for (const spot of p.hotspots || []) {
            const el = spot.target && node.querySelector(".fork-cfg-preview-art " + spot.target), r = el && el.getBoundingClientRect();
            if (r && r.width >= 1 && r.height >= 1) next[spot.key] = [(r.left - f.left) / f.width, (r.top - f.top) / f.height, r.width / f.width, r.height / f.height].map(v => Math.round(v * 1e5) / 1e5);
        }
        setBoxes(now => JSON.stringify(now) === JSON.stringify(next) ? now : next);
    };
    (React.useLayoutEffect || React.useEffect)(() => { measure.current(); });
    React.useEffect(() => {
        if (typeof ResizeObserver !== "function" || !frame.current) return undefined;
        const watch = new ResizeObserver(() => measure.current()); watch.observe(frame.current);
        return () => watch.disconnect();
    }, []);
    return h("div", { ref: frame, className: "fork-cfg-preview" + (p.className ? " " + p.className : ""), role: "group", "aria-label": p.label, style: { aspectRatio: w + " / " + hgt, maxWidth: p.width } },
        h("div", { className: "fork-cfg-preview-art" }, p.children),
        h("div", { className: "fork-cfg-hotspots" }, (p.hotspots || []).map(spot => {
            const box = boxes[spot.key], [x, y, sw, sh] = box ? [box[0] * w, box[1] * hgt, box[2] * w, box[3] * hgt] : spot.rect, dot = ready ? config.dotFor(spot.key) : "";
            return h("button", { key: spot.id || spot.key, type: "button", className: "fork-cfg-hotspot" + (spot.round ? " is-round" : ""), "aria-label": spot.label, title: spot.label, "aria-haspopup": "dialog",
                "aria-expanded": !!open && open.key === spot.key, "data-dot": dot || undefined, disabled: !ready || !config.fields.has(spot.key) || undefined,
                style: { left: pct(x / w), top: pct(y / hgt), width: pct(sw / w), height: pct(sh / hgt) },
                onClick: event => { const anchor = event.currentTarget; setOpen(now => now && now.key === spot.key ? null : { key: spot.key, anchor }); } });
        })),
        !ready && config && config.loading ? h(Spinner, { fill: true, label: "正在载入" }) : null,
        !ready && config && !config.loading && config.error ? h("div", { className: "fork-cfg-preview-error", role: "alert" }, "⚠ ", config.error, " ", h("button", { type: "button", className: "fork-cfg-link", onClick: config.reload }, "重新载入")) : null,
        open && ready ? (p.editor && p.editor(open.key, { anchor: open.anchor, beside: p.placement === "below" ? null : frame.current, placement: p.placement, onClose: () => setOpen(null) })) ||
            h(ValueEditor, { config, fieldKey: open.key, anchor: open.anchor, beside: p.placement === "below" ? null : frame.current, placement: p.placement, onClose: () => setOpen(null) }) : null);
}

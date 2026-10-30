// 设置 › 模型 — a 「能看图」 switch for every model a pi-ai provider card lists.
// The Models page is upstream (dsh-client-ui-settings-models); its keyed `settings.models.provider-card` seat is the one
// supported extension point, so this renders inside each `llm-pi-ai` provider card. A custom route, or a model id the
// bundled catalog does not know, resolves to the route's text-only `defaultInput`; the switch fixes that per model.
// - Start: the adapter's resolved input (host modelCatalog `image`: declared `input`, else the catalog's, else the route
//   default); a model the adapter could not serve falls back to its declared `input`.
// - Write only when flipped, through the page's own path (`settings.mutate` with the namespace revision). Mutate cannot
//   address array items, so it sets the provider's whole `models` list with that entry's `input` replaced.
// - Lists only the configured `models` (what the page's editor adds and edits); catalog-only routes keep the catalog.
const MODEL_IMAGE_NS = "llm-pi-ai";
const MODEL_IMAGE_HELP = "模型支持读图时打开；关闭则图片不会发给它";
function modelImageAt(root, path) {
    return path.reduce((node, key) => node && typeof node === "object" ? node[key] : undefined, root);
}
// The namespace view's model entries for one provider: the user layer when it holds the list, else the resolved value.
function modelImageEntries(view, settingsPath) {
    const own = modelImageAt(view && view.user, settingsPath.concat("models"));
    const list = Array.isArray(own) && own.length ? own : modelImageAt(view && view.value, settingsPath.concat("models"));
    return Array.isArray(list) ? list.filter(entry => entry && typeof entry.id === "string" && entry.id) : [];
}
// The rows: each listed model with its current capability.
function modelImageRows(view, settingsPath, catalog, provider) {
    const served = new Map(((catalog || []).find(group => group.provider === provider) || { models: [] }).models.map(model => [model.id, model]));
    return modelImageEntries(view, settingsPath).map(entry => {
        const model = served.get(entry.id);
        return { id: entry.id, name: entry.name || (model && model.name) || entry.id,
            image: model ? model.image === true : Array.isArray(entry.input) && entry.input.includes("image") };
    });
}
// The mutate ops that set one model's input, or null when the model is no longer listed.
function modelImageOps(view, settingsPath, modelId, image) {
    const models = modelImageEntries(view, settingsPath);
    if (!models.some(entry => entry.id === modelId)) return null;
    const input = image ? ["text", "image"] : ["text"];
    return [{ op: "set", path: settingsPath.concat("models"), value: models.map(entry => entry.id === modelId ? { ...entry, input } : entry) }];
}
function modelImageResult(response) {
    if (response && response.ok === false) throw new Error(response.error && response.error.message || "设置服务不可用");
    return response && response.ok === true ? response.value : response;
}
function ModelImageInput(props) {
    const h = React.createElement, remote = props.remote, entry = props.provider || {};
    const provider = entry.provider, settingsPath = Array.isArray(entry.settingsPath) ? entry.settingsPath : [];
    const [state, setState] = React.useState({ loaded: false, rows: [], writable: false, error: "" });
    const [busy, setBusy] = React.useState(""), [alert, setAlert] = React.useState("");
    const live = React.useRef(true), generation = React.useRef(0);
    const load = React.useCallback(async function () {
        const run = ++generation.current;
        try {
            const [described, settings] = await Promise.all([remote.settings.describe(), rpc("getTavernSettings")]);
            const doc = modelImageResult(described), view = (doc.namespaces || []).find(item => item.ns === MODEL_IMAGE_NS);
            if (!live.current || run !== generation.current) return;
            setState({ loaded: true, writable: !!doc.writable, error: "", rows: view ? modelImageRows(view, settingsPath, settings.modelCatalog, provider) : [] });
        } catch (error) {
            if (live.current && run === generation.current) setState(current => ({ ...current, loaded: true, error: error.message || String(error) }));
        }
    }, [remote, provider, settingsPath.join("\u0000")]);
    React.useEffect(function () {
        live.current = true;
        if (!props.configured) return;
        load();
        const off = ["settings/document-updated", "llm/adapters-updated"].map(name => remote.$on ? remote.$on(name, () => { load(); }) : null);
        return function () { live.current = false; off.forEach(dispose => { if (typeof dispose === "function") dispose(); }); };
    }, [load, !!props.configured]);
    if (!props.configured) return null;
    async function flip(row, image) {
        setBusy(row.id); setAlert("");
        setState(current => ({ ...current, rows: current.rows.map(item => item.id === row.id ? { ...item, image } : item) }));
        try {
            const doc = modelImageResult(await remote.settings.describe());
            const view = (doc.namespaces || []).find(item => item.ns === MODEL_IMAGE_NS);
            const ops = view && modelImageOps(view, settingsPath, row.id, image);
            if (!ops) throw new Error("这个模型已不在列表里");
            modelImageResult(await remote.settings.mutate(MODEL_IMAGE_NS, ops, view.revision));
        } catch (error) {
            if (!live.current) return;
            setState(current => ({ ...current, rows: current.rows.map(item => item.id === row.id ? { ...item, image: row.image } : item) }));
            setAlert("保存失败：" + (error.message || String(error)));
        } finally { if (live.current) setBusy(""); }
    }
    if (!state.loaded) return h("div", { className: "fork-model-image is-loading" }, h(Spinner, { label: "正在读取模型" }));
    if (state.error) return h("div", { className: "fork-model-image" },
        h("p", { className: "fork-model-image-alert", role: "alert" }, "⚠ 读取模型失败：" + state.error,
            h("button", { type: "button", className: "fork-model-image-retry", onClick: () => { setState(current => ({ ...current, loaded: false, error: "" })); load(); } }, "重试")));
    if (!state.rows.length) return null;
    return h("div", { className: "fork-model-image", role: "group", "aria-label": "能看图" },
        h("div", { className: "fork-model-image-head" }, h("span", null, "能看图"),
            typeof HelpTip === "function" ? h(HelpTip, { label: "能看图说明" }, MODEL_IMAGE_HELP) : null),
        state.rows.map(row => h("div", { key: row.id, className: "fork-model-image-row" },
            h("span", { className: "fork-model-image-name", title: row.name }, row.name),
            h(Switch, { label: row.name + " 能看图", checked: row.image, disabled: !state.writable || !!busy, onChange: checked => flip(row, checked) }))),
        alert ? h("p", { className: "fork-model-image-alert", role: "alert" }, "⚠ " + alert) : null);
}

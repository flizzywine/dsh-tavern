function vendorRuntimeStore(extra) {
    const store = Object.assign({ revision: 0, listeners: new Set(),
        installed(value) {
            if (extra && extra.installed) extra.installed.call(store, value);
            store.revision++;
            for (const listener of store.listeners) listener();
        },
        subscribe(listener) { store.listeners.add(listener); return () => store.listeners.delete(listener); },
        snapshot() { return store.revision; } }, extra && extra.fields);
    return store;
}
const spineRuntimeState = vendorRuntimeStore({ fields: { runtime: "" }, installed(value) { this.runtime = value.runtime || ""; } });
const RUNTIME_MIB = 1024 * 1024;
// One spec per runtime. pieces(status): what has to be in place, each with its official page while missing.
// Spine on stage is the third-party pixi-spine 3.1.2 UMD for PIXI 6 (not Esoteric's spine-player / spine-webgl); it
// embeds Spine runtime code, so the user needs their own Spine Editor licence.
const RUNTIMES = {
    spine: { title: "Spine", store: spineRuntimeState, status: "getSpineRuntimeStatus", import: () => "importSpineRuntime",
        installedOf: status => !!(status && (status.installed || status.runtime)),
        importable: status => status.importSupported === true, accept: () => ".js,text/javascript",
        pieces: status => [{ key: "spine", name: "pixi-spine 3.1.2", installed: !!(status.installed || status.runtime),
            links: [{ label: "获取 Spine 授权", href: status.purchaseUrl || "https://esotericsoftware.com/spine-purchase" },
                { label: "下载", href: status.downloadUrl || "https://www.npmjs.com/package/pixi-spine/v/3.1.2" }] }],
        help: (status, a) => [["pixi-spine 含 Spine 运行库，要有你自己的 Spine 授权；未安装时舞台用静态立绘。"],
            status.importSupported === true ? ["导入包里 dist 文件夹的 pixi-spine.umd.js。许可：",
                a(status.licenseUrl || "https://esotericsoftware.com/spine-runtimes-license", "Spine 运行库许可"), "。文件会在页面里运行，只用这个页面下载的。"]
                : ["暂不能在应用内导入。"]] }
};
async function runtimeFileBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
}
// Contract limits: a bare script ≤ 8 MiB, a downloaded archive ≤ 50 MiB.
function runtimeTooLarge(file) {
    const script = /\.js$/i.test(file.name), limit = (script ? 8 : 50) * RUNTIME_MIB;
    return file.size > limit ? file.name + " 太大（上限 " + (script ? 8 : 50) + " MB）" : "";
}
// {status, error, retry, settle} of one runtime; re-read whenever any entry installs it. settle(value) takes an import
// result directly (a Live2D import that brought one piece tells nobody else: only a usable runtime is announced).
function useRuntimeStatus(kind, request) {
    const spec = RUNTIMES[kind];
    const revision = React.useSyncExternalStore(spec.store.subscribe, spec.store.snapshot);
    const [state, setState] = React.useState({ status: null, error: "" }), [retry, setRetry] = React.useState(0);
    React.useEffect(() => {
        let live = true;
        setState(current => current.error ? { status: current.status, error: "" } : current);
        request(spec.status, {}).then(value => { if (live) setState({ status: value || {}, error: "" }); },
            failure => { if (live) setState(current => ({ status: current.status, error: String(failure && failure.message || failure) })); });
        return () => { live = false; };
    }, [request, revision, retry]);
    return { ...state, installed: spec.installedOf(state.status), retry: () => setRetry(value => value + 1),
        settle: value => setState({ status: value || {}, error: "" }) };
}
// props: request (rpc), kind ("live2d" | "spine"), head (default true; false inside a notice that already names it).
function RuntimeEntry({ request, kind, head = true }) {
    const h = React.createElement, spec = RUNTIMES[kind];
    const read = useRuntimeStatus(kind, request), status = read.status;
    const [busy, setBusy] = React.useState(false), [errors, setErrors] = React.useState([]);
    const active = React.useRef(true), lock = React.useRef(false), picker = React.useRef(null), root = React.useRef(null);
    React.useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
    // One file per call, in order; each result is the new status. Files that fail are listed, the others still count.
    async function pick(files) {
        if (lock.current || !files.length) return;
        lock.current = true; setBusy(true); setErrors([]);
        const failed = [];
        let latest = status;
        try {
            for (const file of files) {
                try {
                    const large = runtimeTooLarge(file);
                    if (large) throw new Error(large);
                    latest = await request(spec.import(latest || {}), { name: file.name, base64: await runtimeFileBase64(file), consent: true }) || {};
                    if (active.current) read.settle(latest);
                } catch (failure) { failed.push((files.length > 1 ? file.name + "：" : "") + String(failure && failure.message || failure)); }
            }
            if (spec.installedOf(latest)) { spec.store.installed(latest); if (active.current) root.current?.focus(); }
        } finally { lock.current = false; if (active.current) { setBusy(false); setErrors(failed); } }
    }
    const Tip = typeof HelpTip === "function" ? HelpTip : null;
    const link = (href, label) => h("a", { key: label, href, target: "_blank", rel: "noopener noreferrer" }, label);
    const tip = status && Tip ? h(Tip, { label: spec.title + " 说明", interactive: true },
        ...spec.help(status, link).map((line, i) => h("span", { key: i }, ...line))) : null;
    const loading = !status && !read.error;
    const state = read.installed ? "installed" : busy ? "importing" : status ? "missing" : read.error ? "error" : "loading";
    const canImport = status && !read.installed && spec.importable(status);
    const pieces = status && !read.installed ? spec.pieces(status) : [];
    return h("div", { ref: root, tabIndex: -1, className: "fork-runtime", "data-runtime": kind, "data-state": state, "aria-busy": busy || loading || undefined,
            role: "group", "aria-label": spec.title },
        head ? h("div", { className: "fork-runtime-head" }, h("strong", null, spec.title), tip,
            read.installed ? h("span", { className: "fork-runtime-state", role: "status" }, "✓ 已安装") : null) : null,
        pieces.length ? h("ul", { className: "fork-runtime-pieces" }, pieces.map(piece =>
            h("li", { key: piece.key, className: "fork-runtime-piece", "data-piece": piece.key, "data-installed": piece.installed || undefined },
                h("span", { className: "fork-runtime-name" }, piece.name),
                piece.installed ? h("span", { className: "fork-runtime-state" }, "✓ 已安装")
                    : h("span", { className: "fork-runtime-links" }, h("span", { className: "fork-runtime-state" }, "未安装"),
                        piece.links.map(item => h("a", { key: item.label, className: "fork-runtime-link", href: item.href, target: "_blank", rel: "noopener noreferrer" },
                            item.label, h("span", { className: "fork-runtime-out", "aria-hidden": true }, "↗"))))))) : null,
        canImport || (!head && pieces.length) ? h("div", { className: "fork-runtime-actions" },
            canImport ? h("button", { type: "button", className: "fork-runtime-import", disabled: busy, onClick: () => picker.current?.click() },
                busy ? h(React.Fragment, null, h(Spinner, { key: "import" }), "正在导入…") : "同意许可并导入…") : null,
            canImport ? h("input", { ref: picker, type: "file", hidden: true, tabIndex: -1, "aria-hidden": true, multiple: !!spec.multiple, accept: spec.accept(status),
                onChange: event => { const files = [...(event.target.files || [])]; event.target.value = ""; pick(files); } }) : null,
            head ? null : tip) : null,
        loading ? h(Spinner, { key: "read" }) : null,
        errors.map((error, i) => h("span", { key: i, className: "fork-runtime-alert", role: "alert" }, "⚠ " + error)),
        read.error && !status ? h("span", { className: "fork-runtime-alert", role: "alert" }, "⚠ " + read.error,
            h("button", { type: "button", className: "fork-runtime-retry", onClick: read.retry }, "重新检测")) : null);
}
// The one Live2D entry (settings, stage notice, model previews).
function SpineRuntimeEntry(props) { return React.createElement(RuntimeEntry, { ...props, kind: "spine" }); }

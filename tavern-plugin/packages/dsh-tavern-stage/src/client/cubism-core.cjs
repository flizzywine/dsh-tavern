// The Live2D optional-runtime entry, not a preference or card mutation.
// Live2D needs two pieces that never ship with the app: Cubism Core (Live2D's proprietary runtime) and the
// pixi-live2d-display cubism4 bundle (it embeds the Cubism Framework). One 「下载并安装…」 asks for both licences in a
// dialog, then the host fetches both from their publishers into the data directory (offline afterwards). Only when that
// fails does the entry name the official pages and take the downloaded files dropped on it.
// Extends the shared runtime entry (spine-runtime-entry.js, included before this file): its store, RUNTIMES and RuntimeEntry.
// `core` is set only when Live2D can run (both pieces); `display` is the host's display bundle URL.
const forkCubismCore = vendorRuntimeStore({ fields: { core: "", display: "" },
    installed(value) { this.core = live2dReadyCore(value); this.display = value.display || ""; } });
function useCubismRevision() {
    return React.useSyncExternalStore(forkCubismCore.subscribe, forkCubismCore.snapshot);
}
// The Core URL when Live2D is usable (both pieces installed).
function live2dReadyCore(status) { return status && status.installed !== false && status.core || ""; }
// The Live2D spec of RuntimeEntry (see RUNTIMES in spine-runtime-entry.js); the pages and licences come from the host status.
RUNTIMES.live2d = { title: "Live2D", store: forkCubismCore, status: "getLive2dRuntime",
    download: "downloadLive2dRuntime", import: () => "importLive2dRuntime",
    installedOf: status => !!live2dReadyCore(status), importable: () => true,
    consent: { action: "下载并安装…", retry: "重新下载…", title: "下载 Live2D 运行库", confirm: "同意并下载",
        body: (status, a) => [["从 Live2D 官网和 npm 下载 Cubism Core 与 pixi-live2d-display，保存在这台电脑上，之后离线可用。"],
            ["继续即表示同意 ", a(status.licenseUrl, "Live2D 专有软件许可"), "（Core）和 ",
                a(status.displayLicenseUrl, "Live2D 开放软件许可"), "（显示库）。"]],
        dropLabel: "拖入运行库文件", drop: "或把下载好的 live2dcubismcore.min.js、cubism4.min.js 拖到这里" },
    pieces: status => [
        { key: "core", name: "Cubism Core", installed: !!status.coreInstalled,
            links: [{ label: "去官网下载", href: status.downloadUrl }] },
        { key: "display", name: "pixi-live2d-display", installed: !!status.displayInstalled,
            links: [{ label: "下载官方发布包", href: status.displayDownloadUrl }] }],
    help: (status, a) => [["Cubism Core 与 pixi-live2d-display 不随应用分发；同意许可后由应用从官方下载一次。"],
        ["许可：", a(status.licenseUrl, "Live2D 专有软件许可"), "（Core）、",
            a(status.displayLicenseUrl, "Live2D 开放软件许可"), "（显示库）。"]] };
// The one Live2D entry (settings, stage notice, model previews).
function CubismCoreEntry(props) { return React.createElement(RuntimeEntry, { ...props, kind: "live2d" }); }

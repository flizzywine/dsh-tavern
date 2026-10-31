// 界面皮肤: the active imported skin is one <style> appended after Tavern's own
// stylesheet, so its rules win at equal specificity. Every browser of this profile
// reads it on load; a change in settings re-applies it here at once.
const TAVERN_INTERFACE_SKIN_ID = "dsh-dream-skin/interface-skin";
const TAVERN_INTERFACE_SKIN_EVENT = "dsh-tavern-interface-skin-changed";
function installTavernInterfaceSkin(doc, css) {
    let style = doc.querySelector('style[data-plugin-css="' + TAVERN_INTERFACE_SKIN_ID + '"]');
    if (!css) { if (style) style.remove(); return; }
    if (!style) {
        style = doc.createElement("style");
        style.dataset.plugin = "dsh-dream-skin";
        style.dataset.pluginCss = TAVERN_INTERFACE_SKIN_ID;
    }
    if (style.textContent !== css) style.textContent = css;
    // Last in <head>, after Tavern's stylesheet and any host style added since.
    if (style !== doc.head.lastElementChild) doc.head.appendChild(style);
}

function createInterfaceSkinModule({ React, rpc, dream, doc = document, target = window }) {
    let disposed = false, generation = 0;
    const order = new MutationObserver(() => {
        const style = doc.querySelector('style[data-plugin-css="' + TAVERN_INTERFACE_SKIN_ID + '"]');
        if (!disposed && style && style !== doc.head.lastElementChild) doc.head.appendChild(style);
    });
    order.observe(doc.head, {childList:true});
    async function applyActiveInterfaceSkin() {
        const current = ++generation;
        const result = await rpc("getActiveInterfaceSkin");
        if (disposed || current !== generation) return;
        if (result?.css && dream && !String(dream.current()).startsWith("tavern-terracotta")) dream.setSkin("tavern-terracotta");
        installTavernInterfaceSkin(doc, result?.css || "");
    }
    function changed() {
        void applyActiveInterfaceSkin().catch(report);
        target.dispatchEvent(new CustomEvent(TAVERN_INTERFACE_SKIN_EVENT));
    }
    function report(error) { console.warn("dsh-dream-skin: CSS skin unavailable", error); }
    function dispose() {
        disposed = true; generation++; order.disconnect();
        installTavernInterfaceSkin(doc, "");
    }

    // An imported skin has no colors to preview; draw it in the current theme's own colors.
    const IMPORTED_SKIN_PREVIEW = { "--dsw-alias-bg-layer-1": "var(--dsw-alias-bg-layer-1)", "--dsw-alias-border-l2": "var(--dsw-alias-border-l2)",
        "--dsw-alias-label-primary": "var(--dsw-alias-label-primary)", "--dsw-alias-brand-primary": "var(--dsw-alias-brand-primary)", "--dsw-alias-label-secondary": "var(--dsw-alias-label-secondary)" };
    // The base a CSS skin is drawn over: Tavern's own colors, following light/dark.
    const CSS_SKIN_BASE = "tavern-terracotta";

    // One 皮肤 row for every look: the bundled dream-skin's color skins (window.dshDreamSkin,
    // stored per browser by dream-skin) and Tavern's CSS skins (stored in the profile).
    // Exactly one is chosen; picking a color skin turns the CSS skin off.
    function InterfaceSkinSettings() {
        const h = React.createElement;

        const [index, setIndex] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        const [themeSkin, setThemeSkin] = React.useState(dream ? dream.current() : null);
        const fileInput = React.useRef(null);
        React.useEffect(function () {
            let active = true;
            rpc("listInterfaceSkins").then(function (result) { if (active) setIndex(result); }, function (err) { if (active) setMessage("读取失败：" + err.message); });
            const off = dream ? dream.onChange(function () { setThemeSkin(dream.current()); }) : null;
            return function () { active = false; if (typeof off === "function") off(); };
        }, []);
        async function run(method, args, notice) {
            setBusy(true); setMessage("");
            try { const next = await rpc(method, args); setIndex(next); changed(); if (notice) setMessage(notice); return next; }
            catch (err) { setMessage("失败：" + String(err && err.message || err)); throw err; }
            finally { setBusy(false); }
        }
        function chooseTheme(id) {
            const pick = function () { if (dream) { dream.setSkin(id); setThemeSkin(dream.current()); } };
            if (index && index.active) void run("selectInterfaceSkin", { id: null }).then(pick, function () {});
            else pick();
        }
        function chooseCss(id) {
            void run("selectInterfaceSkin", { id }).then(function () {
                if (dream && !String(dream.current()).startsWith(CSS_SKIN_BASE)) { dream.setSkin(CSS_SKIN_BASE); setThemeSkin(dream.current()); }
            }, function () {});
        }
        async function importFile(file) {
            if (!file) return;
            try { await run("importInterfaceSkin", { name: file.name, css: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) }, "已导入并启用"); }
            catch (err) { setMessage("导入失败：" + String(err && err.message || err)); }
        }
        const cssSkins = index ? index.skins : [];
        const cssActive = index && index.active || null;
        const themeSkins = dream ? dream.skins() : [];
        const selected = cssActive ? "css:" + cssActive : themeSkins.some(function (skin) { return skin.id === themeSkin; }) ? "theme:" + themeSkin : "default";
        const activeCss = cssSkins.find(function (skin) { return skin.id === cssActive; });
        const disabled = !index || busy;
        const styles = dream ? dream.styles : {};
        function card(key, label, swatch, onSelect) {
            const on = selected === key;
            return h("button", { key, type: "button", disabled, "aria-pressed": on, title: label, onClick: onSelect,
                style: Object.assign({}, styles.card, on ? styles.cardSelected : null) },
                swatch,
                h("span", { style: Object.assign({}, styles.cardLabel, on ? styles.cardLabelSelected : null) }, label));
        }
        function swatch(tokens) { return dream ? h(dream.Swatch, { tokens }) : null; }
        return h("div", { style: styles.group },
            h("div", { style: styles.title }, "皮肤"),
            h("div", { style: styles.grid },
                dream ? card("default", dream.defaultLabel(), h(dream.DefaultSwatch), function () { chooseTheme("system"); }) : null,
                themeSkins.map(function (skin) { return card("theme:" + skin.id, skin.label, swatch(skin.tokens), function () { chooseTheme(skin.id); }); }),
                cssSkins.map(function (skin) { return card("css:" + skin.id, skin.name, swatch(skin.preview || IMPORTED_SKIN_PREVIEW), function () { chooseCss(skin.id); }); })),
            h("div", { style: styles.actionRow },
                h("button", { type: "button", style: styles.button, disabled, onClick: function () { fileInput.current && fileInput.current.click(); } }, "导入皮肤…"),
                activeCss && !activeCss.builtin ? h("button", { type: "button", style: styles.button, disabled, onClick: function () {
                    if (window.confirm("删除皮肤「" + activeCss.name + "」？")) void run("deleteInterfaceSkin", { id: activeCss.id }, "已删除").catch(function () {});
                } }, "删除这套皮肤") : null,
                h("input", { ref: fileInput, type: "file", accept: ".css,text/css", hidden: true, onChange: function (event) { const file = event.target.files && event.target.files[0]; event.target.value = ""; void importFile(file); } })),
            h("div", { role: "status", style: styles.hint }, message || "选一套皮肤，立即生效；导入别人分享的 .css 皮肤文件后也会出现在这里。皮肤只改外观，不影响正文和存档。"));
    }

    return { applyActiveInterfaceSkin, InterfaceSkinSettings, dispose };
}

function installInterfaceSkinSettings(ctx, React, dream) {
    const controller = new AbortController();
    async function rpc(method, args) {
        const response = await fetch('/dream-skin/api', {
            method:'POST', credentials:'same-origin', signal:controller.signal,
            headers:{'content-type':'application/json'}, body:JSON.stringify({method, args})
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error?.message || '皮肤请求失败');
        return result.value;
    }
    ctx.effect(() => {
        let skin, off;
        function dispose() {
            controller.abort();skin?.dispose();
            if (typeof off === 'function') off();else off?.dispose?.();
        }
        try {
            skin = createInterfaceSkinModule({React, rpc, dream});
            off = ctx.slots.inject('settings.dreamSkin.item', () => ctx.slots.register({
                name:'settings.dreamSkin.item', id:'dsh-tavern-interface-skin', order:26
            }, skin.InterfaceSkinSettings));
            void skin.applyActiveInterfaceSkin().catch(error => {
                if (!controller.signal.aborted) console.warn('dsh-dream-skin: CSS skin unavailable', error);
            });
        } catch (error) {
            dispose();
            console.warn('dsh-dream-skin: CSS skin registration failed', error);
        }
        return dispose;
    }, 'dsh-dream-skin: interface skin settings');
}

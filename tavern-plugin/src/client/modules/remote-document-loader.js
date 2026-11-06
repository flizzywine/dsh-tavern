// jQuery's cross-origin script transport is asynchronous even during .html().
// For whole documents loaded into body, retain parser-like script ordering.
function installTavernRemoteDocumentLoader() {
    const $ = window.jQuery;
    if (!$?.fn?.load || $.fn.load.__dshRemoteDocument) return;
    const original = $.fn.load;
    function load(url, params, callback) {
        if (typeof url !== "string" || !/^https?:\/\/\S+$/.test(url) || (params && typeof params === "object") || !this.length || Array.from(this).some(node => node !== document.body)) return original.apply(this, arguments);
        if (typeof params === "function") { callback = params; params = undefined; }
        const collection = this;
        $.ajax({ url: window.__dshTavernStaticAssetUrl?.(url) || url, type: "GET", dataType: "html", data: params }).done(async function (html, status, xhr) {
            try {
                if (!/<(?:!doctype|html|head|body)\b/i.test(html)) collection.html(html);
                else {
                    const parsed = new DOMParser().parseFromString(html, "text/html");
                    const base = new URL(parsed.querySelector("base[href]")?.getAttribute("href") || url, url).href;
                    const hostBase = document.baseURI;
                    parsed.querySelectorAll("base").forEach(node => node.remove());
                    // The resource cache may already have rewritten URLs to host routes.
                    const resolveUrl = value => new URL(value, /^\/api\/dsh-tavern\//.test(value) ? hostBase : base).href;
                    const scripts = [];
                    parsed.querySelectorAll("script").forEach(script => {
                        const marker = parsed.createComment("remote script");
                        scripts.push({ script, marker });
                        script.replaceWith(marker);
                    });
                    parsed.querySelectorAll("[src],link[href]").forEach(node => {
                        for (const name of ["src", "href"]) {
                            if (node.hasAttribute(name)) node.setAttribute(name, resolveUrl(node.getAttribute(name)));
                        }
                    });
                    // .load() inserts head contents into body, too. Keep their styles,
                    // but not document indentation: body preserves prose line breaks.
                    const nodes = [...parsed.head.childNodes, ...parsed.body.childNodes].filter(node => node.nodeType !== 3 || /\S/.test(node.nodeValue || ""));
                    collection.empty();
                    document.body.append(...nodes);
                    for (const { script, marker } of scripts) {
                        if (!marker.isConnected) continue;
                        const next = document.createElement("script");
                        for (const attr of script.attributes) if (attr.name !== "src") next.setAttribute(attr.name, attr.value);
                        next.textContent = script.textContent;
                        if (script.hasAttribute("src")) next.src = resolveUrl(script.getAttribute("src"));
                        const executable = !next.type || /^(?:text|application)\/(?:java|ecma)script$/i.test(next.type) || next.type === "module";
                        if (executable && (next.src || next.type === "module")) {
                            await new Promise(resolve => {
                                next.onload = next.onerror = resolve;
                                marker.replaceWith(next);
                            });
                        } else marker.replaceWith(next);
                    }
                }
                collection.each(function () { callback?.call(this, html, status, xhr); });
            } catch (error) {
                console.error("[DSH Tavern] Remote document load failed", error);
                collection.each(function () { callback?.call(this, html, "error", xhr); });
            }
        }).fail(function (xhr, status) {
            collection.each(function () { callback?.call(this, xhr.responseText, status, xhr); });
        });
        return collection;
    }
    load.__dshRemoteDocument = true;
    $.fn.load = load;
}

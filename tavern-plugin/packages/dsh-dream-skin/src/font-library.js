// Shared font catalog and face lifetime. Role/skin precedence belongs to consumers.
function createSkinFontLibrary({document:doc, request}) {
    let fonts = null, pending = null, style = null, disposed = false;
    const registered = new Set();
    async function list() {
        if (disposed) return [];
        if (fonts) return fonts;
        if (!pending) pending = Promise.resolve().then(request).then(result => {
            if (disposed) return [];
            fonts = Object.freeze((result.fonts || []).filter(font => /^[a-z0-9][a-z0-9-]{0,79}$/.test(font.id) && /^[a-zA-Z0-9 _-]{1,120}$/.test(font.family) && Array.isArray(font.files)));
            return fonts;
        }).finally(() => {pending = null;});
        return pending;
    }
    async function ensure(id) {
        const font = (await list()).find(row => row.id === id);
        if (disposed || !font || registered.has(id)) return font || null;
        const rules = font.files.filter(face => ['woff2','truetype','opentype'].includes(face.format) && ['normal','italic','oblique'].includes(face.style)
            && Number.isInteger(face.weight) && face.weight >= 1 && face.weight <= 1000
            && new RegExp('^/dream-skin/fonts/' + id + '/[a-zA-Z0-9][a-zA-Z0-9._-]*\\.(woff2|ttf|otf)$').test(face.url))
            .map(face => '@font-face{font-family:' + JSON.stringify(font.family) + ';src:url(' + JSON.stringify(face.url) + ') format(' + JSON.stringify(face.format) + ');font-weight:' + face.weight + ';font-style:' + face.style + ';font-display:swap;}');
        if (!rules.length) return null;
        if (!style) {style = doc.createElement('style');style.dataset.dshSkinFonts = '';doc.head.appendChild(style);}
        style.appendChild(doc.createTextNode(rules.join('\n')));registered.add(id);
        return font;
    }
    return Object.freeze({list,ensure,createPicker:createSkinFontPicker,dispose() {disposed=true;fonts=null;style?.remove();registered.clear();}});
}
function installSkinFontLibrary(ctx) {
    ctx.effect(() => {
        const controller = new AbortController();
        const library = createSkinFontLibrary({document, request:async () => {
            const response = await fetch('/dream-skin/api', {method:'POST',credentials:'same-origin',signal:controller.signal,
                headers:{'content-type':'application/json'},body:JSON.stringify({method:'listFonts'})});
            const result = await response.json();
            if (!response.ok || !result.ok) throw Error('字体库暂时不可用');
            return result.value;
        }});
        const style = document.createElement('style');style.dataset.dshSkinFontPicker = '';style.textContent = SKIN_FONT_PICKER_CSS;document.head.appendChild(style);
        window.dshSkinFonts = library;
        window.dispatchEvent(new Event('dsh-font-library-changed'));
        return () => {
            controller.abort();library.dispose();style.remove();
            if (window.dshSkinFonts === library) {delete window.dshSkinFonts;window.dispatchEvent(new Event('dsh-font-library-changed'));}
        };
    }, 'dsh-dream-skin: font library');
}

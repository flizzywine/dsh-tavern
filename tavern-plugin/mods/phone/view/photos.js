'use strict';
// the phone's 照片 app, laid out as the iOS 26 Photos 图库 (measured from MacRumors' iOS 26 screenshots): a five-column grid of square tiles 1 pt apart, oldest first and scrolled to
// the newest, under a large 「图库」 title with the count and a glass ＋ (import a picture from this computer). A tile opens the
// picture full screen; swipe (or ← →) moves between pictures, a tap hides the bars; the bottom bar has 「用作墙纸」 and the
// glass trash (删除, confirmed by an action sheet). No albums, editing, favourites, years/months or search: only what works.
// The library is the phone's one picture store: `config.photos` from the stage's settings adapter
// ([{id, layer, file, name, url}], url a thumbnail; config.full[id] the full picture once asked with `open`). Every write
// goes through `ask` (phone.settings): pick {layer} · add {layer, value: {src, name?}} · remove {choice} · open {choice}
// · save {key: 'wallpaper', layer, choice}.
function phoneModPhotos({app, ask, scope, reduced}) {
    const $ = id => app.querySelector('#' + id);
    const grid = $('photo-grid'), count = $('photos-count'), status = $('photos-status'), root = $('photos-root'), viewer = $('photo-viewer');
    const track = viewer.querySelector('.viewer-track'), slides = [...track.children], note = $('viewer-note'), sheet = $('photo-confirm');
    const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
    let config = null, shown = null, error = '', noteTimer = 0, sheetReturn = null;
    const requested = new Set();
    const list = () => config && Array.isArray(config.photos) ? config.photos : [];
    const indexOf = id => list().findIndex(row => row.id === id);
    const label = (row, i) => (row.name || '照片') + '，第 ' + (i + 1) + ' 张，共 ' + list().length + ' 张';
    function say(text) { clearTimeout(noteTimer); note.textContent = text; note.hidden = !text; if (text) noteTimer = setTimeout(() => { note.hidden = true; note.textContent = ''; }, 1800); }
    async function run(op, data, failText) {
        try { await ask(op, data); error = ''; return true; }
        catch (e) { error = (failText ? failText + '：' : '') + (e.message || '出错了'); paint(); return false; }
    }
    // ---- 图库 ----
    function paintGrid() {
        const rows = list(), ready = config && config.status === 'ready', focused = grid.contains(document.activeElement) ? document.activeElement.dataset.id : null;
        count.textContent = ready && rows.length ? rows.length + ' 张照片' : '';
        status.replaceChildren();
        if (config && (config.status === 'loading' || config.status === 'idle')) { status.className = 'photos-status is-loading'; status.append(make('i', 'spin'), make('span', '', '正在载入…')); }
        else if (config?.status === 'error') { status.className = 'photos-status'; status.append(make('span', '', '无法载入照片。')); const again = make('button', 'link', '重试'); again.type = 'button'; again.onclick = () => ask('load').catch(() => {}); status.append(again); }
        else if (!rows.length) { status.className = 'photos-empty'; status.append(make('strong', '', '没有照片')); }
        if (error) { const line = make('span', 'photos-error', error + '。'); line.setAttribute('role', 'alert'); status.append(line); }
        status.hidden = !status.childNodes.length;
        const keep = new Map([...grid.children].map(node => [node.dataset.id, node]));
        const nodes = rows.map((row, i) => {
            let tile = keep.get(row.id);
            if (!tile) { tile = make('button', 'photo-tile'); tile.type = 'button'; tile.dataset.id = row.id; tile.append(make('img')); tile.firstChild.alt = ''; tile.onclick = () => openViewer(row.id); }
            tile.setAttribute('aria-label', label(row, i));
            const img = tile.firstChild; if (row.url && img.getAttribute('src') !== row.url) img.src = row.url; img.hidden = !row.url;
            return tile;
        });
        if (nodes.length !== grid.children.length || nodes.some((node, i) => grid.children[i] !== node)) grid.replaceChildren(...nodes);
        if (focused) grid.querySelector('[data-id="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
    }
    // ---- the viewer: three slides (before, this, after); a horizontal drag moves the strip ----
    function paintViewer() {
        const rows = list(), at = indexOf(shown);
        viewer.hidden = shown === null;
        app.dataset.page = shown === null ? 'root' : 'viewer';
        root.inert = shown !== null;
        if (shown === null) return;
        for (const [k, slide] of slides.entries()) {
            const row = rows[at + k - 1], img = slide.firstChild;
            slide.style.visibility = row ? '' : 'hidden';
            if (!row) continue;
            const url = config.full?.[row.id] || row.url;
            if (url && img.getAttribute('src') !== url) img.src = url;
        }
        viewer.setAttribute('aria-label', label(rows[at], at));
        $('viewer-place').textContent = (at + 1) + ' / ' + rows.length;
        for (const row of [rows[at], rows[at - 1], rows[at + 1]]) if (row && !config.full?.[row.id] && !requested.has(row.id)) { requested.add(row.id); ask('open', { choice: row.id }).catch(() => requested.delete(row.id)); }
        for (const id of requested) if (config.full?.[id]) requested.delete(id);
    }
    function paint() { paintGrid(); paintViewer(); }
    function openViewer(id) {
        shown = id; error = ''; viewer.dataset.chrome = 'on'; paint();
        $('viewer-wall').focus({ preventScroll: true });
    }
    function closeViewer() {
        if (shown === null) return;
        const id = shown; shown = null; closeSheet(false); paint();
        const tile = grid.querySelector('[data-id="' + CSS.escape(id) + '"]');
        tile?.scrollIntoView({ block: 'nearest' }); (tile || $('photos-add')).focus({ preventScroll: true });
    }
    function step(delta) {
        const rows = list(), at = indexOf(shown), next = rows[at + delta];
        if (!next) { settle(0); return; }
        if (reduced()) { shown = next.id; settle(0, true); paint(); return; }
        settle(-delta * track.clientWidth / 3, false, () => { shown = next.id; paint(); settle(0, true); });
    }
    function settle(x, instant = false, done) {
        track.style.transition = instant ? 'none' : 'transform 280ms cubic-bezier(.25, .8, .25, 1)';
        track.style.transform = 'translateX(calc(-100% / 3 + ' + x + 'px))';
        if (done) setTimeout(done, instant ? 0 : 280);
    }
    let drag = null;
    track.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, t: performance.now(), dx: 0, moved: false }; track.setPointerCapture(event.pointerId); };
    track.onpointermove = event => {
        if (!drag) return;
        drag.dx = event.clientX - drag.x;
        if (!drag.moved && Math.abs(drag.dx) > 6 && Math.abs(drag.dx) > Math.abs(event.clientY - drag.y)) drag.moved = true;
        if (drag.moved) settle(drag.dx, true);
    };
    track.onpointerup = () => {
        if (!drag) return;
        const { dx, moved, t } = drag, width = track.clientWidth / 3, fast = Math.abs(dx) / Math.max(1, performance.now() - t) > .5; drag = null;
        if (!moved) { viewer.dataset.chrome = viewer.dataset.chrome === 'off' ? 'on' : 'off'; return; }
        if ((Math.abs(dx) > width * .2 || fast) && list()[indexOf(shown) - Math.sign(dx)]) step(-Math.sign(dx)); else settle(0);
    };
    track.onpointercancel = () => { drag = null; settle(0); };
    viewer.addEventListener('keydown', event => {
        if (!sheet.hidden) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
        else if (event.key === 'Delete') { event.preventDefault(); askDelete(); }
    });
    // 用作墙纸: the picture becomes the wallpaper of the scope Settings edits (此角色卡 / 所有角色卡).
    $('viewer-wall').onclick = async () => {
        const id = shown; if (id === null) return;
        if (await run('save', { key: 'wallpaper', layer: scope(), choice: id }, '无法用作墙纸')) say('已用作墙纸'); else say(error);
    };
    // ---- delete: an iOS action sheet ----
    function askDelete() {
        if (shown === null) return;
        sheetReturn = document.activeElement; sheet.hidden = false; viewer.inert = true;
        requestAnimationFrame(() => $('photo-confirm-cancel').focus({ preventScroll: true }));
    }
    function closeSheet(restore = true) {
        if (sheet.hidden) return;
        sheet.hidden = true; viewer.inert = false;
        if (restore && sheetReturn?.isConnected) sheetReturn.focus({ preventScroll: true });
    }
    $('viewer-delete').onclick = askDelete;
    $('photo-confirm-cancel').onclick = () => closeSheet();
    sheet.onclick = event => { if (event.target === sheet) closeSheet(); };
    sheet.onkeydown = event => { if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === $('photo-confirm-ok') ? $('photo-confirm-cancel') : $('photo-confirm-ok')).focus(); } };
    $('photo-confirm-ok').onclick = async () => {
        const id = shown, rows = list(), at = indexOf(id), neighbour = rows[at + 1] || rows[at - 1];
        closeSheet(false);
        if (!(await run('remove', { choice: id }, '无法删除'))) { say(error); return; }
        // The next picture takes its place, as on iOS; the last one deleted goes back to 图库.
        if (neighbour) { shown = neighbour.id; paint(); $('viewer-delete').focus({ preventScroll: true }); } else closeViewer();
    };
    $('viewer-back').onclick = closeViewer;
    $('photos-add').onclick = () => run('pick', { layer: scope() }, '无法导入').then(() => { paintGrid(); const box = root.querySelector('.scroll'); box.scrollTop = box.scrollHeight; });
    settle(0, true);
    let opened = false;
    return {
        update(next) {
            config = next;
            if (shown !== null && indexOf(shown) < 0) { shown = null; closeSheet(false); }
            paint();
            // iOS opens 图库 at the newest picture (the bottom).
            if (!opened && list().length) { opened = true; const box = root.querySelector('.scroll'); requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; }); }
        },
        // Esc / the home bar: the sheet, then the viewer; false = leave the app.
        back() { if (!sheet.hidden) { closeSheet(); return true; } if (shown !== null) { closeViewer(); return true; } return false; },
        reset() { shown = null; error = ''; opened = false; closeSheet(false); paint(); },
        focus() { (shown !== null ? $('viewer-wall') : grid.querySelector('.photo-tile:last-child') || $('photos-add')).focus({ preventScroll: true }); },
        scroller: () => shown === null ? root.querySelector('.scroll') : null,
        // The API for other phone features (a FaceTime snapshot): a picture (data: URL) into 照片, the library's own write path.
        add: (src, name) => ask('add', { layer: 'card', value: { src, name } }),
    };
}

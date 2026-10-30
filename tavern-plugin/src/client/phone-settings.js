// every phone customisation — colours,
// wallpaper, model, status bar, the message tone — is set in the phone's own Settings app (tavern-plugin/mods/phone/view). Each
// setting applies immediately to the selected scope (this card / every card's default); a card's value wins over the global
// one, which wins over the built-in default. Reset clears that scope's value. The store is the phone's two-layer mod config
// (全局 file + the card's private pack), the same one the right sidebar reads; contacts stay there.
// the phone's 照片 app is its one picture library — the `photos` setting of
// both layers (本卡 pictures, then 所有角色卡 pictures; each oldest first). The wallpaper is one of them (`wallpaper` {file} of
// the same layer; {} = the built-in wallpaper).
//
// usePhoneSettings({sessionId, call?}) → {view, request}
//   view: one frozen object per state (the sandbox posts it to the phone as `phone.config` when its identity changes):
//     {status: 'idle'|'loading'|'ready'|'error', error, fields: [{key, label, type, choices, min, max, auto}],
//      values: {[key]: {value, level: 'card'|'global'|'default', kind, card?, global?}}, autos: {[key]: colour},
//      photos: [{id, layer, file, name, url}] (url: a thumbnail), walls: [{id, layer, file, url, shown}] (each layer's
//      wallpaper picture), full: {[id]: url} (pictures opened in 照片, at most PHONE_FULL_KEEP)}
//   request(message) → Promise: the phone's `phone.settings` {op, key?, layer?, value?, choice?}:
//     load · save {key, layer, value: {fixed} | {auto: true}} · save {key: 'wallpaper', layer, choice: photo id | 'none'}
//     · clear {key, layer} · pick {layer} (a picture from this computer into 照片) · add {layer, value: {src, name?}} (a
//     picture another phone feature made, e.g. a FaceTime snapshot: a data: URL) · remove {choice: photo id} · open {choice}.
//   call(method, args) defaults to the host RPC; every write carries the last revision (CAS) and a conflict reloads.
const PHONE_SETTING_KEYS = ['wallpaper', 'accentColor', 'surfaceColor', 'bodyColor', 'cutout', 'statusBar', 'clockText', 'carrier', 'signal', 'battery', 'sound'];
const PHONE_PHOTO_BYTES = 480 * 1024, PHONE_THUMB = 320, PHONE_FULL_KEEP = 6;
// FORK-PHONE-SETTINGS-BEGIN (pure; tests/fork-phone-settings.test.mjs)
const phoneModOwn = (layer, key) => !!layer && Object.prototype.hasOwnProperty.call(layer, key);
const phoneModKind = stored => !stored ? null : phoneModOwn(stored, 'fixed') ? 'fixed' : phoneModOwn(stored, 'ref') ? 'ref' : phoneModOwn(stored, 'formula') ? 'formula' : 'auto';
// Where a setting is saved: 本卡 over 全局 over the built-in default.
const phoneModLevel = (data, key) => phoneModOwn(data.card, key) ? 'card' : phoneModOwn(data.global, key) ? 'global' : 'default';
// A layer's pictures in 照片, oldest first.
const phoneModPhotoRows = layer => layer && layer.photos && Array.isArray(layer.photos.fixed) ? layer.photos.fixed : [];
// A layer's wallpaper picture (a file of that layer), or '' for none / the built-in one.
const phoneModWallFile = layer => layer && layer.wallpaper && layer.wallpaper.fixed && typeof layer.wallpaper.fixed.file === 'string' ? layer.wallpaper.fixed.file : '';
// A picture id is '<layer>:<file>'; 'none' is the built-in wallpaper.
const phoneModChoice = choice => { const at = choice.indexOf(':'); return at < 0 ? { from: choice, file: '' } : { from: choice.slice(0, at), file: choice.slice(at + 1) }; };
const PHONE_PHOTOS_MAX = 30;
// 照片 after adding `file` to a layer (newest last); a full library refuses rather than dropping the player's pictures.
function phoneModPhotosAfterAdd(rows, file, name, anchor) {
    if (rows.length >= PHONE_PHOTOS_MAX) throw Object.assign(new Error('照片已满（最多 ' + PHONE_PHOTOS_MAX + ' 张），请先删除一些照片'), { code: 'PHOTOS_FULL' });
    return [...rows.map(row => ({ ...row })), { file, ...(name ? { name } : {}), ...(anchor ? { anchor: { ...anchor } } : {}) }];
}
function phoneModTakePhoto(snapshot, request, anchor) {
    // Capture the shutter position before frame rendering or the config write can yield.
    const captured = { ...anchor };
    return snapshot().then(src => request({ op: 'add', layer: 'card', value: { src, name: 'FaceTime', anchor: captured } }));
}
function phoneModSettingsView(data, { status, error, thumbs, full, autos }) {
    const schema = data && data.schema, list = Array.isArray(schema) ? schema : schema && schema.fields || [];
    const fields = PHONE_SETTING_KEYS.map(key => list.find(field => field.key === key)).filter(Boolean).map(field => ({
        key: field.key, label: String(field.label || field.key), type: field.ui && field.ui.control || field.valueType,
        choices: (field.ui && field.ui.choices || []).map(row => ({ value: row.value, label: String(row.label) })),
        min: field.min, max: field.max, auto: !!(field.autoRef || field.guessHints), unit: field.ui && field.ui.unit || '', default: field.default
    }));
    const values = {};
    if (data) for (const field of fields) {
        const resolved = data.resolved && data.resolved[field.key], level = phoneModLevel(data, field.key);
        values[field.key] = { value: resolved && !resolved.error ? resolved.value : field.key === 'wallpaper' ? {} : null, level,
            kind: phoneModKind(level === 'card' ? data.card[field.key] : level === 'global' ? data.global[field.key] : null) || 'auto',
            ...(phoneModOwn(data.card, field.key) ? { card: data.card[field.key] } : {}), ...(phoneModOwn(data.global, field.key) ? { global: data.global[field.key] } : {}) };
    }
    const photos = data ? ['card', 'global'].flatMap(layer => phoneModPhotoRows(data[layer]).map(row => ({
        id: layer + ':' + row.file, layer, file: row.file, name: row.name || '', ...(row.anchor ? { anchor: { ...row.anchor } } : {}), url: thumbs[layer + ':' + row.file] || '' }))) : [];
    const walls = data ? ['card', 'global'].map(layer => ({ layer, file: phoneModWallFile(data[layer]) })).filter(row => row.file)
        .map(row => ({ id: row.layer + ':' + row.file, layer: row.layer, file: row.file, url: thumbs[row.layer + ':' + row.file] || '', shown: true })) : [];
    return Object.freeze({ status, error: error || '', fields, values, autos: autos || {}, photos, walls, full: { ...full } });
}
// What saving a value to a layer writes. 自动 on 全局 is the default itself (clear); on 本卡 it is pinned ({auto: true}),
// so the card keeps following the automatic source even when 全局 is set.
function phoneModWriteOf(layer, value) {
    if (value.auto === true) return layer === 'global' ? { clear: true } : { set: { auto: true } };
    return { set: { fixed: value.fixed } };
}
// FORK-PHONE-SETTINGS-END
// Player wording through the one shared playerErrorText (asset-pack-ui.js): no code, no English.
const phoneModErrorText = error => playerErrorText(error || '出错了');
// The automatic colours (the stage source's values the colour fields follow when 自动), from listModConfigSources.
function phoneModAutoColours(sources, list) {
    const stage = (sources || []).find(row => row.id === 'stage'), find = (nodes, path) => {
        for (const node of nodes || []) { if (node.path === path) return node; if (path.startsWith(node.path + '/')) return find(node.children, path); }
        return null;
    };
    const out = {};
    for (const field of list) if (field.autoRef && field.autoRef.source === 'stage') {
        const node = stage && find(stage.tree, field.autoRef.path), value = node && typeof node.value === 'string' && /^#[0-9a-f]{6}$/i.test(node.value) ? node.value : field.default;
        if (typeof value === 'string') out[field.key] = value;
    }
    return out;
}
// A picture → a data URL no larger than `max` px on its long side, for the library's thumbnails.
async function phoneModScaled(src, max, type, quality) {
    const image = new Image(); image.src = src; await image.decode();
    const k = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * k)); canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, quality);
}
// A picture for 照片 (a data: URL from this computer or a phone feature), made to fit the phone and the upload limit: at
// most 2048 px on its long side, WebP, a lower quality / size until it is under the limit.
async function phoneModPhotoMedia(src) {
    for (const [max, quality] of [[2048, .86], [2048, .74], [1600, .72], [1280, .68]]) {
        const url = await phoneModScaled(src, max, 'image/webp', quality), data = url.replace(/^data:[^,]*,/, '');
        if (data.length * 3 / 4 <= PHONE_PHOTO_BYTES) return { mime: 'image/webp', data, url };
    }
    throw new Error('这张图片太大');
}
const phoneModConflict = e => !!e && /REVISION_CONFLICT$/.test(e.code || '');
function usePhoneSettings({ sessionId, call: callProp }) {
    const call = React.useCallback((method, args) => callProp ? callProp(method, args) : rpc(method, args, sessionId), [callProp, sessionId]);
    const [state, setState] = React.useState({ status: 'idle', error: '', data: null, autos: {} });
    const [thumbs, setThumbs] = React.useState({}), [full, setFull] = React.useState({});
    const latest = React.useRef(null), queue = React.useRef(Promise.resolve()), life = React.useRef(0), asked = React.useRef(new Set()), picker = React.useRef(null);
    React.useEffect(() => { life.current++; latest.current = null; asked.current = new Set(); setState({ status: 'idle', error: '', data: null, autos: {} }); setThumbs({}); setFull({}); }, [sessionId]);
    React.useEffect(() => () => { if (picker.current) picker.current.remove(); }, []);
    const accept = data => { latest.current = data; setState(old => ({ ...old, status: 'ready', error: '', data })); };
    const load = async () => {
        const mine = life.current;
        setState(old => ({ ...old, status: old.data ? old.status : 'loading' }));
        try {
            const [data, sources] = await Promise.all([call('getModConfig', { modId: 'dsh.phone', sessionId }), call('listModConfigSources', { sessionId }).catch(() => null)]);
            if (mine !== life.current) return;
            const list = Array.isArray(data.schema) ? data.schema : data.schema && data.schema.fields || [];
            latest.current = data; setState({ status: 'ready', error: '', data, autos: phoneModAutoColours(sources && sources.sources, list) });
        } catch (e) { if (mine === life.current) setState(old => ({ ...old, status: old.data ? 'ready' : 'error', error: phoneModErrorText(e) })); }
    };
    // One write at a time with the newest revision; a conflict reloads, and the phone shows the reason.
    const write = task => {
        const mine = life.current;
        const run = queue.current.then(async () => {
            if (mine !== life.current) return;
            if (!latest.current) await load();
            try { await task(); }
            catch (e) {
                if (mine !== life.current) return;
                if (phoneModConflict(e)) await load();
                setState(old => ({ ...old, error: phoneModConflict(e) ? '设置刚在别处改过，请再试一次' : phoneModErrorText(e) }));
                throw e;
            }
        });
        queue.current = run.catch(() => null);
        return run;
    };
    const set = async (key, layer, value) => accept(await call('setModConfig', { modId: 'dsh.phone', sessionId, key, layer, value, expectedRevision: latest.current.revision }));
    const clear = async (key, layer) => { if (phoneModOwn(latest.current[layer], key)) accept(await call('clearModConfig', { modId: 'dsh.phone', sessionId, key, layer, expectedRevision: latest.current.revision })); };
    const upload = async (layer, media) => {
        const done = await call('uploadModConfigFile', { modId: 'dsh.phone', layer, sessionId, mime: media.mime, data: media.data, expectedRevision: latest.current.revision });
        latest.current = { ...latest.current, revision: done.revision };
        return done.file.path;
    };
    // 照片's one write path: a picture (data: URL) into `layer`'s files/ and onto the end of that layer's library.
    const addPhoto = async (layer, src, name, anchor) => {
        const media = await phoneModPhotoMedia(src), rows = phoneModPhotoRows(latest.current[layer]);
        phoneModPhotosAfterAdd(rows, 'files/x', name);
        const file = await upload(layer, media), thumb = await phoneModScaled(media.url, PHONE_THUMB, 'image/jpeg', .82);
        asked.current.add(layer + ':' + file); setThumbs(old => ({ ...old, [layer + ':' + file]: thumb }));
        await set('photos', layer, { fixed: phoneModPhotosAfterAdd(phoneModPhotoRows(latest.current[layer]), file, String(name || '').trim().slice(0, 64), anchor) });
    };
    const wallpaper = async (layer, choice) => {
        // The built-in wallpaper: 全局 is the default itself; a card keeps {} so it shows it even when 全局 has a picture.
        if (choice === 'none') return layer === 'global' ? clear('wallpaper', 'global') : set('wallpaper', 'card', { fixed: {} });
        const { from, file } = phoneModChoice(choice);
        let own = file;
        if (from !== layer) {
            // Files belong to their layer: a picture of the other layer is uploaded again (not added to this layer's 照片).
            const read = await call('readModConfigFile', { modId: 'dsh.phone', layer: from, sessionId, path: file });
            own = await upload(layer, { mime: read.file.mime, data: read.data });
        }
        await set('wallpaper', layer, { fixed: { file: own } });
    };
    const pick = layer => new Promise((resolve, reject) => {
        // A file chooser of the stage page: the tap in the phone frame is the user activation it needs.
        if (!picker.current) { picker.current = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true }); picker.current.setAttribute('data-fork-phone-photos', ''); document.body.append(picker.current); }
        const input = picker.current;
        input.oncancel = () => resolve();
        input.onchange = () => {
            const file = input.files && input.files[0]; input.value = '';
            if (!file) { resolve(); return; }
            const reader = new FileReader();
            reader.onerror = () => reject(reader.error);
            reader.onload = () => write(() => addPhoto(layer, String(reader.result), String(file.name || '').replace(/\.[^.]+$/, ''))).then(resolve, reject);
            reader.readAsDataURL(file);
        };
        input.click();
    });
    const remove = choice => write(async () => {
        const { from: layer, file } = phoneModChoice(choice), rest = phoneModPhotoRows(latest.current[layer]).filter(row => row.file !== file).map(row => ({ ...row }));
        return rest.length ? set('photos', layer, { fixed: rest }) : clear('photos', layer);
    });
    // A picture opened in 照片, at full size (the newest few are kept).
    const open = async choice => {
        if (full[choice]) return;
        const { from, file } = phoneModChoice(choice), mine = life.current;
        const read = await call('readModConfigFile', { modId: 'dsh.phone', layer: from, sessionId, path: file });
        if (mine === life.current) setFull(old => Object.fromEntries([...Object.entries(old).filter(([id]) => id !== choice), [choice, 'data:' + read.file.mime + ';base64,' + read.data]].slice(-PHONE_FULL_KEEP)));
    };
    const request = React.useCallback(message => {
        const { op, key, layer, value, choice } = message || {};
        if (op === 'load') return load();
        if (op === 'open' && typeof choice === 'string') return open(choice);
        if (op === 'remove' && typeof choice === 'string') return remove(choice);
        if (!['card', 'global'].includes(layer)) return Promise.reject(new Error('未知的设置'));
        if (op === 'pick') return pick(layer);
        if (op === 'add' && value && typeof value.src === 'string' && value.src.startsWith('data:image/')) return write(() => addPhoto(layer, value.src, value.name, value.anchor ? { ...value.anchor } : undefined));
        if (!PHONE_SETTING_KEYS.includes(key)) return Promise.reject(new Error('未知的设置'));
        if (op === 'clear') return write(() => clear(key, layer));
        if (op === 'save' && key === 'wallpaper' && typeof choice === 'string') return write(() => wallpaper(layer, choice));
        if (op === 'save' && value && typeof value === 'object') return write(() => {
            const plan = phoneModWriteOf(layer, value);
            return plan.clear ? clear(key, layer) : set(key, layer, plan.set);
        });
        return Promise.reject(new Error('未知的设置'));
    }, [call, sessionId, full]);
    // Thumbnails of both layers' pictures and wallpapers, read once per file (readModConfigFile), scaled for the grid.
    React.useEffect(() => {
        const data = state.data, mine = life.current;
        if (!data) return;
        for (const layer of ['card', 'global']) for (const file of [...phoneModPhotoRows(data[layer]).map(row => row.file), phoneModWallFile(data[layer])].filter(Boolean)) {
            const id = layer + ':' + file;
            if (asked.current.has(id)) continue;
            asked.current.add(id);
            call('readModConfigFile', { modId: 'dsh.phone', layer, sessionId, path: file })
                .then(read => phoneModScaled('data:' + read.file.mime + ';base64,' + read.data, PHONE_THUMB, 'image/jpeg', .82))
                .then(url => { if (mine === life.current) setThumbs(old => ({ ...old, [id]: url })); }, () => { asked.current.delete(id); });
        }
    }, [state.data]);
    const view = React.useMemo(() => phoneModSettingsView(state.data, { status: state.status, error: state.error, thumbs, full, autos: state.autos }), [state, thumbs, full]);
    return React.useMemo(() => ({ view, request }), [view, request]);
}

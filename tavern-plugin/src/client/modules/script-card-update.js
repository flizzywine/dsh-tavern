// Card scripts written for SillyTavern update their own card through its server routes
// (/api/characters/*, /api/worldinfo/*). DSH has no such server. Here those calls become
// DSH's own card update (the card library's 「更新人物卡」: the card is replaced in place,
// chats stay, the old card is backed up), for the card of the conversation on screen
// only, and only after the player confirms. World books a script writes stay pending
// here until it writes the card; that write carries them into the one update. A copy
// the script makes of the card (its "backup") also stays here: DSH backs the card up itself.
const TAVERN_SCRIPT_CARD_ROUTES = new Set(['/csrf-token', '/api/settings/get', '/api/characters/get', '/api/characters/export',
    '/api/characters/duplicate', '/api/characters/edit', '/api/worldinfo/get', '/api/worldinfo/edit', '/api/worldinfo/delete']);

// The site of the first script outside DSH on the call stack: where the update comes from.
function tavernScriptCardSource(stack, origin) {
    for (const match of String(stack || '').matchAll(/https?:\/\/[^\s)'"]+/g)) {
        try {
            const url = new URL(match[0].replace(/(:\d+){1,2}$/, ''));
            if (url.origin !== origin) return url.origin;
        } catch (_) { /* not a URL */ }
    }
    return '';
}

// Version shown for each side: the card's character_version, or else the version an
// extension of the card records for itself (a self-updating card's own marker).
function tavernScriptCardVersions(before, after) {
    const a = before?.data || before || {}, b = after?.data || after || {};
    const own = (card, key) => { const value = card.extensions?.[key]?.version; return typeof value === 'string' ? value : ''; };
    if (String(a.character_version || '') !== String(b.character_version || '')) return [String(a.character_version || ''), String(b.character_version || '')];
    for (const key of Object.keys(b.extensions || {})) if (own(b, key) && own(a, key) !== own(b, key)) return [own(a, key), own(b, key)];
    return [String(a.character_version || ''), String(b.character_version || '')];
}

// What the update changes, one line per kind, for the confirmation.
function tavernScriptCardChanges(before, after, beforeWorld, afterWorld, coverChanged) {
    const a = before?.data || before || {}, b = after?.data || after || {}, lines = [];
    const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    const counts = (added, changed, removed) => [added && '新增 ' + added, changed && '改动 ' + changed, removed && '删除 ' + removed].filter(Boolean).join('、');
    function compare(label, left, right, key) {
        const old = new Map(left.map(item => [key(item), item])), next = new Map(right.map(item => [key(item), item]));
        let added = 0, changed = 0, removed = 0;
        for (const [id, item] of next) if (!old.has(id)) added++; else if (!same(old.get(id), item)) changed++;
        for (const id of old.keys()) if (!next.has(id)) removed++;
        if (added || changed || removed) lines.push(label + '：' + counts(added, changed, removed) + ' 条');
    }
    if (String(a.name || '') !== String(b.name || '')) lines.push('人物名：' + a.name + ' → ' + b.name);
    const fields = [['description', '人物描述'], ['personality', '性格'], ['scenario', '场景'], ['first_mes', '开场白'], ['alternate_greetings', '备选开场白'],
        ['mes_example', '对话示例'], ['system_prompt', '系统提示词'], ['post_history_instructions', '历史后指令'], ['creator_notes', '作者备注']];
    const rewritten = fields.filter(([key]) => !same(a[key], b[key])).map(([, label]) => label);
    if (rewritten.length) lines.push('改写：' + rewritten.join('、'));
    // What an entry says and when it fires; the rest differs between World Info writers.
    const entries = world => Object.values(world?.entries || {}).map(e => ({ comment: e.comment || '', content: e.content || '', key: e.key || [], keysecondary: e.keysecondary || [], constant: !!e.constant, disable: !!e.disable }));
    if (beforeWorld && !afterWorld) lines.push('去掉世界书');
    else compare('世界书', entries(beforeWorld), entries(afterWorld), entry => String(entry.comment || '') + '\n' + JSON.stringify(entry.key || []));
    const flat = list => (Array.isArray(list) ? list : []).flatMap(node => [node, ...flat(node?.scripts)]);
    compare('卡内脚本', flat(a.extensions?.tavern_helper?.scripts), flat(b.extensions?.tavern_helper?.scripts), script => String(script?.id ?? script?.name));
    compare('正则', a.extensions?.regex_scripts || [], b.extensions?.regex_scripts || [], script => String(script?.id ?? script?.scriptName));
    if (coverChanged) lines.push('换封面图');
    if (!lines.length) lines.push('只有卡内数据有变化');
    return lines;
}

// The confirmation: the card update dialog (card-update-dialog.js) with the script's request.
function askTavernScriptCardUpdate(request) {
    return new Promise(resolve => {
        const container = document.createElement('div');
        document.body.append(container);
        const root = require('react-dom/client').createRoot(container);
        let settled = false;
        function settle(value) { if (!settled) { settled = true; resolve(value); } }
        function Dialog() {
            const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [result, setResult] = React.useState(null);
            function close() {
                if (busy) return;
                settle(Boolean(result));
                root.unmount(); container.remove();
            }
            async function replace() {
                setBusy(true); setError('');
                try { const reply = await request.apply(); setResult({ ...reply.card, version: request.incoming.version }); settle(true); }
                catch (cause) { setError(String(cause?.message || cause)); }
                finally { setBusy(false); }
            }
            return React.createElement(TavernCardUpdateDialog, { request, current: request.current, incoming: request.incoming, packs: [], way: 'update', ready: true, name: request.current.name, busy, error, result, close, replace });
        }
        root.render(React.createElement(Dialog));
    });
}

function installTavernScriptCardUpdate({ window: w, rpc, ask = askTavernScriptCardUpdate, onUpdated = () => {} }) {
    const original = w.fetch;
    const pending = new Map(); // sessionId -> { worlds: name -> World Info, copies: id -> { card, cover } }
    const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
    function stateOf(sessionId) {
        if (!pending.has(sessionId)) pending.set(sessionId, { worlds: new Map(), copies: new Map() });
        return pending.get(sessionId);
    }
    function reply(status, body) {
        const text = typeof body === 'string' ? body : JSON.stringify(body);
        return new w.Response(text, { status, headers: { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' } });
    }
    async function read(sessionId) {
        const card = await rpc('getScriptCard', {}, sessionId);
        card.ids = [card.path, String((card.card.data || card.card).name || '') + '.png'];
        return card;
    }
    // A card without a cover reads as a blank 1x1 PNG: SillyTavern cards always have one.
    const BLANK = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    async function cover(card) {
        const response = await original.call(w, '/api/dsh-tavern/card-export?format=png&path=' + encodeURIComponent(card.path));
        if (response.status === 404) return new w.Blob([Uint8Array.from(w.atob(BLANK), c => c.charCodeAt(0))], { type: 'image/png' });
        if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status });
        return await response.blob();
    }
    const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
    function base64(data) {
        let text = '';
        for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
        return w.btoa(text);
    }
    async function update(sessionId, state, card, form, source) {
        const next = JSON.parse(String(form.get('json_data') || 'null'));
        if (!next || typeof next !== 'object') return reply(400, '缺少人物卡数据');
        const worldName = String((next.data || next).extensions?.world || '');
        const world = !worldName ? null : state.worlds.has(worldName) ? state.worlds.get(worldName) : worldName === card.worldName ? card.world : undefined;
        if (world === undefined) return reply(400, '世界书「' + worldName + '」不存在');
        const avatar = form.get('avatar');
        const image = avatar && typeof avatar.arrayBuffer === 'function' ? await bytes(avatar) : null;
        let coverChanged = false;
        if (image) {
            const now = await cover(card).then(bytes, () => null);
            coverChanged = !now || now.length !== image.length || now.some((value, i) => value !== image[i]);
        }
        // Writing back what the card already is (a script restoring after a failure) is no update.
        if (!coverChanged && same(next, card.card) && same(world, card.world)) { state.worlds.delete(worldName); return reply(200, 'OK'); }
        const [currentVersion, nextVersion] = tavernScriptCardVersions(card.card, next);
        const accepted = await ask({
            current: { name: String((card.card.data || card.card).name || ''), version: currentVersion },
            incoming: { name: String((next.data || next).name || ''), version: nextVersion },
            source, changes: tavernScriptCardChanges(card.card, next, card.world, world, coverChanged),
            apply: () => rpc('replaceScriptCard', { card: next, world, cover: coverChanged ? base64(image) : '' }, sessionId)
        });
        if (!accepted) return reply(409, '玩家取消了这次更新');
        state.worlds.delete(worldName);
        onUpdated(sessionId);
        return reply(200, 'OK');
    }
    async function handle(path, init, sessionId, source) {
        if (path === '/csrf-token') return reply(200, { token: 'dsh-tavern' });
        const body = init.body, form = body && typeof body.get === 'function' ? body : null;
        const args = form ? { avatar_url: form.get('avatar_url') } : JSON.parse(typeof body === 'string' && body ? body : '{}');
        const state = stateOf(sessionId), card = await read(sessionId);
        if (path === '/api/settings/get') return reply(200, { world_names: [...new Set([card.worldName, ...state.worlds.keys()].filter(Boolean))] });
        if (path === '/api/worldinfo/get') {
            const world = state.worlds.has(args.name) ? state.worlds.get(args.name) : args.name === card.worldName ? card.world : null;
            return world ? reply(200, world) : reply(404, '世界书不存在');
        }
        if (path === '/api/worldinfo/edit') {
            if (!args.name || !args.data || typeof args.data !== 'object') return reply(400, '世界书数据无效');
            state.worlds.set(String(args.name), copy(args.data));
            return reply(200, { ok: true });
        }
        // The card's own book goes with the card; only pending books can be dropped.
        if (path === '/api/worldinfo/delete') { state.worlds.delete(args.name); return reply(200, { ok: true }); }
        const id = String(args.avatar_url || ''), held = state.copies.get(id), current = card.ids.includes(id);
        if (!held && !current) return reply(404, '找不到人物卡');
        if (path === '/api/characters/get') return reply(200, held ? held.card : card.card);
        if (path === '/api/characters/export') {
            if (args.format !== 'png') return reply(400, '只支持导出 PNG');
            return new w.Response(held ? held.cover : await cover(card), { status: 200, headers: { 'Content-Type': 'image/png' } });
        }
        if (path === '/api/characters/duplicate') {
            const base = String((card.card.data || card.card).name || '人物卡');
            let n = state.copies.size + 1, copyId;
            do copyId = base + ' 备份' + n++ + '.png'; while (state.copies.has(copyId) || card.ids.includes(copyId));
            state.copies.set(copyId, { card: copy(held ? held.card : card.card), cover: held ? held.cover : await cover(card) });
            return reply(200, { path: copyId });
        }
        // /api/characters/edit
        if (!form) return reply(400, '人物卡要以表单提交');
        if (held) {
            const avatar = form.get('avatar');
            state.copies.set(id, { card: JSON.parse(String(form.get('json_data') || 'null')), cover: avatar && typeof avatar.arrayBuffer === 'function' ? avatar : held.cover });
            return reply(200, 'OK');
        }
        return await update(sessionId, state, card, form, source);
    }
    function fetch(input, init) {
        const sessionId = String(w.__dshTavernSelectedSessionId || '');
        const url = typeof input === 'string' || input instanceof w.URL ? new w.URL(String(input), w.location.href) : null;
        // Compared by scheme and host: the desktop page's own scheme has no web origin everywhere.
        if (!sessionId || !url || url.protocol + url.host !== w.location.protocol + w.location.host || !TAVERN_SCRIPT_CARD_ROUTES.has(url.pathname)) return original.call(w, input, init);
        const source = tavernScriptCardSource(new Error().stack, w.location.origin);
        return handle(url.pathname, init || {}, sessionId, source).catch(error => reply(Number(error?.status) || 500, String(error?.message || error)));
    }
    w.fetch = fetch;
    return function () { if (w.fetch === fetch) w.fetch = original; pending.clear(); };
}

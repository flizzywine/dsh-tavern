// the settings pages of the first-party mods on the two-layer config model (全局 / 本卡, each value 自动 / 固定 / 引用 / 公式).
// They replace the generic pack-editor page (ModDetail picks them by mod ID). 物品 is no longer a mod: its page (StageItemsPage,
// at the end) is a built-in capability page. Every write goes through useModConfig (getModConfig / setModConfig /
// clearModConfig / uploadModConfigFile); thumbnails of uploaded files through readModConfigFile.
const cfgOwn = (layer, key) => !!layer && Object.prototype.hasOwnProperty.call(layer, key);
function cfgResolved(config, key) { const r = config.data && config.data.resolved && config.data.resolved[key]; return r && !r.error ? r : null; }
// Uploaded files of one mod as data: URLs (readModConfigFile is an authenticated RPC, not a GET route), cached per layer
// and path for the life of the page. A failed read is retried a few times (a card's first upload creates its private
// pack, and the card can take a moment to name it), then shows empty.
function useCfgFiles(rpc, modId, cardId) {
    const [files, setFiles] = React.useState({}), asked = React.useRef(new Set()), tries = React.useRef(new Map());
    React.useEffect(() => { asked.current = new Set(); tries.current = new Map(); setFiles({}); }, [rpc, modId, cardId]);
    return React.useCallback(function ({ layer, path }) {
        const key = layer + ':' + path;
        if (Object.prototype.hasOwnProperty.call(files, key)) return files[key] || null;
        if (!asked.current.has(key)) {
            asked.current.add(key);
            rpc('readModConfigFile', { modId, layer, path, ...(layer === 'card' && cardId ? { cardId } : {}) })
                .then(result => setFiles(now => ({ ...now, [key]: 'data:' + result.file.mime + ';base64,' + result.data })), () => {
                    const n = (tries.current.get(key) || 0) + 1; tries.current.set(key, n);
                    setFiles(now => ({ ...now, [key]: '' }));
                    if (n < 4) setTimeout(() => { if (tries.current.get(key) !== n) return; asked.current.delete(key); setFiles(now => { const next = { ...now }; delete next[key]; return next; }); }, 800 * n);
                });
        }
        return null;
    }, [files, rpc, modId, cardId]);
}
// beside the scope switch, the page-level reset (ResetButton) of the layer
// being edited — 全局: every value back to its default / 自动; 本卡: every 本卡 value cleared (the card follows 全局) — after
// one confirmation. Disabled while the layer sets nothing.
function CfgScope({ config }) {
    const h = React.createElement, [ask, setAsk] = React.useState(false), keys = config.data ? config.ownKeys() : [];
    const card = config.scope === 'card' && !!config.cardId, label = card ? '清除本卡的全部修改' : '全部恢复默认';
    return h('div', { className: 'fork-cfg-scope-row' }, h(ScopeSwitch, { value: config.scope, onChange: config.setScope, cardName: config.cardName }),
        h(ResetButton, { label, disabled: !keys.length, onClick: () => setAsk(true) }),
        ask ? h(ConfirmDialog, { title: label, confirmLabel: card ? '清除' : '恢复', danger: !card, onClose: () => setAsk(false),
            body: card ? '本卡改过的 ' + keys.length + ' 项设置改回全局的值。' : '全局的 ' + keys.length + ' 项设置都恢复默认。',
            onConfirm: () => config.clearAll(keys) }) : null);
}
// 状态来源 is one row of the page's list (no section repeating its
// name); its (?) says it is shared by every card. It has its own config (dsh.state, 全局 only).
const STATE_SOURCE_HELP = '全局共用。自动：卡里有 MVU 变量时读 MVU，没有时读游玩台账；也可手动指定其中一个。';
function StateSourceField({ rpc, onChange }) {
    const h = React.createElement, config = useModConfig({ call: rpc, modId: 'dsh.state' }), previous = React.useRef(null);
    React.useEffect(() => {
        const revision = config.data?.revision;
        if (revision && previous.current && revision !== previous.current) onChange?.();
        if (revision) previous.current = revision;
    }, [config.data?.revision]);
    const help = h(Help, { text: STATE_SOURCE_HELP, label: '状态来源 说明' });
    if (!config.data) return h(InlineRow, { label: '状态来源', help }, config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : h(Spinner, { label: '正在载入' }));
    return h(React.Fragment, null, h(CfgField, { config, fieldKey: 'source', label: '状态来源', help }),
        config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : null);
}
// The page's settings: one left-aligned list of compact rows (CfgField) — 状态来源 first when the mod reads state —
// with loading / read / write errors under it. `help` ({key: text}, modFieldHelp) gives a row its (?).
function CfgList({ rpc, config, keys, state, help = {} }) {
    const h = React.createElement, tip = key => { const field = config.fields.get(key), text = help[key]; return text ? h(Help, { text, label: (field?.label || key) + ' 说明' }) : undefined; };
    return h(React.Fragment, null,
        h(InlineGrid, { label: '设置', columns: 1, className: 'fork-cfg-list' },
            state ? h(StateSourceField, { rpc, onChange: config.reload }) : null,
            config.data ? cfgUserKeys(config, keys).map(key => h(CfgField, { key, config, fieldKey: key, help: tip(key) })) : null),
        !config.data ? config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : h(Spinner, { label: '正在载入' }) :
            config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : null);
}
// A mod whose settings need no preview (文字演出: 强度): the 设置 section with one row per setting, above the mod's own
// packs when it has any, then its entry sections.
function ModConfigList({ rpc, cardId, cardName, sessionId, modId, manifest, data, entries }) {
    const h = React.createElement, config = useModConfig({ call: rpc, modId, cardId, sessionId, cardName });
    const packs = !!(manifest && manifest.assetKinds && manifest.assetKinds.length), keys = config.data ? cfgUserKeys(config, Array.from(config.fields.keys())) : [];
    // Nothing the player adjusts (every option is the skin's or the preset's): no 设置 section.
    return h('div', { className: 'fork-cfg-page', 'data-mod': modId, 'data-compact': packs ? undefined : true },
        config.data && !keys.length ? null : h(ModSettings, { modId, config },
            h(CfgList, { rpc, config, keys, help: modFieldHelp(modId, manifest) })),
        packs ? h(ModAssets, { rpc, cardId, modId, data, title: '素材包' }) : null,
        entries || null);
}
// ---------- 物品 (items core) ----------
// A built-in capability, not a mod: the four-state switch (engine stageToggles.items with this card's stage.switches.items,
// stageSwitchTag) — the 基础设置 row 「物品 ›」 under BGM / 音效 / 环境音, and this page's head. No 全局 | 本卡 settings
// layer and no categories: an 物品's own 标签 group it, and a pack may give a tag an icon (素材包 ⋯ › 标签图标).
//   ‹ 物品 (?) ………………… switch          the page head
//   设置 (?)                              状态来源 (global, dsh.state) · 背包 (the card's one variable binding)
//   物品 N (?) ………………… ›             this card's props (ModEntries, as on every mod page)
//   背包 N (?)                            the open chat's inventory, grouped by tag (only with a readable 背包)
// 背包 is {kind:'items', slot:'inventory'} through listCardVariableSlots / setCardVariableBinding /
// clearCardVariableBinding on the stage page's CAS queue (writer.cardOp). A mapping kept by the retired items mod config is
// read as the card's own (slot.legacy) until the data migration; choosing another writes the card binding, which wins.
const ITEMS_TARGET = { kind: 'items', slot: 'inventory' };
const ITEMS_HELP = '展示、获得、失去重要物品时在舞台上演出；获得和失去的数量以背包变量的结算为准。';
const ITEMS_INVENTORY_HELP = '这张卡记录物品的变量（MVU 里的一个列表），只读不改。没有选时，自动找唯一像背包的列表。';
const ITEMS_BAG_HELP = '当前聊天的背包，按物品的标签分组；一件物品可以在几个组里。';
const ITEMS_FIELDS = [['name', '名称', 'string', true], ['count', '数量', 'number', true], ['id', '标识', 'string', false], ['owner', '持有人', 'string', false]];
const ITEMS_ALIASES = { name: ['name', '名称', '物品名', '名字'], count: ['count', '数量'], id: ['id', '标识'], owner: ['owner', '持有人'] };
const ITEMS_AUTO = '\u0000auto', ITEMS_REF = '\u0000ref', ITEMS_PICK = '\u0000pick', ITEMS_MAP = '\u0000fields', ITEMS_NONE = '\u0000none';
const ITEMS_STATUS = { 'type-mismatch': '背包变量的格式不对', unavailable: '读不到背包变量', missing: '变量里没有这个列表', 'too-large': '背包变量太大' };
const itemsPointer = key => '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const itemsFieldKey = pointer => typeof pointer === 'string' && /^\/[^/]+$/.test(pointer) ? pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~') : null;
// The node of a picked list in the source tree (listModConfigSources), and the fields of its first rows (name → type).
function itemsNode(sources, ref) {
    const source = (sources || []).find(row => row.id === ref.source);
    let nodes = source ? source.tree : null;
    while (nodes) {
        const next = nodes.find(node => node.path === ref.path || ref.path.startsWith(node.path + '/'));
        if (!next) return null;
        if (next.path === ref.path) return next;
        nodes = next.children;
    }
    return null;
}
function itemsRecordKeys(node) {
    const keys = new Map();
    for (const row of (node && node.children || []).slice(0, 8)) for (const child of row.children || []) if (!keys.has(String(child.name))) keys.set(String(child.name), child.type);
    return keys;
}
function itemsGuessFields(keys) {
    const fields = {};
    for (const [key, , type] of ITEMS_FIELDS) {
        const hits = [...keys].filter(([name, kind]) => ITEMS_ALIASES[key].includes(name) && kind === type);
        if (hits.length === 1) fields[key] = itemsPointer(hits[0][0]);
    }
    return fields;
}
// FORK-ITEMS-VIEW-BEGIN (pure; tests/fork-items-core-ui.test.mjs) — the 背包 by tag. `rows` are the resolved inventory
// ({name, count, id?, owner?}), `groups` the card's 物品 per pack (modEntryGroups). A row is the 物品 whose 库存标识
// equals its id, else the one 物品 of exactly its name (several: none — never a guess). Picture: the 物品's own (default
// variant) → its pack's icon of its deepest tag (assetTags.icon) → none (text). One group per full tag path, a row may
// sit in several; 未标记 holds the rest; the count is per inventory identity. A group head shows the members' tag icon
// only while they all agree on one image.
function itemsInventoryView(rows, groups) {
    const entries = (groups || []).flatMap(group => (group.items || []).map(asset => ({ packId: group.packId, manifest: group.pack && group.pack.manifest || { assets: [] }, asset })));
    const stable = asset => String(asset.inventoryId || '');
    const items = [], seen = new Set(), tags = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const name = row && typeof row.name === 'string' ? row.name.trim() : '';
        if (!name) continue;
        const id = typeof row.id === 'string' && row.id || typeof row.id === 'number' ? String(row.id) : null, owner = typeof row.owner === 'string' ? row.owner : '';
        const key = JSON.stringify([owner, id === null ? 'name:' + name : 'id:' + id]);
        if (seen.has(key)) continue;
        seen.add(key);
        const byId = id === null ? [] : entries.filter(entry => stable(entry.asset) === id), byName = entries.filter(entry => String(entry.asset.name).trim() === name);
        const entry = byId.length === 1 ? byId[0] : !byId.length && byName.length === 1 ? byName[0] : null;
        const variants = entry && entry.asset.variants, content = variants ? ((variants.entries || []).find(v => v.id === variants.default) || (variants.entries || [])[0] || {}).content || {} : entry ? entry.asset : {};
        const hash = entry ? content.media || assetTags.icon(entry.manifest, entry.asset.category) : null, own = entry ? assetTags.normalize(entry.asset.category) : [];
        items.push({ key, name, count: typeof row.count === 'number' ? row.count : null, owner, ref: entry ? { packId: entry.packId, assetId: entry.asset.id } : null, image: hash ? { packId: entry.packId, hash } : null, tags: own });
        for (const tag of own) {
            const group = tags.get(tag) || { tag, keys: [], hashes: new Set(), icon: null }, icon = assetTags.icon(entry.manifest, [tag]);
            group.keys.push(key);
            if (icon) { group.hashes.add(icon); if (!group.icon) group.icon = { packId: entry.packId, hash: icon }; }
            tags.set(tag, group);
        }
    }
    const list = [...tags.values()].sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0).map(group => ({ tag: group.tag, keys: group.keys, icon: group.hashes.size === 1 ? group.icon : null }));
    return { total: items.length, items, groups: list, untagged: items.filter(item => !item.tags.length).map(item => item.key) };
}
// FORK-ITEMS-VIEW-END
// The card's 背包 slot (with the open chat's values when there is one); `live` says whether the chat's values were read.
function useItemsSlot(ctx) {
    return useLoad(ctx.binding, async () => {
        const read = args => ctx.binding.rpc('listCardVariableSlots', args);
        let list = null, live = !!ctx.sessionId;
        try { list = await read({ path: ctx.path, ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}) }); }
        catch (e) { if (!ctx.sessionId || e?.code !== 'NOT_FOUND') throw e; live = false; list = await read({ path: ctx.path }); }
        const slot = (list?.providers || []).flatMap(provider => provider.slots || []).find(row => JSON.stringify(row.target) === JSON.stringify(ITEMS_TARGET)) || null;
        return { slot, live };
    }, [ctx.path, ctx.sessionId, ctx.writer.revision]);
}
// The 背包 row: one menu (自动 · 跟随 <path> · a statically declared list · 选择变量… · 对应字段…), the list's size after it; the
// data picker (MVU lists) or the field rows open under the row. Picking a list guesses 名称 / 数量 / 标识 / 持有人 from its
// record keys (the provider's aliases); when 名称 or 数量 is not found the field rows open and nothing is written until both are set.
function ItemsInventoryField({ ctx, state }) {
    const h = React.createElement, slot = state.value?.slot || null, live = !!state.value?.live;
    const [extra, setExtra] = React.useState(null), [draft, setDraft] = React.useState(null), [sources, setSources] = React.useState(null);
    const [problem, setProblem] = React.useState(''), [busy, setBusy] = React.useState(false), pick = React.useRef(null), asked = React.useRef(false);
    const engine = ctx.binding.engineRpc;
    const needSources = () => {
        if (asked.current || !engine) return;
        asked.current = true;
        engine('listModConfigSources', { ...(ctx.cardId ? { cardId: ctx.cardId } : {}), ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}) })
            .then(list => setSources((list?.sources || []).filter(source => source.id === 'mvu')), e => { asked.current = false; setProblem(errorText(e)); });
    };
    React.useEffect(() => { if (extra === 'pick') pick.current?.focus?.(); }, [extra]);
    const help = h(Help, { text: ITEMS_INVENTORY_HELP, label: '背包 说明' });
    if (!slot) return h(InlineRow, { label: '背包', help }, state.error ? null : h(Spinner, { label: '正在载入' }));
    const author = slot.source === 'author' ? slot.variable : null, legacy = !!slot.legacy, variable = draft || author;
    const write = (method, args) => {
        setBusy(true); setProblem('');
        return ctx.writer.cardOp(revision => ctx.binding.rpc(method, { path: ctx.path, expectedRevision: revision, target: ITEMS_TARGET, ...args }))
            .then(() => { setDraft(null); setExtra(null); state.reload(); return true; }, e => { setProblem(errorText(e)); return false; })
            .finally(() => setBusy(false));
    };
    const save = next => {
        if (next.fields?.name && next.fields?.count) return write('setCardVariableBinding', { variable: { source: 'mvu', path: next.path, fields: next.fields } });
        setDraft(next); setExtra('fields'); needSources(); return null;
    };
    // A candidate is another list to follow; the one already followed (自动's pick or the author's) is not offered twice.
    const statics = (slot.candidates || []).filter(row => row?.variable?.source === 'mvu' && row.variable.path && row.variable.path !== (author || slot.variable)?.path);
    const options = [...(legacy ? [] : [{ value: ITEMS_AUTO, label: '自动' }]), ...(author ? [{ value: ITEMS_REF, label: '跟随 ' + author.path }] : []),
        ...statics.map(row => ({ value: 'static:' + row.variable.path, label: row.variable.path })),
        { value: ITEMS_PICK, label: '选择变量…' }, ...(variable ? [{ value: ITEMS_MAP, label: '对应字段…' }] : [])];
    const choose = value => {
        if (value === ITEMS_AUTO) { setDraft(null); setExtra(null); return author && !legacy ? write('clearCardVariableBinding', {}) : null; }
        if (value === ITEMS_PICK) { needSources(); setExtra('pick'); return null; }
        if (value === ITEMS_MAP) { needSources(); setExtra('fields'); return null; }
        const row = statics.find(item => 'static:' + item.variable.path === value);
        return row ? save({ path: row.variable.path, fields: { ...(row.variable.fields || {}) } }) : null;
    };
    const count = live && slot.variable && slot.status === 'ready' && Array.isArray(slot.value) ? slot.value.length + ' 项' : '';
    const shown = [!author && slot.variable ? slot.variable.path : '', count].filter(Boolean).join(' · ') || (slot.variable ? '' : '未找到');
    const warn = live && slot.variable && slot.status !== 'ready' ? ITEMS_STATUS[slot.status] || '读不到背包变量' : '';
    const trail = [shown ? h('span', { key: 'shown', className: 'fork-cfg-meta fork-cfg-shown' }, shown) : null, warn ? h(HintLine, { key: 'warn', compact: true, text: warn }) : null, busy ? h(Spinner, { key: 'busy' }) : null];
    const keys = variable ? itemsRecordKeys(itemsNode(sources, { source: 'mvu', path: variable.path })) : new Map();
    for (const pointer of Object.values(variable?.fields || {})) { const key = itemsFieldKey(pointer); if (key !== null && !keys.has(key)) keys.set(key, null); }
    const fieldRow = ([key, label, type, required]) => {
        const current = variable.fields?.[key] || '', options = [...keys].filter(([, kind]) => !kind || kind === type).map(([name]) => ({ value: itemsPointer(name), label: name }));
        if (current && !options.some(option => option.value === current)) options.push({ value: current, label: current });
        return h(InlineField, { key, kind: 'menu', label, disabled: busy, value: current || ITEMS_NONE,
            options: [...(required && current ? [] : [{ value: ITEMS_NONE, label: required ? '请选择' : '不使用' }]), ...options],
            onCommit: next => { const fields = { ...(variable.fields || {}) }; if (next === ITEMS_NONE) delete fields[key]; else fields[key] = next; return save({ ...variable, fields }); } });
    };
    const below = [];
    if (extra === 'pick') below.push(h(DataPicker, { key: 'pick', sources, error: problem && !sources ? problem : '', value: author ? { source: 'mvu', path: author.path } : null, want: 'list', inline: true, inputRef: pick,
        onPick: ref => save({ path: ref.path, fields: itemsGuessFields(itemsRecordKeys(itemsNode(sources, ref))) }) }));
    if (extra === 'fields' && variable) below.push(h(InlineGrid, { key: 'fields', label: '背包字段', columns: 1, className: 'fork-items-fields' }, ITEMS_FIELDS.map(fieldRow)));
    if (problem && (extra !== 'pick' || sources)) below.push(h('p', { key: 'problem', className: 'ap-field-error', role: 'alert' }, problem));
    const row = h(InlineField, { kind: 'menu', label: '背包', help, disabled: busy, className: 'fork-cfg-field is-bound', value: author ? ITEMS_REF : ITEMS_AUTO, options, trail, onCommit: choose });
    return below.length ? h(React.Fragment, null, row, h('div', { className: 'fork-cfg-below', 'data-key': 'inventory',
        onKeyDown: e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); setExtra(null); setDraft(null); } } }, below)) : row;
}
// 背包 N: the tag chips (全部 · each tag with its icon · 未标记) over the rows (picture or text · name · 持有人 · ×数量).
function ItemsInventory({ ctx, state }) {
    const h = React.createElement, [filter, setFilter] = React.useState(null), slot = state.value?.slot;
    if (!state.value?.live || !slot?.variable || slot.status !== 'ready') return null;
    const groups = modEntryGroups(ctx, 'props', 'core.items'), head = { title: '背包', help: ITEMS_BAG_HELP, foldKey: 'items:inventory', className: 'fork-items-bag' };
    if (groups.some(group => !group.items)) return h(StageSection, head, h(Loading));
    const view = itemsInventoryView(slot.value, groups);
    const current = filter === '' ? (view.untagged.length ? '' : null) : filter && view.groups.some(group => group.tag === filter) ? filter : null;
    const keys = current === '' ? view.untagged : current ? view.groups.find(group => group.tag === current).keys : null;
    const shown = keys ? view.items.filter(item => keys.includes(item.key)) : view.items;
    const chip = (id, label, icon) => h('button', { key: id === null ? '@all' : id === '' ? '@none' : id, type: 'button', className: 'ap-mod-chip fork-items-tag', 'aria-pressed': current === id, title: label, onClick: () => setFilter(id) },
        icon ? h(Thumb, { binding: ctx.binding, packId: icon.packId, hash: icon.hash, label, className: 'ap-mod-chip-art' }) : null, h('span', { className: 'fork-items-tag-name' }, label));
    return h(StageSection, { ...head, meta: view.total },
        !view.total ? h(EmptyState, { compact: true, text: '背包是空的' }) : h(React.Fragment, null,
            view.groups.length ? h('div', { className: 'ap-mod-chips fork-items-tags', role: 'group', 'aria-label': '按标签筛选' },
                chip(null, '全部', null), view.groups.map(group => chip(group.tag, group.tag, group.icon)), view.untagged.length ? chip('', '未标记', null) : null) : null,
            h('ul', { className: 'fork-items-bag-list', 'aria-label': current === null ? '背包' : '背包 · ' + (current || '未标记') },
                shown.map(item => h('li', { key: item.key, className: 'fork-items-bag-row', 'data-text': item.image ? undefined : true },
                    item.image ? h(Thumb, { binding: ctx.binding, packId: item.image.packId, hash: item.image.hash, label: item.name, className: 'fork-items-bag-art' }) : h('span', { className: 'fork-items-bag-art is-text', 'aria-hidden': true }, [...item.name][0]),
                    h('span', { className: 'fork-items-bag-name', title: item.name }, item.name),
                    item.owner ? h('span', { className: 'fork-items-bag-owner' }, item.owner) : null,
                    item.count !== null ? h('span', { className: 'fork-items-bag-count' }, '×' + item.count) : null)))));
}
// The page (StagePage sub-page; ‹ and Esc go back to 舞台设置, the focus returns to the 基础设置 row's 「›」).
function StageItemsPage({ ctx, onBack }) {
    const h = React.createElement, state = useItemsSlot(ctx), missing = stageMissing('stage', ctx.active);
    const toggle = stageSwitchTag(ctx, 'items', '物品', missing.length > 0);
    return h('article', { className: 'ap-mod-detail fork-items-page', onKeyDown: subpageKeys(onBack) },
        h(SubpageHead, { parent: '舞台设置', title: '物品', onBack, className: 'fork-mod-head', help: h(Help, { text: ITEMS_HELP, label: '物品 说明' }), tools: toggle }),
        h('div', { className: 'fork-cfg-page', 'data-mod': 'core.items' },
            h(StageSection, { title: '设置', foldKey: 'items:settings', className: 'fork-mod-settings' },
                h(InlineGrid, { label: '物品设置', columns: 1, className: 'fork-cfg-list' },
                    ctx.binding.engineRpc ? h(StateSourceField, { rpc: ctx.binding.engineRpc, onChange: state.reload }) : null,
                    h(ItemsInventoryField, { ctx, state })),
                h(ErrorBox, { error: state.error, reload: state.reload })),
            h(ModEntries, { ctx, modId: 'core.items', kind: 'props' }),
            h(ItemsInventory, { ctx, state })));
}
// The mods' settings pages register themselves (mods/<name>/client/settings.js, built into this scope) by mod id.
const MOD_CONFIG_PAGES = {};
// @include-mods client/settings.js
for (const part of modClients.slot('settings')) MOD_CONFIG_PAGES[part.modId] = part.value;

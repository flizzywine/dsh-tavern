// the one page pattern of every mod page in 舞台设置 › 模组 ›
//. Included in the asset-pack UI factory (mod-library.js), so it uses the panel's one
// SubpageHead / StageSection / Help / EntryItem / LampMenu.
//   ‹ 名称 (?) ………………………… 全局开关          ModPageHead — the (?) is the mod's one-line description
//   设置 (?) ……… 全局 | 本卡 ⟲                 ModSettings — only a page with two-layer settings; the scope switch
//                                               in the head decides where every control of the section writes
//   <素材种类> N (?) ………………………… ›           ModEntries — one section per manifest admission entry kind: this
//                                               card's entries (全局 + 本卡 packs) with their lamps, as in 舞台素材
// A config page (MOD_CONFIG_PAGES) gets the entry sections ready-made as its `entries` prop and places them last;
// the manifest renderer appends them itself. Rule 15: a mod's switch is global only; a card differs by its entries.

// The page head's (?): one sentence a player understands (a manifest summary is written for the director); another
// mod shows its manifest summary.
const MOD_HELP = Object.freeze({
    'dsh.danmaku': '模拟观众看你游玩时发的弹幕；只看，不影响剧情。',
    'dsh.performance': '场景专属的持续演出（如场景光效），导演按本卡的演出素材播放。',
    'dsh.timer': '舞台上的倒计时：剧情限时，或等你回应的时限，时间到时自动替你回应；打开菜单、履历时暂停，刷新也不会扣时。',
    'dsh.phone': '角色用手机收发消息时，舞台上显示成手机画面。',
    'dsh.textcard': '情绪转折、回忆、章节切换时，用全屏文字卡强调。'
});
// The 舞台设置 › 模组 row icon of a first-party mod (glyph names of the panel's one Glyph); another mod shows 'widgets'.
const MOD_GLYPHS = Object.freeze({ 'dsh.danmaku': 'audience', 'dsh.performance': 'performances', 'dsh.phone': 'phone', 'dsh.textcard': 'textcard', 'dsh.timer': 'timers' });
// A setting's (?) where the config schema carries none (the manifest's settingsSchema help is used first).
const MOD_FIELD_HELP = Object.freeze({ 'dsh.textcard': { intensity: '每轮最多几张文字卡、播放快慢：克制 5 张偏慢，标准 8 张，浓烈 12 张偏快。' } });
const MOD_ENTRY_HELP = '蓝灯每轮可用，绿灯在正文提到触发词时可用；一轮里一条都用不上时，这个模组那一轮不启用。';

// {key: help text} for a config page's rows: the manifest field's own help, else the client's line above.
function modFieldHelp(modId, manifest) {
    const own = Object.fromEntries((manifest?.settingsSchema?.fields || []).filter(field => field.help).map(field => [field.key, modText(manifest, field.help)]));
    return { ...own, ...MOD_FIELD_HELP[modId] };
}

function ModPageHead({ modId, manifest, name, onBack, toggle }) {
    const text = MOD_HELP[modId] || (manifest?.summary ? modText(manifest, manifest.summary) : '');
    return h(SubpageHead, { parent: '舞台设置', title: name, onBack, className: 'fork-mod-head', help: text ? h(Help, { text, label: name + ' 说明' }) : null, tools: toggle });
}

// The 设置 section: the 全局 | 本卡 switch with its page-level reset in the head, the page's controls in the body.
function ModSettings({ modId, config, help, children }) {
    return h(StageSection, { title: '设置', help, foldKey: 'mod:' + modId + '/settings', className: 'fork-mod-settings', action: h(CfgScope, { config }) }, children);
}

// A mod's own built-in asset pack (tavern-plugin/lib/mod-builtins.js assetPackId; tests keep them equal). Rule 15:
// its entries are in use whenever the mod is on, like a 全局 pack (mod-event-catalogue.js), so its section lists them
// first and 舞台设置 loads its document like a lit pack's (stageDetailRows).
const MOD_BUILTIN_PACKS = Object.freeze({ 'dsh.danmaku': '829254f8-e721-4c06-ae27-73d91c495f7c' });
// This card's entries of one kind, pack by pack (the mod's built-in pack, then 全局 packs, then 本卡 — the packs the
// mod reads): the full pack documents 舞台设置 already holds (items null while one is still loading).
function modEntryGroups(ctx, kind, modId) {
    const own = MOD_BUILTIN_PACKS[modId], builtin = own ? (ctx.packs || []).filter(row => !row.error && row.manifest?.id === own && packCount(row, kind) > 0) : [];
    return [...builtin, ...stageKindPacks(ctx, kind).filter(row => row.manifest.id !== own)].map(row => {
        const pack = ctx.writer?.pack?.(row.manifest.id);
        return { packId: row.manifest.id, pack, items: pack ? pack.manifest.assets.filter(asset => asset.kind === kind) : null };
    });
}
// One entry section: the library's own entry rows (EntryItem: art · name · lamp menu). A row opens the entry in 舞台素材;
// its lamp writes the pack on the stage page's CAS queue (writer.packOp), like the library's list lamp.
function ModEntries({ ctx, modId, kind }) {
    const [error, setError] = React.useState(''), label = kinds[kind] || kind, groups = modEntryGroups(ctx, kind, modId);
    const loading = groups.some(group => !group.items), shown = loading ? [] : groups.filter(group => group.items.length);
    const count = loading ? undefined : shown.reduce((sum, group) => sum + group.items.length, 0), many = shown.length > 1, library = ctx.nav?.openLibrary;
    // The library selects any entry of the opened kind by `figureId` (its deep-link field for the selected item).
    const open = (packId, item) => library?.({ packId, kind, figureId: item.id });
    const lamp = (packId, item, mode) => {
        setError('');
        return ctx.writer.packOp(packId, snapshot => ctx.binding.service.patchPack({ packId, expectedRevision: snapshot.revision,
            patch: { assets: snapshot.manifest.assets.map(asset => asset.kind === kind && asset.id === item.id ? setEntryLamp(asset, mode) : asset) } }))
            .catch(e => setError(errorText(e)));
    };
    return h(StageSection, { title: label, meta: count, help: MOD_ENTRY_HELP, foldKey: 'mod:' + modId + '/entries/' + kind, className: 'fork-mod-entries', action: h(StageKindJump, { ctx, kind, label }) },
        // the heading's › (StageKindJump) already opens 舞台素材 — the empty state does not repeat it (R13).
        loading ? h(Loading, { lead: true, count: 3 }) : !count ? h(EmptyState, { compact: true, text: '本卡还没有' + label }) :
        shown.map(group => h('div', { key: group.packId, className: 'fork-mod-entries-pack' },
            many ? h('div', { className: 'fork-mod-entries-pack-name', 'aria-hidden': true }, group.pack.manifest.name) : null,
            h('ul', { className: 'ap-items fork-mod-entries-list', role: 'listbox', 'aria-label': (many ? group.pack.manifest.name + ' · ' : '') + label },
                group.items.map(item => h(EntryItem, { key: item.id, binding: ctx.binding, pack: group.pack, kind, item, focused: false, checked: null, audio: null, ctx,
                    onSelect: () => open(group.packId, item), onLamp: mode => lamp(group.packId, item, mode) }))))),
        h(ErrorBox, { error }));
}
// Every admission entry kind of a mod (none for a mod that needs only its built-in assets: 手机, 文字演出).
function ModEntrySections({ ctx, modId, manifest }) {
    const entryKinds = manifest?.admission?.entryKinds || [];
    return entryKinds.length ? h(React.Fragment, null, entryKinds.map(kind => h(ModEntries, { key: kind, ctx, modId, kind }))) : null;
}

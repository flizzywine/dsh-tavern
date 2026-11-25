// One menu for a card wherever the card list shows it (人物卡库 grid: ⋯, right click, long press; the card's detail
// header ⋯; the 游玩 card picker): 导出, 另存副本, 重命名, 标签 ›, 收藏, 选择, 更新, then 删除 (confirmed).
// useTavernCardActions owns what the items do; TavernCardMenu draws them for one card.
//
// opts: busy / setBusy, refresh() → cards, onError(text), onNotice(text), archiveSession, displayName(card), exportCard(card) (the export
// sheet), update (useTavernCardUpdate), onDuplicated(path), onDeleted(path), select(path) (starts selecting with it).
function useTavernCardActions(opts) {
  const askConfirm = useTavernConfirm();
  const report = error => opts.onError(String(error && error.message || error));
  const nameOf = card => opts.displayName ? opts.displayName(card) : card.displayName || card.name;
  async function run(work) {
    opts.setBusy(true); opts.onError('');
    try { return await work(); } catch (error) { report(error); } finally { opts.setBusy(false); }
  }
  // The library name (a local display name); empty puts the card's own name back.
  async function rename(card) {
    if (opts.busy) return;
    const current = nameOf(card);
    await askTavernText({ title: '重命名人物卡', initialValue: current, description: '留空恢复默认名称。', allowEmpty: true, maxLength: 120,
      onSubmit: async function (displayName) {
        if (displayName === current) return;
        await rpc('organizeCards', { action: 'cards', paths: [card.path], displayName });
        await opts.refresh();
        notifyTavernDataChanged(['cards'], 'cards');
      } });
  }
  // A separate card to edit or experiment with; the original file is not touched.
  function duplicate(card) {
    if (opts.busy) return;
    return run(async () => {
      const copied = (await rpc('duplicateCard', { path: card.path })).card;
      await opts.refresh(); notifyTavernDataChanged(['cards'], 'cards');
      opts.onNotice('已另存副本，原卡未改动');
      if (opts.onDuplicated) await opts.onDuplicated(copied.path);
    });
  }
  async function remove(card) {
    if (opts.busy) return;
    const name = nameOf(card);
    if (!await askConfirm('人物卡文件会被删除，不能撤销。', { title: '从人物卡库删除“' + name + '”？', confirmText: '删除', danger: true, hide: 'card' })) return;
    let chats;
    try { chats = await askTavernCardChatRemoval([card.path], askConfirm); }
    catch (error) { opts.onError('读取游玩记录失败，未删除人物卡：' + String(error && error.message || error)); return; }
    await run(async () => {
      await rpc('deleteCard', { path: card.path });
      const chatRemoval = await removeTavernCardChats(chats, [{ path: card.path, ok: true }], opts.archiveSession);
      announceTavernSessionsUnavailable(chatRemoval.sessionIds);
      if (opts.onDeleted) opts.onDeleted(card.path);
      await opts.refresh(); notifyTavernDataChanged(['cards', 'sessions'], 'cards');
      if (chatRemoval.notice.indexOf('失败') >= 0) opts.onError(chatRemoval.notice);
    });
  }
  return {
    rename, duplicate, remove,
    exportCard: card => { if (!opts.busy) opts.exportCard(card); },
    update: opts.update ? card => { if (!opts.busy) opts.update.start(card.path, nameOf(card)); } : null,
    select: opts.select || null
  };
}

// The menu of one card (content of a useContextMenu layer): the items, or the 标签 page (‹ back) of the same menu.
// `detail`: the card's own page, which shows the name's ✎ and the tags itself; its ⋯ holds the page's low-frequency
// actions instead: { exportCard() (the one export sheet) or exportFormats [{ label, note, disabled, run }] (without the pack
// service: a 导出 › page of the formats, 加密导出 last), manageSaves(), attach() }.
function TavernCardMenu({ card, actions, organization, close, detail }) {
  const h = React.createElement, ui = packUi, [page, setPage] = React.useState('main');
  const item = (label, onClick, props) => h(ui.MenuItem, Object.assign({ disabled: organization.disabled, onClick: () => { close(); onClick(); } }, props), label);
  const sub = (label, to) => h(ui.MenuItem, { disabled: organization.disabled, onClick: () => setPage(to) },
    h('span', { className: 'dsh-tavern-card-menu-label' }, label), h('span', { 'aria-hidden': true, className: 'dsh-tavern-card-menu-more' }, '›'));
  if (page === 'tags') return h('div', { className: 'dsh-tavern-card-menu-tags' },
    organization.tagChecklist(card, { title: '标签', onBack: () => setPage('main') }));
  if (page === 'export') return h(React.Fragment, null,
    h(ui.MenuItem, { onClick: () => setPage('main') }, '‹ 导出'),
    detail.exportFormats.map(format => h(ui.MenuItem, { key: format.label, disabled: organization.disabled || format.disabled, onClick: () => { close(); format.run(); } },
      h('span', { className: 'dsh-tavern-card-menu-label' }, format.label), h('span', { className: 'dsh-tavern-card-menu-more' }, format.note))));
  if (detail) return h(React.Fragment, null,
    detail.exportFormats ? sub('导出', 'export') : item('导出…', detail.exportCard),
    detail.manageSaves ? item('管理存档…', detail.manageSaves) : null,
    detail.attach ? item('引用到对话', detail.attach) : null,
    item('另存副本', () => actions.duplicate(card)),
    item(card.starred ? '取消收藏' : '收藏', () => organization.toggleStar(card)),
    actions.update ? item('更新', () => actions.update(card)) : null,
    h('div', { className: 'dsh-tavern-card-menu-divider', role: 'separator' }),
    item('删除', () => actions.remove(card), { danger: true }));
  return h(React.Fragment, null,
    item('导出', () => actions.exportCard(card)),
    item('另存副本', () => actions.duplicate(card)),
    item('重命名', () => actions.rename(card)),
    sub('标签', 'tags'),
    item(card.starred ? '取消收藏' : '收藏', () => organization.toggleStar(card)),
    actions.select ? item('选择', () => actions.select(card.path)) : null,
    actions.update ? item('更新', () => actions.update(card)) : null,
    h('div', { className: 'dsh-tavern-card-menu-divider', role: 'separator' }),
    item('删除', () => actions.remove(card), { danger: true }));
}

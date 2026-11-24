// The card list's own organization (人物卡库 and the 游玩 card picker): tags, 收藏, filter, search, sort, columns and the
// selection bar's tag / star actions. Tags and stars are local (rpc organizeCards, domain/card-organization.js); a card
// can carry several tags. The filter is a multi-pick: every picked condition must hold (收藏 and the picked tags);
// 未打标签 stands alone beside 收藏.
const TAVERN_CARD_SORTS = [
  { value: 'auto', label: '自动' }, { value: 'played', label: '最近游玩' },
  { value: 'name', label: '名字' }, { value: 'imported', label: '导入时间' }
];
const TAVERN_CARD_FAVORITES = 'fav', TAVERN_CARD_UNTAGGED = 'untagged';

function tavernCardSortName(card) { return String(card.displayName || card.name || card.path || ''); }

// The visible cards: search, then every filter condition, then the order. 自动 keeps the host's order
// (收藏 first, then recent imports and the most played, orderCardsForLibrary).
// The picked tags hold all together (`tagMode` 'all') or any one of them ('any'); 收藏 and 未打标签 always must hold.
function filterOrganizedCards(cards, filter, query, sort = 'auto', tagMode = 'all') {
  const needle = query.trim().toLocaleLowerCase();
  const picked = filter.filter(condition => condition.startsWith('tag:')).map(condition => condition.slice(4));
  const list = cards.filter(card => {
    const tags = card.tags || [];
    return (!needle || [card.displayName, card.name, card.path].join(' ').toLocaleLowerCase().includes(needle))
      && (!filter.includes(TAVERN_CARD_FAVORITES) || card.starred)
      && (!filter.includes(TAVERN_CARD_UNTAGGED) || !tags.length)
      && (!picked.length || (tagMode === 'any' ? picked.some(tag => tags.includes(tag)) : picked.every(tag => tags.includes(tag))));
  });
  if (sort === 'played') return list.slice().sort((a, b) => (Number(b.lastPlayedAt) || 0) - (Number(a.lastPlayedAt) || 0));
  if (sort === 'name') return list.slice().sort((a, b) => tavernCardSortName(a).localeCompare(tavernCardSortName(b), 'zh-CN'));
  if (sort === 'imported') return list.slice().sort((a, b) => (Number(b.importedAt) || 0) - (Number(a.importedAt) || 0));
  return list;
}

function readTavernCardTagMode(place) {
  try { return window.localStorage.getItem('dsh-tavern-card-tag-mode-' + place) === 'any' ? 'any' : 'all'; }
  catch (_) { return 'all'; }
}

function readTavernCardSort(place) {
  try { const value = window.localStorage.getItem('dsh-tavern-card-sort-' + place); return TAVERN_CARD_SORTS.some(sort => sort.value === value) ? value : 'auto'; }
  catch (_) { return 'auto'; }
}

// The tag checklist of a card menu, the detail page's ＋ and the selection bar: one row per tag (✓ when `state(tag)` is
// true, – when some of the selected cards have it), then a box that creates a tag and puts it on at once.
function TavernCardTagChecklist({ tags, state, onToggle, onCreate, disabled, title, onBack }) {
  const h = React.createElement, [draft, setDraft] = React.useState('');
  return h(React.Fragment, null,
    title ? h('div', { className: 'dsh-tavern-card-tag-title' }, onBack ? h('button', { type: 'button', 'aria-label': '返回', onClick: onBack }, '‹') : null, h('span', null, title)) : null,
    tags.map(tag => {
      const on = state(tag);
      return h('button', { key: tag, type: 'button', role: 'menuitemcheckbox', className: 'fork-inline-option ap-menu-item dsh-tavern-card-tag-option', 'aria-checked': on === 'mixed' ? 'mixed' : Boolean(on), disabled,
        onClick: () => onToggle(tag, on !== true) }, h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }, on === true ? '✓' : on === 'mixed' ? '–' : ''), h('span', null, tag));
    }),
    h('input', { className: 'dsh-tavern-card-tag-new', value: draft, maxLength: 40, disabled, placeholder: '新建标签，回车添加', 'aria-label': '新建标签',
      onChange: event => setDraft(event.target.value),
      onKeyDown: event => {
        if (event.key !== 'Enter' || !draft.trim()) return;
        event.preventDefault();
        const name = draft.trim();
        setDraft('');
        onCreate(name);
      } }));
}

function useCardOrganization(cards, busy, refresh, onError, batch = {}, place = 'library') {
  const askConfirm = useTavernConfirm();
  const h = React.createElement;
  const [tags, setTags] = React.useState([]);
  const [query, setQuery] = React.useState('');
  // Filtering hundreds of rows must not block typing in the search box.
  const deferredQuery = React.useDeferredValue(query);
  const [filter, setFilter] = React.useState([]);
  const [sort, setSortState] = React.useState(() => readTavernCardSort(place));
  const [tagMode, setTagModeState] = React.useState(() => readTavernCardTagMode(place));
  function setTagMode(value) {
    setTagModeState(value);
    try { window.localStorage.setItem('dsh-tavern-card-tag-mode-' + place, value); } catch (_) {}
  }
  const [wanted, setColumns] = useTavernCardGridColumns(place);
  // A narrow panel fits fewer columns than the one asked for: the stepper shows and steps the count the grid draws.
  const [width, setWidth] = React.useState(0);
  const watched = React.useRef(null);
  function measure(element) {
    if (watched.current) watched.current.disconnect();
    watched.current = null;
    if (!element || typeof ResizeObserver !== 'function') return;
    watched.current = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    watched.current.observe(element);
  }
  const fit = !width ? 6 : width <= 400 ? 2 : width <= 640 ? 3 : 6;
  const columns = Math.min(wanted, fit);
  const [managing, setManaging] = React.useState(false);
  const filterPop = useInlinePopup(), sortPop = useInlinePopup({ alignEnd: true }), batchTagPop = useInlinePopup();
  const [saving, setSaving] = React.useState(false);
  const running = React.useRef(false);
  React.useEffect(function () {
    let active = true;
    rpc('getCardOrganization', {}).then(result => {
      if (!active) return;
      const next = result.tags || [];
      setTags(next);
      setFilter(previous => previous.filter(condition => !condition.startsWith('tag:') || next.includes(condition.slice(4))));
    }, error => { if (active) onError(String(error.message || error)); });
    return () => { active = false; };
  }, [cards]);
  async function change(input) {
    if (running.current || busy) return;
    running.current = true; setSaving(true);
    try {
      const result = await rpc('organizeCards', input);
      setTags(result.tags || []);
      await refresh();
      notifyTavernDataChanged(['cards'], 'card-organization');
    } finally { running.current = false; setSaving(false); }
  }
  function submit(input) { void change(input).catch(error => onError(String(error.message || error))); }
  function setSort(value) {
    setSortState(value);
    try { window.localStorage.setItem('dsh-tavern-card-sort-' + place, value); } catch (_) {}
  }
  async function nameTag(tag) {
    await askTavernText({ title: tag !== undefined ? '重命名标签' : '新建标签', maxLength: 40, initialValue: tag || '',
      onSubmit: async name => {
        await change({ action: tag !== undefined ? 'rename' : 'create', tag, name });
        if (tag !== undefined) setFilter(previous => previous.map(condition => condition === 'tag:' + tag ? 'tag:' + name : condition));
      }
    });
  }
  // A new tag from a checklist: created, then put on the cards in one go.
  function createAndTag(paths, name) {
    void (async () => {
      if (!tags.includes(name)) await change({ action: 'create', name });
      if (paths.length) await change({ action: 'cards', paths, addTags: [name] });
    })().catch(error => onError(String(error.message || error)));
  }
  const disabled = busy || saving;
  const visible = filterOrganizedCards(cards, filter, deferredQuery, sort, tagMode);
  function toggleFilter(condition) {
    setFilter(previous => {
      if (previous.includes(condition)) return previous.filter(item => item !== condition);
      // 未打标签 and a tag cannot both hold: picking one drops the other.
      const kept = condition === TAVERN_CARD_UNTAGGED ? previous.filter(item => !item.startsWith('tag:'))
        : condition.startsWith('tag:') ? previous.filter(item => item !== TAVERN_CARD_UNTAGGED) : previous;
      return kept.concat(condition);
    });
  }
  const pickedTags = filter.filter(condition => condition.startsWith('tag:')).map(condition => condition.slice(4));
  const filterLabel = filter.length ? [filter.includes(TAVERN_CARD_FAVORITES) ? '收藏' : '', filter.includes(TAVERN_CARD_UNTAGGED) ? '未打标签' : '',
    pickedTags.join(tagMode === 'any' ? ' 或 ' : ' 且 ')].filter(Boolean).join(' · ') : '全部';
  function option(condition, label) {
    const on = filter.includes(condition);
    return h('button', { key: condition, type: 'button', role: 'menuitemcheckbox', className: 'fork-inline-option', 'aria-checked': on, onClick: () => toggleFilter(condition) },
      h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }, on ? '✓' : ''), h('span', null, label));
  }
  function popupButton(popup, props, ...children) {
    return h('button', Object.assign({ ref: popup.trigger, type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': popup.open,
      onClick: () => popup.setOpen(!popup.open),
      onKeyDown: event => { if (event.key === 'ArrowDown' && !popup.open) { event.preventDefault(); popup.setOpen(true); } } }, props), ...children);
  }
  // The row above the grid: tag filter, search, sort, − columns ＋ and 多选.
  function toolbar() {
    const sortLabel = TAVERN_CARD_SORTS.find(item => item.value === sort).label;
    return h(React.Fragment, null,
      h('div', { className: 'dsh-tavern-card-organization', ref: measure },
        h('span', { className: 'fork-inline-anchor dsh-tavern-card-filter', ref: filterPop.root, onKeyDown: filterPop.keys },
          popupButton(filterPop, { className: 'dsh-tavern-group-picker-button', 'aria-label': '按标签筛选：' + filterLabel },
            h('span', { className: 'dsh-tavern-card-filter-label' }, filterLabel), h('span', { 'aria-hidden': true }, '⌄')),
          filterPop.open ? filterPop.layer({ className: 'fork-inline-pop dsh-tavern-card-filter-pop', role: 'menu', 'aria-label': '按标签筛选', onKeyDown: inlineMenuKeys },
            h('button', { type: 'button', role: 'menuitemradio', className: 'fork-inline-option', 'aria-checked': !filter.length, onClick: () => setFilter([]) },
              h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }, filter.length ? '' : '✓'), h('span', null, '全部')),
            option(TAVERN_CARD_FAVORITES, '收藏'), option(TAVERN_CARD_UNTAGGED, '未打标签'),
            tags.length ? h('div', { className: 'dsh-tavern-card-menu-divider', role: 'separator' }) : null,
            // Several picked tags: the cards that have them all (同时有) or any one (任一).
            tags.length > 1 ? h('div', { className: 'ap-ui dsh-tavern-card-filter-mode' },
              h(Segmented, { label: '多个标签时', value: tagMode, onChange: setTagMode,
                // ↑↓ keep walking the menu rows; ←→ switch.
                onKeyDown: event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.preventDefault(); }, options: [['all', '标签全都有', false, '只显示选中标签全都有的卡'], ['any', '有任一个', false, '显示有任一选中标签的卡']] })) : null,
            tags.map(tag => option('tag:' + tag, tag)),
            h('div', { className: 'dsh-tavern-card-menu-divider', role: 'separator' }),
            // The two tag actions are quieter rows under the conditions, their names in the same column as the tags.
            h('button', { type: 'button', role: 'menuitem', className: 'fork-inline-option dsh-tavern-card-filter-action', disabled, onClick: () => { filterPop.close(false); void nameTag(); } },
              h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }, '＋'), h('span', null, '新建标签')),
            tags.length ? h('button', { type: 'button', role: 'menuitem', className: 'fork-inline-option dsh-tavern-card-filter-action', onClick: () => { filterPop.close(false); setManaging(true); } },
              h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }), h('span', null, '管理标签')) : null) : null),
        h('input', { className: 'dsh-tavern-library-search', value: query, placeholder: '搜索人物卡', 'aria-label': '搜索人物卡', onChange: event => setQuery(event.target.value) }),
        h('span', { className: 'dsh-tavern-card-organization-tools' },
          h('span', { className: 'fork-inline-anchor', ref: sortPop.root, onKeyDown: sortPop.keys },
            popupButton(sortPop, { className: 'dsh-tavern-card-tool', 'aria-label': '排序：' + sortLabel, title: '排序：' + sortLabel }, '⇅'),
            sortPop.open ? sortPop.layer({ className: 'fork-inline-pop', role: 'menu', 'aria-label': '排序', onKeyDown: inlineMenuKeys },
              TAVERN_CARD_SORTS.map(item => h('button', { key: item.value, type: 'button', role: 'menuitemradio', className: 'fork-inline-option', 'aria-checked': sort === item.value,
                onClick: () => { setSort(item.value); sortPop.close(true); } },
                h('span', { className: 'dsh-tavern-card-tag-mark', 'aria-hidden': true }, sort === item.value ? '✓' : ''), h('span', null, item.label)))) : null),
          fit > 2 ? h('span', { className: 'dsh-tavern-card-columns', role: 'group', 'aria-label': '每行张数' },
            h('button', { type: 'button', 'aria-label': '每行少一张', disabled: columns <= 2, onClick: () => setColumns(columns - 1) }, '−'),
            h('output', { 'aria-live': 'polite', title: '每行 ' + columns + ' 张' }, String(columns)),
            h('button', { type: 'button', 'aria-label': '每行多一张', disabled: columns >= fit, onClick: () => setColumns(columns + 1) }, '＋')) : null,
          typeof batch.begin === 'function' ? h('button', { type: 'button', className: 'dsh-tavern-card-tool', 'aria-pressed': Boolean(batch.managing), disabled: busy,
            'aria-label': '多选', title: '多选（也可以 Ctrl+点卡片）', onClick: () => batch.managing ? batch.reset() : batch.begin() }, '☑') : null)),
      managing ? h('dialog', { className: 'dsh-tavern-group-manager', 'aria-label': '管理标签',
        ref: element => { if (element && !element.open) element.showModal(); },
        onCancel: () => setManaging(false), onClick: event => { if (event.target === event.currentTarget && !disabled) setManaging(false); }
      }, h('div', { className: 'dsh-tavern-group-manager-content' },
        h('div', { className: 'dsh-tavern-group-manager-head' }, h('h3', null, '管理标签'),
          h('button', { className: 'dsh-tavern-btn', onClick: () => setManaging(false) }, '关闭')),
        tags.length ? tags.map(tag => h('div', { key: tag, className: 'dsh-tavern-group-manager-row' },
          h('span', null, tag),
          h('button', { className: 'dsh-tavern-btn', disabled, 'aria-label': '重命名标签：' + tag, onClick: () => nameTag(tag) }, '重命名'),
          h('button', { className: 'dsh-tavern-btn danger', disabled, 'aria-label': '删除标签：' + tag, onClick: async () => {
            if (await askConfirm('只去掉这个标签，人物卡不受影响。', { title: '删除标签“' + tag + '”？', confirmText: '删除', danger: true, hide: 'card-tag' })) submit({ action: 'delete', tag });
          } }, '删除'))) : h(EmptyState, { compact: true, noun: '标签' }),
        h('div', { className: 'dsh-tavern-group-manager-footer' },
          h('button', { type: 'button', className: 'dsh-tavern-card-tag-add', disabled, 'aria-label': '新建标签', title: '新建标签', onClick: () => nameTag() }, '＋')))) : null);
  }
  // The selection bar's own actions: 标签 (on for all / off for all / – some) and 收藏.
  function batchActions() {
    if (!batch.managing) return null;
    const chosen = cards.filter(card => batch.paths.includes(card.path));
    const state = tag => {
      const count = chosen.filter(card => (card.tags || []).includes(tag)).length;
      return count && count === chosen.length ? true : count ? 'mixed' : false;
    };
    const none = disabled || !chosen.length;
    return h(React.Fragment, null,
      h('span', { className: 'fork-inline-anchor', ref: batchTagPop.root, onKeyDown: batchTagPop.keys },
        popupButton(batchTagPop, { className: 'dsh-tavern-btn', disabled: none }, '标签 ⌄'),
        batchTagPop.open ? batchTagPop.layer({ className: 'fork-inline-pop dsh-tavern-card-tag-pop', role: 'menu', 'aria-label': '所选人物卡的标签', onKeyDown: inlineMenuKeys },
          h(TavernCardTagChecklist, { tags, state, disabled,
            onToggle: (tag, on) => submit({ action: 'cards', paths: batch.paths, [on ? 'addTags' : 'removeTags']: [tag] }),
            onCreate: name => createAndTag(batch.paths, name) })) : null),
      h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: none, onClick: () => {
        const starred = !chosen.every(card => card.starred);
        submit({ action: 'cards', paths: batch.paths, starred });
      } }, chosen.length && chosen.every(card => card.starred) ? '取消收藏' : '收藏'));
  }
  // The floating selection bar (render it after the grid).
  function batchBar() { return batch.managing ? batch.toolbar(visible, batchActions()) : null; }
  // A card's tag checklist (its menu's 标签 page, the detail page's ＋).
  function tagChecklist(card, extra = {}) {
    return h(TavernCardTagChecklist, Object.assign({ tags, disabled, state: tag => (card.tags || []).includes(tag),
      onToggle: (tag, on) => submit({ action: 'cards', paths: [card.path], [on ? 'addTags' : 'removeTags']: [tag] }),
      onCreate: name => createAndTag([card.path], name) }, extra));
  }
  function toggleStar(card) { submit({ action: 'cards', paths: [card.path], starred: !card.starred }); }
  function untag(card, tag) { submit({ action: 'cards', paths: [card.path], removeTags: [tag] }); }
  return { visible, columns, tags, toolbar, batchBar, tagChecklist, toggleStar, untag, disabled };
}

// The detail page's tags: one chip per tag (✕ takes it off) and a dashed ＋ opening the same checklist.
function TavernCardDetailTags({ card, organization }) {
  const h = React.createElement, popup = useInlinePopup({ focusSelector: 'input' });
  if (!card) return null;
  const tags = card.tags || [];
  return h('div', { className: 'dsh-tavern-card-detail-tags' },
    tags.map(tag => h('span', { key: tag, className: 'dsh-tavern-card-detail-tag' }, h('span', null, tag),
      h('button', { type: 'button', disabled: organization.disabled, 'aria-label': '去掉标签：' + tag, title: '去掉标签',
        onClick: () => organization.untag(card, tag) }, '×'))),
    h('span', { className: 'fork-inline-anchor', ref: popup.root, onKeyDown: popup.keys },
      h('button', { ref: popup.trigger, type: 'button', className: 'dsh-tavern-card-tag-add', 'aria-label': '添加标签', title: '添加标签', 'aria-haspopup': 'menu', 'aria-expanded': popup.open,
        onClick: () => popup.setOpen(!popup.open) }, '＋'),
      popup.open ? popup.layer({ className: 'fork-inline-pop dsh-tavern-card-tag-pop', role: 'menu', 'aria-label': '标签', onKeyDown: inlineMenuKeys }, organization.tagChecklist(card)) : null));
}

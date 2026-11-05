const wiki = 'https://github.com/flizzywine/dsh-tavern/wiki/';
const features = {
  script: { image: 'script-mode.png', alt: '剧本进度和当前片段与正文并排显示', kicker: '剧本模式 / 实机画面', caption: '有主线，也有你的选择。', doc: '绑定剧本后开始游戏' },
  memory: { image: 'overview.png', alt: '酒馆游玩界面；历史原文可由 Agent 按需检索', kicker: '长期记忆 / 游玩界面', caption: '很久以前的那一幕，依然有迹可循。', doc: '按需找回历史细节' },
  guide: { image: 'rewrite-body.png', alt: '带意见重写当前正文，右侧为本局 Guide', kicker: 'Guide 与带意见重写 / 实机画面', caption: '不必反复抽卡，把意见告诉它。', doc: '持续-Guide' },
  state: { image: 'mvu-status-panel.png', alt: '本轮变量结算结果与常驻 MVU 状态栏', kicker: 'MVU 状态栏 / 实机画面', caption: '前台写故事，后台照顾世界。', doc: 'MVU-变量与常驻状态栏' },
};
const tabs = [...document.querySelectorAll('[data-feature]')];
function selectTab(tab, focus = false) {
  const feature = features[tab.dataset.feature];
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  document.querySelector('#preview-image').src = `assets/screens/${feature.image}`;
  document.querySelector('#preview-image').alt = feature.alt;
  document.querySelector('#preview-kicker').textContent = feature.kicker;
  document.querySelector('#preview-caption').textContent = feature.caption;
  document.querySelector('#preview-doc').href = wiki + encodeURIComponent(feature.doc);
  document.querySelector('#play-panel').setAttribute('aria-labelledby', tab.id);
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    const destinations = { ArrowDown: (index + 1) % tabs.length, ArrowUp: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    selectTab(tabs[destinations[event.key]], true);
  });
});

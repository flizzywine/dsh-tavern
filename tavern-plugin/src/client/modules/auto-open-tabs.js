// 「进入游戏时打开酒馆状态」的判定：什么时候算玩家离开了这一局。
//
// 侧栏拿到的 current 由会话列表的 retainedBy.mainView 推导。列表刷新、侧栏重挂载的那几帧
// 读不到主会话，会得到空串。把空串当成「离开」会清掉「这一局已经展示过」的记号，等快照
// 回来，同一局又被当成新进入：右侧栏重新展开、状态页被聚焦，直接盖在正文上。
//
// 所以只有真的切到另一个会话才立刻清记号；空串要持续 TAVERN_AUTO_OPEN_BLANK_MS 才算离开
// （开始页、卡片工作台），短暂抖动不算。

var TAVERN_AUTO_OPEN_BLANK_MS = 800;

function tavernAutoOpenClearedBy(mark, current) {
	return Boolean(current) && current !== mark;
}

// 右侧栏此刻是否已经展开、并且正停在其中一页上。自动打开要先问这一句：重复打开会展开
// 收起状态下的整列并聚焦那一页，等于把面板压到正文上。
function tavernRightColumnShowsPage(column, kinds) {
	if (!column || typeof column.isExpanded !== "function" || typeof column.active !== "function") return false;
	try {
		if (column.isExpanded() !== true) return false;
		const page = column.active();
		if (!page) return false;
		return kinds.some(function (kind) { return page.kind === kind || page.contentId === kind; });
	} catch (_) { return false; }
}

function tavernRightColumnShowing(ctx, kinds) {
	try {
		return tavernRightColumnShowsPage(ctx && typeof ctx.get === "function" ? ctx.get("sidebarRight") : null, kinds);
	} catch (_) { return false; }
}

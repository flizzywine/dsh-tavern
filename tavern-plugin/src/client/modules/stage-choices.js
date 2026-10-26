// 回合末选项 (features/stage-choices.js, tavern.css 「stage choices」): the stage's last page of a round offers the round's
// candidates (the chat's candidate pipeline: the same task, the same panel) and 自由输入, in place of a bare input.
// The menu's state from the candidate panel or task of the latest reply: hidden away from the last card or while a reply is
// written; generating while the candidate task runs; ready / failed once it ends; off (生成选项) when there is none or the
// player stopped it. The stage never starts a task by itself: the host's automatic generation (自动生成候选项) or a click does.
function stageChoiceStatus(panel, task) {
	if (panel) return panel.phase === "ready" ? "ready" : panel.phase === "error" ? "failed" : panel.phase === "loading" ? "generating" : "off";
	if (!task) return "off";
	return task.busy ? "generating" : task.status === "succeeded" ? "ready" : task.status === "cancelled" ? "off" : "failed";
}
function stageChoiceState({ panel, task, atEnd, running }) {
	return !atEnd || running ? "hidden" : stageChoiceStatus(panel, task);
}
// A suggestion as the menu shows it and as it is sent: a scene change reads like any other choice (no tag); only the message
// sent carries its 【场景变化】 mark, as the chat's candidates do.
function stageChoiceItems(choices) {
	return (choices || []).map(choice => {
		const item = choice !== null && typeof choice === "object" ? choice : { type: "action", text: String(choice) };
		return { type: item.type === "scene" ? "scene" : "action", text: String(item.text || ""), send: (item.type === "scene" ? "【场景变化】" : "") + String(item.text || "") };
	}).filter(item => item.text.trim());
}

// The wait lines: while the choices generate, and while the next reply is written, the text box shows one short line at a
// time, each held STAGE_WAIT_LINE_MS and cross-fading in one of four stacked slots, followed by six breathing dots (its only
// ellipsis). The engine's own lines are the default; a skin replaces them with its waitLines (a card through the skin it
// draws its stage in). Each line fits one line on a 375 px phone.
const STAGE_WAIT_LINES = Object.freeze([
	"世界线收束中", "正在发送 D-Mail", "收集光玉中", "正在寻找这个世界的秘密", "观测「不连续存在」中",
	"模拟宇宙载入中", "神圣时间线校准中", "正在更新未来日记", "正在运营平行世界", "正在闭合时间的圆环",
	"正在遍历世界线", "观测下一个分歧点", "正在推演每一条分支", "正在折叠时间线", "正在打开薛定谔的盒子",
	"量子叠加态坍缩中", "多元宇宙分支展开中", "世界线变动率测定中", "正在拼合世界的碎片", "正在平行世界间转移",
	"平行宇宙坐标校准中", "命运的道路正在分岔", "因果律网络重构中"
]);
const STAGE_WAIT_LINE_MS = 2400, STAGE_WAIT_SLOTS = 4;
// One wait: where in the lines it starts (so each wait opens on a different line) and when it began. The same key keeps the
// same wait, so a remount resumes the cycle where it was.
function stageWaitEpisode(previous, key, count, random = Math.random, now = Date.now()) {
	if (previous && previous.key === key) return previous;
	return { key, first: Math.floor(random() * count), start: now };
}
// The line slot `slot` shows `elapsed` ms into the wait: slot i shows the wait's turns i, i + 4, i + 8 ... and takes its next
// line half a turn after its fade-out ends, while it is hidden, so no visible line ever changes its text.
function stageWaitLineAt(lines, first, slot, elapsed) {
	const turn = STAGE_WAIT_LINE_MS, cycle = turn * STAGE_WAIT_SLOTS;
	const round = Math.max(0, Math.floor((elapsed - turn / 2 - (slot + 1) * turn) / cycle) + 1);
	return lines[(first + slot + round * STAGE_WAIT_SLOTS) % lines.length];
}

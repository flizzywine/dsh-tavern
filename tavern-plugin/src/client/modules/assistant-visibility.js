// DSH 0.1.5 Definitions may withdraw an already materialized node: an assistant
// whose stream block becomes empty, or a turn-process whose only evidence was a
// live stream that failed into an assistant/attempt (its match() ignores attempts).
// The core then throws inside the event feed subscriber and the conversation stops
// updating until reload. Preserve identity at the assembler boundary as the core
// asks: the same key, hidden. React renderers cannot enforce this.
function installTavernAssistantVisibilityPatch(require) {
	let conversation;
	try { conversation = require("@deepseek-ai/dsh-client-ui-conversation/client"); }
	catch (_) { return; }
	const proto = conversation && conversation.ConversationNodeAssembler && conversation.ConversationNodeAssembler.prototype;
	if (!proto || typeof proto.buildNode !== "function" || proto.__dshTavernAssistantVisibility) return;
	const buildNode = proto.buildNode;
	const warned = new Set();
	proto.buildNode = function (context, target) {
		const node = buildNode.call(this, context, target);
		if (node === null) {
			const previous = context.current.get(target);
			if (!previous) return null;
			if (context.kind !== "assistant-step" && !warned.has(context.kind)) {
				warned.add(context.kind);
				console.warn("[dsh-tavern] 宿主节点 " + context.kind + " 撤回了已显示内容，已改为隐藏以免会话停止刷新");
			}
			return Object.assign({}, previous, { visibility: "hidden" });
		}
		if (target !== "chat" || context.kind !== "assistant-step") return node;
		const messageId = node.data && node.data.finalNode && node.data.finalNode.messageId;
		if (/^tavern-seed-trajectory:v1:.+:2$/.test(String(messageId || ""))) {
			return Object.assign({}, node, { visibility: "hidden" });
		}
		return node;
	};
	Object.defineProperty(proto, "__dshTavernAssistantVisibility", { value: true });
}

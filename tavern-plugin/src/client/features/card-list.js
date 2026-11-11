		async function deleteTavernCards(cards, remove) {
			const results = [];
			const paths = new Set();
			for (const card of cards) {
				if (paths.has(card.path)) continue;
				paths.add(card.path);
				try {
					const result = await remove(card.path);
					if (!result || result.deleted !== true) throw new Error("人物卡未删除");
					results.push({ path: card.path, name: card.name, ok: true });
				} catch (error) { results.push({ path: card.path, name: card.name, ok: false, error: String(error && error.message || error) }); }
			}
			return results;
		}

		function isMissingSessionArchiveError(error) {
			const message = String(error && error.message || error || "").toLowerCase();
			return message.indexOf("session-not-found") >= 0 || (message.indexOf("cannot archive session") >= 0 && message.indexOf("no such session") >= 0);
		}

		// Stop Tavern work first, then archive the DSH session, then remove the record;
		// a chat whose session cannot be archived is kept so it never becomes a hidden orphan.
		// Archiving is one host round-trip per session, so a batch runs a few at a time —
		// it used to wait for each one before starting the next.
		const ARCHIVE_CONCURRENCY = 4;
		async function deleteTavernChats(items, archiveSession, call = rpc) {
			const failures = [];
			if (!items.length) return { removed: [], failures };
			const prepared = await call("prepareDeleteChats", { chatIds: items.map(item => item.chatId) });
			failures.push(...prepared.results.filter(result => !result.ok));
			const eligible = items.filter(item => prepared.results.some(result => result.chatId === item.chatId && result.ok));
			const archived = new Set();
			let next = 0;
			async function archiveSome() {
				for (;;) {
					const index = next++;
					if (index >= eligible.length) return;
					const item = eligible[index];
					try {
						try { await archiveSession(item.sessionId); }
						catch (archiveError) { if (!isMissingSessionArchiveError(archiveError)) throw archiveError; }
						archived.add(item.chatId);
					} catch (error) { failures.push({ chatId: item.chatId, error: String(error && error.message || error) }); }
				}
			}
			await Promise.all(Array.from({ length: Math.min(ARCHIVE_CONCURRENCY, eligible.length) }, archiveSome));
			const ready = eligible.filter(item => archived.has(item.chatId)).map(item => item.chatId);
			if (!ready.length) return { removed: [], failures };
			const deleted = await call("deleteChats", { chatIds: ready });
			failures.push(...deleted.results.filter(result => !result.ok));
			return { removed: deleted.results.filter(result => result.ok).map(result => result.chatId), failures };
		}

		function tavernCardPathKey(path) {
			return String(path || "").replace(/\\/g, "/");
		}

		// Play history survives its card unless the user opts in; card workbench chats are kept.
		async function askTavernCardChatRemoval(paths, askConfirm, call = rpc) {
			const wanted = new Set(paths.map(tavernCardPathKey));
			const listed = await call("listSessions");
			const chats = (listed.sessions || []).filter(entry => entry.chatId && groupOfMode(entry.mode) === "play" && wanted.has(tavernCardPathKey(entry.cardPath)));
			if (!chats.length) return [];
			const counts = new Map();
			for (const entry of chats) { const key = tavernCardPathKey(entry.cardPath); counts.set(key, { name: entry.cardName || key, count: (counts.get(key)?.count || 0) + 1 }); }
			const lines = paths.length > 1 ? "\n\n" + Array.from(counts.values()).slice(0, 20).map(item => "• " + item.name + "：" + item.count + " 个").join("\n") + (counts.size > 20 ? "\n……共 " + counts.size + " 张卡" : "") : "";
			const accepted = await askConfirm((paths.length > 1 ? "所选人物卡中有 " + counts.size + " 张" : "这张人物卡") + "还有 " + chats.length + " 个游玩记录，要一起彻底删除吗？" + lines + "\n\n此操作不可撤销。", { confirmText: "一起彻底删除", cancelText: "保留游玩记录" });
			return accepted ? chats : [];
		}

		// Only history of cards that were actually deleted is removed.
		async function removeTavernCardChats(chats, results, archiveSession, call = rpc) {
			const deletedPaths = new Set(results.filter(item => item.ok).map(item => tavernCardPathKey(item.path)));
			const items = chats.filter(entry => deletedPaths.has(tavernCardPathKey(entry.cardPath)));
			if (!items.length) return { notice: "", sessionIds: [] };
			let outcome;
			try { outcome = await deleteTavernChats(items, archiveSession, call); }
			catch (error) { return { notice: "游玩记录删除失败：" + String(error && error.message || error), sessionIds: [] }; }
			const sessionIds = items.filter(entry => outcome.removed.includes(entry.chatId)).map(entry => entry.sessionId);
			return { notice: "游玩记录删除 " + outcome.removed.length + " 个" + (outcome.failures.length ? "，" + outcome.failures.length + " 个失败，可在左侧历史中重试" : ""), sessionIds };
		}

		// The sidebar listens so an open chat of a deleted card does not stay on screen.
		function announceTavernChatsRemoved(sessionIds) {
			if (sessionIds.length) window.dispatchEvent(new CustomEvent("dsh-tavern-chats-removed", { detail: { sessionIds } }));
		}

		// @include card-organization.js

		function useCardBatchDeletion(cards, busy, setBusy, refresh, archiveSession) {
            const askConfirm = useTavernConfirm();
			const [managing, setManaging] = React.useState(false);
			const [paths, setPaths] = React.useState([]);
			const [notice, setNotice] = React.useState("");
			const running = React.useRef(false);
			const selected = cards.filter(card => paths.includes(card.path));
			function toggle(path) { if (!busy && !running.current) setPaths(previous => previous.includes(path) ? previous.filter(value => value !== path) : previous.concat(path)); }
			function isSelected(path) { return paths.includes(path); }
			function reset() { setManaging(false); setPaths([]); setNotice(""); }
			async function removeSelected() {
				if (busy || running.current || !selected.length) return;
				const names = selected.slice(0, 20).map(card => "• " + card.name + "（" + card.path + "）").join("\n");
				if (!await askConfirm("删除所选的 " + selected.length + " 张人物卡吗？\n\n" + names + (selected.length > 20 ? "\n……共 " + selected.length + " 张" : "") + "\n\n此操作不可撤销。")) return;
				let chats;
				try { chats = archiveSession ? await askTavernCardChatRemoval(selected.map(card => card.path), askConfirm) : []; }
				catch (error) { setNotice("读取游玩记录失败，未删除人物卡：" + String(error && error.message || error)); return; }
				running.current = true; setBusy(true); setNotice("");
				try {
					const results = await deleteTavernCards(selected, path => rpc("deleteCard", { path }));
					const failed = results.filter(item => !item.ok);
					const chatRemoval = await removeTavernCardChats(chats, results, archiveSession);
					const chatNotice = chatRemoval.notice;
					announceTavernChatsRemoved(chatRemoval.sessionIds);
					setPaths(failed.map(item => item.path));
					setNotice("已删除 " + (results.length - failed.length) + " 张" + (failed.length ? "，" + failed.length + " 张失败，可重试：" + failed.map(item => item.name + "：" + item.error).join("；") : "。") + (chatNotice ? " " + chatNotice + "。" : ""));
					await refresh();
					notifyTavernDataChanged(["cards", "sessions"], "cards");
				} catch (error) { setNotice(previous => previous + " 刷新失败：" + String(error && error.message || error)); }
				finally { running.current = false; setBusy(false); }
			}
			// One compact bar: select-all, count, actions, done. `extra` holds the
			// caller's own actions (e.g. moving to a group).
			function toolbar(visible, extra) {
				const h = React.createElement;
				const allSelected = visible.length > 0 && visible.every(card => paths.includes(card.path));
				function toggleAll() {
					if (allSelected) setPaths(previous => previous.filter(path => !visible.some(card => card.path === path)));
					else setPaths(previous => Array.from(new Set(previous.concat(visible.map(card => card.path)))));
				}
				return h("div", { className: "dsh-tavern-card-batch" },
					h("label", { className: "dsh-tavern-card-batch-all" },
						h("input", { type: "checkbox", className: "dsh-tavern-card-batch-checkbox", checked: allSelected, disabled: busy || !visible.length, "aria-label": "全选当前列表",
							ref: function (element) { if (element) element.indeterminate = !allSelected && selected.length > 0; }, onChange: toggleAll }),
						"全选"),
					h("span", { className: "dsh-tavern-card-batch-count" }, selected.length ? "已选 " + selected.length + " 张" : "点击人物卡选择"),
					h("span", { className: "dsh-tavern-spacer" }),
					extra || null,
					h("button", { className: "dsh-tavern-btn danger", disabled: busy || !selected.length, onClick: removeSelected }, running.current ? "正在删除…" : "删除" + (selected.length ? "（" + selected.length + "）" : "")),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: reset }, "完成"),
					notice ? h("div", { role: "status", className: "dsh-tavern-card-batch-notice" }, notice) : null);
			}
			function checkbox(card) {
				return managing ? React.createElement("input", {
					type: "checkbox",
					className: "dsh-tavern-card-batch-checkbox",
					checked: paths.includes(card.path),
					disabled: busy,
					"aria-label": "选择人物卡：" + card.name + "（" + card.path + "）",
					onClick: function (event) { event.stopPropagation(); },
					onChange: function () { toggle(card.path); }
				}) : null;
			}
			return { managing, toggle, toolbar, checkbox, isSelected, reset, paths, begin: function () { setManaging(true); setPaths([]); setNotice(""); } };
		}

		function tavernHistoryCardKey(item) {
			return item.cardPath ? "card:" + item.cardPath : "unbound:" + (item.chatId || item.sessionId);
		}

		// Latest of opened, saved, or replied to (the live session summary), for "most recent" orderings.
		function tavernHistoryActivity(item, summaries = {}) {
			function timestamp(value) { const n = Number(value); return Number.isFinite(n) ? n : (Date.parse(value) || 0); }
			return Math.max(timestamp(item.lastOpenedAt), timestamp(item.updatedAt), timestamp(summaries[item.sessionId]?.updatedAt));
		}

		// 设置 › 高级 › 对话按最新回复排序：默认 created（创建时间固定排列），recent 为最近活动优先。
		function tavernHistoryOrder(order) { return order === "recent" ? "recent" : "created"; }

		// 一行右侧那个时间：创建序时是创建时间，最新回复序时是这次排序用的活动时间。
		function tavernHistoryStamp(item, summary, summaries, order) {
			if (tavernHistoryOrder(order) === "recent") {
				return tavernHistoryActivity(item, summaries || (summary ? { [item.sessionId]: summary } : {}));
			}
			return Number(item.createdAt) || Number(item.lastOpenedAt) || Number(summary && summary.updatedAt) || Number(item.updatedAt) || 0;
		}

		function sortTavernHistoryByActivity(history, summaries = {}) {
			function timestamp(value) { const n = Number(value); return Number.isFinite(n) ? n : (Date.parse(value) || 0); }
			return history.slice().sort(function (left, right) {
				return tavernHistoryActivity(right, summaries) - tavernHistoryActivity(left, summaries) || timestamp(right.createdAt) - timestamp(left.createdAt);
			});
		}

		// 最新回复序下整张列表按活动排；创建序保持注册表的固定位置（同时间按最近打开）。
		function orderTavernHistory(history, summaries = {}, order) {
			function timestamp(value) { const n = Number(value); return Number.isFinite(n) ? n : (Date.parse(value) || 0); }
			if (tavernHistoryOrder(order) === "recent") return sortTavernHistoryByActivity(history, summaries);
			return history.slice().sort(function (left, right) {
				return timestamp(right.createdAt) - timestamp(left.createdAt) || timestamp(right.lastOpenedAt) - timestamp(left.lastOpenedAt);
			});
		}

		function groupTavernHistory(history, summaries = {}, order) {
			function timestamp(value) { const n = Number(value); return Number.isFinite(n) ? n : (Date.parse(value) || 0); }
			function activity(item) { return tavernHistoryActivity(item, summaries); }
			// Groups follow the latest activity; conversations inside keep their creation order
			// unless 「对话按最新回复排序」 is on, then the inner list follows the same activity.
			const groups = new Map();
			for (const item of history.slice().sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt))) {
				const key = tavernHistoryCardKey(item);
				if (!groups.has(key)) groups.set(key, { key, name: item.cardName || "未命名人物卡", path: item.cardPath || "", items: [], activity: 0 });
				const group = groups.get(key);
				group.items.push(item);
				group.activity = Math.max(group.activity, activity(item));
			}
			const grouped = Array.from(groups.values());
			if (tavernHistoryOrder(order) === "recent") for (const group of grouped) group.items = sortTavernHistoryByActivity(group.items, summaries);
			return grouped.sort((a, b) => b.activity - a.activity);
		}

		// 在人物卡分组下展示时，剥离 SillyTavern 导入产生的重复角色名前缀（如 "Storyteller - Storyteller - 2026-..."）。
		function compactTavernHistoryTitle(rawTitle, cardName) {
			const title = String(rawTitle || "").trim();
			const card = String(cardName || "").trim();
			if (!title || !card) return title;
			let rest = title;
			for (let step = 0; step < 3; step++) {
				if (rest.slice(0, card.length).toLowerCase() !== card.toLowerCase()) break;
				const tail = rest.slice(card.length);
				const match = /^\s*(?:[-_—·:|/]+|\s+)\s*(.+)$/.exec(tail);
				if (!match || !match[1].trim()) break;
				rest = match[1].trim();
			}
			return rest || title;
		}

		function tavernPreviewLines(text, limit, role, label) {
			const lines = String(text || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
			if (!lines.length) return null;
			// Folded to one paragraph: the clamp in CSS counts wrapped lines, so a
			// pre-wrapped list would make "one line here, five lines expanded" lie.
			return { role: role, label: label, text: lines.slice(0, limit).join(" ") };
		}

		function formatTavernHistoryPreview(preview) {
			const empty = { hasPreview: false, turnCount: 0, messageCount: 0, isOpeningOnly: false, turnBadge: "", compactLines: [], detailLines: [], tooltip: "", searchText: "" };
			if (!preview || typeof preview !== "object") return empty;
			const turnCount = Math.max(0, Number(preview.turnCount) || 0);
			const messageCount = Math.max(0, Number(preview.messageCount) || 0);
			const userText = String(preview.userText || "").trim();
			const replyText = String(preview.replyText || "").trim();
			const openingText = String(preview.openingText || "").trim();
			const hasDialogue = Boolean(userText || replyText);
			const turnBadge = turnCount > 0 ? (turnCount + " 轮") : (messageCount > 0 || openingText || userText ? "仅开场" : "空对话");
			const compactLines = [];
			const detailLines = [];
			function push(brief, full) { if (brief) compactLines.push(brief); if (full) detailLines.push(full); }
			if (hasDialogue) {
				push(tavernPreviewLines(userText, 1, "user", "你"), tavernPreviewLines(userText, 3, "user", "你"));
				push(tavernPreviewLines(replyText, 2, "reply", "角色"), tavernPreviewLines(replyText, 5, "reply", "角色"));
			} else if (openingText) {
				push(tavernPreviewLines(openingText, 2, "opening", "开场"), tavernPreviewLines(openingText, 5, "opening", "开场"));
			}
			return {
				hasPreview: compactLines.length > 0,
				turnCount,
				messageCount,
				isOpeningOnly: turnCount === 0 && !hasDialogue,
				turnBadge,
				compactLines,
				detailLines,
				tooltip: detailLines.map(function (line) { return line.label + "：" + line.text; }).join("\n"),
				searchText: [userText, replyText, openingText].filter(Boolean).join("\n").toLowerCase()
			};
		}


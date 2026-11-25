		// ==== 世界书库 › one book ====
		// The book's page in the 舞台素材 language, like the card detail page: ‹ name ✎ … ⋯ (导出 · 重命名文件… · 在对话中引用 ·
		// 删除世界书…), then StageSection headings — 设置 (全局生效, 说明), 人物卡 (the cards bound to it, ＋ binds another), 条目 (search,
		// the lamp filter and ＋ on one row; groups 常驻 · 非常驻 · 禁用 · 仅后台变量更新, each a windowed list). An entry's lamp is its
		// state (蓝 常驻, 绿 非常驻, 灰 禁用). Every change saves itself when it is left (R17): one entry update per change, the book
		// itself only when an entry is added or deleted; the head says 正在保存… / 已保存.
		const WORLD_BOOK_SELECTIVE_LOGIC = ["至少一个命中", "不全部命中", "全部不命中", "全部命中"];
		const WORLD_BOOK_CHANNEL_OPTIONS = [
			{ value: "auto", label: "自动" },
			{ value: "prefix", label: "稳定前缀" },
			{ value: "tail", label: "每轮尾部" }
		];
		const WORLD_BOOK_CHANNEL_LABELS = { auto: "自动", prefix: "稳定前缀", tail: "每轮尾部" };
		const WORLD_BOOK_CHANNEL_INHERIT = "";
		const WORLD_BOOK_CHANNEL_HINTS = {
			auto: "自动：常驻且内容不变的进稳定前缀；会变、带模板或随机、或非常驻的进每轮尾部。",
			prefix: "稳定前缀：固定设定放这里最省 token，改一次才重建一次；含模板或随机的条目仍走每轮尾部。",
			tail: "每轮尾部：每轮都贴着最新消息出现，注意力最高；不看触发词、不吃冷却，但同样计入 Token 预算。"
		};
		function worldBookChannelValue(value) {
			const text = String(value || "auto");
			return WORLD_BOOK_CHANNEL_LABELS[text] ? text : "auto";
		}
		function worldBookEntryTitle(entry) { return entry.comment || entry.title || "未命名条目"; }
		// The quiet text after an entry's name: its trigger words, else the start of its text.
		function worldBookEntryHint(entry) {
			const keys = entry.constant === true || isMvuUpdateEntry(entry) ? [] : entry.primaryKeys || [];
			return keys.length ? keys.join("、") : String(entry.content || "").replace(/\s+/g, " ").trim().slice(0, 80);
		}
		function worldBookViewClone(view) { return JSON.parse(JSON.stringify(view || { displayName: "", description: "", entries: [], diagnostics: [] })); }
		// One entry in a group: its lamp (a menu: 常驻 / 非常驻 / 禁用), the name and the quiet hint; a click opens it. `children` is
		// the entry's fields when it opens in place.
		function WorldBookEntryRow(props) {
			const h = React.createElement, entry = props.entry, title = worldBookEntryTitle(entry), hint = worldBookEntryHint(entry);
			return h("li", { className: "dsh-wbd-entry", role: "option", "aria-selected": !!props.selected, "data-open": props.children ? true : undefined, "data-off": entry.enabled === false || undefined },
				h("div", { className: "dsh-wbd-entry-row", onClick: props.onOpen },
					h(packUi.LampMenu, { mode: worldBookEntryLamp(entry), onOff: isMvuUpdateEntry(entry), words: WORLD_BOOK_LAMP_WORDS, label: "「" + title + "」的状态",
						anchorClassName: "ap-item-lamp-anchor", className: "ap-item-lamp", onChange: props.onLamp }),
					h("button", { type: "button", className: "dsh-wbd-entry-main", "aria-expanded": !!props.selected, title: title,
						onClick: function (event) { event.stopPropagation(); props.onOpen(); } },
						h("span", { className: "dsh-wbd-entry-name" }, title), hint ? h("span", { className: "dsh-wbd-entry-hint" }, hint) : null),
					props.menu || null),
				props.children || null);
		}
		// 内容: the text reads as prose under its label (like the card page's opened texts); ✎ or a double click turns it into the
		// field, which saves when it is left.
		function WorldBookEntryText(props) {
			const h = React.createElement, [editing, setEditing] = React.useState(false);
			return h("div", { className: "dsh-wbd-text", onBlur: function (event) { if (editing && !event.currentTarget.contains(event.relatedTarget)) setTimeout(function () { setEditing(false); }, 0); } },
				h("div", { className: "dsh-wbd-text-head" }, h("span", null, "内容"),
					editing ? null : h("button", { type: "button", className: "ap-icon-button dsh-card-fold-edit", "aria-label": "编辑内容", title: "编辑", onClick: function () { setEditing(true); } }, h(packUi.Glyph, { name: "edit" }))),
				editing
					? h(InlineField, { kind: "text", multiline: true, lines: true, wide: true, hideLabel: true, trim: false, label: "内容", value: props.value, autoEdit: true, onCommit: props.onCommit })
					: h("div", { className: "dsh-wbd-text-body", "data-empty": "还没有内容", onDoubleClick: function () { setEditing(true); } }, props.value));
		}
		// An entry's fields. 标题 · 状态 · 触发词 · 内容 first; the rest of the trigger rules and the SillyTavern-only fields are two
		// folded headings. Each field saves when it is left (onPatch).
		function WorldBookEntryEditor(props) {
			const h = React.createElement, entry = props.entry, background = isMvuUpdateEntry(entry), st = props.format === "sillytavern-worldbook";
			const set = function (patch) { return props.onPatch(patch); };
			const help = function (label, text) { return h(HelpTip, { label: label + " 说明" }, text); };
			const number = function (key, label, fallback, extra) {
				return h(InlineField, Object.assign({ key: key, kind: "number", integer: true, label: label, value: entry[key] ?? (extra && extra.optional ? null : fallback),
					onCommit: function (value) { return set({ [key]: value === null ? (extra && extra.optional ? null : fallback) : value }); } }, extra || {}));
			};
			const toggle = function (key, label, checked, tip) {
				return h(InlineRow, { key: key, label: label, help: tip ? help(label, tip) : null }, h(Switch, { label: label, checked: checked, onChange: function (value) { return set({ [key]: value }); } }));
			};
			const words = !background && entry.constant !== true;
			const bookChannel = worldBookChannelValue(props.bookChannel);
			const entryChannel = worldBookChannelValue(entry.channel);
			const channelInherited = entry.channelInherited !== false;
			return h("div", { className: "dsh-wbd-editor" },
				h(InlineGrid, { label: "条目", columns: 1, className: "dsh-wbd-fields" },
					h(InlineField, { key: "comment", kind: "text", label: "标题", value: entry.comment || "", onCommit: function (value) { return set({ comment: value, title: value }); } }),
					h(InlineRow, { key: "lamp", label: "状态" }, h(packUi.LampMenu, { named: true, mode: worldBookEntryLamp(entry), onOff: background, words: WORLD_BOOK_LAMP_WORDS, label: "状态", onChange: props.onLamp })),
					!background ? h(InlineField, {
						key: "channel", kind: "menu", label: "注入通道",
						value: channelInherited ? WORLD_BOOK_CHANNEL_INHERIT : entryChannel,
						options: [{ value: WORLD_BOOK_CHANNEL_INHERIT, label: "跟随整本（" + WORLD_BOOK_CHANNEL_LABELS[bookChannel] + "）" }].concat(WORLD_BOOK_CHANNEL_OPTIONS),
						help: help("注入通道", (channelInherited ? "跟随整本默认（" + WORLD_BOOK_CHANNEL_LABELS[bookChannel] + "）。" : "") + WORLD_BOOK_CHANNEL_HINTS[entryChannel]),
						onCommit: function (value) {
							return value === WORLD_BOOK_CHANNEL_INHERIT
								? set({ channel: null, channelInherited: true })
								: set({ channel: value, channelInherited: false });
						}
					}) : null,
					words ? h(InlineField, { key: "primaryKeys", kind: "chips", label: "触发词", value: entry.primaryKeys || [], help: help("触发词", "对话里出现这些词时提示这个条目。也可以写 /正则/。"), onCommit: function (value) { return set({ primaryKeys: value }); } }) : null,
					words ? h(InlineField, { key: "secondaryKeys", kind: "chips", label: "二级触发词", hideEmpty: true, value: entry.secondaryKeys || [], onCommit: function (value) { return set({ secondaryKeys: value }); } }) : null),
				h(WorldBookEntryText, { value: entry.content || "", onCommit: function (value) { return set({ content: value }); } }),
				h(packUi.StageSection, { level: 2, title: "触发规则", foldKey: "worldbook-detail:entry-rules", defaultFolded: true,
					help: "扫描本轮输入和最近消息；非常驻条目共用一份软预算，排序大的先入选。" },
					h(InlineGrid, { label: "触发规则", columns: 2, className: "dsh-wbd-fields" },
						number("order", "排序", 100),
						number("displayIndex", "展示顺序", props.index),
						number("scanDepth", "扫描消息数", null, { optional: true, min: 0, max: 1000, placeholder: "跟随世界书" }),
						h(InlineField, { key: "selectiveLogic", kind: "menu", label: "二级条件", value: entry.selectiveLogic || 0,
							options: WORLD_BOOK_SELECTIVE_LOGIC.map(function (label, value) { return { value: value, label: label }; }), onCommit: function (value) { return set({ selectiveLogic: value }); } }),
						number("delayUntilRecursion", "递归等级", 0, { min: 0 }),
						h(InlineField, { key: "group", kind: "text", label: "包含组", value: entry.group || "", onCommit: function (value) { return set({ group: value }); } }),
						number("groupWeight", "组权重", 100, { min: 0 }),
						h(InlineField, { key: "position", kind: st ? "number" : "text", integer: st || undefined, label: "注入位置", value: entry.position ?? (st ? 0 : ""),
							onCommit: function (value) { return set({ position: st ? (value === null ? 0 : value) : value }); } }),
						toggle("selective", "使用二级条件", entry.selective === true),
						toggle("caseSensitive", "区分大小写", entry.caseSensitive === true),
						toggle("matchWholeWords", "整词匹配", entry.matchWholeWords === true),
						toggle("groupOverride", "组内按排序", entry.groupOverride === true),
						toggle("useGroupScoring", "组内计分", entry.useGroupScoring === true),
						toggle("excludeRecursion", "不被递归触发", entry.excludeRecursion === true),
						toggle("preventRecursion", "不触发递归", entry.preventRecursion === true))),
				h(packUi.StageSection, { level: 2, title: "兼容字段", foldKey: "worldbook-detail:entry-compat", defaultFolded: true,
					help: "只用于和 SillyTavern 互相导入导出，不影响这里的游玩；人物卡脚本仍能读到。" },
					h(InlineGrid, { label: "兼容字段", columns: 2, className: "dsh-wbd-fields" },
						number("depth", "深度", 4),
						number("probability", "概率 %", 100, { min: 0, max: 100 }),
						toggle("probabilityEnabled", "启用概率", entry.probabilityEnabled !== false),
						toggle("vectorized", "向量候选", entry.vectorized === true))));
		}
		function WorldBookDetail(props) {
			const askConfirm = useTavernConfirm(props.sessionId);
			const h = React.createElement, ui = packUi, record = props.record, source = record.source;
			const [draft, setDraft] = React.useState(function () { return worldBookViewClone(record.view); });
			const draftRef = React.useRef(draft);
			draftRef.current = draft;
			// the view this page saved itself (lean writes keep the client's copy); any other new view replaces the page's copy.
			const savedView = React.useRef(null);
			React.useEffect(function () { if (record.view !== savedView.current) setDraft(worldBookViewClone(record.view)); }, [record.view]);
			const [pending, setPending] = React.useState(0), pendingRef = React.useRef(0), queue = React.useRef(Promise.resolve());
			const [saved, setSaved] = React.useState(false);
			const [error, setError] = usePersistentError("世界书编辑");
			const [query, setQuery] = React.useState(""), deferredQuery = React.useDeferredValue(query);
			const [filter, setFilter] = React.useState("all");
			const [openRefs, setOpenRefs] = React.useState(function () { return new Set(); });
			const [renaming, setRenaming] = React.useState(false);
			// Writes run one after another. `nextView` (an entry or the name / 说明) is a lean write: the server answers with the
			// revision and the page keeps its own copy; without it (add, delete) the whole book comes back.
			function persist(update, nextView) {
				pendingRef.current += 1; setPending(pendingRef.current); setError("");
				if (props.onDirty) props.onDirty(true);
				const run = queue.current.then(function () {
					return rpc("updateWorldBook", { source: source, lean: !!nextView, update: update }, props.sessionId);
				}).then(function (result) {
					if (nextView) {
						savedView.current = nextView;
						props.onSaved(function (current) { return Object.assign({}, current, { view: nextView, revision: result && result.revision !== undefined ? result.revision : current.revision }); });
					} else props.onSaved(result);
					setSaved(true);
					return result;
				}, function (err) {
					setError(String(err && err.message || err));
					setDraft(worldBookViewClone(record.view));
					return null;
				}).then(function (result) {
					pendingRef.current -= 1; setPending(pendingRef.current);
					if (!pendingRef.current && props.onDirty) props.onDirty(false);
					if (result) notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
					return result;
				});
				queue.current = run;
				return run;
			}
			function patchEntry(ref, patch) {
				const current = draftRef.current;
				const bookChannel = worldBookChannelValue(current.channel);
				const localPatch = Object.assign({}, patch);
				if (Object.prototype.hasOwnProperty.call(patch, "channel")) {
					if (patch.channel === null || patch.channel === "") {
						localPatch.channel = bookChannel;
						localPatch.channelInherited = true;
					} else {
						const nextChannel = worldBookChannelValue(patch.channel);
						localPatch.channel = nextChannel;
						localPatch.channelInherited = nextChannel === "auto" && bookChannel === "auto";
					}
				}
				const next = Object.assign({}, current, { entries: current.entries.map(function (entry) { return entry.ref === ref ? Object.assign({}, entry, localPatch) : entry; }) });
				draftRef.current = next; setDraft(next);
				const sent = Object.assign({}, patch);
				delete sent.title;
				delete sent.channelInherited;
				return persist({ operations: [{ op: "update", ref: ref, patch: sent }] }, next);
			}
			// 一次点击把整本默认和全部条目同时改掉，之后仍可在条目里单独覆盖或还原为跟随整本。
			function applyBookChannel(value) {
				const current = draftRef.current;
				const nextChannel = worldBookChannelValue(value);
				const inherited = nextChannel === "auto";
				const currentEntries = current.entries || [];
				const next = Object.assign({}, current, {
					channel: nextChannel,
					entries: currentEntries.map(function (entry) {
						return Object.assign({}, entry, { channel: nextChannel, channelInherited: inherited });
					})
				});
				draftRef.current = next; setDraft(next);
				return persist({
					channel: nextChannel,
					operations: currentEntries.map(function (entry) { return { op: "update", ref: entry.ref, patch: { channel: nextChannel } }; })
				}, next);
			}
			function saveMeta(key, value) {
				const current = draftRef.current, field = key === "name" ? "displayName" : key;
				if ((current[field] || "") === value) return;
				const next = Object.assign({}, current, { [field]: value });
				draftRef.current = next; setDraft(next);
				return persist({ [key]: value }, next);
			}
			function openEntry(ref) {
				setOpenRefs(function (current) { const next = new Set(current); if (next.has(ref)) next.delete(ref); else next.add(ref); return next; });
			}
			async function addEntry() {
				const before = new Set(draftRef.current.entries.map(function (entry) { return entry.ref; }));
				const result = await persist({ operations: [{ op: "add", entry: {
					comment: "新条目", content: "", enabled: true, primaryKeys: [], secondaryKeys: [], constant: false, selective: false, selectiveLogic: 0, order: 100,
					position: draftRef.current.format === "sillytavern-worldbook" ? 0 : "after_char", depth: 4, role: 0,
					probabilityEnabled: true, probability: 100, caseSensitive: false, matchWholeWords: false } }] }, null);
				const created = result && result.view && (result.view.entries || []).find(function (entry) { return !before.has(entry.ref); });
				if (!created) return;
				setQuery(""); setFilter("all");
				setOpenRefs(function (current) { return new Set(current).add(created.ref); });
			}
			async function removeEntry(entry) {
				if (!await askConfirm("删除后不能恢复。", { title: "删除条目「" + worldBookEntryTitle(entry) + "」？", confirmText: "删除", danger: true, hide: "worldbook-entry" })) return;
				await persist({ operations: [{ op: "delete", ref: entry.ref }] }, null);
			}
			const entries = draft.entries || [];
			const title = draft.displayName || "未命名世界书";
			const entryMenu = function (entry) {
				return h(ui.Popover, { label: "「" + worldBookEntryTitle(entry) + "」操作", className: "dsh-wbd-entry-more",
					trigger: function (t) { return h(ui.IconButton, { icon: "more", label: "条目操作", "aria-expanded": t.open, className: "ap-icon-button dsh-card-row-icon", onClick: function (event) { event.stopPropagation(); t.toggle(event); } }); },
					content: function (close) { return h(ui.MenuItem, { danger: true, onClick: function () { close(); removeEntry(entry); } }, "删除条目…"); } });
			};
			const currentBookChannel = worldBookChannelValue(draft.channel);
			const editor = function (entry) {
				return h(WorldBookEntryEditor, { key: "editor:" + entry.ref, entry: entry, index: entries.indexOf(entry), format: draft.format, bookChannel: currentBookChannel,
					onPatch: function (patch) { return patchEntry(entry.ref, patch); }, onLamp: function (mode) { return patchEntry(entry.ref, worldBookLampPatch(mode)); } });
			};
			// ---- head
			const more = h(ui.Popover, { label: title + " 操作", className: "dsh-wbd-more",
				trigger: function (t) { return h(ui.IconButton, { icon: "more", label: "更多操作", "aria-expanded": t.open, className: "ap-icon-button dsh-card-more", onClick: t.toggle }); },
				content: function (close) {
					const run = function (fn) { return function () { close(); fn(); }; };
					return h(React.Fragment, null,
						h(ui.MenuItem, { onClick: run(props.onExport) }, "导出"),
						props.onRename ? h(ui.MenuItem, { disabled: props.busy, onClick: run(props.onRename) }, "重命名文件…") : null,
						props.onMention ? h(ui.MenuItem, { onClick: run(props.onMention) }, "在对话中引用") : null,
						h("div", { className: "ap-menu-sep", role: "separator" }),
						h(ui.MenuItem, { danger: true, disabled: props.busy, onClick: run(props.onDelete) }, "删除世界书…"));
				} });
			const name = renaming
				? h("div", { className: "dsh-wbd-name-edit", onBlur: function (event) { if (!event.currentTarget.contains(event.relatedTarget)) setTimeout(function () { setRenaming(false); }, 0); } },
					h(InlineField, { kind: "text", label: "世界书名称", hideLabel: true, value: draft.displayName || "", autoEdit: true,
						onCommit: function (value) { setRenaming(false); if (value.trim()) saveMeta("name", value.trim()); } }))
				: h("h2", { className: "dsh-card-name" }, h("span", { className: "dsh-card-name-text", title: title }, title),
					h("button", { type: "button", className: "ap-icon-button dsh-card-rename", "aria-label": "改名", title: "改名", onClick: function () { setRenaming(true); } }, h(ui.Glyph, { name: "edit" })));
			const from = source.kind === "card" ? "「" + (source.cardName || "人物卡") + "」自带" : "独立世界书";
			const head = h("header", { className: "dsh-wbd-head" },
				h("div", { className: "dsh-card-title-row" },
					h("button", { type: "button", className: "ap-icon-button dsh-card-back", "aria-label": "返回世界书库", title: "返回世界书库", onClick: props.onBack }, h(ui.Glyph, { name: "back" })),
					name,
					pending || saved ? h("span", { className: "ap-save-state dsh-wbd-save", role: "status" }, pending ? "正在保存…" : "已保存") : null,
					more),
				h("p", { className: "dsh-wbd-sub" }, from + " · " + entries.length + " 条"));
			const notes = h(React.Fragment, null,
				props.stale ? h(ui.HintLine, { text: "这本世界书在别处改过了", action: "重新载入", onAction: props.onReload }) : null,
				props.error ? h(ui.HintLine, { text: props.error }) : null,
				error ? h(ui.HintLine, { text: error }) : null,
				(record.view.diagnostics || []).map(function (item, index) { return h(ui.HintLine, { key: "d" + index, text: item.message }); }));
			// ---- 设置 and 人物卡
			const channelGroupKeys = function (event) {
				if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
				const buttons = event.currentTarget && event.currentTarget.querySelectorAll ? Array.from(event.currentTarget.querySelectorAll("button")) : [];
				if (!buttons.length) return;
				const active = typeof document !== "undefined" ? document.activeElement : null;
				const at = Math.max(0, buttons.indexOf(active));
				const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
					: (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
				event.preventDefault();
				const chosen = WORLD_BOOK_CHANNEL_OPTIONS[next];
				if (chosen && pending === 0) applyBookChannel(chosen.value);
				if (buttons[next] && buttons[next].focus) buttons[next].focus();
			};
			const settings = h(ui.StageSection, { key: "settings", title: "设置", foldKey: "worldbook-detail:settings" },
				source.kind === "standalone" ? h(ui.SwitchRow, { icon: "globe", label: "全局生效", checked: props.globalEnabled, disabled: props.busy, onChange: props.onToggleGlobal,
					help: "所有人物卡都使用这本书。新对话直接生效；已有对话要重新载入人物卡和世界书，这会覆盖对话里对世界书的修改。" }) : null,
				h(InlineGrid, { label: "设置", columns: 1, className: "dsh-wbd-fields" },
					h(InlineRow, {
						key: "channel", label: "注入通道",
						help: h(HelpTip, { label: "整本注入通道 说明" }, "一键把全部 " + entries.length + " 个条目设为该通道，同时作为整本默认（之后新增的条目自动跟随）；设完还能在条目里单独改成别的通道。当前默认：" + WORLD_BOOK_CHANNEL_LABELS[currentBookChannel] + "。固定设定用稳定前缀，随时会切换、需要更高注意力的用每轮尾部。")
					}, h("div", { className: "ap-segmented dsh-wbd-channel-seg", role: "group", "aria-label": "整本注入通道", onKeyDown: channelGroupKeys },
						WORLD_BOOK_CHANNEL_OPTIONS.map(function (option) {
							return h("button", {
								key: option.value, type: "button", className: "dsh-wbd-channel-opt",
								"aria-pressed": currentBookChannel === option.value,
								disabled: pending > 0 || undefined,
								onClick: function () { applyBookChannel(option.value); }
							}, option.label);
						}))),
					h(InlineField, { key: "description", kind: "text", multiline: true, lines: true, wide: true, hideEmpty: true, label: "说明", value: draft.description || "",
						onCommit: function (value) { return saveMeta("description", value); } })));
			const relations = props.associations;
			const bound = relations ? relations.boundCards || [] : null;
			const unbound = relations ? (relations.cards || []).filter(function (card) { return !card.bound; }) : [];
			const cards = h(ui.StageSection, { key: "cards", title: "人物卡", meta: bound ? bound.length : undefined, foldKey: "worldbook-detail:cards",
				help: "绑定了这本书的人物卡。一张卡绑多本书时，书里设定互相矛盾，AI 可能会混淆。" },
				!bound ? h(PanelLoading, { shape: "rows", count: 1, label: "正在读取人物卡…" }) : h(React.Fragment, null,
					bound.length ? h("ul", { className: "dsh-wbd-cards", "aria-label": "已绑定的人物卡" }, bound.map(function (card) {
						const label = card.name || card.path;
						return h("li", { key: card.path, className: "dsh-wbd-card" },
							h(ui.Glyph, { name: "card" }), h("span", { className: "dsh-wbd-card-name", title: label }, label),
							h("button", { type: "button", className: "ap-icon-button dsh-card-row-icon", disabled: props.bindingBusy, title: "解绑", "aria-label": "解绑「" + label + "」",
								onClick: function () { props.onUnbindCard(card.path); } }, h(ui.Glyph, { name: "close" })));
					})) : null,
					h(WorldBookAddMenu, { label: "绑定人物卡", noun: "人物卡", choices: unbound.map(function (card) { return { value: card.path, name: card.name || card.path, note: "" }; }),
						loading: false, disabled: props.bindingBusy, onOpen: function () {}, onPick: props.onBindCard })));
			// ---- 条目
			const groups = groupWorldBookEditorEntries(entries, deferredQuery, filter);
			const narrowing = !!deferredQuery.trim() || filter !== "all";
			const filterName = WORLD_BOOK_ENTRY_FILTERS.find(function (item) { return item[0] === filter; })[1];
			const filterMenu = h(ui.Popover, { label: "筛选条目", className: "ap-filter-anchor",
				trigger: function (t) { return h(ui.Button, { className: "ap-icon-button", "data-on": filter !== "all" || undefined, "aria-label": filter === "all" ? "筛选条目" : "筛选条目：" + filterName, "aria-expanded": t.open, title: "筛选", onClick: t.toggle }, h(ui.Glyph, { name: "filter" })); },
				content: function (close) {
					return WORLD_BOOK_ENTRY_FILTERS.map(function (item) {
						return h("button", { key: item[0], type: "button", role: "menuitemradio", "aria-checked": filter === item[0], className: "ap-menu-item ap-lamp-opt", "data-mode": item[0], onClick: function () { setFilter(item[0]); close(); } },
							h("span", { className: "ap-lamp-dot" }), h("span", { className: "ap-lamp-opt-name" }, item[1]), filter === item[0] ? h("span", { className: "ap-state-check" }, h(ui.Glyph, { name: "check" })) : null);
					});
				} });
			const tools = h("div", { className: "dsh-wbd-tools" },
				h(ui.PackSearchBox, { label: "搜索条目", placeholder: "搜索标题、内容或触发词", value: query, onChange: setQuery }),
				filterMenu,
				h(ui.IconButton, { icon: "plus", label: "新增条目", disabled: pending > 0, onClick: addEntry }));
			const row = function (item) {
				const entry = item.entry, open = openRefs.has(entry.ref);
				return h(WorldBookEntryRow, { key: entry.ref, entry: entry, selected: open, onOpen: function () { openEntry(entry.ref); },
					onLamp: function (mode) { return patchEntry(entry.ref, worldBookLampPatch(mode)); }, menu: open ? entryMenu(entry) : null }, open ? editor(entry) : null);
			};
			const shownGroups = WORLD_BOOK_ENTRY_GROUPS.filter(function (group) { return groups[group.key].length; });
			const list = !entries.length ? h(EmptyState, { noun: "条目" })
				: !shownGroups.length ? h(EmptyState, { query: deferredQuery, filter: filter !== "all" ? filterName : "", noun: "条目", onClear: function () { setQuery(""); setFilter("all"); } })
				: shownGroups.map(function (group) {
					return h(ui.StageSection, { key: group.key, level: 2, title: group.title, meta: groups[group.key].length, help: group.help, foldKey: "worldbook-detail:group:" + group.key, className: "dsh-wbd-group", reveal: narrowing },
						h(ui.WindowedItems, { className: "dsh-wbd-entries", label: group.title, items: groups[group.key], render: row }));
				});
			const entryCount = narrowing ? groups.constant.length + groups.keyword.length + groups.off.length + groups.background.length + " / " + entries.length : entries.length;
			const keys = function (event) { if (event.key === "Escape" && !event.defaultPrevented && props.onBack && event.target === event.currentTarget) props.onBack(); };
			const body = h(React.Fragment, null, settings, cards,
				h(ui.StageSection, { key: "entries", title: "条目", meta: entryCount, foldKey: "worldbook-detail:entries" }, tools, list));
			return h("div", { className: "fork-tab-scroll dsh-wbd-detail-scroll" },
				h("section", { className: "ap-ui dsh-wbd-detail", "aria-label": title, tabIndex: -1, onKeyDown: keys }, head, notes, body));
		}

		function groupWorldBookEditorEntries(entries, query) {
			const groups = { constant: [], dynamic: [], background: [] };
			const needle = String(query || "").trim().toLocaleLowerCase();
			for (const [index, entry] of (entries || []).entries()) {
				if (needle && ![entry.comment, entry.title, entry.content, ...(entry.primaryKeys || []), ...(entry.secondaryKeys || [])].join("\n").toLocaleLowerCase().includes(needle)) continue;
				groups[isMvuUpdateEntry(entry) ? "background" : entry && entry.constant === true ? "constant" : "dynamic"].push({ entry: entry, index: index });
			}
			return groups;
		}
		// @include-domain worldbook-mvu-entry.js
		const WORLD_BOOK_BACKGROUND_HELP = "只交给后台变量更新任务，不发给正文模型";

		const WORLD_BOOK_SORT_STORAGE_KEY = "dsh-tavern-worldbook-sort";
		function normalizeWorldBookSort(value) {
			// Retired modes (A-Z, Z-A, recently updated) fall back to the default.
			return value === "oldest" ? "oldest" : "newest";
		}
		const WORLD_BOOK_SORTS = [["newest", "最新导入"], ["oldest", "最早导入"]];
		const WORLD_BOOK_BANDS = { global: 0, card: 1, off: 2 };
		function worldBookSameSource(left, right) {
			if (!left || !right || left.kind !== right.kind) return false;
			return left.kind === "card" ? left.cardPath === right.cardPath : left.path === right.path;
		}
		// The library's rows from listWorldBooks (+ the open chat's card binding): every book once, with its state seen from
		// that card — 全局 (standalone, globally on) · 本卡 (bound to the card; a card's own book counts when nothing else is
		// bound) · 关闭. Without a card there is no 本卡 and a card's book has no state to switch. The first bound book is 主书;
		// a bound book that is gone stays as a row so it can be switched off.
		function worldBookLibraryRows(catalog) {
			const cardPath = catalog && catalog.sessionCardPath || "";
			const binding = cardPath ? catalog.sessionBinding : null;
			const bound = !binding ? [] : binding.kind === "multiple" ? binding.books || [] : binding.source ? [binding] : [];
			function boundIndex(source) { return bound.findIndex(function (book) { return worldBookSameSource(book.source, source); }); }
			function row(item, kind) {
				const source = kind === "card" ? { kind: "card", cardPath: item.cardPath } : { kind: "standalone", path: item.path };
				const index = boundIndex(source), global = kind === "standalone" && item.globalEnabled === true;
				const state = global ? "global" : index >= 0 ? "card" : "off";
				const options = kind === "standalone" ? (cardPath ? ["global", "card", "off"] : ["global", "off"]) : cardPath ? ["card", "off"] : [];
				return { id: (kind === "card" ? "card:" + item.cardPath : "book:" + item.path), kind: kind, source: source, resourcePath: kind === "card" ? item.cardPath : item.path,
					name: item.name, cardName: kind === "card" ? item.cardName || "" : "", own: kind === "card" && item.cardPath === cardPath, available: true,
					entryCount: Number(item.entryCount) || 0, enabledCount: Number(item.enabledCount) || 0, diagnostics: Number(item.diagnostics) || 0,
					importedAt: Number(item.importedAt) || 0, bound: index >= 0, boundIndex: index, primary: index === 0, state: state, rank: WORLD_BOOK_BANDS[state], options: options };
			}
			const rows = (catalog && catalog.standalone || []).map(function (item) { return row(item, "standalone"); })
				.concat((catalog && catalog.embedded || []).map(function (item) { return row(item, "card"); }));
			bound.forEach(function (book, index) {
				if (rows.some(function (item) { return worldBookSameSource(item.source, book.source); })) return;
				const kind = book.source.kind === "card" ? "card" : "standalone";
				rows.push({ id: (kind === "card" ? "card:" + book.source.cardPath : "book:" + book.source.path), kind: kind, source: book.source, resourcePath: book.source.cardPath || book.source.path,
					name: book.name || "", cardName: "", own: false, available: false, entryCount: 0, enabledCount: 0, diagnostics: 0, importedAt: 0,
					bound: true, boundIndex: index, primary: index === 0, state: "card", rank: WORLD_BOOK_BANDS.card, options: ["card", "off"] });
			});
			return rows;
		}
		function worldBookRowMatches(row, query) {
			const needle = String(query || "").trim().toLocaleLowerCase();
			return !needle || [row.name, row.cardName].some(function (value) { return String(value || "").toLocaleLowerCase().includes(needle); });
		}
		// Bands in a fixed order (`rank`: the band each row had when the list was read); 本卡 keeps the card's own order (主书
		// first), 关闭 lists independent books before cards' books, and the chosen sort orders the rest.
		function orderWorldBookLibraryRows(rows, mode, rank) {
			const direction = normalizeWorldBookSort(mode) === "oldest" ? 1 : -1;
			const band = function (row) { return rank && rank.has(row.id) ? rank.get(row.id) : row.rank; };
			return (rows || []).slice().sort(function (left, right) {
				const byBand = band(left) - band(right);
				if (byBand !== 0) return byBand;
				if (left.bound && right.bound && band(left) === WORLD_BOOK_BANDS.card) return left.boundIndex - right.boundIndex;
				const byKind = (left.kind === "card" ? 1 : 0) - (right.kind === "card" ? 1 : 0);
				if (byKind !== 0) return byKind;
				const byTime = (left.importedAt - right.importedAt) * direction;
				if (byTime !== 0) return byTime;
				const byName = String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
				if (byName !== 0) return byName;
				return String(left.resourcePath).localeCompare(String(right.resourcePath), "zh-CN");
			});
		}
		function worldBookStateTitles(cardName) {
			return { global: "全局：所有人物卡都使用", card: "本卡：只在" + (cardName ? "「" + cardName + "」" : "这张人物卡") + "使用", off: "关闭：不使用" };
		}

		const WORLD_BOOK_RECALL_STEPS = [
			{ title: "常驻条目直接加入上下文", body: "启用的静态常驻条目每轮都生效，正文放在上下文的稳定前缀，无需匹配关键词。" },
			{ title: "非常驻条目按关键词提示名称", body: "系统用本轮输入和近期对话匹配条目配置的关键词，把命中的静态非常驻条目名称放进上下文，供 Agent 参考。" },
			{ title: "Agent 按需检索正文", body: "Agent 自行决定要查哪些资料，可以用提示的条目名称，也可以用剧情里的其他线索搜索本局世界书。搜索返回文件路径和匹配片段，Agent 按路径读取需要的正文。" }
		];
		const WORLD_BOOK_RECALL_NOTES = [
			"人物卡绑定的世界书与全局世界书合并使用，同一本书只加载一次。",
			"含模板或脚本的条目按运行时规则处理。可检索的动态条目使用最近一次渲染的快照。"
		];
		// The 「?」 right after the 世界书库 heading text, inside the h2 like the stage pages' section heads (owner 11-24).
		function WorldBookRecallGuide() {
			const h = React.createElement;
			return h(HelpTip, { label: "世界书如何召回" },
				h("span", { className: "dsh-tavern-recall-tip" },
					h("b", { className: "dsh-tavern-recall-title" }, "世界书如何召回"),
					h("ol", { className: "dsh-tavern-recall-steps" }, WORLD_BOOK_RECALL_STEPS.map(function (step) {
						return h("li", { key: step.title }, h("b", null, step.title), h("span", null, step.body));
					})),
					h("ul", { className: "dsh-tavern-recall-notes" }, WORLD_BOOK_RECALL_NOTES.map(function (note) { return h("li", { key: note }, note); }))));
		}
		// One book in the library list: the name opens it (as does the row), 主书 and where a card's book lives follow the
		// name, then the entry count and the state tag. Right click, Shift+F10 / the menu key or a long press: 打开 · 在对话中引用 ·
		// 复制 · 导出 · 删除… (复制 makes a standalone copy, also of a card's own book).
		function WorldBookLibraryRow(props) {
			const h = React.createElement, row = props.row;
			const rowMenu = packUi.useContextMenu({ label: (row.name || "世界书") + " 操作", content: row.available ? function (close) {
				const run = function (fn) { return function () { close(); fn(); }; };
				return h(React.Fragment, null,
					h(packUi.MenuItem, { onClick: run(props.onOpen) }, "打开"),
					props.mention ? h(packUi.MenuItem, { onClick: run(props.onMention) }, "在对话中引用") : null,
					h(packUi.MenuItem, { disabled: props.busy, onClick: run(props.onCopy) }, "复制"),
					h(packUi.MenuItem, { onClick: run(props.onExport) }, "导出"),
					h("div", { className: "ap-menu-sep", role: "separator" }),
					h(packUi.MenuItem, { danger: true, disabled: props.busy, onClick: run(props.onDelete) }, "删除…"));
			} : null });
			const open = function (event) {
				const target = event.target;
				if (!event.currentTarget.contains(target) || (target.closest && target.closest("button,a,input,label,[role=menu],[role=dialog]"))) return;
				props.onOpen();
			};
			const where = row.kind !== "card" ? "" : row.own ? "本卡自带" : "内置于 " + (row.cardName || row.resourcePath);
			const count = row.enabledCount === row.entryCount ? row.entryCount + " 条" : row.enabledCount + " / " + row.entryCount + " 条";
			return h("li", Object.assign({ className: "ap-pack-row dsh-tavern-wblib-row" + (row.available ? " is-openable" : " is-missing"), "data-state": row.state, onClick: row.available ? open : undefined }, rowMenu.target),
				rowMenu.layer,
				h("span", { className: "ap-pack-title" },
					row.available
						? h("button", { type: "button", className: "ap-pack-name", title: row.name, "aria-label": "打开 " + row.name, "aria-keyshortcuts": rowMenu.trigger["aria-keyshortcuts"], onClick: function (event) { event.stopPropagation(); props.onOpen(); } }, row.name)
						: h("span", { className: "ap-pack-name is-missing", title: "这本世界书已被删除或移走" }, h(InlineGlyph, { name: "warning" }), "找不到这本世界书"),
					row.primary ? h(HelpTip, { label: "主书", face: "主书", faceClassName: "dsh-tavern-worldbook-primary" }, "主书：游戏里新建的人物写进这本。在人物卡库的世界书列表里拖动排序可以换主书。") : null,
					where ? h("span", { className: "dsh-tavern-wblib-where", title: where }, where) : null,
					row.diagnostics ? h("span", { className: "ap-hint-mark", role: "img", "aria-label": row.diagnostics + " 个诊断", title: row.diagnostics + " 个诊断" }, h(InlineGlyph, { name: "warning" })) : null),
				row.available ? h("span", { className: "dsh-tavern-wblib-count", title: "启用 " + row.enabledCount + " 条，共 " + row.entryCount + " 条" }, count) : null,
				row.options.length ? h(packUi.PackStateTag, { scope: props.scope, id: row.id, name: row.name || "这本世界书" }) : null);
		}

		function createWorldBookLibraryFeatureModule() {
		// 触发词输入框：本地保留原文，否则每次按键都 parse→join 会吞掉末尾的逗号（#425）。
		function WorldBookKeyInput(props) {
			const h = React.createElement;
			const joined = (props.value || []).join(", ");
			const [text, setText] = React.useState(joined);
			const parse = function (value) { return String(value || "").split(/[,，\n]/).map(function (item) { return item.trim(); }).filter(Boolean); };
			const shown = parse(text).join(", ") === joined ? text : joined;
			return h("input", { value: shown, placeholder: props.placeholder, onChange: function (event) { setText(event.target.value); props.onChange(parse(event.target.value)); } });
		}
		function WorldBookEditor(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const initial = props.record && props.record.view ? props.record.view : { displayName: "", description: "", entries: [], diagnostics: [] };
			const [draft, setDraft] = React.useState(function () { return JSON.parse(JSON.stringify(initial)); });
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("世界书编辑");
			const [query, setQuery] = React.useState("");
			// Large books (600+ entries) mount ~75 controls per entry; only open entries mount their form.
			const [openRefs, setOpenRefs] = React.useState(function () { return new Set(); });
			const deferredQuery = React.useDeferredValue(query);
			function setEntryOpen(ref, open) {
				setOpenRefs(function (current) {
					if (current.has(ref) === open) return current;
					const next = new Set(current);
					if (open) next.add(ref); else next.delete(ref);
					return next;
				});
			}
			// The library reloads a clean draft when the book changes elsewhere (e.g. the
			// card Agent edited it); unsaved edits are never overwritten.
			React.useEffect(function () { setDraft(JSON.parse(JSON.stringify(initial))); if (props.onDirty) props.onDirty(false); }, [props.record.view]);
			function editDraft(next) { setDraft(next); if (props.onDirty) props.onDirty(true); }
			const h = React.createElement;
			function updateEntry(index, patch) {
				const entries = (draft.entries || []).slice();
				entries[index] = Object.assign({}, entries[index], patch);
				editDraft(Object.assign({}, draft, { entries: entries }));
			}
			function addEntry() {
				const ref = "new:" + Date.now() + ":" + Math.random();
				setEntryOpen(ref, true);
				const entries = (draft.entries || []).concat([{
					ref: ref, comment: "新条目", title: "新条目", content: "", enabled: true,
					primaryKeys: [], secondaryKeys: [], constant: false, selective: false, selectiveLogic: 0, order: 100,
					position: initial.format === "sillytavern-worldbook" ? 0 : "after_char", depth: 4, role: 0,
					probabilityEnabled: true, probability: 100, caseSensitive: false, matchWholeWords: false,
				}]);
				editDraft(Object.assign({}, draft, { entries: entries }));
			}
			async function removeEntry(index) {
				const entry = (draft.entries || [])[index];
				const title = entry && (entry.comment || entry.title) || "未命名条目";
				if (!await askConfirm("保存世界书后才会正式删除。", { title: "删除世界书条目“" + title + "”？", confirmText: "删除", danger: true, hide: "worldbook-entry" })) return;
				editDraft(Object.assign({}, draft, { entries: (draft.entries || []).filter(function (_entry, itemIndex) { return itemIndex !== index; }) }));
			}
			function entryPatch(entry) {
				return {
					comment: entry.comment, content: entry.content, enabled: entry.enabled, primaryKeys: entry.primaryKeys,
					secondaryKeys: entry.secondaryKeys, constant: entry.constant, selective: entry.selective,
					selectiveLogic: entry.selectiveLogic, vectorized: entry.vectorized, order: entry.order,
					displayIndex: entry.displayIndex, position: entry.position, depth: entry.depth, role: entry.role,
					probabilityEnabled: entry.probabilityEnabled, probability: entry.probability, scanDepth: entry.scanDepth,
					caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords,
					excludeRecursion: entry.excludeRecursion, preventRecursion: entry.preventRecursion, group: entry.group,
					groupOverride: entry.groupOverride, groupWeight: entry.groupWeight, useGroupScoring: entry.useGroupScoring, delayUntilRecursion: entry.delayUntilRecursion,
				};
			}
			async function save() {
				setBusy(true); setError("");
				try {
					const before = new Map((initial.entries || []).map(function (entry) { return [entry.ref, entry]; }));
					const after = new Map((draft.entries || []).filter(function (entry) { return !String(entry.ref).startsWith("new:"); }).map(function (entry) { return [entry.ref, entry]; }));
					const operations = [];
					before.forEach(function (_entry, ref) { if (!after.has(ref)) operations.push({ op: "delete", ref: ref }); });
					(draft.entries || []).forEach(function (entry) {
						const patch = entryPatch(entry);
						if (String(entry.ref).startsWith("new:")) operations.push({ op: "add", entry: patch });
						else if (JSON.stringify(patch) !== JSON.stringify(entryPatch(before.get(entry.ref)))) operations.push({ op: "update", ref: entry.ref, patch: patch });
					});
					const update = { operations: operations };
					if (draft.displayName !== initial.displayName) update.name = draft.displayName;
					if (draft.description !== initial.description) update.description = draft.description;
					if (draft.tokenBudget !== initial.tokenBudget) update.tokenBudget = draft.tokenBudget;
					if (draft.scanDepth !== initial.scanDepth) update.scanDepth = draft.scanDepth;
					if (draft.recursiveScanning !== initial.recursiveScanning) update.recursiveScanning = draft.recursiveScanning;
					const result = await rpc("updateWorldBook", { source: props.record.source, update: update }, props.sessionId);
					props.onSaved(result); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			function numeric(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
			function entryRow(entry, index) {
				const open = openRefs.has(entry.ref);
				const background = isMvuUpdateEntry(entry);
				return h("details", { key: entry.ref, className: "dsh-tavern-worldbook-entry" + (entry.enabled === false ? " disabled" : ""), open: open, onToggle: function (event) { setEntryOpen(entry.ref, event.currentTarget.open); } },
					h("summary", { className: "dsh-tavern-worldbook-entry-head" }, entry.comment || entry.title || "未命名条目"),
					open ? h("div", { className: "dsh-tavern-worldbook-entry-body" },
						h("div", { className: "dsh-tavern-worldbook-entry-actions" },
							h("label", null, h("input", { type: "checkbox", checked: entry.enabled !== false, onChange: function (event) { updateEntry(index, { enabled: event.target.checked }); } }), "启用"),

							background
								? h("span", { className: "dsh-tavern-worldbook-kind is-background" }, "仅后台变量更新", typeof HelpTip === "function" ? h(HelpTip, { label: "仅后台变量更新说明" }, WORLD_BOOK_BACKGROUND_HELP) : null)
								: h("button", { className: "dsh-tavern-worldbook-kind", onClick: function () { updateEntry(index, { constant: !entry.constant }); } }, entry.constant ? "常驻" : "非常驻")
						),
						h("div", { className: "dsh-tavern-card-field dsh-tavern-worldbook-content" }, h("label", null, "内容"), h("textarea", { className: "large", rows: 14, "aria-label": "条目内容", value: entry.content || "", onChange: function (event) { updateEntry(index, { content: event.target.value }); } })),
						h("details", { className: "dsh-tavern-worldbook-entry-settings" }, h("summary", null, "条目设置"),
						h("div", { className: "dsh-tavern-card-field" }, h("label", null, "标题 / 备注"), h("input", { value: entry.comment || "", onChange: function (event) { updateEntry(index, { comment: event.target.value, title: event.target.value }); } })),
						entry.constant || background ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "主触发词"), h(WorldBookKeyInput, { value: entry.primaryKeys, placeholder: "逗号分隔；支持 /pattern/flags", onChange: function (keys) { updateEntry(index, { primaryKeys: keys }); } })),
							entry.constant || background ? null : h("div", { className: "dsh-tavern-card-field" }, h("label", null, "二级触发词"), h(WorldBookKeyInput, { value: entry.secondaryKeys, placeholder: "逗号分隔", onChange: function (keys) { updateEntry(index, { secondaryKeys: keys }); } })),
							h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.selective === true, onChange: function (event) { updateEntry(index, { selective: event.target.checked }); } }), "使用二级条件"),
							h("label", null, h("input", { type: "checkbox", checked: entry.caseSensitive === true, onChange: function (event) { updateEntry(index, { caseSensitive: event.target.checked }); } }), "区分大小写"),
							h("label", null, h("input", { type: "checkbox", checked: entry.matchWholeWords === true, onChange: function (event) { updateEntry(index, { matchWholeWords: event.target.checked }); } }), "整词匹配")
						),
						h("div", { className: "dsh-tavern-worldbook-grid" },
							h("label", null, "排序", h("input", { type: "number", value: entry.order, onChange: function (event) { updateEntry(index, { order: numeric(event.target.value, 100) }); } })),
							h("label", null, "展示顺序", h("input", { type: "number", value: entry.displayIndex, onChange: function (event) { updateEntry(index, { displayIndex: numeric(event.target.value, index) }); } })),
						),

                        h("details", null, h("summary", null, "激活规则"),
                          h("p", { className: "dsh-tavern-card-field-hint" }, "扫描当前输入和最近消息；非常驻条目共用估算 Token 软预算，沿用 10 轮冷却。排序越大越优先入选，同一位置内排序越小越靠前。位置用于分组编排，暂不映射到 ST 的精确消息锚点。"),
                          h("div", { className: "dsh-tavern-worldbook-grid" },
                            h("label", null, "扫描消息数（留空跟随世界书）", h("input", { type: "number", min: 0, max: 1000, value: entry.scanDepth ?? "", onChange: function (event) { updateEntry(index, { scanDepth: event.target.value === "" ? null : numeric(event.target.value, 2) }); } })),
                            h("label", null, "二级条件逻辑", h("select", { value: entry.selectiveLogic || 0, onChange: function (event) { updateEntry(index, { selectiveLogic: Number(event.target.value) }); } }, ["至少一个命中", "不全部命中", "全部不命中", "全部命中"].map(function (label, value) { return h("option", { key: value, value: value }, label); }))),
                            h("label", null, "递归等级（0 表示正常触发）", h("input", { type: "number", min: 0, value: entry.delayUntilRecursion || 0, onChange: function (event) { updateEntry(index, { delayUntilRecursion: numeric(event.target.value, 0) }); } })),
                            h("label", null, "组权重", h("input", { type: "number", min: 0, value: entry.groupWeight ?? 100, onChange: function (event) { updateEntry(index, { groupWeight: numeric(event.target.value, 100) }); } })),
                            h("label", null, h("input", { type: "checkbox", checked: entry.groupOverride === true, onChange: function (event) { updateEntry(index, { groupOverride: event.target.checked }); } }), "组内按排序优先"),
                            h("label", null, h("input", { type: "checkbox", checked: entry.useGroupScoring === true, onChange: function (event) { updateEntry(index, { useGroupScoring: event.target.checked }); } }), "组内关键词计分"),
							h("label", null, "注入位置", h("input", { value: entry.position, onChange: function (event) { updateEntry(index, { position: initial.format === "sillytavern-worldbook" ? numeric(event.target.value, 0) : event.target.value }); } })),
							h("label", null, "包含组", h("input", { value: entry.group || "", onChange: function (event) { updateEntry(index, { group: event.target.value }); } })),
							h("label", null, h("input", { type: "checkbox", checked: entry.excludeRecursion === true, onChange: function (event) { updateEntry(index, { excludeRecursion: event.target.checked }); } }), "不被递归触发"),
							h("label", null, h("input", { type: "checkbox", checked: entry.preventRecursion === true, onChange: function (event) { updateEntry(index, { preventRecursion: event.target.checked }); } }), "不触发递归")
                          )
                        ),
						h("details", null, h("summary", null, "兼容字段"),
							h("p", { className: "dsh-tavern-card-field-hint" }, "以下字段仅用于兼容 SillyTavern 导入、导出格式，不参与 DSH Tavern 游玩模式的世界书召回与注入逻辑；修改它们不会改变游玩模式的内置运行效果。人物卡脚本仍可读取这些字段。"),
							h("div", { className: "dsh-tavern-worldbook-grid" },
							h("label", null, "深度", h("input", { type: "number", value: entry.depth, onChange: function (event) { updateEntry(index, { depth: numeric(event.target.value, 4) }); } })),
							h("label", null, "概率 %", h("input", { type: "number", min: 0, max: 100, value: entry.probability, onChange: function (event) { updateEntry(index, { probability: numeric(event.target.value, 100) }); } })),
						),
						h("div", { className: "dsh-tavern-worldbook-checks" },
							h("label", null, h("input", { type: "checkbox", checked: entry.probabilityEnabled !== false, onChange: function (event) { updateEntry(index, { probabilityEnabled: event.target.checked }); } }), "启用概率"),
							h("label", null, h("input", { type: "checkbox", checked: entry.vectorized === true, onChange: function (event) { updateEntry(index, { vectorized: event.target.checked }); } }), "向量候选"),
						)
						),
						),
						h("div", { className: "dsh-tavern-worldbook-danger-zone" },
							h("button", { className: "dsh-tavern-worldbook-del", onClick: function () { removeEntry(index); } }, "删除条目")
						)
					) : null
				);
			}
			function entryGroup(label, description, items) {
				return h("section", { className: "dsh-tavern-worldbook-group" },
					h("div", { className: "dsh-tavern-worldbook-group-head" }, h("b", null, label + " · " + items.length), h("span", null, description)),
					items.length ? items.map(function (item) { return entryRow(item.entry, item.index); }) : h(EmptyState, { compact: true, noun: label })
				);
			}
			const entryGroups = groupWorldBookEditorEntries(draft.entries, deferredQuery);
			return h("div", { className: "dsh-tavern-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回世界书库"), h("div", { className: "dsh-tavern-status-title" }, draft.displayName || "未命名世界书"), h("div", { className: "dsh-tavern-question-sub" }, props.record.source.kind === "card" ? "人物卡内置 · " + props.record.source.cardName : "独立世界书"), props.actions),
				props.stale ? h("div", { className: "dsh-tavern-dock-error", role: "status" }, "这本世界书已在别处被修改（例如卡片 Agent），当前显示的不是最新内容。",
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: props.onReload }, "重新加载（放弃未保存的修改）")) : null,
				h("div", { className: "dsh-tavern-worldbook-editor" },
					props.bindingPanel,
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "世界书名称"), h("input", { value: draft.displayName || "", onChange: function (event) { editDraft(Object.assign({}, draft, { displayName: event.target.value })); } })),
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "说明"), h("textarea", { value: draft.description || "", onChange: function (event) { editDraft(Object.assign({}, draft, { description: event.target.value })); } })),
                    h("div", { className: "dsh-tavern-worldbook-summary" }, draft.entries.length + " 个条目 · " + draft.entries.filter(function (entry) { return entry.enabled !== false; }).length + " 个启用"),
					(initial.diagnostics || []).map(function (item, index) { return h("div", { key: index, className: "dsh-tavern-dock-error" }, item.message); }),
					h("div", { className: "dsh-tavern-worldbook-head" }, h("span", { className: "dsh-tavern-worldbook-title" }, "条目"), h("button", { className: "dsh-tavern-worldbook-add", onClick: addEntry }, "＋ 新增条目")),
					h("div", { className: "dsh-tavern-card-field" }, h("label", null, "搜索条目"), h("input", { type: "search", value: query, placeholder: "搜索标题、正文或触发词", onChange: function (event) { setQuery(event.target.value); } }), h("span", null, "匹配 " + (entryGroups.constant.length + entryGroups.dynamic.length + entryGroups.background.length) + " / " + draft.entries.length + " 条")),
					entryGroup("常驻条目", "始终进入上下文", entryGroups.constant),
					entryGroup("非常驻条目", "按触发词匹配", entryGroups.dynamic),
					entryGroups.background.length ? entryGroup("仅后台变量更新", WORLD_BOOK_BACKGROUND_HELP, entryGroups.background) : null,
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-worldbook-editor-actions" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存世界书"))
				)
			);
		}
		function WorldBookLibraryTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			// 世界书库列表（库文件 + 全局生效标记）与会话无关，只有「本卡」跟着本局的人物卡。把上一次结果放在 window 上跨面板实例复用：
			// 重开面板或切换会话先直接渲染（别的会话留下的先不带本卡），再后台刷新，不必再等一次空加载。
			const initialCatalog = (function () {
				try {
					const cached = window.__dshTavernWorldBookCatalog;
					if (!cached || typeof cached !== "object") return null;
					return cached.forSession === props.scope.sessionId ? cached : Object.assign({}, cached, { sessionCardPath: "", sessionCardName: "", sessionBinding: null });
				} catch (_) { return null; }
			})();
			const [catalog, setCatalog] = React.useState(initialCatalog);
			const [catalogWarning, setCatalogWarning] = React.useState("");
			const [record, setRecord] = React.useState(null);
			const [associations, setAssociations] = React.useState(null);
			const [selectedCardPath, setSelectedCardPath] = React.useState("");
			const [loading, setLoading] = React.useState(!initialCatalog);
			const [recordLoading, setRecordLoading] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [bindingBusy, setBindingBusy] = React.useState(false);
			const [searchQuery, setSearchQuery] = React.useState("");
			const [sortMode, setSortMode] = React.useState(function () {
				try { return normalizeWorldBookSort(window.localStorage.getItem(WORLD_BOOK_SORT_STORAGE_KEY)); }
				catch (_) { return "newest"; }
			});
			const [error, setError] = usePersistentError("世界书库");
			const [bookPending, setBookPending] = React.useState({});
			const frozenBands = React.useRef({ key: null, rank: null });
			const sessionRef = React.useRef(null);
			sessionRef.current = props.scope.sessionId;
			const importInput = React.useRef(null);
			const bindingDisclosure = React.useRef(null);
			// The book and its card associations arrive separately now; late answers from a
			// previous selection must not overwrite the current one.
			const loadSequence = React.useRef(0);
			const refreshModule = React.useRef(null);
			const draftDirty = React.useRef(false);
			const [recordStale, setRecordStale] = React.useState(false);
			const requestedSource = props.tab && props.tab.meta && props.tab.meta.worldBookSource ? props.tab.meta.worldBookSource : null;
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const h = React.createElement;
			if (!refreshModule.current) refreshModule.current = createWorldBookLibraryRefreshModule({
				// 本卡 is the open chat's card: its binding (in order, 主书 first) comes with the list. A card that can no longer be
				// read has no 本卡.
				load: async function () {
					const sessionId = sessionRef.current;
					const result = Object.assign({ standalone: [], embedded: [] }, await rpcWithTimeout("listWorldBooks", {}, sessionId), { forSession: sessionId });
					if (!result.sessionCardPath) return result;
					const binding = await rpcWithTimeout("getWorldBookBinding", { cardPath: result.sessionCardPath }, sessionId).then(function (answer) { return answer.binding; }, function () { return null; });
					return binding ? Object.assign(result, { sessionBinding: binding }) : Object.assign(result, { sessionCardPath: "", sessionCardName: "" });
				},
				onValue: function (result) { try { window.__dshTavernWorldBookCatalog = result; } catch (_) {} setCatalog(result); setCatalogWarning(worldBookCatalogDiagnostic(result)); },
				onError: function (err) { setError(String(err && err.message || err)); },
				onBusyChange: setLoading
			});
			function refresh() {
				setError("");
				refreshModule.current.request();
				return refreshModule.current.whenIdle();
			}
			function load(source) {
				setRecordStale(false);
				if (!source) { setRecord(null); setAssociations(null); setSelectedCardPath(""); return Promise.resolve(); }
				setRecordLoading(true); setError("");
				// Entries paint as soon as the book is read: the association scan walks the whole
				// card library for the binding panel below, so it must not hold the book open.
				const loadId = ++loadSequence.current;
				// 已经拿着同一本书的 revision 时走条件读取：文件没改就复用本地这份，
				// 不再把整本文档取回来再解析一遍。
				const known = record && record.source && JSON.stringify(record.source) === JSON.stringify(source) ? record.revision : null;
				const bookArgs = known === undefined || known === null ? { source: source } : { source: source, ifRevision: known };
				const bookRequest = rpcWithTimeout("getWorldBook", bookArgs, props.scope.sessionId).then(function (result) {
					if (loadSequence.current !== loadId) return;
					if (result && result.unchanged === true) { setRecordLoading(false); return; }
					setRecord(result);
					setRecordLoading(false);
				}, function (err) {
					if (loadSequence.current !== loadId) return;
					setRecord(null); setAssociations(null); setSelectedCardPath("");
					setError(String(err && err.message || err)); setRecordLoading(false);
				});
				const associationRequest = rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					if (loadSequence.current !== loadId) return;
					const relations = result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false };
					setAssociations(relations);
					setSelectedCardPath((relations.cards || []).find(function (card) { return !card.bound; })?.path || "");
				}, function () {});
				return Promise.all([bookRequest, associationRequest]);
			}
			function reloadAssociations(source) {
				return rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					const relations = result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false };
					setAssociations(relations);
					setSelectedCardPath((relations.cards || []).find(function (card) { return !card.bound; })?.path || "");
					return relations;
				});
			}
			// An open book must follow external edits too, not only the catalog.
			function refreshAll() {
				const listed = refresh();
				if (!record) return listed;
				if (draftDirty.current) { setRecordStale(true); return listed; }
				const source = record.source;
				// 书没改就只回一个空壳：切会话、重开面板不再把整本文档取回来再解析一遍。
				const ifRevision = record.revision === undefined ? null : record.revision;
				return Promise.all([listed, rpcWithTimeout("getWorldBook", { source: source, ifRevision: ifRevision }, props.scope.sessionId).then(function (result) {
					if (result && result.unchanged === true) return;
					setRecord(function (current) { return current && JSON.stringify(current.source) === JSON.stringify(source) && !draftDirty.current ? result : current; });
				}, function () {})]);
			}
			useVisibleDataRefresh(props.visible, function (event) { return tavernDataChangeAffects(event, ["worldbooks", "cards"], "worldbooks"); }, refreshAll, props.scope.sessionId);
			React.useEffect(function () { return function () { refreshModule.current.dispose(); }; }, []);
			React.useEffect(function () { if (requestedSource) load(requestedSource); }, [JSON.stringify(requestedSource)]);
			function clear() { setRecord(null); setAssociations(null); setSelectedCardPath(""); if (props.ctx && props.tab) props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null }); }
			function changeSortMode(value) {
				const next = normalizeWorldBookSort(value);
				setSortMode(next);
				try { window.localStorage.setItem(WORLD_BOOK_SORT_STORAGE_KEY, next); } catch (_) {}
			}
			async function importFile(file) { if (!file) return; setBusy(true); setError(""); try { const result = await rpc("importWorldBook", { payload: await parseTextResourceFile(file) }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.worldBook.path }); notifyTavernDataChanged(["worldbooks"], "worldbooks"); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function toggleGlobal(enabled) {
                if (!record || busy) return;
                setBusy(true); setError("");
                try {
                    const result = await rpc("setGlobalWorldBook", { source: record.source, enabled: enabled }, props.scope.sessionId);
                    setRecord(function (previous) { return Object.assign({}, previous, { globalEnabled: result.globalEnabled }); }); await refresh(); notifyTavernDataChanged(["worldbooks"], "worldbooks");
                } catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }
            async function rename() { if (!record || record.source.kind !== "standalone") return; const current = record.source.path.split("/").pop(); const name = await askTavernText({ title: "重命名世界书文件", initialValue: current, maxLength: 120 }); if (name === null || name === current) return; setBusy(true); try { const result = await rpc("renameResource", { path: record.source.path, name: name }, props.scope.sessionId); await refresh(); await load({ kind: "standalone", path: result.resource.path }); } catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); } }
			async function remove(source, name) {
				if (busy || bindingBusy || !source) return;
				const detail = source.kind === "card" ? "将移除人物卡内的整本世界书，保留人物卡其他内容，并解除相关绑定。" : "工作版和原版都会删除，并解除相关绑定。";
				if (!await askConfirm(detail, { title: "删除世界书“" + name + "”？", confirmText: "删除", danger: true, hide: "worldbook" })) return;
				setBusy(true); setError("");
				try {
					await rpc("deleteWorldBook", { source: source }, props.scope.sessionId);
					if (record) clear();
					await refresh(); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function exportFile() { if (!record) return; try { const result = await rpc("exportWorldBook", { source: record.source }, props.scope.sessionId); const item = result.worldBook; downloadTavernBlob(new Blob([JSON.stringify(item.document, null, 2)], { type: "application/json" }), (item.name || "世界书") + ".json"); } catch (err) { setError(String(err && err.message || err)); } }
			async function bindCard() {
				if (!record || !selectedCardPath || !associations) return;
				const target = (associations.cards || []).find(function (card) { return card.path === selectedCardPath; });
				if (!target) return;
				setBindingBusy(true); setError("");
				try {
					await rpc("bindWorldBook", { cardPath: selectedCardPath, source: record.source }, props.scope.sessionId);
					await reloadAssociations(record.source); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
					if (bindingDisclosure.current) bindingDisclosure.current.open = false;
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			async function unbindCard(cardPath) {
				if (!record || !cardPath) return;
				setBindingBusy(true); setError("");
				try {
					await rpc("unbindWorldBook", { cardPath: cardPath, source: record.source }, props.scope.sessionId);
					await reloadAssociations(record.source); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBindingBusy(false); }
			}
			function bindingPanel() {
				if (!associations) return h("div", { className: "dsh-tavern-worldbook-note" }, "正在读取人物卡绑定关系…");
				const boundCards = associations.boundCards || [];
				const cards = (associations.cards || []).filter(function (card) { return !card.bound; });
				return h("section", { className: "dsh-tavern-worldbook-bindings", "aria-label": "人物卡绑定" },
					h("div", { className: "dsh-tavern-worldbook-bindings-head" }, h("span", null, "已绑定人物卡"), h("span", { className: "dsh-tavern-worldbook-bindings-count" }, String(boundCards.length))),
					boundCards.length ? h("ul", { className: "dsh-tavern-worldbook-bound-list" }, boundCards.map(function (card) {
						return h("li", { key: card.path, className: "dsh-tavern-worldbook-bound-card" },
							h("span", { className: "dsh-tavern-worldbook-bound-name" }, card.name || card.path),
							h("button", { type: "button", className: "dsh-tavern-worldbook-binding-link", "aria-label": "解绑「" + (card.name || card.path) + "」", disabled: bindingBusy, onClick: function () { unbindCard(card.path); } }, "解绑"));
					})) : h("p", { className: "dsh-tavern-worldbook-binding-empty" }, "尚未绑定人物卡"),
					cards.length ? h("details", { key: JSON.stringify(record.source), ref: bindingDisclosure, className: "dsh-tavern-worldbook-binding-add" },
						h("summary", null, "绑定其他人物卡"),
						h("div", { className: "dsh-tavern-worldbook-binding-form" },
							h("select", { "aria-label": "选择要绑定的人物卡", value: selectedCardPath, disabled: bindingBusy, onChange: function (event) { setSelectedCardPath(event.target.value); } }, cards.map(function (card) { return h("option", { key: card.path, value: card.path }, card.name || card.path); })),
							h("button", { type: "button", className: "dsh-tavern-worldbook-binding-confirm", disabled: bindingBusy || !selectedCardPath, onClick: bindCard }, bindingBusy ? "绑定中…" : "确认绑定")),
						h("p", { className: "dsh-tavern-worldbook-binding-hint" }, "同时绑定多本世界书时，请留意内容冲突。"))
						: h("p", { className: "dsh-tavern-worldbook-binding-empty" }, "所有人物卡均已绑定")
				);
			}
			if (recordLoading) return h("div", { className: "dsh-tavern-library" }, h(PanelLoading, { shape: "fields", label: "正在读取世界书…" }));
			if (record) {
				const actions = h("div", { className: "dsh-tavern-library-head-actions" }, h("button", { className: "dsh-tavern-btn", onClick: exportFile }, "导出"), record.source.kind === "standalone" ? h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: rename }, "重命名文件") : null, h("button", { className: "dsh-tavern-btn", disabled: busy || bindingBusy, onClick: function () { remove(record.source, record.view.displayName); } }, "删除世界书"), error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null);
				return h(WorldBookEditor, { record: record, sessionId: props.scope.sessionId, onBack: clear, actions: actions, stale: recordStale, onReload: function () { draftDirty.current = false; return load(record.source); }, onDirty: function (value) { draftDirty.current = value; if (!value) setRecordStale(false); }, bindingPanel: h(React.Fragment, null,
                    record.source.kind === "standalone" ? h("label", { className: "dsh-tavern-worldbook-global" + (record.globalEnabled === true ? " enabled" : "") },
                        h("span", { className: "dsh-tavern-worldbook-global-icon", "aria-hidden": "true" }, "🌐"),
                        h("span", { className: "dsh-tavern-settings-copy" },
                            h("span", { className: "dsh-tavern-settings-title" }, "全局生效", record.globalEnabled === true ? h("span", { className: "dsh-tavern-worldbook-global-badge" }, "已启用") : null),
                            h("span", { className: "dsh-tavern-settings-desc" }, "所有人物卡自动使用这本世界书，同一本书只加载一次。"),
                            h("span", { className: "dsh-tavern-worldbook-global-note" }, "新对话直接生效；已有对话需重新加载人物卡和世界书，这会覆盖对话中的世界书修改。")),
                        h("span", { className: "dsh-tavern-settings-switch" },
                            h("input", { type: "checkbox", role: "switch", checked: record.globalEnabled === true, disabled: busy, onChange: function (event) { toggleGlobal(event.target.checked); } }),
                            h("span", { className: "dsh-tavern-settings-track", "aria-hidden": "true" }))) : null,
                    bindingPanel()), onSaved: function (result) { setRecord(result); refresh(); } });
			}
			// One flat list like 舞台素材: 全局 → 本卡 → 关闭 bands, each row with the shared 全局 / 本卡 / 关闭 state tag.
			async function setBookState(row, next) {
				const cardPath = catalog && catalog.sessionCardPath;
				const was = row.state;
				if (was === next || bookPending[row.id]) return;
				setBookPending(function (current) { return Object.assign({}, current, { [row.id]: true }); }); setError("");
				try {
					if (was === "global") await rpc("setGlobalWorldBook", { source: row.source, enabled: false, lean: true }, props.scope.sessionId);
					if (next === "global") await rpc("setGlobalWorldBook", { source: row.source, enabled: true, lean: true }, props.scope.sessionId);
					if (next === "card" && !row.bound) await rpc("bindWorldBook", { cardPath: cardPath, source: row.source }, props.scope.sessionId);
					if (next === "off" && row.bound) await rpc("unbindWorldBook", { cardPath: cardPath, source: row.source }, props.scope.sessionId);
					await refresh(); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBookPending(function (current) { const rest = Object.assign({}, current); delete rest[row.id]; return rest; }); }
			}
			async function exportBook(row) { try { const result = await rpc("exportWorldBook", { source: row.source }, props.scope.sessionId); const item = result.worldBook; downloadTavernBlob(new Blob([JSON.stringify(item.document, null, 2)], { type: "application/json" }), (item.name || "世界书") + ".json"); } catch (err) { setError(String(err && err.message || err)); } }
			// 复制 = the export imported again as a standalone book named 「… 副本」.
			async function copyBook(row) {
				setBusy(true); setError("");
				try {
					const item = (await rpc("exportWorldBook", { source: row.source }, props.scope.sessionId)).worldBook;
					const name = (item.name || row.name || "世界书") + " 副本";
					await rpc("importWorldBook", { payload: { name: name + ".json", type: "application/json", text: JSON.stringify(Object.assign({}, item.document, { name: name })) } }, props.scope.sessionId);
					await refresh(); notifyTavernDataChanged(["worldbooks"], "worldbooks");
				} catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			const rows = catalog ? worldBookLibraryRows(catalog) : [];
			// Bands are fixed while the same books are listed, so a row never jumps away from its tag after a change.
			const bandKey = rows.map(function (row) { return row.id; }).join("\n") + "\n" + (catalog && catalog.sessionCardPath || "");
			if (frozenBands.current.key !== bandKey) frozenBands.current = { key: bandKey, rank: new Map(rows.map(function (row) { return [row.id, row.rank]; })) };
			const shown = orderWorldBookLibraryRows(rows.filter(function (row) { return worldBookRowMatches(row, searchQuery); }), sortMode, frozenBands.current.rank);
			const scope = {
				pending: bookPending,
				stateOf: function (id) { const row = rows.find(function (item) { return item.id === id; }); return row ? row.state : "off"; },
				options: function (id) { const row = rows.find(function (item) { return item.id === id; }); return row ? row.options : []; },
				set: function (id, next) { const row = rows.find(function (item) { return item.id === id; }); if (row) setBookState(row, next); },
				titles: worldBookStateTitles(catalog && catalog.sessionCardName)
			};
			const list = !catalog ? (loading ? h(PanelLoading, { shape: "rows", label: "正在读取世界书…" }) : null)
				: !rows.length ? h(EmptyState, { noun: "世界书" })
				: !shown.length ? h(EmptyState, { query: searchQuery, onClear: function () { setSearchQuery(""); } })
				: h("ul", { className: "ap-pack-list dsh-tavern-wblib-list", "aria-label": "世界书" }, shown.map(function (row) {
					return h(WorldBookLibraryRow, { key: row.id, row: row, scope: scope, busy: busy, mention: sessionMode === "card", onOpen: function () { load(row.source); }, onMention: function () { props.appendMention("worldbook", row.resourcePath, row.name); }, onCopy: function () { copyBook(row); }, onExport: function () { exportBook(row); }, onDelete: function () { remove(row.source, row.name); } });
				}));
			return h("div", { className: "fork-tab-scroll dsh-tavern-wblib" }, h("div", { className: "ap-ui ap-library" },
				h("header", { className: "ap-head" }, h("h2", null, "世界书库", h(WorldBookRecallGuide))),
				h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } }),
				h("div", { className: "ap-pack-toolbar" },
					h(packUi.PackSearchBox, { label: "搜索世界书", placeholder: "搜索世界书或人物卡", value: searchQuery, onChange: setSearchQuery }),
					h(packUi.SortMenu, { sort: sortMode, onSort: changeSortMode, sorts: WORLD_BOOK_SORTS }),
					h(packUi.IconButton, { icon: "download", label: "导入世界书", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } })),
				error ? h(packUi.HintLine, { text: error, action: "重新读取", onAction: refresh }) : null,
				catalogWarning ? h(packUi.HintLine, { text: catalogWarning }) : null,
				list));
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:worldbooks",
				title: "世界书库",
				order: 6,
				single: true,
				component: function (props) { return React.createElement(WorldBookLibraryTab, Object.assign({}, props, { appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); } })); }
			}), "dsh-tavern: Better Sidebar worldbook library tab");
		}
		return Object.freeze({ register: register });
		}
		const worldBookLibraryFeature = createWorldBookLibraryFeatureModule();

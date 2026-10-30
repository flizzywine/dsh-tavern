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
		function orderWorldBookCatalogItems(items, mode) {
			const direction = normalizeWorldBookSort(mode) === "oldest" ? 1 : -1;
			return (items || []).slice().sort(function (left, right) {
				const byTime = ((Number(left && left.importedAt) || 0) - (Number(right && right.importedAt) || 0)) * direction;
				if (byTime !== 0) return byTime;
				const byName = String(left && left.name || "").localeCompare(String(right && right.name || ""), "zh-CN");
				if (byName !== 0) return byName;
				return String(left && (left.path || left.cardPath) || "").localeCompare(String(right && (right.path || right.cardPath) || ""), "zh-CN");
			});
		}
		function filterWorldBookCatalogItems(items, query) {
			const needle = String(query || "").trim().toLocaleLowerCase();
			if (!needle) return items || [];
			return (items || []).filter(function (item) {
				return [item && item.name, item && item.cardName].some(function (value) { return String(value || "").toLocaleLowerCase().includes(needle); });
			});
		}

		const WORLD_BOOK_RECALL_STEPS = [
			{ icon: "📌", title: "常驻条目始终生效", body: "开启“常驻”的条目不看关键词、不占预算。内容固定的放进稳定前缀以提高缓存命中；含随机、分组或模板的每轮重新渲染。" },
			{ icon: "🔑", title: "关键词匹配", body: "扫描本轮输入和最近一条 AI 正文（默认 2 条消息，可按世界书或条目调整）。命中任一主关键词即成为候选；开启次关键词时再按“任一 / 不全部 / 全部不 / 全部”判断。默认不区分大小写，支持 /正则/。" },
			{ icon: "🧠", title: "智能筛选", body: "候选超过 5 条或约 2000 Token 时，后台模型会挑出与当前剧情真正相关的条目；候选特别多（超过 20 条或约 8000 Token）时先用 BM25 词频粗筛。" },
			{ icon: "⚖️", title: "排序与预算", body: "按条目的“排序”值从大到小入选，共用估算 Token 软预算（默认 8192，中文约每字 1 Token）。预算用完后，本轮不再加入更多条目。" },
			{ icon: "⏳", title: "10 回合冷却", body: "注入过的非常驻条目，之后 10 个剧情回合内不再自动召回，避免同一设定反复占用上下文；条目正文修改后冷却立即解除。" },
			{ icon: "🔍", title: "主动检索补查", body: "自动召回之外，正文 Agent 和后台任务（候选、结算、人物设计）可以主动搜索当前世界书：先按关键词查到条目标题和片段（标题匹配优先），再按编号读取完整正文。补查不受关键词条件、冷却和预算裁剪限制，也不会触发冷却；前台本轮读过的条目会交给后台任务参考。" }
		];
		const WORLD_BOOK_RECALL_NOTES = [
			"人物卡绑定的世界书与全局世界书合并使用，同一本书只加载一次。",
			"条目的“位置”只用于分组排序，暂不映射到酒馆的精确消息深度。",
			"酒馆的粘性、延迟、概率字段由冷却机制代替，字段本身原样保留。",
			"MVU 变量更新规则条目、已禁用和空正文的条目不参与召回，也搜不到。",
			"主动检索是词面搜索，只能搜到条目的静态正文；完全由模板动态生成的内容可改用条目标题或主关键词查找。"
		];
		function WorldBookRecallGuide() {
			const h = React.createElement;
			return h("details", { className: "dsh-tavern-help dsh-tavern-recall-guide" },
				h("summary", null,
					h("span", { className: "dsh-tavern-recall-guide-icon", "aria-hidden": "true" }, "📖"),
					h("span", { className: "dsh-tavern-recall-guide-heading" }, h("strong", null, "世界书如何召回"), h("span", null, "每轮自动挑选与剧情相关的条目放进上下文"))),
				h("ol", { className: "dsh-tavern-recall-steps" }, WORLD_BOOK_RECALL_STEPS.map(function (step, index) {
					return h("li", { key: step.title },
						h("span", { className: "dsh-tavern-recall-step-mark", "aria-hidden": "true" }, step.icon),
						h("div", null, h("b", null, (index + 1) + ". " + step.title), h("p", null, step.body)));
				})),
				h("div", { className: "dsh-tavern-recall-notes" }, h("b", null, "补充说明"), h("ul", null, WORLD_BOOK_RECALL_NOTES.map(function (note) { return h("li", { key: note }, note); }))));
		}

		function createWorldBookLibraryFeatureModule() {
		// 触发词输入框：本地保留原文，否则每次按键都 parse→join 会吞掉末尾的逗号（#425）。
		function WorldBookKeyInput(props) {
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
				if (!await askConfirm("删除世界书条目“" + title + "”？\n保存世界书后才会正式删除。")) return;
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
								? h("span", { className: "dsh-tavern-worldbook-kind is-background", title: WORLD_BOOK_BACKGROUND_HELP }, "仅后台变量更新")
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
					items.length ? items.map(function (item) { return entryRow(item.entry, item.index); }) : h("div", { className: "dsh-tavern-worldbook-empty" }, "暂无" + label)
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
			const [catalog, setCatalog] = React.useState(null);
			const [catalogWarning, setCatalogWarning] = React.useState("");
			const [record, setRecord] = React.useState(null);
			const [associations, setAssociations] = React.useState(null);
			const [selectedCardPath, setSelectedCardPath] = React.useState("");
			const [loading, setLoading] = React.useState(true);
			const [recordLoading, setRecordLoading] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [bindingBusy, setBindingBusy] = React.useState(false);
			const [searchQuery, setSearchQuery] = React.useState("");
			const [sortMode, setSortMode] = React.useState(function () {
				try { return normalizeWorldBookSort(window.localStorage.getItem(WORLD_BOOK_SORT_STORAGE_KEY)); }
				catch (_) { return "newest"; }
			});
			const [error, setError] = usePersistentError("世界书库");
			const importInput = React.useRef(null);
			const bindingDisclosure = React.useRef(null);
			const refreshModule = React.useRef(null);
			const draftDirty = React.useRef(false);
			const [recordStale, setRecordStale] = React.useState(false);
			const requestedSource = props.tab && props.tab.meta && props.tab.meta.worldBookSource ? props.tab.meta.worldBookSource : null;
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const h = React.createElement;
			if (!refreshModule.current) refreshModule.current = createWorldBookLibraryRefreshModule({
				load: function () { return rpcWithTimeout("listWorldBooks", {}, props.scope.sessionId); },
				onValue: function (result) { setCatalog(result || { standalone: [], embedded: [] }); setCatalogWarning(worldBookCatalogDiagnostic(result)); },
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
				return Promise.all([
					rpcWithTimeout("getWorldBook", { source: source }, props.scope.sessionId),
					rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId)
				]).then(function (results) {
					const relations = results[1] && results[1].associations ? results[1].associations : { cards: [], boundCards: [], conflict: false };
					setRecord(results[0]); setAssociations(relations);
					setSelectedCardPath((relations.cards || []).find(function (card) { return !card.bound; })?.path || "");
				}, function (err) {
					setRecord(null); setAssociations(null); setSelectedCardPath(""); setError(String(err && err.message || err));
				}).finally(function () { setRecordLoading(false); });
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
				return Promise.all([listed, rpcWithTimeout("getWorldBook", { source: source }, props.scope.sessionId).then(function (result) {
					setRecord(function (current) { return current && JSON.stringify(current.source) === JSON.stringify(source) && !draftDirty.current ? result : current; });
				}, function () {})]);
			}
			useVisibleDataRefresh(props.visible, function (event) { return tavernDataChangeAffects(event, ["worldbooks", "cards"], "worldbooks"); }, refreshAll);
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
				if (!await askConfirm("删除世界书“" + name + "”吗？\n" + detail)) return;
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
			if (recordLoading) return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…"));
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
			function row(item) { const source = item.kind === "card" ? { kind: "card", cardPath: item.cardPath } : { kind: "standalone", path: item.path }; const resourcePath = item.kind === "card" ? item.cardPath : item.path; return h("div", { key: resourcePath, className: "dsh-tavern-card-pick-wrap" }, h("button", { className: "dsh-tavern-library-card", disabled: busy, onClick: function () { load(source); } }, h("b", null, item.name), h("span", null, (item.globalEnabled ? "全局生效 · " : "") + item.entryCount + " 条 · " + item.enabledCount + " 条启用" + (item.diagnostics ? " · " + item.diagnostics + " 个诊断" : "")), item.cardName ? h("span", null, "来自人物卡：" + item.cardName) : null), sessionMode === "card" ? h("button", { className: "dsh-tavern-resource-at", title: "在对话中引用", onClick: function () { props.appendMention("worldbook", resourcePath, item.name); } }, "在对话中引用") : null); }
			function group(title, items) { return h("section", { className: "dsh-tavern-resource-group" }, h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length)), items.length ? items.map(row) : h("div", { className: "dsh-tavern-status-empty" }, searchQuery.trim() ? "没有匹配的世界书" : "暂无")); }
			return h("div", { className: "dsh-tavern-library" }, h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "世界书库"), h("div", { className: "dsh-tavern-question-sub" }, "独立世界书与人物卡内置世界书共用编辑界面"), h("button", { className: "dsh-tavern-btn primary", disabled: busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入世界书"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importFile(file); event.target.value = ""; } })), h("div", { className: "dsh-tavern-resource-body" },
				h(WorldBookRecallGuide),
				h("div", { className: "dsh-tavern-worldbook-toolbar" },
					h("input", { className: "dsh-tavern-library-search", type: "search", value: searchQuery, placeholder: "搜索世界书或人物卡", "aria-label": "搜索世界书", onChange: function (event) { setSearchQuery(event.target.value); } }),
					h("label", { className: "dsh-tavern-worldbook-sort" },
						h("span", { className: "dsh-tavern-worldbook-sort-label" }, "排序"),
						h("span", { className: "dsh-tavern-worldbook-sort-control" },
							h("select", { value: sortMode, "aria-label": "世界书排序方式", onChange: function (event) { changeSortMode(event.target.value); } },
								h("option", { value: "newest" }, "最新"),
								h("option", { value: "oldest" }, "最旧")),
							h("span", { className: "dsh-tavern-worldbook-sort-chevron", "aria-hidden": "true" }, "⌄")))),
				loading && !catalog ? h("div", { className: "dsh-tavern-empty" }, "正在读取世界书…") : null,
				error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: refresh }, "重新读取")) : null,
				catalogWarning ? h("div", { className: "dsh-tavern-dock-error" }, catalogWarning) : null,
				catalog ? group("独立世界书", orderWorldBookCatalogItems(filterWorldBookCatalogItems(catalog.standalone, searchQuery), sortMode)) : null,
				catalog ? group("人物卡内置世界书", orderWorldBookCatalogItems(filterWorldBookCatalogItems(catalog.embedded, searchQuery), sortMode)) : null));
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => ctx.betterSidebar.registerTab({
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

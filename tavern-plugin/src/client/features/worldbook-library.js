		// An entry's lamp, the one place its state is read: 常驻 (constant) · 非常驻 (keyword) · 禁用 (off); an entry only for the
		// background variable update is 启用 / 禁用 (on / off). The lamp's words are the groups' titles.
		function worldBookEntryLamp(entry) {
			if (isMvuUpdateEntry(entry)) return entry.enabled === false ? "off" : "on";
			return entry.enabled === false ? "off" : entry.constant === true ? "constant" : "keyword";
		}
		function worldBookLampPatch(mode) { return mode === "off" ? { enabled: false } : mode === "on" ? { enabled: true } : { enabled: true, constant: mode === "constant" }; }
		const WORLD_BOOK_LAMP_WORDS = { constant: "常驻", keyword: "非常驻", on: "启用", off: "禁用" };
		// The entry list in groups — 常驻 · 非常驻 · 禁用 · 仅后台变量更新 — each in the book's order; `filter` keeps one lamp.
		function groupWorldBookEditorEntries(entries, query, filter) {
			const groups = { constant: [], keyword: [], off: [], background: [] };
			const needle = String(query || "").trim().toLocaleLowerCase();
			for (const [index, entry] of (entries || []).entries()) {
				const background = isMvuUpdateEntry(entry), lamp = worldBookEntryLamp(entry);
				if (filter && filter !== "all" && (background || lamp !== filter)) continue;
				if (needle && ![entry.comment, entry.title, entry.content, ...(entry.primaryKeys || []), ...(entry.secondaryKeys || [])].join("\n").toLocaleLowerCase().includes(needle)) continue;
				groups[background ? "background" : lamp].push({ entry: entry, index: index });
			}
			return groups;
		}
		// @include-domain worldbook-mvu-entry.js
		const WORLD_BOOK_BACKGROUND_HELP = "只交给后台变量更新任务，不发给正文模型";
		const WORLD_BOOK_ENTRY_GROUPS = [
			{ key: "constant", title: "常驻", help: "每轮都进入上下文，不用匹配触发词。" },
			{ key: "keyword", title: "非常驻", help: "对话提到触发词时提示给 AI，AI 按需读取正文。" },
			{ key: "off", title: "禁用", help: "不参与游玩。" },
			{ key: "background", title: "仅后台变量更新", help: WORLD_BOOK_BACKGROUND_HELP }];
		const WORLD_BOOK_ENTRY_FILTERS = [["all", "全部"], ["constant", "常驻"], ["keyword", "非常驻"], ["off", "禁用"]];

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
		// @include features/worldbook-detail.js
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
					setRecord(null); setAssociations(null);
					setError(String(err && err.message || err)); setRecordLoading(false);
				});
				const associationRequest = rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					if (loadSequence.current !== loadId) return;
					setAssociations(result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false });
				}, function () {});
				return Promise.all([bookRequest, associationRequest]);
			}
			function reloadAssociations(source) {
				return rpcWithTimeout("getWorldBookAssociations", { source: source }, props.scope.sessionId).then(function (result) {
					const relations = result && result.associations ? result.associations : { cards: [], boundCards: [], conflict: false };
					setAssociations(relations);
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
			function clear() { setRecord(null); setAssociations(null); if (props.ctx && props.tab) props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null }); }
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
			async function bindCard(cardPath) {
				if (!record || !cardPath) return;
				setBindingBusy(true); setError("");
				try {
					await rpc("bindWorldBook", { cardPath: cardPath, source: record.source }, props.scope.sessionId);
					await reloadAssociations(record.source); notifyTavernDataChanged(["worldbooks", "cards"], "worldbooks");
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
			if (recordLoading) return h("div", { className: "fork-tab-scroll dsh-wbd-detail-scroll" }, h("div", { className: "ap-ui dsh-wbd-detail" }, h(PanelLoading, { shape: "fields", label: "正在读取世界书…" })));
			if (record) {
				const bookPath = record.source.kind === "card" ? record.source.cardPath : record.source.path;
				return h(WorldBookDetail, { record: record, sessionId: props.scope.sessionId, onBack: clear, stale: recordStale, error: error, busy: busy || bindingBusy,
					onReload: function () { draftDirty.current = false; return load(record.source); }, onDirty: function (value) { draftDirty.current = value; if (!value) setRecordStale(false); },
					onSaved: function (result) { setRecord(result); refresh(); },
					globalEnabled: record.globalEnabled === true, onToggleGlobal: toggleGlobal,
					associations: associations, bindingBusy: bindingBusy, onBindCard: bindCard, onUnbindCard: unbindCard,
					onExport: exportFile, onRename: record.source.kind === "standalone" ? rename : null, onDelete: function () { remove(record.source, record.view.displayName); },
					onMention: sessionMode === "card" ? function () { props.appendMention("worldbook", bookPath, record.view.displayName); } : null });
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

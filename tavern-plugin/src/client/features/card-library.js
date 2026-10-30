// Library-only label: never write the filename suffix into the prompt character name.
function cardLibraryDisplayName(card) {
    const suffix = String(card.path || '').match(/ ([\(][1-9]\d*[\)])\.json$/i);
    return card.name + (suffix ? suffix[1] : '');
}

		function createCardLibraryFeatureModule() {
		function CardLibraryTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);

			const [cards, setCards] = React.useState([]);
			const [selectedPath, setSelectedPath] = React.useState("");
			const [card, setCard] = React.useState(null);
			const [loading, setLoading] = React.useState(false);
						const [busy, setBusy] = React.useState(false);
			const cardBatch = useCardBatchDeletion(cards, busy, setBusy, refreshCards, props.archiveSession);
			const organization = useCardOrganization(cards, busy, refreshCards, error => setError(error), cardBatch);
			const [error, setError] = usePersistentError("人物卡库");
			const importInput = React.useRef(null);
			const [importStatus, setImportStatus] = React.useState("");
			const importing = React.useRef(false);
			const cardRequest = React.useRef(0);
			const visibleRef = React.useRef(Boolean(props.visible));
			const refreshModule = React.useRef(null);
			visibleRef.current = Boolean(props.visible);
			if (!refreshModule.current) refreshModule.current = createCardLibraryRefreshModule();
			const sessionMode = useTavernSessionMode(props.scope.sessionId);
			const requestedPath = props.tab && props.tab.meta && typeof props.tab.meta.cardPath === "string" ? props.tab.meta.cardPath : "";
			function refreshCards() {
				return rpcWithTimeout("listCards", {}).then(function (result) { setCards(result.cards || []); setError(""); return result.cards || []; }, function (err) { if (visibleRef.current) setError(String(err && err.message || err)); return []; });
			}
			function loadCard(path) {
				if (!path) { setSelectedPath(""); setCard(null); setLoading(false); return Promise.resolve(); }
				return refreshModule.current.load(path, function () {
					const request = ++cardRequest.current;
					if (path !== selectedPath) setCard(null);
					setSelectedPath(path); setLoading(true); setError("");
					return rpcWithTimeout("getCard", { path: path }).then(function (result) {
						if (request !== cardRequest.current) return;
						const next = result.card || null;
						setCard(function (current) { return JSON.stringify(current) === JSON.stringify(next) ? current : next; });
					}, function (err) {
						if (request !== cardRequest.current) return;
						setError(String(err && err.message || err)); setCard(null);
					}).finally(function () { if (request === cardRequest.current) setLoading(false); });
				});
			}
			React.useEffect(function () {
				if (!props.visible) return function () { cardRequest.current += 1; refreshModule.current.dispose(); };
				refreshCards();
				function onData(event) {
					if (!tavernDataChangeAffects(event, ["cards"], "cards")) return;
					refreshCards().then(function (items) {
						if (!selectedPath) return;
						if (!items.some(function (item) { return item.path === selectedPath; })) { setSelectedPath(""); setCard(null); return; }
						loadCard(selectedPath);
					});
				}
				function onActivate() { refreshModule.current.activate(function () { if (selectedPath) loadCard(selectedPath); else refreshCards(); }); }
				function onVisibility() { if (document.visibilityState === "visible") onActivate(); }
				window.addEventListener("dsh-tavern-data-changed", onData);
				window.addEventListener("focus", onActivate);
				document.addEventListener("visibilitychange", onVisibility);
				return function () {
					window.removeEventListener("dsh-tavern-data-changed", onData);
					window.removeEventListener("focus", onActivate);
					document.removeEventListener("visibilitychange", onVisibility);
					refreshModule.current.dispose();
				};
			}, [selectedPath, props.visible]);
			React.useEffect(function () {
				if (props.visible && requestedPath && requestedPath !== selectedPath) loadCard(requestedPath);
			}, [requestedPath, selectedPath, props.visible]);
			function clearCard() {
				cardRequest.current += 1;
				setSelectedPath("");
				setCard(null);
				setLoading(false);
				props.ctx.betterSidebar.updateTab(props.tab.id, { meta: null });
			}
			// 「导入人物卡」 also takes a card ZIP and hands it to the 导入卡片 sheet
			// (card-zip-entry.js); PNG / JSON files picked with it import here as before.
			const forkCardZip = props.forkCardZip && props.forkCardZip.available ? props.forkCardZip : null;
			if (props.forkCardZip && props.forkCardZip.pickerRef) props.forkCardZip.pickerRef.current = function () { if (importInput.current) importInput.current.click(); };
			async function importCardFiles(picked) {
				if (!picked.length || busy || importing.current) return;
				let files = picked;
				if (forkCardZip) {
					const split = await splitCardFiles(picked);
					files = split.cards;
					if (split.zips.length) {
						setError(split.zips.length > 1 ? "一次只能导入一个卡片 ZIP，只打开了「" + split.zips[0].name + "」。" : "");
						forkCardZip.openFile(split.zips[0]).catch(function (err) { setError(String(err && err.message || err)); });
					}
					if (!files.length) return;
				}
				importing.current = true;
				setBusy(true); if (files.length === picked.length) setError("");
				let imported = 0, existing = 0;
				let lastPath = "";
				const failures = [], notices = [];
				try {
					for (let index = 0; index < files.length; index++) {
						const file = files[index];
						setImportStatus("正在导入 " + (index + 1) + "/" + files.length + "：" + file.name);
						try {
							const result = await importTavernCardFile(file, rpc);
							lastPath = result.card.path;
							if (result.card.duplicate) {
								existing += 1;
								notices.push((files.length > 1 ? file.name + "：" : "") + "这张卡已经导入过（「" + result.card.name + "」），没有重复添加");
								continue;
							}
							imported += 1;
							const notice = tavernCardAssetNotice(result.card.assets, result.card);
							if (notice) notices.push((files.length > 1 ? file.name + "：" : "") + notice);
						} catch (err) { failures.push(file.name + "：" + String(err && err.message || err)); }
					}
					setImportStatus("已导入 " + imported + " 张" + (existing ? "，" + existing + " 张已在卡库中" : "") + (failures.length ? "，" + failures.length + " 张失败" : "") + (notices.length ? "。" + notices.join("\n") : ""));
					if (failures.length) setError(failures.join("\n"));
					if (imported || existing) {
						notifyTavernDataChanged(["cards"], "cards");
						await refreshCards();
						if (files.length === 1) await loadCard(lastPath);
					}
				} catch (err) { setError(failures.concat("刷新人物卡库失败：" + String(err && err.message || err)).join("\n")); }
				finally { importing.current = false; setBusy(false); }
			}
			async function renameCard() {
				if (!card) return;
				const current = card.path.split("/").pop();
				const name = await askTavernText({ title: "重命名人物卡文件", initialValue: current, maxLength: 120 });
				if (name === null || name === current) return;
				setBusy(true); setError("");
				try { const result = await rpc("renameResource", { path: card.path, name: name }); await refreshCards(); await loadCard(result.resource.path); notifyTavernDataChanged(["cards", "sessions"], "cards"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			// a separate card to edit or experiment with; the original file is not touched.
			async function duplicateCardFile() {
				if (!card) return;
                setBusy(true); setError("");
                try {
                    const copied = (await rpc("duplicateCard", { path: card.path })).card;
                    await refreshCards(); await loadCard(copied.path); notifyTavernDataChanged(["cards"], "cards"); setImportStatus("已另存副本，原卡未改动");
                }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			async function deleteCardFile() {
				if (!card || !await askConfirm("从人物卡库删除“" + card.name + "”吗？")) return;
				let chats;
				try { chats = await askTavernCardChatRemoval([card.path], askConfirm); }
				catch (err) { setError("读取游玩记录失败，未删除人物卡：" + String(err && err.message || err)); return; }
				setBusy(true); setError("");
				try {
					await rpc("deleteCard", { path: card.path });
					const chatRemoval = await removeTavernCardChats(chats, [{ path: card.path, ok: true }], props.archiveSession);
					announceTavernChatsRemoved(chatRemoval.sessionIds);
					setSelectedPath(""); setCard(null); await refreshCards(); notifyTavernDataChanged(["cards", "sessions"], "cards");
					if (chatRemoval.notice.indexOf("失败") >= 0) setError(chatRemoval.notice);
				}
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
			// The host picks the format: CHARX with character material, PNG with a cover, otherwise JSON.
			function exportCardFile() {
				if (!card) return;
				const link = document.createElement("a");
				link.href = "/api/dsh-tavern/card-export?path=" + encodeURIComponent(card.path);
				document.body.appendChild(link); link.click(); link.remove();
			}
			const h = React.createElement;
			if (selectedPath) {
				if (!card) return h("div", { className: "dsh-tavern-library dsh-tavern-card-library" }, h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: clearCard }, "← 返回人物卡库")), loading ? h(PanelLoading, { shape: "fields", label: "正在读取人物卡…" }) : error ? h("div", { className: "dsh-tavern-dock-error" }, error, h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")) : h("div", { className: "dsh-tavern-empty" }, "人物卡读取失败", h("button", { className: "dsh-tavern-btn", onClick: function () { loadCard(selectedPath); } }, "重新读取")));
				return h(React.Fragment, null, h(TavernCardPluginsBox, { path: selectedPath }), h(CardFieldsPanel, { view: { card: card }, library: true, organizationSettings: organization.detailSettings(cards.find(item => item.path === selectedPath)), busy: busy, onBack: clearCard, onAttach: sessionMode === "card" ? function () { props.appendMention(card.path, card.name); } : null, onOpenWorldBook: props.openWorldBook, onRename: renameCard, onDuplicate: duplicateCardFile, onExport: exportCardFile, onDelete: deleteCardFile, onSaved: function (saved) { setCard(Object.assign({}, saved, { path: selectedPath })); refreshCards(); } }));
			}
			const visible = organization.visible;
			// "@" quotes a card into the card workspace conversation; only there does it mean anything.
			const mentionButton = sessionMode === "card" ? function (item) { return h("button", { type: "button", className: "dsh-tavern-card-mention", title: "在对话中引用", "aria-label": "在对话中引用：" + item.name, onClick: function (event) { event.stopPropagation(); props.appendMention(item.path, item.name); } }, "@"); } : null;
			return h("div", { className: "dsh-tavern-library dsh-tavern-card-library" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "人物卡库"), h("div", { className: "dsh-tavern-question-sub" }, cards.length + " 张人物卡"), h("div", { className: "dsh-tavern-library-head-actions" }, h(MobileCardImportButton, { inputRef: importInput, disabled: busy, onImported: async function (imported) { await refreshCards(); await loadCard(imported.path); notifyTavernDataChanged(["cards"], "cards"); } }), forkCardZip ? h("button", { type: "button", className: "dsh-tavern-btn fork-card-url-import", disabled: busy || forkCardZip.busy, onClick: forkCardZip.openUrl }, "从网址导入卡") : null, h("input", { ref: importInput, type: "file", multiple: true, accept: TAVERN_CARD_FILE_ACCEPT, style: { display: "none" }, onChange: function (event) { const files = Array.from(event.target.files || []); importCardFiles(files); event.target.value = ""; } }))),
				h("div", { className: "dsh-tavern-question-sub dsh-tavern-card-import-hint", role: "status" }, importStatus || (forkCardZip ? "支持 PNG、JSON、CHARX、DSH 人物卡和卡片 ZIP" : "支持多选 PNG、JSON、CHARX、DSH 人物卡一起导入")),
				organization.toolbar(),
				h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, visible.length ? h(TavernCardList, { place: "library", cards: visible, batch: cardBatch, busy: busy, open: function (item) { loadCard(item.path); }, menu: organization.rowMenu, mention: mentionButton, builtin: function () { return organization.renderCards(function (item) { return h("div", { key: item.path, className: "dsh-tavern-library-card-row" },
					cardBatch.checkbox(item),
					h("button", { className: "dsh-tavern-library-card" + (item.hasImage ? " with-image" : "") + (cardBatch.managing && cardBatch.isSelected(item.path) ? " selected" : ""), disabled: busy, onClick: function () { if (cardBatch.managing) cardBatch.toggle(item.path); else loadCard(item.path); } }, h(TavernCardListContent, { card: Object.assign({}, item, { name: cardLibraryDisplayName(item) }), detail: item.path.split("/").pop(), extra: item.script ? "已绑定剧本：" + item.script.title : "" })),
					!cardBatch.managing ? organization.rowMenu(item) : null,
					!cardBatch.managing && mentionButton ? mentionButton(item) : null
				); }); } }) : h(EmptyState, cards.length ? { text: "没有匹配的人物卡", icon: "search" } : { noun: "人物卡" }), organization.addCardsFooter() )
			);
		}

		function CardFieldsPanel(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const [draft, setDraft] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = usePersistentError("人物卡详情");
			const [script, setScript] = React.useState(null);
			const [availableResources, setAvailableResources] = React.useState([]);
			const [scriptCatalogLoaded, setScriptCatalogLoaded] = React.useState(false);
			const [scriptCatalogLoading, setScriptCatalogLoading] = React.useState(false);
			const [selectedScriptPath, setSelectedScriptPath] = React.useState("");
			const [scriptBusy, setScriptBusy] = React.useState(false);
			const [scriptError, setScriptError] = usePersistentError("剧本管理");
			const [worldBookBinding, setWorldBookBinding] = React.useState(null);
			const [availableWorldBooks, setAvailableWorldBooks] = React.useState([]);
			const [worldBookCatalogLoaded, setWorldBookCatalogLoaded] = React.useState(false);
			const [worldBookCatalogLoading, setWorldBookCatalogLoading] = React.useState(false);
			const [worldBookCatalogWarning, setWorldBookCatalogWarning] = React.useState("");
			const [selectedWorldBook, setSelectedWorldBook] = React.useState("");
			const [addingWorldBook, setAddingWorldBook] = React.useState(false);
			const [worldBookBusy, setWorldBookBusy] = React.useState(false);
			const [worldBookError, setWorldBookError] = usePersistentError("世界书绑定");
			const scriptFileRef = React.useRef(null);
			const worldBookDetailsRef = React.useRef(null);
			const worldBookCatalogRequestRef = React.useRef(null);
			const cardPath = props.view.card.path;
			function call(method, args) { return rpc(method, args); }
			function worldBookChoiceValue(item) {
				if (!item) return "";
				return item.kind === "card" ? "card:" + item.cardPath : "standalone:" + item.path;
			}
			function worldBookChoiceSource(value) {
				if (value.indexOf("card:") === 0) return { kind: "card", cardPath: value.slice(5) };
				if (value.indexOf("standalone:") === 0) return { kind: "standalone", path: value.slice(11) };
				return null;
			}
			function loadScript() {
				if (!cardPath) return;
				call("getScriptInfo", { path: cardPath }).then(function (result) {
					const currentScript = result.script || null;
					setScript(currentScript);
					setSelectedScriptPath(currentScript ? currentScript.path : "");
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); });
			}
			function loadScriptCatalog() {
				if (!cardPath || scriptCatalogLoaded || scriptCatalogLoading) return;
				setScriptCatalogLoading(true);
				call("listResources").then(function (result) {
					setAvailableResources(result.resources || []);
					setScriptCatalogLoaded(true);
					setScriptError("");
				}, function (err) { setScriptError(String(err && err.message || err)); })
					.finally(function () { setScriptCatalogLoading(false); });
			}
			function loadWorldBookBinding() {
				if (!cardPath) return;
				call("getWorldBookBinding", { cardPath: cardPath }).then(function (result) {
					const binding = result.binding || { kind: "none", source: null, name: "" };
					setWorldBookBinding(binding);
					setSelectedWorldBook(""); setAddingWorldBook(false);
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); });
			}
			function loadWorldBookCatalog(force) {
				if (!cardPath || (!force && worldBookCatalogLoaded)) return Promise.resolve();
				if (worldBookCatalogRequestRef.current) return worldBookCatalogRequestRef.current;
				setWorldBookError("");
				setWorldBookCatalogLoading(true);
				const request = rpcWithTimeout("listWorldBooks", {}).then(function (result) {
					setAvailableWorldBooks((result.standalone || []).concat(result.embedded || []));
					setWorldBookCatalogLoaded(true);
					setWorldBookCatalogWarning(worldBookCatalogDiagnostic(result));
					setWorldBookError("");
				}, function (err) { setWorldBookError(String(err && err.message || err)); })
					.finally(function () {
						if (worldBookCatalogRequestRef.current !== request) return;
						worldBookCatalogRequestRef.current = null;
						setWorldBookCatalogLoading(false);
					});
				worldBookCatalogRequestRef.current = request;
				return request;
			}
			React.useEffect(function () {
				const card = props.view.card;
				setDraft({
					name: card.name || "", tags: (card.tags || []).join(", "), description: card.description || "", personality: card.personality || "", scenario: card.scenario || "",
					first_mes: card.first_mes || "", alternate_greetings: (card.alternate_greetings || []).join("\n---\n"), mes_example: card.mes_example || "", system_prompt: card.system_prompt || "",
					post_history_instructions: card.post_history_instructions || "", creator_notes: card.creator_notes || ""
				});
			}, [props.view.card]);
			React.useEffect(function () {
				setAvailableResources([]); setScriptCatalogLoaded(false); setScriptCatalogLoading(false);
				setAvailableWorldBooks([]); setWorldBookCatalogLoaded(false); setWorldBookCatalogLoading(false);
				setWorldBookCatalogWarning("");
				loadScript();
				loadWorldBookBinding();
			}, [cardPath]);
			React.useEffect(function () {
				function onWorldBookDataChanged(event) {
					if (!tavernDataChangeAffects(event, ["worldbooks", "cards"])) return;
					loadWorldBookBinding();
					setAvailableWorldBooks([]);
					setWorldBookCatalogLoaded(false);
					if (worldBookDetailsRef.current && worldBookDetailsRef.current.open) loadWorldBookCatalog(true);
				}
				window.addEventListener("dsh-tavern-data-changed", onWorldBookDataChanged);
				return function () { window.removeEventListener("dsh-tavern-data-changed", onWorldBookDataChanged); };
			}, [cardPath]);
			function field(name, value) { setDraft(Object.assign({}, draft, { [name]: value })); }
			async function save() {
				setBusy(true); setError("");
				try {
					const next = Object.assign({}, draft, { tags: draft.tags.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean), alternate_greetings: draft.alternate_greetings.split(/\n---+\n/).map(function (x) { return x.trim(); }).filter(Boolean) });
					const source = props.view.card || {};
					const baseline = {
						name: source.name || "", tags: source.tags || [], description: source.description || "", personality: source.personality || "", scenario: source.scenario || "",
						first_mes: source.first_mes || "", alternate_greetings: source.alternate_greetings || [], mes_example: source.mes_example || "", system_prompt: source.system_prompt || "",
						post_history_instructions: source.post_history_instructions || "", creator_notes: source.creator_notes || ""
					};
					const patch = {};
					Object.keys(next).forEach(function (key) { if (JSON.stringify(next[key]) !== JSON.stringify(baseline[key])) patch[key] = next[key]; });
					const res = await call("updateCard", { path: cardPath, patch: patch });
					props.onSaved(res.card);
					notifyTavernDataChanged(["cards", "sessions"], "cards");
				} catch (err) { setError(String(err && err.message || err)); } finally { setBusy(false); }
			}
			async function importScriptFile(file) {
				if (!cardPath || !file) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("importScript", { cardPath: cardPath, payload: await parseTextResourceFile(file) });
					setScript(res.script || null);
					setSelectedScriptPath(res.script ? res.script.path : "");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
					loadScript();
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindSelectedScript() {
				if (!cardPath || !selectedScriptPath) return;
				setScriptBusy(true); setScriptError("");
				try {
					const res = await call("bindScript", { cardPath: cardPath, path: selectedScriptPath });
					setScript(res.script || null);
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function deleteScript() {
				if (!script || !await askConfirm("解除剧本《" + (script.title || "未命名") + "》绑定？\n已有剧本会话保留，新会话将按自由故事推进。")) return;
				setScriptBusy(true); setScriptError("");
				try {
					await call("deleteScript", { cardPath: cardPath });
					setScript(null);
					setSelectedScriptPath("");
					notifyTavernDataChanged(["scripts", "cards"], "cards");
				} catch (err) { setScriptError(String(err && err.message || err)); }
				finally { setScriptBusy(false); }
			}
			async function bindSelectedWorldBook() {
				if (!cardPath || !selectedWorldBook) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const source = worldBookChoiceSource(selectedWorldBook);
					if (!source) throw new Error("请选择世界书");
					const result = await call("bindWorldBook", { cardPath: cardPath, source: source });
					setWorldBookBinding(result.binding || null); setSelectedWorldBook(""); setAddingWorldBook(false);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			async function unbindWorldBook(source) {
				if (!cardPath) return;
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("unbindWorldBook", { cardPath: cardPath, source: source });
					setWorldBookBinding(result.binding || null); setSelectedWorldBook(""); setAddingWorldBook(false);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			async function moveWorldBook(index, direction) {
				const sources = boundWorldBooks.map(function (book) { return book.source; });
				const target = index + direction;
				if (target < 0 || target >= sources.length) return;
				[sources[index], sources[target]] = [sources[target], sources[index]];
				setWorldBookBusy(true); setWorldBookError("");
				try {
					const result = await call("setWorldBookBindings", { cardPath: cardPath, sources: sources });
					setWorldBookBinding(result.binding);
					notifyTavernDataChanged(["worldbooks", "cards"], "cards");
				} catch (err) { setWorldBookError(String(err && err.message || err)); }
				finally { setWorldBookBusy(false); }
			}
			function F(name, label, large) {
				const value = draft[name] || "";
				const empty = !String(value).trim();
				return React.createElement("div", { className: "dsh-tavern-card-field" + (empty ? " is-empty" : "") },
					React.createElement("label", null, label),
					name === "name" || name === "tags"
						? React.createElement("input", { value: value, onChange: function (e) { field(name, e.target.value); } })
						: React.createElement("textarea", { className: (large ? "large" : "") + (empty ? " is-empty" : ""), value: value, rows: empty ? (large ? 3 : 2) : undefined, onChange: function (e) { field(name, e.target.value); } })
				);
			}
			const h = React.createElement;
			const cardExtensions = props.view.card.extensions || {};
			const cardRegexScripts = cardExtensions.regexScripts || [];
			const helperScripts = cardExtensions.helperScripts || [];
			const mvuResources = cardExtensions.mvuResources || [];
			const otherExtensions = cardExtensions.otherExtensions || [];
			const extensionCount = Number(cardExtensions.extensionCount) || 0;
			function extensionSectionTitle(title, count) {
				return count ? h("div", { className: "dsh-tavern-preset-section-title" }, title + " · " + count) : null;
			}
			function extensionTags(items) {
				return h("span", { className: "dsh-tavern-prompt-tags" }, items.filter(Boolean).map(function (item, index) { return h("span", { key: index, className: "dsh-tavern-prompt-tag" }, item); }));
			}
			function regexExtensionRow(item, index) {
				const placement = item.placement && item.placement.length ? item.placement.join(", ") : "未设置";
				const snippet = String(item.findRegex || "").slice(0, 400).replace(/\s+/g, " ").trim() || "空查找规则";
				const metadata = [
					"placement: [" + placement + "]", "promptOnly: " + Boolean(item.promptOnly), "markdownOnly: " + Boolean(item.markdownOnly),
					"runOnEdit: " + Boolean(item.runOnEdit), "substituteRegex: " + String(item.substituteRegex === null ? "null" : item.substituteRegex),
					"minDepth: " + String(item.minDepth === null ? "null" : item.minDepth), "maxDepth: " + String(item.maxDepth === null ? "null" : item.maxDepth),
					"trimStrings: " + JSON.stringify(item.trimStrings || [])
				].join("\n");
				return h(TavernLazyDetails, { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-regex",
					summary: h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "REGEX"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags(["位置 " + placement, item.promptOnly ? "仅提示词" : "", item.markdownOnly ? "仅 Markdown" : "", item.runOnEdit ? "编辑时运行" : ""])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					render: function () { return h("div", { className: "dsh-tavern-regex-body" },
						h("div", { className: "dsh-tavern-regex-label" }, "查找正则"), h("pre", { className: "dsh-tavern-regex-code" }, item.findRegex || "（空）"),
						h("div", { className: "dsh-tavern-regex-label" }, "替换内容"), h("pre", { className: "dsh-tavern-regex-code" }, item.replaceString || "（空）"),
						h("div", { className: "dsh-tavern-regex-meta" }, metadata)
					); }
				});
			}
			function scriptCode(label, value) {
				const content = String(value || "（空）");
				const lineCount = content.split(/\r\n|\r|\n/).length;
				return h(TavernLazyDetails, { className: "dsh-tavern-script-code",
					summary: h("summary", null, label, h("span", { className: "dsh-tavern-script-code-count" }, lineCount + " 行 · 只读")),
					render: function () { return h("div", { className: "dsh-tavern-script-code-scroll", tabIndex: 0, role: "region", "aria-label": label },
						h("div", { className: "dsh-tavern-script-code-lines", "aria-hidden": true }, Array.from({ length: lineCount }, function (_, index) { return index + 1; }).join("\n")),
						h("pre", null, h("code", null, content))
					); }
				});
			}
			function helperScriptRow(item, index) {
				const snippet = String(item.content || "").slice(0, 400).replace(/\s+/g, " ").trim() || "空脚本";
				return h(TavernLazyDetails, { key: item.ref || item.id || index, className: "dsh-tavern-prompt-row role-script",
					summary: h("summary", { className: "dsh-tavern-prompt-head" },
						h("span", { className: "dsh-tavern-prompt-role" }, "SCRIPT"),
						h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, snippet), extensionTags([item.type, item.buttonCount ? item.buttonCount + " 个按钮" : "", item.chars + " 字"])),
						h("span", { className: "dsh-tavern-prompt-state" + (item.enabled ? "" : " off") }, item.enabled ? "已启用" : "已关闭")
					),
					render: function () { return h("div", { className: "dsh-tavern-regex-body" },
						scriptCode("脚本内容", item.content),
						item.dataText ? scriptCode("脚本配置", item.dataText) : null,
						item.info ? h("div", null, h("div", { className: "dsh-tavern-regex-label" }, "说明"), h("pre", { className: "dsh-tavern-regex-code" }, item.info)) : null,
						item.exportWith !== null ? h("div", { className: "dsh-tavern-regex-meta" }, "export_with: " + JSON.stringify(item.exportWith)) : null
					); }
				});
			}
			function otherExtensionRow(item, index) {
				return h(TavernLazyDetails, { key: item.ref || item.name || index, className: "dsh-tavern-prompt-row role-extension",
					summary: h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-role" }, "EXT"), h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.name), h("span", null, item.type + " · " + item.chars + " 字")), h("span", { className: "dsh-tavern-mvu-state" }, "只读")),
					render: function () { return h("pre", { className: "dsh-tavern-prompt-content" }, item.text || "（空）"); }
				});
			}
			const extensionPanel = () => h("div", { className: "dsh-tavern-card-extensions" },
				h("div", { className: "dsh-tavern-extension-note" }, "这里只读取人物卡工作区中的完整扩展数据，不执行任何卡内脚本。MVU 按名称和内容识别，用于帮助定位相关资源，不代表已经完整解析其运行逻辑。"),
				extensionSectionTitle("正则脚本", cardRegexScripts.length), cardRegexScripts.map(regexExtensionRow),
				extensionSectionTitle("Tavern Helper 脚本", helperScripts.length), helperScripts.map(helperScriptRow),
				extensionSectionTitle("MVU 相关资源", mvuResources.length),
				mvuResources.length ? h("div", { className: "dsh-tavern-mvu-list" }, mvuResources.map(function (item, index) { return h("div", { key: item.ref || index, className: "dsh-tavern-mvu-row" }, h("span", { className: "dsh-tavern-mvu-kind" }, item.kindLabel), h("span", { className: "dsh-tavern-mvu-name", title: item.name }, item.name), h("span", { className: "dsh-tavern-mvu-state" }, item.enabled ? "已启用" : "已关闭")); })) : null,
				extensionSectionTitle("其他扩展", otherExtensions.length), otherExtensions.map(otherExtensionRow),
				extensionCount === 0 && mvuResources.length === 0 ? h("div", { className: "dsh-tavern-worldbook-empty" }, "这张人物卡没有可展示的扩展内容") : null
			);
			const selectableResources = availableResources.filter(function (item) { return !Array.isArray(item.boundCards) || item.boundCards.length === 0 || item.boundCards.some(function (boundCard) { return boundCard.path === cardPath; }); });
			const scriptPanel = h("div", { className: "dsh-tavern-script-row" },
				h("div", { className: "dsh-tavern-script-info" }, script ? h("span", null, h("b", null, "当前剧本："), script.title + " · " + script.chunkCount + " 块 · " + script.sourceChars + " 字") : h("span", null, "未绑定剧本；游玩时按自由故事推进")),
				h("select", { value: selectedScriptPath, disabled: scriptBusy || scriptCatalogLoading || !scriptCatalogLoaded || !selectableResources.length, onChange: function (event) { setSelectedScriptPath(event.target.value); } }, h("option", { value: "" }, scriptCatalogLoading ? "正在读取剧本与素材库…" : "选择已有剧本"), selectableResources.map(function (item) { return h("option", { key: item.path, value: item.path }, item.title); })),
				h("button", { className: script ? "dsh-tavern-script-file" : "dsh-tavern-script-primary", disabled: scriptBusy || !selectedScriptPath || !!(script && script.path === selectedScriptPath), onClick: bindSelectedScript }, script ? "更换绑定" : "绑定"),
				h("input", { ref: scriptFileRef, type: "file", accept: ".txt,.md,.epub,text/plain,text/markdown,application/epub+zip", style: { display: "none" }, onChange: function (e) { const f = e.target.files && e.target.files[0]; if (f) importScriptFile(f); e.target.value = ""; } }),
				h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: function () { scriptFileRef.current && scriptFileRef.current.click(); } }, "导入新剧本并绑定"),
				script ? h("button", { className: "dsh-tavern-script-file", disabled: scriptBusy, onClick: deleteScript }, "解绑") : null
			);
			const scriptHero = h("details", { className: "dsh-tavern-script-hero", onToggle: function (event) { if (event.currentTarget.open) loadScriptCatalog(); } },
				h("summary", { className: "dsh-tavern-script-hero-title" }, script ? ("剧本模式 · " + script.title) : "剧本模式 · 未绑定"),
				h("div", { className: "dsh-tavern-script-hero-help" }, "绑定剧本后，新开的游玩对话会自动进入剧本模式。Agent 按剧情进度分段读取当前片段并围绕它续写，每轮完成后推进阅读位置；不会一次载入整本剧本，也不要求玩家照原文行动。更换或解绑会影响所有使用这张人物卡的剧本对话。"),
				scriptPanel,
				scriptError ? h("div", { className: "dsh-card-error" }, scriptError) : null
			);
			const boundWorldBooks = worldBookBinding && worldBookBinding.kind === "multiple" ? worldBookBinding.books : worldBookBinding && worldBookBinding.source ? [worldBookBinding] : [];
			const hasWorldBookBinding = boundWorldBooks.length > 0;
			const ownWorldBook = props.view.card.character_book;
			const ownWorldBookName = String(ownWorldBook && ownWorldBook.name || "").trim() || String(props.view.card.name || "").trim() || cardPath;
			const worldBookChoices = availableWorldBooks.filter(function (item) { return !(item.kind === "card" && item.cardPath === cardPath); });
			const worldBookPanel = h("div", { className: "dsh-tavern-worldbook" },
				!hasWorldBookBinding ? h("div", { className: "dsh-tavern-worldbook-note" }, "尚未绑定世界书") : null,
				boundWorldBooks.map(function (book, index) {
					return h("div", { key: worldBookChoiceValue(book.source), className: "dsh-tavern-script-row" },
						h("button", { className: "dsh-tavern-worldbook-add dsh-tavern-worldbook-bound", disabled: worldBookBusy || !book.available, onClick: function () { if (typeof props.onOpenWorldBook === "function") props.onOpenWorldBook(book.source); } }, (index === 0 ? "主书 · " : "") + (book.name || "世界书不可用")),
						h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy || index === 0, onClick: function () { moveWorldBook(index, -1); } }, "上移"),
						h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy || index === boundWorldBooks.length - 1, onClick: function () { moveWorldBook(index, 1); } }, "下移"),
						h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy, onClick: function () { unbindWorldBook(book.source); } }, "解绑")
					);
				}),
				addingWorldBook ? h("div", { className: "dsh-tavern-script-row" },
					h("select", { value: selectedWorldBook, disabled: worldBookBusy || worldBookCatalogLoading, onChange: function (event) { setSelectedWorldBook(event.target.value); } },
						h("option", { value: "" }, worldBookCatalogLoading ? "正在读取世界书库…" : "选择世界书"),
						ownWorldBook && typeof ownWorldBook === "object" ? h("option", { value: worldBookChoiceValue({ kind: "card", cardPath: cardPath }) }, ownWorldBookName + "（当前人物卡）") : null,
						worldBookChoices.map(function (item) { const value = worldBookChoiceValue(item); return h("option", { key: value, value: value }, item.kind === "card" ? item.name + "（人物卡：" + item.cardName + "）" : item.name + "（独立世界书）"); })
					),
					h("button", { className: "dsh-tavern-script-primary", disabled: worldBookBusy || !selectedWorldBook || boundWorldBooks.some(function (book) { return worldBookChoiceValue(book.source) === selectedWorldBook; }), onClick: bindSelectedWorldBook }, worldBookBusy ? "处理中…" : "确认绑定"),
					h("button", { className: "dsh-tavern-script-file", disabled: worldBookBusy, onClick: function () { setAddingWorldBook(false); setSelectedWorldBook(""); } }, "取消")
				) : h("button", { className: "dsh-tavern-worldbook-add dsh-tavern-worldbook-new", disabled: worldBookBusy, onClick: function () { setAddingWorldBook(true); loadWorldBookCatalog(); } }, "＋ 新增绑定"),
				h("div", { className: "dsh-tavern-worldbook-note" }, "多本世界书可能相互冲突，引发异常"),
				worldBookError ? h("div", { className: "dsh-card-error" },
					worldBookError,
					h("button", { className: "dsh-tavern-btn", disabled: worldBookCatalogLoading, onClick: function () { loadWorldBookCatalog(true); } }, worldBookCatalogLoading ? "正在读取…" : "重新读取")
				) : null,
				worldBookCatalogWarning ? h("div", { className: "dsh-card-error" }, worldBookCatalogWarning) : null
			);
			return h("aside", { className: "dsh-tavern-status" + (props.library ? " dsh-tavern-card-detail" : "") },
				h("div", { className: "dsh-tavern-status-head" },
					props.onBack ? h("button", { className: "dsh-tavern-btn", onClick: props.onBack }, "← 返回") : null,
					h("div", { className: props.library ? "dsh-tavern-status-title" : "dsh-tavern-status-role" }, props.library ? cardLibraryDisplayName(props.view.card) : props.view.card.name),
					h("div", { className: "dsh-tavern-question-sub" }, props.view.card.path ? props.view.card.path.split("/").pop() : ""),
					props.library ? h("div", { className: "dsh-tavern-library-head-actions" }, props.onAttach ? h("button", { className: "dsh-tavern-btn", onClick: props.onAttach }, "在对话中引用") : null, props.onDuplicate ? h("button", { className: "dsh-tavern-btn", disabled: props.busy, onClick: props.onDuplicate }, "另存副本") : null, h("button", { className: "dsh-tavern-btn", onClick: props.onRename }, "重命名"), h("button", { className: "dsh-tavern-btn", onClick: props.onExport, title: "按内容自动选格式：有立绘等角色素材导出 CHARX，有封面导出 PNG 角色卡，否则导出 SillyTavern JSON" }, "导出"), h("button", { className: "dsh-tavern-btn danger", onClick: props.onDelete }, "删除")) : null
				),
				props.organizationSettings,
				scriptHero,
				h("div", { className: "dsh-tavern-card-fields" },
					h("details", { ref: worldBookDetailsRef, open: true, className: "dsh-tavern-card-advanced dsh-tavern-card-worldbook", onToggle: function (event) { if (event.currentTarget.open) loadWorldBookCatalog(); } }, h("summary", null, "世界书 · " + boundWorldBooks.length + " 本"), worldBookPanel),
					h("details", { className: "dsh-tavern-card-advanced", open: true }, h("summary", null, "基本信息"), F("name", "角色名称"), F("tags", "标签"), F("description", "角色描述", true), F("personality", "性格"), F("scenario", "场景设定"), F("first_mes", "开场白", true), F("alternate_greetings", "备选开场白（--- 分隔）"), F("system_prompt", "系统提示"), F("post_history_instructions", "历史后指令"), F("mes_example", "对话示例", true), F("creator_notes", "创作者备注")),
					h(TavernLazyDetails, { className: "dsh-tavern-card-advanced", summary: h("summary", null, "扩展内容 · " + extensionCount + " 项"), render: extensionPanel }),
					error ? h("div", { className: "dsh-card-error" }, error) : null,
					h("div", { className: "dsh-tavern-card-save" }, h("button", { className: "dsh-card-primary", disabled: busy, onClick: save }, busy ? "保存中…" : "保存字段"))
				)
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:cards",
				title: "人物卡库",
				order: 3,
				single: true,
				component: function (props) {
					return React.createElement(CardLibraryTab, Object.assign({}, props, {
						appendMention: function (path, label) { appendMention(props.scope.sessionId, "card", path, label); },
						archiveSession: function (sessionId) { return ctx.workspaces.archiveSession(sessionId); },
						openWorldBook: function (source) {
							openTavernSidebarTab(ctx, { type: "dsh-tavern:worldbooks", meta: { worldBookSource: source } }, { sessionId: props.scope.sessionId });
						}
					}));
				}
			}), "dsh-tavern: Better Sidebar card library tab");
		}
		return Object.freeze({ register: register });
		}
		const cardLibraryFeature = createCardLibraryFeatureModule();

		function createResourcesLibraryFeatureModule() {
			function TavernResourcesTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
				const [resources, setResources] = React.useState({ resources: [] });
				const [cards, setCards] = React.useState([]);
				const [selectedCardPaths, setSelectedCardPaths] = React.useState({});
				const [view, setView] = React.useState(null);
				const [openedScript, setOpenedScript] = React.useState(null);
				const [error, setError] = usePersistentError("剧本与素材库");
			const [busy, setBusy] = React.useState(false);
			const [bindingPath, setBindingPath] = React.useState("");
			const sourceInput = React.useRef(null);
			function refresh() {
					return Promise.all([rpc("listResources", {}, props.sessionId), readSessionViewAfterLive(props.sessionId)]).then(function (all) {
						setResources(all[0] || { resources: [] });
						setView(all[1] && all[1].view ? all[1].view : null);
						setCards(all[0] && all[0].cards || []);
					setError("");
				}, function (err) { setError(String(err && err.message || err)); });
			}
			async function importSourceResource(file) {
				if (!file) return;
				setBusy(true); setError("");
				try { await rpc("importSource", { payload: await parseTextResourceFile(file) }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
				async function openScript(item) {
					setBusy(true); setError("");
					try {
						const result = await rpc("getResource", { path: item.path }, props.sessionId);
						setOpenedScript({ path: item.path, title: item.title, text: result.text || "" });
					} catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
			useVisibleDataRefresh(props.visible, function (event) { return tavernDataChangeAffects(event, ["scripts", "cards", "sessions"], "resources"); }, refresh, props.sessionId);
			const h = React.createElement;
				const readOnly = !view || view.mode !== "card";
			async function renameResource(item, label) {
				const current = item.path.split("/").pop();
				const name = await askTavernText({ title: "重命名文件", initialValue: current, maxLength: 120 });
				if (name === null || name === current) return;
				setBusy(true); setError("");
				try { await rpc("renameResource", { path: item.path, name: name }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards", "sessions"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
				finally { setBusy(false); }
			}
				async function deleteResource(item) {
					if (!await askConfirm("删除剧本或素材“" + item.title + "”吗？\n工作版和原版都会删除。")) return;
				setBusy(true); setError("");
				try { await rpc("deleteResource", { path: item.path }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards", "sessions"], "resources"); }
				catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function bindScriptToCard(item) {
					const cardPath = selectedCardPaths[item.path] || "";
					if (!cardPath) return;
					setBusy(true); setError("");
					try {
						await rpc("bindScript", { cardPath: cardPath, path: item.path }, props.sessionId);
						setBindingPath("");
						await refresh();
						notifyTavernDataChanged(["scripts", "cards"], "resources");
					}
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				async function unbindScriptFromCard(item, boundCard) {
					if (!await askConfirm("解除剧本《" + item.title + "》与人物卡“" + boundCard.name + "”的绑定吗？")) return;
					setBusy(true); setError("");
					try { await rpc("deleteScript", { cardPath: boundCard.path }, props.sessionId); await refresh(); notifyTavernDataChanged(["scripts", "cards"], "resources"); }
					catch (err) { setError(String(err && err.message || err)); }
					finally { setBusy(false); }
				}
				function row(kind, item) {
					const path = item.path;
					const label = item.title;
					const boundCard = kind === "source" && Array.isArray(item.boundCards) ? item.boundCards[0] : null;
					const availableCards = cards.filter(function (card) { return !card.readError && card.script == null; });
					const meta = (item.chunkCount ? item.chunkCount + " 块 · " : "") + (boundCard ? "已绑定：" + boundCard.name : "未绑定");
					const name = h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", title: "查看工作版：" + label, onClick: function () { openScript(item); } }, label);
					if (readOnly) return h("div", { key: path, className: "dsh-tavern-resource-row" }, h("div", { className: "dsh-tavern-resource-row-main" }, name, h("span", { className: "dsh-tavern-resource-meta" }, meta)));
					const bindingOpen = bindingPath === path && !boundCard;
					const menu = h("details", {
						className: "dsh-tavern-resource-menu",
						onBlur: function (event) { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; },
						onKeyDown: function (event) { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary").focus(); } }
					},
						h("summary", { "aria-label": "更多操作：" + label, title: "更多操作" }, "⋯"),
						h("div", { className: "dsh-tavern-resource-menu-popup", role: "menu" },
							boundCard
								? h("button", { type: "button", disabled: busy, onClick: function (event) { event.currentTarget.closest("details").open = false; unbindScriptFromCard(item, boundCard); } }, "解绑人物卡")
								: h("button", { type: "button", disabled: busy, onClick: function (event) { event.currentTarget.closest("details").open = false; setBindingPath(path); } }, "绑定人物卡"),
							h("button", { type: "button", disabled: busy, onClick: function (event) { event.currentTarget.closest("details").open = false; renameResource(item, label); } }, "重命名"),
							h("button", { type: "button", className: "danger", disabled: busy, onClick: function (event) { event.currentTarget.closest("details").open = false; deleteResource(item); } }, "删除")
						)
					);
					const mention = h("button", {
						type: "button",
						className: "dsh-tavern-resource-mention",
						title: "在对话中引用",
						"aria-label": "在对话中引用：" + label,
						disabled: busy,
						onClick: function () { props.appendMention(kind, path, label); }
					}, "@");
					const binding = bindingOpen ? h("div", { className: "dsh-tavern-resource-binding" },
						h("select", {
							value: selectedCardPaths[item.path] || "",
							disabled: busy || !availableCards.length,
							"aria-label": "选择要绑定的人物卡",
							onChange: function (event) {
								const cardPath = event.target.value;
								setSelectedCardPaths(function (current) { return Object.assign({}, current, { [item.path]: cardPath }); });
							}
						},
							h("option", { value: "" }, availableCards.length ? "选择未绑定人物卡" : "暂无未绑定人物卡"),
							availableCards.map(function (card) { return h("option", { key: card.path, value: card.path }, card.name); })
						),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !selectedCardPaths[item.path], onClick: function () { bindScriptToCard(item); } }, "确认绑定"),
						h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: function () { setBindingPath(""); } }, "取消")
					) : null;
					return h("div", { key: path, className: "dsh-tavern-resource-row" + (bindingOpen ? " is-binding" : "") },
						h("div", { className: "dsh-tavern-resource-row-main" },
							name,
							h("span", { className: "dsh-tavern-resource-meta" }, meta),
							mention,
							menu
						),
						binding
					);
				}
			function group(title, kind, items, actions) {
				return h("section", { className: "dsh-tavern-resource-group" },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", null, title + " · " + items.length), actions || null),
					items.length ? items.map(function (item) { return row(kind, item); }) : h(EmptyState, { compact: true, text: "暂无" })
				);
			}
				if (openedScript) return h("div", { className: "dsh-tavern-resources" },
					h("div", { className: "dsh-tavern-status-head" }, h("button", { className: "dsh-tavern-btn", onClick: function () { setOpenedScript(null); } }, "← 返回剧本与素材库"), h("div", { className: "dsh-tavern-status-title" }, openedScript.title)),
					error ? h("div", { className: "dsh-tavern-dock-error" }, error) : h("pre", { className: "dsh-tavern-resource-body dsh-tavern-script-preview" }, openedScript.text)
				);
				const sourceActions = h("div", { className: "dsh-tavern-resource-actions" }, h("button", { className: "dsh-tavern-resource-import", disabled: busy, onClick: function () { sourceInput.current && sourceInput.current.click(); } }, "导入剧本或素材"), h("input", { ref: sourceInput, type: "file", accept: ".txt,.md,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; importSourceResource(file); event.target.value = ""; } }));
				return h("div", { className: "dsh-tavern-resources" },
						h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "剧本与素材库"), h("div", { className: "dsh-tavern-question-sub" }, readOnly ? "点击名称查看内容；导入、引用和管理请前往卡片工作台。" : "导入后按需引用；引用教学素材并提出要求，可在卡片工作台编写写作 Skill")),
					h("div", { className: "dsh-tavern-resource-body" }, error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null, group("剧本与素材", "source", resources.resources || [], readOnly ? null : sourceActions))
			);
		}
		function register(input) {
			const ctx = input.ctx;
			const appendMention = input.appendMention;
			return ctx.effect(() => registerTab(ctx.betterSidebar, {
				id: "dsh-tavern:resources",
					title: "剧本与素材库",
				order: 7,
				single: true,
				component: function (props) {
					return React.createElement(TavernResourcesTab, {
						sessionId: props.scope.sessionId,
						visible: props.visible,
						appendMention: function (kind, path, label) { appendMention(props.scope.sessionId, kind, path, label); },
					});
				}
			}), "dsh-tavern: Better Sidebar resources tab");
		}
		return Object.freeze({ register: register });
		}
		const resourcesLibraryFeature = createResourcesLibraryFeatureModule();

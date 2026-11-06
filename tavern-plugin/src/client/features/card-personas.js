		// 卡片工作台性格: a global library; the selected entry is the card Agent's custom
		// system text. Edits save straight back to that entry.
		function CardPersonaTab() {
			const askConfirm = useTavernConfirm();
			const h = React.createElement;
			const [state, setState] = React.useState({ loading: true, busy: false, activeId: "", items: [], draft: null, error: "", notice: "" });
			function accept(result, notice) {
				const value = result && result.cardPersonas || {};
				setState({ loading: false, busy: false, activeId: value.activeId || "", items: Array.isArray(value.items) ? value.items : [], draft: null, error: "", notice: notice || "" });
			}
			function fail(error) { setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); }); }
			React.useEffect(function () { rpc("getCardPersonas").then(function (result) { accept(result, ""); }, fail); }, []);
			const active = state.items.find(function (item) { return item.id === state.activeId; }) || null;
			const text = active ? (state.draft === null ? active.text : state.draft) : "";
			const dirty = active !== null && state.draft !== null && state.draft !== active.text;
			async function manage(action, notice, extra) {
				if (dirty && action !== "save" && !await askConfirm("当前性格有未保存的修改，继续会丢弃这些修改。是否继续？")) return;
				let name;
				if (action === "create" || action === "duplicate" || action === "rename") {
					name = await askTavernText({ title: action === "rename" ? "重命名性格" : "新性格名称", initialValue: action === "rename" ? active.name : action === "duplicate" ? active.name + " 副本" : "", maxLength: 80 });
					if (!name) return;
				}
				if (action === "delete" && !await askConfirm("删除性格“" + active.name + "”？" + (active.builtin ? "删除后这个内置性格不再出现。" : "此操作不能撤销。"))) return;
				if (action === "restore" && !await askConfirm("把“" + active.name + "”恢复为内置的默认内容？你的修改会丢失。")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try {
					accept(await rpc("manageCardPersona", Object.assign({ action: action, id: active ? active.id : "", name: name }, extra)), notice);
					notifyTavernDataChanged(["card-personas"], "card-personas");
				} catch (error) { fail(error); }
			}
			const body = state.loading ? h("div", { className: "dsh-tavern-status-empty" }, "正在读取性格…")
				: active === null ? h("div", { className: "dsh-tavern-status-empty" }, "当前为空白：卡片 Agent 不带自定义性格。从上方选择一个性格，或新建一个。")
				: h("div", { className: "dsh-tavern-prompt-editor" },
					// the draft text area, saved by its own 「保存」.
					h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h(TextArea, { value: text, disabled: state.busy, label: "性格内容", rows: 8, onChange: function (value) { setState(function (current) { return Object.assign({}, current, { draft: value, error: "", notice: "" }); }); } })),
					h("div", { className: "dsh-tavern-prompt-editor-actions" },
						active.builtin ? h("button", { className: "dsh-tavern-btn", disabled: state.busy || !active.modified, title: "恢复为内置的默认内容和名称", onClick: function () { void manage("restore", "已恢复默认内容。"); } }, "恢复默认") : null,
						h("button", { className: "dsh-tavern-btn primary", disabled: state.busy || !dirty, onClick: function () { void manage("save", "已保存，将从下一次卡片 Agent 请求开始生效。", { text: text }); } }, "保存")));
			return h("div", { className: "dsh-tavern-presets" },
				h("div", { className: "dsh-tavern-status-head dsh-tavern-system-prompt-head" },
					h("div", { className: "dsh-tavern-status-title" }, "卡片工作台性格"),
					h("div", { className: "dsh-tavern-question-sub" }, "选中的性格作为卡片 Agent 的自定义 system 指令，对所有卡片会话生效")),
				h("div", { className: "dsh-tavern-profile-library-bar dsh-tavern-prompt-set-bar" },
					// the shared menu, as on the 预设 page's 卡片工作台性格 row.
					h(InlineField, { kind: "menu", label: "卡片工作台性格", hideLabel: true, value: state.activeId, disabled: state.busy || state.loading,
						onCommit: function (id) { void manage("select", id ? "已切换性格，将从下一次卡片 Agent 请求开始生效。" : "已切换为空白。", { id: id }); },
						options: [{ value: "", label: "空白（默认）" }].concat(state.items.map(function (item) { return { value: item.id, label: item.name + (item.modified ? "（已修改）" : "") }; })) }),
					h("button", { className: "dsh-tavern-btn", disabled: state.busy || state.loading, title: "新建一个空白性格", onClick: function () { void manage("create", "已新建性格并切换使用。"); } }, "新建"),
					h("button", { className: "dsh-tavern-btn", disabled: state.busy || active === null, title: "复制当前性格", onClick: function () { void manage("duplicate", "已复制并切换使用。"); } }, "复制"),
					h("button", { className: "dsh-tavern-btn", disabled: state.busy || active === null, onClick: function () { void manage("rename", "已重命名。"); } }, "重命名"),
					h("button", { className: "dsh-tavern-btn danger", disabled: state.busy || active === null, onClick: function () { void manage("delete", "性格已删除，已切换为空白。"); } }, "删除")),
				h("div", { className: "dsh-tavern-preset-detail dsh-tavern-system-prompt-body" },
					state.notice ? h("div", { className: "dsh-tavern-system-prompt-status", role: "status" }, state.notice) : null,
					state.error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, state.error) : null,
					body));
		}

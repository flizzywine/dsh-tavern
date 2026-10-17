		function SystemPromptSidebarTab() {
            const askConfirm = useTavernConfirm();
			const h = React.createElement;
			const [state, setState] = React.useState({ loading: true, busy: false, prompts: [], systemAppendEnabled: false, drafts: {}, error: "", notice: "" });
			const importInput = React.useRef(null);
			function accept(result, notice, name) {
				const value = result && result.systemPrompts || {};
				setState(function (current) {
                        const drafts = name ? Object.assign({}, current.drafts) : {};
                        if (name) delete drafts[name];
                        return { loading: false, busy: false, prompts: Array.isArray(value.prompts) ? value.prompts : [], systemAppendEnabled: value.systemAppendEnabled === true, drafts: drafts, error: "", notice: notice || "" };
                    });
			}
			async function load() {
				try { accept(await rpc("getSystemPrompts"), ""); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { loading: false, error: String(error && error.message || error) }); }); }
			}
			React.useEffect(function () { void load(); }, []);
			function draft(item) { return Object.prototype.hasOwnProperty.call(state.drafts, item.name) ? state.drafts[item.name] : String(item.text || ""); }
			function edit(name, value) { setState(function (current) { return Object.assign({}, current, { drafts: Object.assign({}, current.drafts, { [name]: value }), error: "", notice: "" }); }); }
			async function toggleSystemAppend(enabled) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try {
					const result = await rpc("updateTavernSettings", { patch: { systemAppendEnabled: enabled } });
					setState(function (current) { return Object.assign({}, current, { busy: false, systemAppendEnabled: result.settings.systemAppendEnabled === true, notice: enabled ? "已开启，将从下一次请求开始生效。" : "已关闭，已保存的内容仍然保留。" }); });
				} catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}

			async function save(item) {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("updateSystemPrompt", { name: item.name, text: draft(item) }), item.name === "system-append" && !state.systemAppendEnabled ? "内容已保存，开启开关后生效。" : "已保存，将从下一次相关调用开始生效。", item.name); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function restore(item) {
				if (!item.customized) { edit(item.name, String(item.text || "")); return; }
				if (!await askConfirm("恢复“" + item.label + "”的系统默认内容？")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("updateSystemPrompt", { name: item.name, text: null }), "已恢复该项默认内容。", item.name); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function restoreAll() {
				if (!await askConfirm("恢复全部系统提示词为当前版本默认内容？此操作会清除全部自定义修改。")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("resetSystemPrompts"), "全部系统提示词已恢复默认。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function importFile(file) {
				if (!file || !await askConfirm("导入将覆盖当前整套系统提示词，是否继续？")) return;
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try { accept(await rpc("importSystemPrompts", { payload: await parseTextResourceFile(file) }), "整套系统提示词已导入，附加指令按开关状态生效。"); }
				catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			async function exportFile() {
				setState(function (current) { return Object.assign({}, current, { busy: true, error: "", notice: "" }); });
				try {
					const result = await rpc("exportSystemPrompts");
					const blob = new Blob([result.text], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
					link.href = url; link.download = result.name || "dsh-tavern-system-prompts.json"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
					setState(function (current) { return Object.assign({}, current, { busy: false, notice: "已导出当前整套系统提示词。" }); });
				} catch (error) { setState(function (current) { return Object.assign({}, current, { busy: false, error: String(error && error.message || error) }); }); }
			}
			function row(item) {
				const value = draft(item); const dirty = value !== String(item.text || "");
				return h("details", { key: item.name, className: "dsh-tavern-prompt-row dsh-tavern-system-prompt-row role-system" },
					h("summary", { className: "dsh-tavern-prompt-head" }, h("span", { className: "dsh-tavern-prompt-title" }, h("b", null, item.label), h("span", null, item.description)), item.name === "system-append" ? h("button", { type: "button", role: "switch", className: "dsh-tavern-prompt-state is-toggle " + (state.systemAppendEnabled ? "on" : "off"), disabled: state.busy, title: state.systemAppendEnabled ? "点击关闭附加指令" : "点击开启附加指令", "aria-label": "启用 system 附加指令", "aria-checked": state.systemAppendEnabled === true, onClick: function (event) { event.preventDefault(); event.stopPropagation(); void toggleSystemAppend(!state.systemAppendEnabled); } }) : h("span", { className: "dsh-tavern-prompt-state " + (item.customized ? "on" : "off") }, item.customized ? "已修改" : "默认")),
					h("div", { className: "dsh-tavern-prompt-editor" },
						h("label", { className: "dsh-tavern-prompt-editor-field full" }, "内容", h("textarea", { value: value, disabled: state.busy, onChange: function (event) { edit(item.name, event.target.value); }, "aria-label": item.label })),
						h("div", { className: "dsh-tavern-prompt-editor-actions" }, h("button", { className: "dsh-tavern-btn", disabled: state.busy || (!item.customized && !dirty), onClick: function () { void restore(item); } }, "恢复默认"), h("button", { className: "dsh-tavern-btn", disabled: state.busy || !dirty || (value.trim() === "" && item.name !== "system-append"), onClick: function () { void save(item); } }, "保存此项"))));
			}
			return h("div", { className: "dsh-tavern-presets" },
				h("div", { className: "dsh-tavern-status-head dsh-tavern-system-prompt-head" },
					h("div", { className: "dsh-tavern-status-title" }, "系统提示词"),
					h("div", { className: "dsh-tavern-question-sub" }, "DSH Tavern 当前使用的唯一一套内置提示词"),
					h("div", { className: "dsh-tavern-system-prompt-top-actions" }, h("button", { className: "dsh-tavern-btn", disabled: state.busy, onClick: function () { importInput.current && importInput.current.click(); } }, "导入 JSON"), h("button", { className: "dsh-tavern-btn", disabled: state.busy, onClick: function () { void exportFile(); } }, "导出 JSON"), h("input", { ref: importInput, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: function (event) { const file = event.target.files && event.target.files[0]; void importFile(file); event.target.value = ""; } }))),
				h("div", { className: "dsh-tavern-preset-detail dsh-tavern-system-prompt-body" },
					h("div", { className: "dsh-tavern-system-prompt-warning", role: "note" }, "修改系统提示词可能导致正文生成异常、人物卡指令冲突、后台任务失败或输出格式失效。不了解其作用时请保持默认；出现问题时请恢复默认。"),
					h("div", { className: "dsh-tavern-preset-detail-actions" }, h("button", { className: "dsh-tavern-btn danger", disabled: state.busy || !state.prompts.some(function (item) { return item.customized; }), onClick: function () { void restoreAll(); } }, "全部恢复默认")),
					state.notice ? h("div", { className: "dsh-tavern-system-prompt-status", role: "status" }, state.notice) : null,
					state.error ? h("div", { className: "dsh-tavern-dock-error", role: "alert" }, state.error) : null,
					state.loading ? h("div", { className: "dsh-tavern-status-empty" }, "正在读取系统提示词…") : state.prompts.map(row)));
		}

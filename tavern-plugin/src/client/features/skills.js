		function TavernSkillsTab(props) {
            const askConfirm = useTavernConfirm(props.sessionId || props.scope?.sessionId);
			const h = React.createElement;
			const [skills, setSkills] = React.useState([]);
			const [opened, setOpened] = React.useState(null);
            const [skillDraft, setSkillDraft] = React.useState(null);
            const [skillPreview, setSkillPreview] = React.useState(false);
            const [dragging, setDragging] = React.useState(null);
            const [dropGroup, setDropGroup] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [notice, setNotice] = React.useState("");
			const importInput = React.useRef(null);
			const [error, setError] = usePersistentError("Skill 库");
			const roles = [["card", "卡片 Agent"], ["foreground", "前台"], ["background", "后台"]];
			async function refresh() {
				const result = await rpc("listSkills", {}, props.sessionId);
				setSkills(result.skills || []);
			}
			// A single SKILL.md, or a .zip of the skill folder (SKILL.md plus references/*.md).
			async function importSkill(file) {
				if (!file) return;
				const zip = /\.zip$/i.test(file.name);
				if (!zip && !/\.md$/i.test(file.name)) throw new Error("请选择 SKILL.md 或 Skill 文件夹的 .zip 压缩包");
				if (file.size > 20 * 1024 * 1024) throw new Error("文件不能超过 20 MB");
				const bytes = new Uint8Array(await file.arrayBuffer());
				const payload = zip ? { fileB64: bytesToBase64(bytes) } : { text: decodeTextResource(bytes.buffer) };
				let result = await rpc("importSkill", payload, props.sessionId);
				if (result.conflict) {
					if (!await askConfirm("已有同名 Skill「" + result.name + "」，用导入的版本覆盖？")) return;
					result = await rpc("importSkill", Object.assign({ overwrite: true }, payload), props.sessionId);
				}
				await refresh();
				const skipped = Array.isArray(result.skipped) && result.skipped.length ? "；忽略了 " + result.skipped.length + " 个非 references/*.md 文件" : "";
				setNotice("已导入 Skill「" + result.skill.name + "」" + (result.skill.overwritten ? "（已覆盖）" : "") + skipped);
			}
			async function run(action) {
				setBusy(true); setError(""); setNotice("");
				try { await action(); } catch (err) { setError(String(err.message || err)); }
				finally { setBusy(false); }
			}
			React.useEffect(function () {
				run(refresh);
				function update() { refresh().catch(err => setError(String(err.message || err))); }
				window.addEventListener("focus", update);
				return function () { window.removeEventListener("focus", update); };
			}, [props.sessionId]);
            if (opened) {
                const document = skillDraft || opened;
                const markdown = text => h(DshUi.MarkdownText, { text, labels: { code: { copyLabel: "复制", copiedLabel: "已复制" }, footnotes: "脚注" } });
                const editor = (label, value, onChange) => h("textarea", { className: "dsh-skill-editor", "aria-label": label, value, disabled: busy, spellCheck: false, onChange: e => onChange(e.target.value) });
                return h("div", { className: "dsh-tavern-resources dsh-tavern-skills" },
                    h("div", { className: "dsh-tavern-status-head dsh-skill-toolbar" },
                        h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: async () => { if (skillDraft && !await askConfirm("放弃未保存的修改？")) return; setSkillDraft(null); setOpened(null); } }, "← 返回"),
                        h("div", { className: "dsh-tavern-status-title" }, opened.skill.name),
                        h("span", { className: "dsh-tavern-spacer" }),
                        skillDraft ? h(React.Fragment, null,
                            h("button", { className: "dsh-tavern-btn", onClick: () => setSkillPreview(!skillPreview) }, skillPreview ? "继续编辑" : "预览"),
                            h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => setSkillDraft(null) }, "取消"),
                            h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(async () => { await rpc("editSkill", { name: opened.skill.name, content: skillDraft.skill.content, references: skillDraft.references }, props.sessionId); setOpened(await rpc("getSkill", { name: opened.skill.name }, props.sessionId)); setSkillDraft(null); await refresh(); }) }, busy ? "保存中…" : "保存")
                        ) : h("button", { className: "dsh-tavern-btn", onClick: () => { setSkillPreview(false); setSkillDraft(JSON.parse(JSON.stringify(opened))); } }, "编辑")),
                    error ? h("p", { role: "alert", className: "dsh-tavern-dock-error" }, error) : null,
                    h("div", { className: "dsh-tavern-resource-body dsh-tavern-skill-content" },
                        h("article", { className: "dsh-skill-document" },
                            skillDraft && !skillPreview ? editor("Skill 正文", document.skill.content, content => setSkillDraft({ ...skillDraft, skill: { ...skillDraft.skill, content } })) : markdown(document.skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""))),
                        (document.references || []).map(ref => h("details", { key: ref.path, className: "dsh-skill-reference" },
                            h("summary", null, ref.path),
                            h("div", { className: "dsh-skill-document" }, skillDraft && !skillPreview ? editor(ref.path, ref.content, content => setSkillDraft({ ...skillDraft, references: skillDraft.references.map(item => item.path === ref.path ? { ...item, content } : item) })) : markdown(ref.content))))));
            }
			return h("div", { className: "dsh-tavern-resources dsh-tavern-skills" },
				h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "Skill 库"),
					h("input", { ref: importInput, type: "file", accept: ".md,.zip,text/markdown,application/zip", hidden: true, onChange: event => { const file = event.target.files && event.target.files[0]; event.target.value = ""; run(() => importSkill(file)); } }),
					h("button", { className: "dsh-tavern-btn", disabled: busy, title: "导入 SKILL.md，或包含 SKILL.md 与 references/ 的文件夹压缩包", onClick: () => importInput.current && importInput.current.click() }, "导入 Skill"),
					h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => run(refresh) }, "刷新")),
				h("p", { className: "dsh-tavern-question-sub" }, "拖动 Skill 调整用途，不需要的 Skill 可直接删除。"),
				error ? h("div", { className: "dsh-tavern-dock-error" }, error) : null,
				notice ? h("p", { role: "status", className: "dsh-tavern-question-sub" }, notice) : null,
				h("div", { className: "dsh-tavern-resource-body" }, roles.map(([group, title]) => {
                    const items = skills.filter(skill => skill.agents.includes(group) || (!skill.agents.length && group === (skill.purpose === "writing" ? "foreground" : skill.purpose === "background" || skill.purpose === "image" ? "background" : "card")));
                    return h("details", { key: group, open: true, className: "dsh-tavern-skill-group" + (dropGroup === group ? " is-drop-target" : ""),
                        onDragOver: event => { if (!dragging || busy) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropGroup(group); },
                        onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropGroup(null); },
                        onDrop: event => {
                            event.preventDefault(); setDropGroup(null); setDragging(null);
                            if (!dragging || busy || dragging.group === group) return;
                            const skill = skills.find(item => item.name === dragging.name);
                            if (!skill) return;
                            const agents = Array.from(new Set(skill.agents.filter(role => role !== dragging.group).concat(group)));
                            run(async () => { await rpc("assignSkill", { name: skill.name, agents }, props.sessionId); await refresh(); });
                        } },
                        h("summary", null, title, h("span", { className: "dsh-tavern-skill-count" }, items.length)),
                        items.length ? items.map(skill => h("section", { key: skill.name, draggable: !busy, className: "dsh-tavern-skill-row" + (dragging?.name === skill.name && dragging.group === group ? " is-dragging" : ""),
                            onDragStart: event => { event.dataTransfer.setData("text/plain", skill.name); event.dataTransfer.effectAllowed = "move"; setDragging({ name: skill.name, group }); },
                            onDragEnd: () => { setDragging(null); setDropGroup(null); } },
					h("div", { className: "dsh-tavern-resource-group-title" }, h("span", { className: "dsh-tavern-skill-grip", "aria-hidden": true }, "⠿"), h("button", { className: "dsh-tavern-resource-name dsh-tavern-resource-open", disabled: busy, onClick: () => run(async () => setOpened(await rpc("getSkill", { name: skill.name }, props.sessionId))) }, skill.name), h("span", { className: "dsh-tavern-resource-meta" }, skill.source === "builtin" ? "内置" : "自建"), h("button", { className: "dsh-tavern-resource-at", disabled: busy, onClick: async () => { if (await askConfirm("删除 Skill “" + skill.name + "”及其参考文件？")) run(async () => { await rpc("deleteSkill", { name: skill.name }, props.sessionId); await refresh(); }); } }, "删除")),
					h("button", { type: "button", className: "dsh-tavern-question-sub dsh-tavern-skill-description", disabled: busy, onClick: () => run(async () => setOpened(await rpc("getSkill", { name: skill.name }, props.sessionId))) }, skill.description),
					h("details", { className: "dsh-tavern-skill-options" }, h("summary", null, "调整用途"), h("div", { className: "dsh-tavern-skill-assignments" }, roles.map(([role, label]) => h("label", { key: role }, h("input", { type: "checkbox", checked: skill.agents.includes(role), disabled: busy || skill.agents.length === 1 && skill.agents.includes(role), onChange: event => { const agents = event.target.checked ? skill.agents.concat(role) : skill.agents.filter(value => value !== role); run(async () => { await rpc("assignSkill", { name: skill.name, agents }, props.sessionId); await refresh(); }); } }), label))))
                    )) : h("div", { className: "dsh-tavern-skill-empty" }, "拖动 Skill 到这里"));
                }), !skills.length ? (busy ? h(PanelLoading, { label: "正在读取 Skill…" }) : h(EmptyState, { noun: "Skill" })) : null));
		}

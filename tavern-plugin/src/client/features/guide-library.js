        function GuideLibraryTab(props) {
            const h = React.createElement;
            const sessionId = props.scope?.sessionId;
            const [editing, setEditing] = React.useState(null);
            const [drafts, setDrafts] = React.useState([]);
            const [items, setItems] = React.useState(null);
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState("");
            const [error, setError] = React.useState("");
            const askConfirm = useTavernConfirm(sessionId);
            async function refresh() {
                setError("");
                try { setItems((await rpc("listGuideLibrary", {}, sessionId)).items); }
                catch (err) { setError(String(err.message || err)); }
            }
            React.useEffect(() => {
                refresh();
                const onData = event => { if (tavernDataChangeAffects(event, ["guide-library"], "guide-library")) refresh(); };
                window.addEventListener("dsh-tavern-data-changed", onData);
                return () => window.removeEventListener("dsh-tavern-data-changed", onData);
            }, [sessionId]);
            async function load(id) {
                setBusy(true); setError(""); setNotice("");
                try {
                    await rpc("loadGuideLibrary", { id }, sessionId);
                    liveTavernView.invalidate(sessionId);
                    setNotice("已加载到本局，保留已有指导并跳过重复内容。");
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            async function update(item, patch) {
                setBusy(true); setError(""); setNotice("");
                try {
                    await rpc("updateGuideLibrary", { id: item.id, expected: item, ...patch }, sessionId);
                    setEditing(null); await refresh();
                    notifyTavernDataChanged(["guide-library"], "guide-library");
                    setNotice("已保存到 Guide 库，已加载到游戏的指导不变。");
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            async function remove(item) {
                if (!await askConfirm("删除 Guide 方案“" + item.name + "”吗？\n已加载到游戏的指导不受影响。")) return;
                setBusy(true); setError(""); setNotice("");
                try {
                    await rpc("deleteGuideLibrary", { id: item.id, expected: item }, sessionId);
                    await refresh();
                    notifyTavernDataChanged(["guide-library"], "guide-library");
                    setNotice("已从 Guide 库删除该方案。");
                } catch (err) { setError(String(err.message || err)); }
                finally { setBusy(false); }
            }
            async function rename(item) {
                const name = await askTavernText({ title: "重命名 Guide 方案", initialValue: item.name, maxLength: 80 });
                if (name && name !== item.name) await update(item, { name });
            }
            return h("div", { className: "dsh-tavern-user-profile" },
                h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "Guide 库"), h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: refresh }, "刷新")),
                h("div", { className: "dsh-tavern-user-profile-body" },
                    h("p", { className: "dsh-tavern-settings-desc" }, "Guide 会注入模型上下文，用来引导剧情走向和文风。在酒馆状态中保存本局 Guide，在这里选择方案加载。加载会追加到本局，不替换已有指导。"),
                    error ? h("p", { role: "alert" }, error) : null,
                    notice ? h("p", { role: "status" }, notice) : null,
                    items === null ? h(PanelLoading, { label: "正在读取 Guide 库…" }) : !items.length ? h(EmptyState, { noun: "方案" }) : items.map(item =>
                        h("section", { key: item.id, className: "dsh-tavern-guide-library" },
                            h("div", { className: "dsh-tavern-guide-heading" }, h("h3", null, item.name), h("button", { className: "dsh-tavern-btn", disabled: busy || !!editing, onClick: () => rename(item) }, "重命名")),
                            editing?.id === item.id ? null : h("details", null, h("summary", null, "查看指导（" + item.guides.length + " 条）"), item.guides.map((text, index) => h("p", { key: index, className: "dsh-tavern-guide-text" }, text))),
                            editing?.id === item.id ? h("div", { className: "dsh-tavern-guide-editor" },
                                h("p", { className: "dsh-tavern-settings-desc" }, "可增加、删除或修改 Guide，点击保存修改后生效。"),
                                drafts.map((text, index) => h("div", { key: index },
                                    h("label", null, "Guide " + (index + 1), h("textarea", { className: "dsh-tavern-regen-input", rows: 3, value: text, maxLength: 2000, disabled: busy, onChange: event => setDrafts(drafts.map((value, n) => n === index ? event.target.value : value)) })),
                                    h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => setDrafts(drafts.filter((_, n) => n !== index)) }, "删除这条 Guide"))),
                                h("div", { className: "dsh-tavern-guide-actions" },
                                    h("button", { className: "dsh-tavern-btn", disabled: busy || drafts.length >= 20, onClick: () => setDrafts([...drafts, ""]) }, "添加 Guide"),
                                    h("button", { className: "dsh-tavern-btn", disabled: busy || !drafts.length || drafts.some(text => !text.trim()), onClick: () => update(editing, { guides: drafts }) }, "保存修改"),
                                    h("button", { className: "dsh-tavern-btn", disabled: busy, onClick: () => setEditing(null) }, "取消"))) : h("div", { className: "dsh-tavern-guide-actions" },
                                h("button", { className: "dsh-tavern-btn primary", disabled: busy || !!editing || !sessionId, onClick: () => load(item.id) }, "加载到本局"),
                                h("button", { className: "dsh-tavern-btn", disabled: busy || !!editing, onClick: () => { setEditing(item); setDrafts([...item.guides]); setError(""); setNotice(""); } }, "修改"),
                                h("button", { className: "dsh-tavern-btn danger", disabled: busy || !!editing, onClick: () => remove(item) }, "删除方案"))))));
        }

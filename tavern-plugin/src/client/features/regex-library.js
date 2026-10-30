        // Regex manager: global rules plus the conversation's preset/card rules.
        // Preset/card switches are conversation overrides and never rewrite the source file.
        const REGEX_PLACEMENTS = [
            { id: 1, label: "用户输入" },
            { id: 2, label: "AI 输出" },
            { id: 3, label: "斜杠命令" },
            { id: 5, label: "世界书" },
            { id: 6, label: "推理" }
        ];
        const REGEX_SAMPLE = [
            "【章节】3",
            "",
            "【旁白】雨声贴着窗棂滑下去，像有人在玻璃外面数着拍子。",
            "",
            "<thinking>她大概会问灯塔的事，先埋一个线索，不要一次说完。</thinking>",
            "",
            "「你终于来了。」她把灯芯挑亮了一点，火苗在玻璃罩里抖了抖。",
            "",
            "<!--LOG: settlement ok · affection +1-->",
            "",
            "[[VAR:affection=37]]",
            "",
            "<!--STATE_BEGIN-->",
            "地点：灯塔二层",
            "时间：雨夜",
            "天气：暴雨",
            "<!--STATE_END-->",
            "",
            "<details><summary>选项</summary>",
            "1. 问她为什么把灯留给你",
            "2. 先检查窗台上的水痕",
            "</details>"
        ].join("\n");

        function regexCompile(value) {
            const source = String(value === null || value === undefined ? "" : value);
            const match = source.match(/(\/?)(.+)\1([a-z]*)/i);
            if (match === null) return new RegExp(source);
            try { return new RegExp(match[2], match[3]); } catch (_error) { return new RegExp(source); }
        }

        function regexValidationError(value) {
            if (String(value || "").trim() === "") return "查找正则不能为空";
            try { regexCompile(value); return ""; }
            catch (error) { return "正则无效：" + String(error && error.message || error); }
        }

        function regexEntryScript(entry) {
            return {
                id: entry.id,
                name: entry.name,
                findRegex: entry.findRegex,
                replaceString: entry.replaceString,
                trimStrings: Array.isArray(entry.trimStrings) ? entry.trimStrings.slice() : [],
                placement: Array.isArray(entry.placement) ? entry.placement.slice() : [],
                markdownOnly: entry.markdownOnly === true,
                promptOnly: entry.promptOnly === true,
                runOnEdit: entry.runOnEdit === true,
                minDepth: entry.minDepth === undefined ? null : entry.minDepth,
                maxDepth: entry.maxDepth === undefined ? null : entry.maxDepth,
                enabled: entry.enabled !== false
            };
        }

        function regexDraftFromEntry(entry) {
            return {
                key: entry.key,
                id: entry.id,
                name: entry.name || "",
                findRegex: entry.findRegex || "",
                replaceString: entry.replaceString || "",
                placement: Array.isArray(entry.placement) ? entry.placement.slice() : [],
                markdownOnly: entry.markdownOnly === true,
                promptOnly: entry.promptOnly === true,
                runOnEdit: entry.runOnEdit === true,
                trimText: (Array.isArray(entry.trimStrings) ? entry.trimStrings : []).join(", "),
                minText: entry.minDepth === null || entry.minDepth === undefined ? "" : String(entry.minDepth),
                maxText: entry.maxDepth === null || entry.maxDepth === undefined ? "" : String(entry.maxDepth),
                enabled: entry.enabled !== false
            };
        }

        function regexNewDraft() {
            return {
                key: "__new__", id: "", name: "", findRegex: "", replaceString: "",
                placement: [2], markdownOnly: false, promptOnly: false, runOnEdit: false,
                trimText: "", minText: "", maxText: "", enabled: true
            };
        }

        function regexNumberOrNull(value) {
            if (value === null || value === undefined || value === "") return null;
            const number = Number(value);
            return Number.isFinite(number) && number >= 0 ? number : null;
        }

        function regexDraftScript(draft) {
            return {
                id: draft.id,
                name: String(draft.name || "").trim() || "未命名正则",
                findRegex: draft.findRegex,
                replaceString: draft.replaceString,
                trimStrings: String(draft.trimText || "").split(",").map(function (part) { return part.trim(); }).filter(Boolean),
                placement: (draft.placement || []).map(Number).filter(function (id) { return REGEX_PLACEMENTS.some(function (item) { return item.id === id; }); }),
                markdownOnly: draft.markdownOnly === true,
                promptOnly: draft.promptOnly === true,
                runOnEdit: draft.runOnEdit === true,
                minDepth: regexNumberOrNull(draft.minText),
                maxDepth: regexNumberOrNull(draft.maxText),
                enabled: draft.enabled !== false
            };
        }

        function regexDraftSignature(draft) {
            return JSON.stringify([
                String(draft.name || ""), String(draft.findRegex || ""), String(draft.replaceString || ""),
                (draft.placement || []).map(Number).sort(function (left, right) { return left - right; }),
                draft.markdownOnly === true, draft.promptOnly === true, draft.runOnEdit === true,
                String(draft.trimText || ""), String(draft.minText || ""), String(draft.maxText || "")
            ]);
        }

        function regexPlacementText(entry) {
            const values = (entry.placement || []).map(Number);
            const labels = REGEX_PLACEMENTS.filter(function (item) { return values.includes(item.id); }).map(function (item) { return item.label; });
            return labels.length ? labels.join(" / ") : "未选作用位置";
        }

        function regexLayerText(entry) {
            if (entry.markdownOnly === true && entry.promptOnly === true) return "显示 + 上下文";
            if (entry.markdownOnly === true) return "仅显示层";
            if (entry.promptOnly === true) return "仅上下文层";
            return "永久替换";
        }

        function regexSourceLabel(source) {
            return source === "preset" ? "预设" : source === "card" ? "人物卡" : "全局";
        }

        function RegexLibraryTab(props) {
            const h = React.createElement;
            const sessionId = props.scope?.sessionId;
            const askConfirm = useTavernConfirm(sessionId);
            const [data, setData] = React.useState(null);
            const [error, setError] = usePersistentError("正则库");
            const [notice, setNotice] = React.useState("");
            const [busy, setBusy] = React.useState(false);
            const [query, setQuery] = React.useState("");
            const [filter, setFilter] = React.useState("all");
            const [stateFilter, setStateFilter] = React.useState("all");
            const [selected, setSelected] = React.useState(function () { return new Set(); });
            const [openKeys, setOpenKeys] = React.useState(function () { return new Set(); });
            const [drafts, setDrafts] = React.useState({});
            const [newDraft, setNewDraft] = React.useState(null);
            const [formError, setFormError] = React.useState("");
            const [tests, setTests] = React.useState({});
            const [chainOpen, setChainOpen] = React.useState(false);
            const [chainInput, setChainInput] = React.useState(REGEX_SAMPLE);
            const [chainLayer, setChainLayer] = React.useState("display");
            const [chainResult, setChainResult] = React.useState(null);
            const importInput = React.useRef(null);

            const load = React.useCallback(async function () {
                setError("");
                try {
                    const result = await rpc("getRegexManager", {}, sessionId);
                    setData(result);
                    setChainResult(null);
                    if (result.migrated > 0) setNotice("已将 " + result.migrated + " 条旧正则迁入全局，默认停用。");
                    else if (result.warning) setNotice(result.warning);
                } catch (err) { setError(String(err && err.message || err)); }
            }, [sessionId]);
            useVisibleDataRefresh(props.visible, function (event) {
                return tavernDataChangeAffects(event, ["regex-library", "sessions", "cards", "presets"], "regex-library");
            }, load, sessionId);
            React.useEffect(function () {
                setOpenKeys(new Set());
                setDrafts({});
                setNewDraft(null);
                setTests({});
                setChainResult(null);
                setStateFilter("all");
                setSelected(new Set());
                setFormError("");
            }, [sessionId]);
            // A batch selection only applies to the view it was made in; changing
            // source, state or search clears it instead of acting on hidden rows.
            React.useEffect(function () { setSelected(new Set()); }, [query, filter, stateFilter]);

            async function writeGlobal(scripts, success) {
                if (!data) return null;
                setBusy(true); setError("");
                try {
                    const result = await rpc("writeGlobalRegexes", { revision: data.revision, scripts: scripts }, sessionId);
                    setData(function (current) { return current ? { ...current, global: result.global, revision: result.revision } : current; });
                    setChainResult(null);
                    notifyTavernDataChanged(["regex-library", "sessions"], "regex-library");
                    if (success) setNotice(success);
                    return result;
                } catch (err) { setError(String(err && err.message || err)); return null; }
                finally { setBusy(false); }
            }

            async function saveDraft(entry) {
                const draft = entry ? drafts[entry.key] : newDraft;
                if (!draft) return;
                const message = regexValidationError(draft.findRegex);
                if (message) { setFormError(message); return; }
                setFormError("");
                const script = regexDraftScript(draft);
                const scripts = (data?.global || []).map(regexEntryScript);
                if (entry) {
                    const index = scripts.findIndex(function (item) { return item.id === entry.id; });
                    if (index === -1) { setError("这条正则已不存在，请刷新后重试"); return; }
                    scripts[index] = { ...scripts[index], ...script, id: entry.id };
                } else {
                    delete script.id;
                    scripts.push(script);
                }
                const result = await writeGlobal(scripts, entry ? "已保存「" + script.name + "」。" : "已新建「" + script.name + "」。");
                if (!result) return;
                if (entry) {
                    setDrafts(function (current) { const next = { ...current }; delete next[entry.key]; return next; });
                    setOpenKeys(function (current) { const next = new Set(current); next.delete(entry.key); return next; });
                } else {
                    setNewDraft(null);
                    setStateFilter("all");
                    const added = result.global[result.global.length - 1];
                    if (added) {
                        setOpenKeys(function (current) { return new Set(current).add(added.key); });
                        setDrafts(function (current) { return { ...current, [added.key]: regexDraftFromEntry(added) }; });
                    }
                }
            }

            async function removeEntry(entry) {
                if (!await askConfirm("删除全局正则「" + entry.name + "」吗？\n删除后所有存档都不再应用这条规则。")) return;
                const result = await writeGlobal((data?.global || []).filter(function (item) { return item.key !== entry.key; }).map(regexEntryScript), "已删除「" + entry.name + "」。");
                if (!result) return;
                setDrafts(function (current) { const next = { ...current }; delete next[entry.key]; return next; });
                setOpenKeys(function (current) { const next = new Set(current); next.delete(entry.key); return next; });
                setSelected(function (current) { const next = new Set(current); next.delete(selectionId("global", entry.key)); return next; });
            }

            async function duplicateEntry(entry) {
                const script = { ...regexEntryScript(entry), name: entry.name + " 副本", enabled: false };
                delete script.id;
                const result = await writeGlobal([...(data?.global || []).map(regexEntryScript), script], "已复制一条全局正则（默认停用）。");
                if (!result) return;
                setStateFilter("all");
                const added = result.global[result.global.length - 1];
                if (added) setOpenKeys(function (current) { return new Set(current).add(added.key); });
            }

            async function moveEntry(entry, delta) {
                const scripts = (data?.global || []).map(regexEntryScript);
                const index = (data?.global || []).findIndex(function (item) { return item.key === entry.key; });
                const target = index + delta;
                if (index < 0 || target < 0 || target >= scripts.length) return;
                const moved = scripts.splice(index, 1)[0];
                scripts.splice(target, 0, moved);
                await writeGlobal(scripts);
            }

            async function toggleGlobal(entry) {
                const scripts = (data?.global || []).map(function (item) {
                    return item.key === entry.key ? { ...regexEntryScript(item), enabled: !item.enabled } : regexEntryScript(item);
                });
                const result = await writeGlobal(scripts);
                if (result) {
                    setDrafts(function (current) {
                        if (!current[entry.key]) return current;
                        return { ...current, [entry.key]: { ...current[entry.key], enabled: !entry.enabled } };
                    });
                }
            }

            function applyOverrides(source, overrides) {
                const map = overrides && overrides[source] && typeof overrides[source] === "object" ? overrides[source] : {};
                setData(function (current) {
                    if (!current) return current;
                    const group = current[source];
                    if (!group) return { ...current, overrides };
                    const scripts = group.scripts.map(function (entry) {
                        const has = Object.prototype.hasOwnProperty.call(map, entry.key);
                        return { ...entry, overridden: has, enabled: has ? map[entry.key] === true : entry.sourceEnabled };
                    });
                    return { ...current, overrides, [source]: { ...group, scripts } };
                });
            }

            async function setOverride(source, entry, enabled) {
                setBusy(true); setError("");
                try {
                    const result = await rpc("setRegexOverride", { source: source, key: entry.key, enabled: enabled }, sessionId);
                    applyOverrides(source, result.overrides);
                    setChainResult(null);
                    notifyTavernDataChanged(["regex-library", "sessions"], "regex-library");
                    setNotice(enabled === null ? "已恢复跟随来源设置。" : enabled ? "已在本局启用「" + entry.name + "」。" : "已在本局停用「" + entry.name + "」。");
                } catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }

            async function copyToGlobal(entry) {
                const script = { ...regexEntryScript(entry), name: entry.name + "（全局副本）", enabled: false };
                delete script.id;
                const result = await writeGlobal([...(data?.global || []).map(regexEntryScript), script], "已复制到全局正则（默认停用）。");
                if (!result) return;
                setStateFilter("all");
                const added = result.global[result.global.length - 1];
                if (added) setOpenKeys(function (current) { return new Set(current).add(added.key); });
            }

            function exportScript(entry) {
                const script = regexEntryScript(entry);
                return {
                    id: script.id, scriptName: script.name, findRegex: script.findRegex, replaceString: script.replaceString,
                    trimStrings: script.trimStrings, placement: script.placement, disabled: script.enabled === false,
                    markdownOnly: script.markdownOnly, promptOnly: script.promptOnly, runOnEdit: script.runOnEdit,
                    minDepth: script.minDepth === null ? undefined : script.minDepth,
                    maxDepth: script.maxDepth === null ? undefined : script.maxDepth
                };
            }

            function exportAll() {
                const payload = (data?.global || []).map(exportScript);
                downloadTavernBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), "tavern-regex.json");
                setNotice("已导出 " + payload.length + " 条全局正则。");
            }

            function bulkExport() {
                if (selectedEntries.length === 0) return;
                const payload = selectedEntries.map(function (item) { return exportScript(item.entry); });
                downloadTavernBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }), "tavern-regex-selected.json");
                setNotice("已导出 " + payload.length + " 条正则。");
            }

            async function bulkSetEnabled(enabled) {
                if (selectedEntries.length === 0) return;
                setBusy(true); setError("");
                try {
                    const globals = selectedEntries.filter(function (item) { return item.source === "global"; });
                    const others = selectedEntries.filter(function (item) { return item.source !== "global"; });
                    if (globals.length > 0) {
                        const keys = new Set(globals.map(function (item) { return item.entry.key; }));
                        const scripts = (data?.global || []).map(function (script) {
                            const value = regexEntryScript(script);
                            return keys.has(script.key) ? { ...value, enabled: enabled } : value;
                        });
                        const result = await rpc("writeGlobalRegexes", { revision: data.revision, scripts: scripts }, sessionId);
                        setData(function (current) { return current ? { ...current, global: result.global, revision: result.revision } : current; });
                    }
                    if (others.length > 0) {
                        const changes = others.map(function (item) { return { source: item.source, key: item.entry.key, enabled: enabled }; });
                        const result = await rpc("setRegexOverrides", { changes: changes }, sessionId);
                        applyOverrides("preset", result.overrides);
                        applyOverrides("card", result.overrides);
                    }
                    setSelected(new Set());
                    setChainResult(null);
                    notifyTavernDataChanged(["regex-library", "sessions"], "regex-library");
                    setNotice((enabled ? "已启用 " : "已停用 ") + selectedEntries.length + " 条正则。");
                } catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }

            async function bulkDelete() {
                const globals = selectedEntries.filter(function (item) { return item.source === "global"; });
                if (globals.length === 0) {
                    setNotice("预设和人物卡的正则来自来源文件，不能在这里删除。");
                    return;
                }
                const keys = new Set(globals.map(function (item) { return item.entry.key; }));
                const skipped = selectedEntries.length - globals.length;
                const scripts = (data?.global || []).filter(function (script) { return !keys.has(script.key); }).map(regexEntryScript);
                const result = await writeGlobal(scripts, "已删除 " + globals.length + " 条全局正则。" + (skipped > 0 ? " 跳过 " + skipped + " 条预设/人物卡规则。" : ""));
                if (result) setSelected(new Set());
            }

            async function importFiles(files) {
                if (!files.length) return;
                setBusy(true); setError(""); setNotice("");
                let count = 0;
                let revision = data?.revision || "";
                try {
                    for (const file of files) {
                        const parsed = await parseTextResourceFile(file);
                        const result = await rpc("importRegexes", { text: parsed.text, fileName: parsed.name.replace(/\.json$/i, ""), revision: revision }, sessionId);
                        count += result.imported;
                        revision = result.revision;
                        setData(function (current) { return current ? { ...current, global: result.global, revision: result.revision } : current; });
                    }
                    setChainResult(null);
                    setStateFilter("all");
                    notifyTavernDataChanged(["regex-library", "sessions"], "regex-library");
                    setNotice("已导入 " + count + " 条正则到全局。");
                } catch (err) { setError((count ? "已导入 " + count + " 条，其余失败：" : "") + String(err && err.message || err)); }
                finally { setBusy(false); }
            }

            function toggleOpen(entry) {
                const open = !openKeys.has(entry.key);
                setOpenKeys(function (current) {
                    const next = new Set(current);
                    if (next.has(entry.key)) next.delete(entry.key); else next.add(entry.key);
                    return next;
                });
                if (open && !drafts[entry.key]) {
                    setDrafts(function (current) {
                        return current[entry.key] ? current : { ...current, [entry.key]: regexDraftFromEntry(entry) };
                    });
                }
                setFormError("");
            }

            function patchDraft(entry, patch) {
                const key = entry ? entry.key : "__new__";
                if (entry) {
                    setDrafts(function (current) {
                        const draft = current[key] || regexDraftFromEntry(entry);
                        return { ...current, [key]: { ...draft, ...patch } };
                    });
                } else {
                    setNewDraft(function (current) { return { ...(current || regexNewDraft()), ...patch }; });
                }
                setFormError("");
            }

            function startNew() {
                setNewDraft(regexNewDraft());
                setFormError("");
                setFilter("all");
                setStateFilter("all");
                setQuery("");
            }

            function setTestInput(key, value) {
                setTests(function (current) {
                    const previous = current[key] || {};
                    return { ...current, [key]: { ...previous, input: value } };
                });
            }

            async function runTest(key, script, layer, input) {
                setBusy(true); setError("");
                try {
                    const result = await rpc("previewRegexScripts", {
                        text: input,
                        scripts: [script],
                        placement: 2,
                        depth: 0,
                        isMarkdown: layer !== "context",
                        isEdit: false
                    }, sessionId);
                    setTests(function (current) { return { ...current, [key]: { input: input, layer: layer, result: result } }; });
                } catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }

            function enabledScripts() {
                const list = []
                    .concat((data?.global || []).filter(function (entry) { return entry.enabled; }).map(function (entry) { return { source: "global", entry: entry }; }))
                    .concat((data?.preset?.scripts || []).filter(function (entry) { return entry.enabled; }).map(function (entry) { return { source: "preset", entry: entry }; }))
                    .concat((data?.card?.scripts || []).filter(function (entry) { return entry.enabled; }).map(function (entry) { return { source: "card", entry: entry }; }));
                return list.filter(function (item) { return !item.entry.invalid; });
            }

            async function runChain() {
                const items = enabledScripts();
                const scripts = items.map(function (item) { return regexEntryScript(item.entry); });
                setBusy(true); setError("");
                try {
                    const result = await rpc("previewRegexScripts", {
                        text: chainInput,
                        scripts: scripts,
                        placement: 2,
                        depth: 0,
                        isMarkdown: chainLayer !== "context",
                        isEdit: false
                    }, sessionId);
                    setChainResult({ result: result, items: items, layer: chainLayer, text: chainInput });
                } catch (err) { setError(String(err && err.message || err)); }
                finally { setBusy(false); }
            }

            const matches = React.useCallback(function (entry) {
                if (stateFilter === "enabled" && entry.enabled !== true) return false;
                if (stateFilter === "disabled" && entry.enabled !== false) return false;
                const needle = query.trim().toLocaleLowerCase();
                if (needle === "") return true;
                return [entry.name, entry.findRegex, entry.replaceString].join(" ").toLocaleLowerCase().includes(needle);
            }, [query, stateFilter]);

            const counts = {
                all: (data?.global?.length || 0) + (data?.preset?.scripts?.length || 0) + (data?.card?.scripts?.length || 0),
                global: data?.global?.length || 0,
                preset: data?.preset?.scripts?.length || 0,
                card: data?.card?.scripts?.length || 0
            };
            const enabledCount = [].concat(data?.global || [], data?.preset?.scripts || [], data?.card?.scripts || []).filter(function (entry) { return entry.enabled; }).length;
            const playMode = data?.mode === "story" || data?.mode === "script";
            const stateEntries = filter === "global" ? (data?.global || [])
                : filter === "preset" ? (data?.preset?.scripts || [])
                    : filter === "card" ? (data?.card?.scripts || [])
                        : [].concat(data?.global || [], data?.preset?.scripts || [], data?.card?.scripts || []);
            const stateCounts = {
                all: stateEntries.length,
                enabled: stateEntries.filter(function (entry) { return entry.enabled; }).length,
                disabled: stateEntries.filter(function (entry) { return !entry.enabled; }).length
            };
            const allEntries = [];
            if (data) {
                (data.global || []).forEach(function (entry) { allEntries.push({ source: "global", entry: entry }); });
                (data.preset?.scripts || []).forEach(function (entry) { allEntries.push({ source: "preset", entry: entry }); });
                (data.card?.scripts || []).forEach(function (entry) { allEntries.push({ source: "card", entry: entry }); });
            }
            const selectedEntries = allEntries.filter(function (item) { return selected.has(item.source + ":" + item.entry.key); });
            const selectedCount = selectedEntries.length;
            const visibleEntries = allEntries.filter(function (item) { return filter === "all" || item.source === filter; }).filter(function (item) { return matches(item.entry); });

            function selectionId(source, key) { return source + ":" + key; }
            function isSelected(source, key) { return selected.has(selectionId(source, key)); }
            function toggleSelected(source, key) {
                setSelected(function (current) {
                    const next = new Set(current);
                    const id = selectionId(source, key);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                });
            }
            function selectAllVisible() {
                setSelected(new Set(visibleEntries.map(function (item) { return selectionId(item.source, item.entry.key); })));
            }
            function clearSelected() { setSelected(new Set()); }

            function switchButton(source, entry) {
                return h("button", {
                    type: "button", role: "switch", disabled: busy,
                    className: "dsh-tavern-rx-switch",
                    "aria-checked": entry.enabled ? "true" : "false",
                    "aria-label": entry.name + (entry.enabled ? " 已启用" : " 已停用"),
                    onKeyDown: function (event) { event.stopPropagation(); },
                    onClick: function (event) {
                        event.preventDefault(); event.stopPropagation();
                        if (source === "global") void toggleGlobal(entry);
                        else void setOverride(source, entry, !entry.enabled);
                    }
                });
            }

            function tagsFor(source, entry, draft) {
                const sourceEntry = draft || entry;
                const tags = [
                    h("span", { key: "placement", className: "dsh-tavern-rx-tag" }, regexPlacementText(sourceEntry)),
                    h("span", { key: "layer", className: "dsh-tavern-rx-tag layer" }, regexLayerText(sourceEntry))
                ];
                if (sourceEntry.runOnEdit) tags.push(h("span", { key: "edit", className: "dsh-tavern-rx-tag" }, "编辑时运行"));
                const minDepth = draft ? draft.minText : sourceEntry.minDepth;
                const maxDepth = draft ? draft.maxText : sourceEntry.maxDepth;
                const hasMin = minDepth !== null && minDepth !== undefined && String(minDepth).trim() !== "";
                const hasMax = maxDepth !== null && maxDepth !== undefined && String(maxDepth).trim() !== "";
                if (hasMin || hasMax) {
                    tags.push(h("span", { key: "depth", className: "dsh-tavern-rx-tag" }, "深度 " + (hasMin ? String(minDepth) : "0") + "–" + (hasMax ? String(maxDepth) : "∞")));
                }
                if (source !== "global" && entry.overridden) tags.push(h("span", { key: "override", className: "dsh-tavern-rx-tag override" }, "本局覆盖"));
                if (source !== "global" && entry.sourceEnabled !== entry.enabled && !entry.overridden) tags.push(h("span", { key: "off", className: "dsh-tavern-rx-tag off" }, "来源已停用"));
                if (source === "global" && draft && regexDraftSignature(draft) !== regexDraftSignature(regexDraftFromEntry(entry))) tags.push(h("span", { key: "dirty", className: "dsh-tavern-rx-tag dirty" }, "未保存"));
                return tags;
            }

            function row(source, entry) {
                const open = openKeys.has(entry.key);
                const checked = isSelected(source, entry.key);
                const draft = source === "global" ? drafts[entry.key] : null;
                const current = draft || entry;
                return h("article", {
                    key: source + ":" + entry.key,
                    className: "dsh-tavern-rx-row" + (open ? " is-open" : "") + (current.enabled ? "" : " is-disabled") + (checked ? " is-selected" : "") + " src-" + source
                },
                    h("div", {
                        className: "dsh-tavern-rx-row-head", role: "button", tabIndex: 0,
                        "aria-expanded": open ? "true" : "false",
                        onClick: function () { toggleOpen(entry); },
                        onKeyDown: function (event) {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault(); toggleOpen(entry);
                        }
                    },
                        h("label", {
                            className: "dsh-tavern-rx-select", "data-stop": "",
                            onClick: function (event) { event.stopPropagation(); },
                            onKeyDown: function (event) { event.stopPropagation(); }
                        }, h(Switch, {
                            bare: true, checked: checked, disabled: busy,
                            label: "选择 " + (entry.name || "未命名正则"),
                            onChange: function () { toggleSelected(source, entry.key); }
                        })),
                        h("div", { className: "dsh-tavern-rx-row-main" },
                            h("div", { className: "dsh-tavern-rx-row-title" }, h("b", null, current.name || "未命名正则")),
                            h("div", { className: "dsh-tavern-rx-row-preview" },
                                h("code", null, current.findRegex || "（空）"), " → ", h("code", null, current.replaceString || "（删除匹配）")),
                            h("div", { className: "dsh-tavern-rx-tags" }, tagsFor(source, entry, draft))
                        ),
                        switchButton(source, entry),
                        h("span", { className: "dsh-tavern-rx-caret", "aria-hidden": "true" })
                    ),
                    open ? (source === "global" ? globalEditor(entry, draft) : sourceEditor(source, entry)) : null
                );
            }

            function field(label, control, hint) {
                return h("div", { className: "dsh-tavern-rx-field" },
                    h("span", { className: "dsh-tavern-rx-label" }, label),
                    control,
                    hint ? h("span", { className: "dsh-tavern-rx-hint" }, hint) : null
                );
            }

            function placementChips(draft, entry) {
                return h("div", { className: "dsh-tavern-rx-chips" }, REGEX_PLACEMENTS.map(function (item) {
                    const checked = (draft.placement || []).map(Number).includes(item.id);
                    return h("label", { key: item.id, className: "dsh-tavern-rx-chip" + (checked ? " is-on" : "") },
                        h(Switch, {
                            bare: true, label: item.label, checked: checked, disabled: busy,
                            onChange: function (on) {
                                const values = (draft.placement || []).map(Number).filter(function (id) { return id !== item.id; });
                                if (on) values.push(item.id);
                                values.sort(function (left, right) { return left - right; });
                                patchDraft(entry, { placement: values });
                            }
                        }),
                        item.label);
                }));
            }

            function layerBox(draft, entry) {
                return h("div", { className: "dsh-tavern-rx-layers" },
                    h("label", { className: "dsh-tavern-rx-check" },
                        h(Switch, { bare: true, label: "仅显示层", checked: draft.markdownOnly === true, disabled: busy, onChange: function (on) { patchDraft(entry, { markdownOnly: on }); } }),
                        h("span", null, h("b", null, "仅显示层"), " 只改玩家看到的正文")),
                    h("label", { className: "dsh-tavern-rx-check" },
                        h(Switch, { bare: true, label: "仅上下文层", checked: draft.promptOnly === true, disabled: busy, onChange: function (on) { patchDraft(entry, { promptOnly: on }); } }),
                        h("span", null, h("b", null, "仅上下文层"), " 只改发给模型的历史")),
                    h("p", { className: "dsh-tavern-rx-hint" }, "两个都不勾＝永久替换（显示和上下文都改）；两个都勾＝两层分别替换，原始输出仍留档。")
                );
            }

            function testPanel(source, entry, draft) {
                const key = entry ? entry.key : "__new__";
                const state = tests[key] || null;
                const script = draft ? regexDraftScript(draft) : regexEntryScript(entry);
                const sourceEntry = draft || entry || {};
                const layer = sourceEntry.promptOnly === true && sourceEntry.markdownOnly !== true ? "context" : "display";
                const input = state && typeof state.input === "string" ? state.input : REGEX_SAMPLE;
                const result = state && state.result;
                return h("details", { className: "dsh-tavern-rx-test" },
                    h("summary", null, "试运行", h("span", { className: "dsh-tavern-rx-hint" }, "只跑当前这一条，按" + (layer === "context" ? "上下文层" : "显示层"))),
                    h("div", { className: "dsh-tavern-rx-test-body" },
                        h(TextArea, {
                            className: "dsh-tavern-rx-code", rows: 4, value: input, spellCheck: false, disabled: busy, label: "试运行文本",
                            onChange: function (text) { setTestInput(key, text); }
                        }),
                        h("div", { className: "dsh-tavern-rx-test-actions" },
                            h("button", {
                                className: "dsh-tavern-btn", type: "button", disabled: busy,
                                onClick: function () { void runTest(key, script, layer, input); }
                            }, "运行"),
                            result ? h("span", { className: "dsh-tavern-rx-test-meta" }, (result.applied && result.applied.length ? "匹配 " + result.applied.reduce(function (total, item) { return total + item.matches; }, 0) + " 处" : "没有命中") + (result.warnings && result.warnings.length ? " · " + result.warnings.length + " 个警告" : "")) : null
                        ),
                        result ? h("pre", { className: "dsh-tavern-rx-test-out" }, result.text || "（空）") : null,
                        result && result.warnings && result.warnings.length ? h("p", { className: "dsh-tavern-rx-error" }, result.warnings.join("\n")) : null
                    )
                );
            }

            function editorActions(entry, draft, extra) {
                const dirty = entry ? regexDraftSignature(draft) !== regexDraftSignature(regexDraftFromEntry(entry)) : true;
                return h("div", { className: "dsh-tavern-rx-actions" },
                    entry ? h("button", { className: "dsh-tavern-btn danger dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void removeEntry(entry); } }, "删除") : null,
                    entry ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void duplicateEntry(entry); } }, "复制") : null,
                    entry ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy || (data?.global || []).filter(function (item) { return item.key === entry.key; })[0] === (data?.global || [])[0], onClick: function () { void moveEntry(entry, -1); } }, "上移") : null,
                    entry ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy || (data?.global || []).filter(function (item) { return item.key === entry.key; })[0] === (data?.global || [])[(data?.global || []).length - 1], onClick: function () { void moveEntry(entry, 1); } }, "下移") : null,
                    extra || null,
                    h("span", { className: "dsh-tavern-rx-spacer" }),
                    h("span", { className: "dsh-tavern-rx-dirty" }, dirty ? "未保存" : ""),
                    h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { if (entry) { setDrafts(function (current) { const next = { ...current }; delete next[entry.key]; return next; }); setOpenKeys(function (current) { const next = new Set(current); next.delete(entry.key); return next; }); } else setNewDraft(null); setFormError(""); } }, "取消"),
                    h("button", { className: "dsh-tavern-btn primary dsh-tavern-rx-small", type: "button", disabled: busy || (entry && !dirty), onClick: function () { void saveDraft(entry); } }, "保存")
                );
            }

            function globalEditor(entry, draft) {
                if (!draft) return null;
                return h("div", { className: "dsh-tavern-rx-editor" },
                    field("名称", h(InlineField, {
                        kind: "text", label: "名称", hideLabel: true, value: draft.name, disabled: busy, maxLength: 120, trim: false,
                        onCommit: function (text) { patchDraft(entry, { name: text }); }
                    })),
                    field("查找正则", h(TextArea, {
                        className: "dsh-tavern-rx-code", rows: 3, value: draft.findRegex, spellCheck: false, disabled: busy, label: "查找正则",
                        onChange: function (text) { patchDraft(entry, { findRegex: text }); }
                    }), "SillyTavern 格式，支持 /pattern/flags。"),
                    formError ? h("p", { className: "dsh-tavern-rx-error", role: "alert" }, formError) : null,
                    field("替换内容", h(TextArea, {
                        className: "dsh-tavern-rx-code", rows: 2, value: draft.replaceString, spellCheck: false, disabled: busy, label: "替换内容",
                        onChange: function (text) { patchDraft(entry, { replaceString: text }); }
                    }), "可用 $1、$<name>、{{match}}，留空表示删除。"),
                    field("作用位置", placementChips(draft, entry), "通常只需要「AI 输出」；不选任何位置时这条规则不会运行。"),
                    h("div", { className: "dsh-tavern-rx-field" },
                        h("span", { className: "dsh-tavern-rx-label" }, "作用层"),
                        layerBox(draft, entry)),
                    h("details", { className: "dsh-tavern-rx-advanced" },
                        h("summary", null, "高级选项", h("span", { className: "dsh-tavern-rx-hint" }, "深度、修剪、编辑时运行")),
                        h("div", { className: "dsh-tavern-rx-advanced-body" },
                            h("label", { className: "dsh-tavern-rx-check" },
                                h(Switch, { bare: true, label: "编辑消息时也运行", checked: draft.runOnEdit === true, disabled: busy, onChange: function (on) { patchDraft(entry, { runOnEdit: on }); } }),
                                h("span", null, "编辑消息时也运行")),
                            h("div", { className: "dsh-tavern-rx-grid" },
                                field("深度范围", h("div", { className: "dsh-tavern-rx-range" },
                                    h(InlineField, { kind: "number", label: "最小深度", hideLabel: true, integer: true, optional: true, min: 0, value: draft.minText, placeholder: "最小", disabled: busy, onCommit: function (value) { patchDraft(entry, { minText: value === null ? "" : String(value) }); } }),
                                    h("span", null, "到"),
                                    h(InlineField, { kind: "number", label: "最大深度", hideLabel: true, integer: true, optional: true, min: 0, value: draft.maxText, placeholder: "最大", disabled: busy, onCommit: function (value) { patchDraft(entry, { maxText: value === null ? "" : String(value) }); } })
                                ), "0 = 最新一条，留空不限。"),
                                field("修剪字符串", h(InlineField, { kind: "text", label: "修剪字符串", hideLabel: true, trim: false, value: draft.trimText, placeholder: "例如：\\n, 　", disabled: busy, onCommit: function (text) { patchDraft(entry, { trimText: text }); } }), "逗号分隔；从捕获内容里去掉。")
                            )
                        )
                    ),
                    testPanel("global", entry, draft),
                    editorActions(entry, draft)
                );
            }

            function sourceEditor(source, entry) {
                return h("div", { className: "dsh-tavern-rx-editor" },
                    h("p", { className: "dsh-tavern-rx-note" },
                        "来自" + (source === "preset" ? "本局预设" : "本局人物卡") + "，这里的开关只影响本局，不改写" + (source === "preset" ? "预设文件" : "人物卡文件") + "。"),
                    field("查找正则", h("pre", { className: "dsh-tavern-rx-code" }, entry.findRegex || "（空）")),
                    field("替换内容", h("pre", { className: "dsh-tavern-rx-code" }, entry.replaceString || "（空）")),
                    h("div", { className: "dsh-tavern-rx-meta" },
                        h("div", null, "作用位置：" + regexPlacementText(entry)),
                        h("div", null, "作用层：" + regexLayerText(entry) + (entry.runOnEdit ? " · 编辑时运行" : "")),
                        h("div", null, "深度：" + (entry.minDepth === null || entry.minDepth === undefined ? "0" : entry.minDepth) + "–" + (entry.maxDepth === null || entry.maxDepth === undefined ? "∞" : entry.maxDepth)),
                        h("div", null, "来源：" + (entry.sourceEnabled ? "启用" : "停用") + " · 本局：" + (entry.enabled ? "启用" : "停用"))
                    ),
                    h("div", { className: "dsh-tavern-rx-actions" },
                        h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void copyToGlobal(entry); } }, "复制到全局"),
                        entry.overridden ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void setOverride(source, entry, null); } }, "恢复跟随来源") : null,
                        h("span", { className: "dsh-tavern-rx-spacer" }),
                        h("span", { className: "dsh-tavern-rx-dirty" }, entry.overridden ? "本局覆盖已生效" : "")
                    ),
                    testPanel(source, entry, null)
                );
            }

            function groupHead(source, title, count, subtitle, actions) {
                return h("div", { className: "dsh-tavern-rx-group-head" },
                    h("div", { className: "dsh-tavern-rx-group-title" },
                        h("span", { className: "dsh-tavern-rx-dot " + source }),
                        h("b", null, title),
                        h("span", { className: "dsh-tavern-rx-count" }, String(count)),
                        subtitle ? h("span", { className: "dsh-tavern-rx-group-sub" }, subtitle) : null
                    ),
                    actions ? h("div", { className: "dsh-tavern-rx-group-actions" }, actions) : null
                );
            }

            function empty(text) {
                return h(EmptyState, { compact: true, text: text });
            }

            function globalSection() {
                const entries = (data?.global || []).filter(matches);
                const allEnabled = (data?.global || []).length > 0 && (data?.global || []).every(function (entry) { return entry.enabled; });
                return h("section", { key: "global", className: "dsh-tavern-rx-group" },
                    groupHead("global", "全局正则", data?.global?.length || 0,
                        "所有存档生效 · 最先执行 · tavern-extension-settings.json › regex",
                        h("button", {
                            className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy || !data?.global?.length,
                            onClick: function () {
                                const scripts = (data?.global || []).map(function (entry) { return { ...regexEntryScript(entry), enabled: !allEnabled }; });
                                void writeGlobal(scripts, allEnabled ? "已停用全部全局正则。" : "已启用全部全局正则。");
                            }
                        }, allEnabled ? "全部停用" : "全部启用")),
                    newDraft ? newDraftRow() : null,
                    entries.length ? entries.map(function (entry) { return row("global", entry); }) : (!newDraft ? empty(query || stateFilter !== "all" ? "没有匹配的全局正则。" : "暂无全局正则。点「新建」写一条，或从酒馆导入。") : null)
                );
            }

            function newDraftRow() {
                return h("article", { key: "__new__", className: "dsh-tavern-rx-row is-open is-new" },
                    h("div", { className: "dsh-tavern-rx-row-head" },
                        h("div", { className: "dsh-tavern-rx-row-main" },
                            h("div", { className: "dsh-tavern-rx-row-title" }, h("b", null, "新建正则"), h("span", { className: "dsh-tavern-rx-tag dirty" }, "未保存")),
                            h("div", { className: "dsh-tavern-rx-row-preview" }, h("code", null, newDraft.findRegex || "（空）"), " → ", h("code", null, newDraft.replaceString || "（删除匹配）"))
                        )
                    ),
                    globalEditor(null, newDraft)
                );
            }

            function sourceSection(source) {
                const group = source === "preset" ? data?.preset : data?.card;
                const label = source === "preset" ? "预设" : "人物卡";
                if (!group) {
                    return h("section", { key: source, className: "dsh-tavern-rx-group" },
                        groupHead(source, label, 0, source === "preset" ? "本局没有预设快照" : "本局没有绑定人物卡"),
                        empty(source === "preset" ? "本局没有载入预设，或预设没有正则。" : "本局没有绑定人物卡，或人物卡没有正则。"));
                }
                const entries = group.scripts.filter(matches);
                return h("section", { key: source, className: "dsh-tavern-rx-group" },
                    groupHead(source, label + " · " + group.name, group.scripts.length,
                        (source === "preset" ? "本局预设快照" : "本局人物卡") + " · " + group.path,
                        null),
                    entries.length ? entries.map(function (entry) { return row(source, entry); }) : empty(query || stateFilter !== "all" ? "没有匹配的正则。" : "这一层没有正则。")
                );
            }

            function chainPanel() {
                const result = chainResult;
                return h("details", {
                    className: "dsh-tavern-rx-chain", open: chainOpen,
                    onToggle: function (event) { setChainOpen(event.currentTarget.open); }
                },
                    h("summary", null, "全链路试运行", h("span", { className: "dsh-tavern-rx-hint" }, "全局 → 预设 → 人物卡")),
                    h("div", { className: "dsh-tavern-rx-chain-body" },
                        h(TextArea, {
                            className: "dsh-tavern-rx-code", rows: 5, value: chainInput, spellCheck: false, disabled: busy, label: "全链路试运行文本",
                            onChange: function (text) { setChainInput(text); }
                        }),
                        h("div", { className: "dsh-tavern-rx-chain-tools" },
                            h(InlineField, { kind: "menu", label: "作用层", hideLabel: true, value: chainLayer, disabled: busy,
                                options: [{ value: "display", label: "显示层" }, { value: "context", label: "上下文层" }],
                                onCommit: function (value) { setChainLayer(value); } }),
                            h("button", { className: "dsh-tavern-btn", type: "button", disabled: busy, onClick: function () { void runChain(); } }, "运行"),
                            result ? h("span", { className: "dsh-tavern-rx-test-meta" }, result.result.applied.length + " 条命中" + (result.result.warnings.length ? " · " + result.result.warnings.length + " 个警告" : "")) : null
                        ),
                        result ? h("div", { className: "dsh-tavern-rx-steps" },
                            result.result.applied.map(function (applied) {
                                const item = result.items[applied.index];
                                if (!item) return null;
                                return h("div", { key: applied.index, className: "dsh-tavern-rx-step" },
                                    h("span", { className: "dsh-tavern-rx-dot " + item.source }),
                                    h("span", { className: "dsh-tavern-rx-step-name" }, regexSourceLabel(item.source) + " · " + item.entry.name),
                                    h("span", { className: "dsh-tavern-rx-step-n" }, applied.matches + " 处")
                                );
                            })) : null,
                        result ? h("pre", { className: "dsh-tavern-rx-test-out" }, result.result.text || "（空）") : null,
                        result && result.result.warnings.length ? h("p", { className: "dsh-tavern-rx-error" }, result.result.warnings.join("\n")) : null
                    )
                );
            }

            if (data === null) {
                return h("div", { className: "dsh-tavern-user-profile dsh-tavern-rx" },
                    h("div", { className: "dsh-tavern-status-head" }, h("div", { className: "dsh-tavern-status-title" }, "正则库")),
                    h("div", { className: "dsh-tavern-user-profile-body" },
                        error ? h("p", { role: "alert" }, error) : h(PanelLoading, { label: "正在读取正则…" })));
            }

            return h("div", { className: "dsh-tavern-user-profile dsh-tavern-rx" },
                h("div", { className: "dsh-tavern-status-head dsh-tavern-rx-head" },
                    h("div", { className: "dsh-tavern-status-title" }, "正则库"),
                    h("div", { className: "dsh-tavern-rx-head-actions dsh-tavern-library-head-actions" },
                        h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void load(); } }, "刷新"),
                        h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { importInput.current?.click(); } }, "导入"),
                        h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: exportAll }, "导出"),
                        h("button", { className: "dsh-tavern-btn primary dsh-tavern-rx-small", type: "button", disabled: busy || !!newDraft, onClick: startNew }, "新建")
                    )
                ),
                h("input", { type: "file", ref: importInput, multiple: true, accept: ".json,application/json", style: { display: "none" },
                    onChange: function (event) {
                        const files = Array.from(event.target.files || []);
                        event.target.value = "";
                        if (files.length) void importFiles(files);
                    }
                }),
                h("div", { className: "dsh-tavern-user-profile-body dsh-tavern-rx-body" },
                    h("p", { className: "dsh-tavern-settings-desc" }, "管理会作用于正文的正则。执行顺序：全局 → 预设 → 人物卡。全局改动立即生效；预设和人物卡只显示本局来源，开关只影响本局，不修改来源文件。"),
                    h("div", { className: "dsh-tavern-rx-stats" },
                        h("span", null, counts.all + " 条"),
                        h("span", null, enabledCount + " 条启用"),
                        data.preset ? h("span", null, "预设 " + data.preset.name) : null,
                        data.card ? h("span", null, "人物卡 " + data.card.name) : null
                    ),
                    error ? h("p", { className: "dsh-tavern-rx-error", role: "alert" }, error) : null,
                    notice ? h("p", { className: "dsh-tavern-rx-notice", role: "status" }, notice) : null,
                    chainPanel(),
                    h("div", { className: "dsh-tavern-rx-toolbar" },
                        h(SearchBox, {
                            bare: true, inputClassName: "dsh-tavern-rx-search", label: "搜索正则", placeholder: "搜索名称、查找规则或替换内容",
                            value: query, onChange: setQuery
                        }),
                        h("div", { className: "dsh-tavern-rx-filters" },
                            (playMode ? [["all", "全部"], ["global", "全局"], ["preset", "预设"], ["card", "人物卡"]] : [["all", "全部"], ["global", "全局"]]).map(function (item) {
                                return h("button", {
                                    key: item[0], type: "button",
                                    className: "dsh-tavern-rx-filter" + (filter === item[0] ? " is-on" : ""),
                                    onClick: function () { setFilter(item[0]); }
                                }, item[1], h("span", { className: "dsh-tavern-rx-filter-count" }, String(counts[item[0]])));
                            })
                        ),
                        h("div", { className: "dsh-tavern-rx-state-filters", role: "group", "aria-label": "按启用状态筛选" },
                            h("span", { className: "dsh-tavern-rx-state-label" }, "状态"),
                            [["all", "全部"], ["enabled", "已启用"], ["disabled", "已停用"]].map(function (item) {
                                return h("button", {
                                    key: item[0], type: "button",
                                    "aria-pressed": stateFilter === item[0] ? "true" : "false",
                                    className: "dsh-tavern-rx-filter dsh-tavern-rx-state-filter" + (stateFilter === item[0] ? " is-on" : ""),
                                    onClick: function () { setStateFilter(item[0]); }
                                }, item[1], h("span", { className: "dsh-tavern-rx-filter-count" }, String(stateCounts[item[0]])));
                            })
                        )
                    ),
                    h("div", { className: "dsh-tavern-rx-bulk", role: "group", "aria-label": "批量操作" },
                        h("span", { className: "dsh-tavern-rx-bulk-count" }, selectedCount > 0 ? "已选 " + selectedCount + " 条" : "未选择"),
                        h("button", {
                            className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button",
                            disabled: busy || visibleEntries.length === 0, onClick: selectAllVisible,
                            title: "选择当前筛选下的全部规则"
                        }, "全选当前"),
                        selectedCount > 0 ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: clearSelected }, "清除") : null,
                        selectedCount > 0 ? h("span", { className: "dsh-tavern-rx-spacer" }) : null,
                        selectedCount > 0 ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void bulkSetEnabled(true); } }, "启用") : null,
                        selectedCount > 0 ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: function () { void bulkSetEnabled(false); } }, "停用") : null,
                        selectedCount > 0 ? h("button", { className: "dsh-tavern-btn dsh-tavern-rx-small", type: "button", disabled: busy, onClick: bulkExport }, "导出") : null,
                        selectedCount > 0 ? h("button", {
                            className: "dsh-tavern-btn danger dsh-tavern-rx-small", type: "button",
                            disabled: busy, onClick: function () { void bulkDelete(); },
                            title: "只删除选中的全局正则；预设/人物卡规则来自来源文件"
                        }, "删除") : null
                    ),
                    (filter === "all" || filter === "global") ? globalSection() : null,
                    playMode && (filter === "all" || filter === "preset") ? sourceSection("preset") : null,
                    playMode && (filter === "all" || filter === "card") ? sourceSection("card") : null,
                    !playMode ? h("p", { className: "dsh-tavern-rx-empty" }, "打开一局游玩会话后，这里会显示本局预设与人物卡自带的正则。") : null,
                    h("p", { className: "dsh-tavern-rx-footer" }, "预设/人物卡的正则来自本局快照；开关只影响本局，要修改来源文件请到预设编辑器或人物卡工作台。")
                )
            );
        }

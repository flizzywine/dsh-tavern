        // Offline estimate for comparing sections, not a tokenizer or a bill: a CJK character
        // is about 1.5 tokens, a Latin word piece of 4 letters or 3 digits about 1.
        function estimateTavernTokens(text) {
            let halfTokens = 0;
            for (const piece of String(text ?? "").match(/[A-Za-z]+|[0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|\r?\n|[^\p{L}\p{N}\s]+|[^\s]/gu) || []) {
                if (/^[A-Za-z]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 4);
                else if (/^[0-9]+$/.test(piece)) halfTokens += 2 * Math.ceil(piece.length / 3);
                else if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(piece)) halfTokens += 3;
                else halfTokens += 2 * Math.ceil([...piece].length / 2);
            }
            return Math.ceil(halfTokens / 2);
        }
        function formatCachePercent(rate) {
            if (typeof rate !== "number" || !Number.isFinite(rate)) return "—";
            return (Math.max(0, Math.min(1, rate)) * 100).toFixed(1) + "%";
        }
        function cacheStatusMeta(status) {
            if (status === "hit") return { label: "一致前缀", cls: "is-cache-hit" };
            if (status === "break") return { label: "首处差异", cls: "is-cache-break" };
            if (status === "cascade") return { label: "差异之后", cls: "is-cache-cascade" };
            if (status === "appended") return { label: "本次新增", cls: "is-cache-appended" };
            return null;
        }
        function cacheZeroReadNote(reason) {
            if (reason === "ttl-or-provider") return "前缀与上一条完全一致，但供应商返回缓存读取为 0（可能已过 TTL、首次写入未生效或上游通道未开启/未透传缓存统计）。";
            return "";
        }
        const CONTEXT_SOURCE_CATEGORIES = {
            worldbook: "世界书",
            preset: "预设",
            card: "人物卡",
            story: "正文",
            state: "状态",
            plugin: "插件",
            tool: "工具",
            system: "系统"
        };
        function describeSectionSource(name, rest) {
            if (!name) return { category: "plugin", label: "附加上下文" };
            if (name === "tavern:runtime-preset-front") return { category: "preset", label: "前段预设" };
            if (name === "tavern:runtime-preset-middle") return { category: "preset", label: "中段预设" };
            if (name === "tavern:runtime-preset-back") return { category: "preset", label: "末尾预设投影" };
            if (name === "tavern:constant-worldbook") return { category: "worldbook", label: "常驻世界书" };
            if (name === "tavern:worldbook-skills") return { category: "worldbook", label: "世界书 Skill" };
            if (name.includes(":activeWorldbook:")) return { category: "worldbook", label: "本轮世界书" };
            if (name === "tavern:character-card") return { category: "card", label: "人物卡" };
            if (name === "tavern:card-system-prompt") return { category: "card", label: "人物卡系统提示" };
            if (name === "tavern:card-system") return { category: "preset", label: "卡片工作台性格" };
            if (name === "tavern:card-reference") return { category: "card", label: "人物卡参考" };
            if (name === "tavern:user-preference") return { category: "preset", label: "长期偏好" };
            if (name === "tavern:variable-directory") return { category: "state", label: "变量目录" };
            if (name.includes(":currentStateProjection:")) return { category: "state", label: "当前状态" };
            if (name.includes(":writingRules:")) return { category: "plugin", label: "写作规则" };
            if (name === "tavern:resource-workspace") return { category: "plugin", label: "工作区资源" };
            if (name === "tavern:plugin-body-generation" || name === "tavern:plugin-body-generation-reminder") return { category: "plugin", label: "正文生成规范" };
            if (name === "tavern:story-tool-submission" || name === "tavern:story-tool-submission-reminder") return { category: "plugin", label: "工具提交规范" };
            if (name === "tavern:no-foreground-tools") return { category: "plugin", label: "工具禁用说明" };
            if (name === "tavern:foreground-style-reference") return { category: "plugin", label: "文风参考" };
            if (name === "tavern:foreground-candidates") return { category: "plugin", label: "候选参考" };
            if (name === "tavern:system-append") return { category: "system", label: "系统追加" };
            if (name === "tavern:session-context") return { category: "system", label: "会话上下文" };
            if (name === "tavern:dsh-system") return { category: "system", label: rest || "系统提示词" };
            if (name === "tavern:turn") return { category: "story", label: "玩家输入" };
            if (name.startsWith("deployment:")) return { category: "plugin", label: "后台任务 · " + name.slice("deployment:".length) };
            if (name.startsWith("tavern:foreground:")) return { category: "plugin", label: "前台注入" };
            return { category: "plugin", label: name };
        }
        function describeMessageFallbackSource(message) {
            const source = message && message.source;
            const kind = typeof source?.kind === "string" ? source.kind : "";
            const form = typeof source?.form === "string" ? source.form : "";
            if (form === "worldbook-snapshot") return { category: "worldbook", label: "世界书快照" };
            if (form === "worldbook-recovery") return { category: "worldbook", label: "世界书恢复" };
            if (form === "writing-rules") return { category: "plugin", label: "写作规则" };
            if (form === "writing-skill-state") return { category: "plugin", label: "写作技能" };
            if (form === "variable-changes") return { category: "state", label: "变量变更" };
            if (form === "card-system-prompt-update") return { category: "card", label: "人物卡系统提示" };
            if (form === "foreground-capability-update") return { category: "plugin", label: "前台能力追加说明" };
            if (form === "foreground-frame") return { category: "plugin", label: "前台上下文" };
            if (form === "mvu-final-story") return { category: "plugin", label: "MVU 正文" };
            if (form === "stage-player-input") return { category: "story", label: "玩家输入" };
            if (form === "snapshot" && source?.workspaceContextVersion) return { category: "plugin", label: "工作区" };
            if (source?.worldbookSkills) return { category: "worldbook", label: "世界书技能" };
            if (kind === "preset" || kind === "preset-depth" || kind === "marker") {
                return { category: "preset", label: source?.name ? "预设 · " + source.name : "预设" };
            }
            if (kind === "mod") return { category: "plugin", label: "Mod · " + (source?.name || source?.modId || "扩展") };
            if (kind === "system-prompt") return { category: "system", label: "系统提示" };
            if (kind === "user" || kind === "current-input") return { category: "story", label: "玩家输入" };
            if (kind === "chat-history") return { category: "story", label: "对话历史" };
            if (kind === "model") {
                if (source?.model === "character-card") return { category: "card", label: "人物卡开场白" };
                return { category: "story", label: "模型回复" };
            }
            if (kind === "tool" || message?.role === "tool") return { category: "tool", label: "工具结果" };
            if (kind === "plugin:dsh-tavern") return { category: "plugin", label: "酒馆插件" };
            if (kind.startsWith("plugin:")) return { category: "plugin", label: "插件 · " + kind.slice("plugin:".length) };
            if (message?.role === "system") return { category: "system", label: "系统提示" };
            if (message?.role === "user") return { category: "story", label: "用户消息" };
            if (message?.role === "assistant") return { category: "story", label: "模型回复" };
            return { category: "system", label: "消息" };
        }
        function collectSectionSources(parts, fallback) {
            const seen = new Set();
            const list = [];
            function push(item) {
                if (!item || !item.label) return;
                const key = item.category + ":" + item.label;
                if (seen.has(key)) return;
                seen.add(key);
                list.push({ category: item.category, label: item.label });
            }
            for (const part of parts || []) {
                if (!part || !String(part.text || "").trim()) continue;
                if (part.catalog) { push({ category: "plugin", label: "Skill 目录" }); continue; }
                if (part.sourceCategory && part.label) push({ category: part.sourceCategory, label: part.label });
            }
            if (!list.length && fallback) push(fallback);
            return list;
        }
        function requestContextSections(request) {
            if (!request) return [];
            const sections = [];
            // System and tool declarations are independent request fields, not trailing messages.
            const metadata = Object.fromEntries(Object.entries(request).filter(([key]) => !['system', 'tools', 'messages'].includes(key)));
            if (Object.keys(metadata).length) sections.push({ title: "调用参数", value: metadata, cacheKey: "field:metadata", sources: [{ category: "system", label: "调用参数" }] });
            function addField(key) {
                if (!Object.hasOwn(request, key)) return;
                const labels = { system: "系统提示词", tools: "工具定义", messages: "消息" };
                const sourceByField = {
                    system: [{ category: "system", label: "系统提示" }],
                    tools: [{ category: "tool", label: "工具定义" }],
                    messages: [{ category: "story", label: "消息" }]
                };
                sections.push({ title: key + " · " + labels[key], value: request[key], cacheKey: "field:" + key, sources: sourceByField[key] || [] });
            }
            function addMessage(message, index) {
                const labels = { "tavern:runtime-preset-front": "前段预设", "tavern:runtime-preset-middle": "中段预设", "tavern:runtime-preset-back": "末尾预设投影" };
                const phases = [...new Set((message?.source?.sections || []).map(section => labels[section.name]).filter(Boolean))];
                const fallbackSource = describeMessageFallbackSource(message);
                let displayParts = [];
                for (const block of (Array.isArray(message.content) ? message.content : [message.content])) {
                    const plain = typeof block === "string" ? block : block?.type === "text" && Object.keys(block).every(key => key === "type" || key === "text") ? block.text : undefined;
                    if (typeof plain !== "string") {
                        const text = JSON.stringify(block, null, 2);
                        if (text !== undefined) displayParts.push({ text });
                        continue;
                    }
                    // Older host snapshots merge the catalog into user text and retain only
                    // the user's source. Recognize the host's exact catalog wrapper for display.
                    const catalog = /<system-reminder>\n(?:A skill is a reusable set of task-specific instructions\. The following skills are available in this session:|The available skill catalog changed\. This complete catalog replaces every earlier available-skills list in this session:)[\s\S]*?<\/system-reminder>/g;
                    let cursor = 0;
                    for (const match of plain.matchAll(catalog)) {
                        if (match.index > cursor) displayParts.push({ text: plain.slice(cursor, match.index), label: message.role === "user" ? "消息正文" : undefined, sourceCategory: message.role === "user" ? fallbackSource.category : undefined });
                        displayParts.push({ text: match[0], label: "系统附加 · Skill 目录", catalog: true, sourceCategory: "plugin" });
                        cursor = match.index + match[0].length;
                    }
                    if (cursor < plain.length || !plain.length) displayParts.push({ text: plain.slice(cursor), label: cursor ? "消息正文" : undefined, sourceCategory: cursor ? fallbackSource.category : undefined });
                }
                // Match recorded source sections against the actual body, in order.
                // If provenance cannot be aligned unambiguously, keep the original body.
                const sourceSections = (message?.source?.sections || []).filter(section => typeof section.text === "string" && section.text.length);
                if (sourceSections.length && displayParts.length === 1 && !displayParts[0].catalog) {
                    const text = displayParts[0].text;
                    const rest = message.role === "system" ? "系统提示词" : "消息正文";
                    const parts = [];
                    let cursor = 0;
                    let aligned = true;
                    for (const section of sourceSections) {
                        const start = text.indexOf(section.text, cursor);
                        if (start < 0 || text.indexOf(section.text, start + section.text.length) >= 0) { aligned = false; break; }
                        if (start > cursor) parts.push({ text: text.slice(cursor, start), label: text.slice(cursor, start).trim() ? rest : undefined, sourceCategory: text.slice(cursor, start).trim() ? fallbackSource.category : undefined });
                        const name = section.name || "";
                        const described = describeSectionSource(name, rest);
                        parts.push({ text: section.text, label: described.label || "附加上下文", sourceCategory: described.category, presetPhase: labels[name] ? name : undefined });
                        cursor = start + section.text.length;
                    }
                    if (aligned) {
                        if (cursor < text.length) parts.push({ text: text.slice(cursor), label: text.slice(cursor).trim() ? rest : undefined, sourceCategory: text.slice(cursor).trim() ? fallbackSource.category : undefined });
                        displayParts = parts;
                    }
                }
                const messageSources = collectSectionSources(displayParts, fallbackSource);
                sections.push({ title: "messages[" + index + "] · " + (message?.role || "消息") + (phases.length ? " · 含" + phases.join("、") : ""), value: message,
                    cacheKey: "msg:" + index,
                    fallbackSource,
                    sources: messageSources,
                    displayParts,
                    body: displayParts.map(part => part.text),
                    metadataText: JSON.stringify(Object.fromEntries(Object.entries(message).filter(([key]) => key !== "content" && key !== "role")), null, 2)
                });
            }
            addField("system");
            const messages = request.messages;
            let firstOrdinary = 0;
            // Tools are request metadata. Place them after the leading system messages,
            // without moving any message relative to another or changing its original index.
            if (Array.isArray(messages)) {
                while (firstOrdinary < messages.length && messages[firstOrdinary]?.role === "system") {
                    addMessage(messages[firstOrdinary], firstOrdinary);
                    firstOrdinary++;
                }
            }
            addField("tools");
            if (Array.isArray(messages) && messages.length) {
                for (let index = firstOrdinary; index < messages.length; index++) addMessage(messages[index], index);
            } else addField("messages");
            return sections.flatMap(section => {
                if (!section.displayParts?.some(part => part.presetPhase)) return [section];
                const groups = [];
                for (const part of section.displayParts) {
                    const previous = groups[groups.length - 1];
                    const phase = part.text.trim() ? (part.presetPhase || "") : (previous?.phase || "");
                    if (previous && previous.phase === phase) previous.parts.push(part);
                    else groups.push({ phase, parts: [part] });
                }
                const baseTitle = section.title.split(" · 含")[0];
                return groups.map((group, index) => ({
                    ...section,
                    title: baseTitle + (group.phase ? " · " + (group.phase.endsWith("-front") ? "预设前段" : group.phase.endsWith("-back") ? "预设后段" : "预设中段") : " · 消息正文"),
                    displayKey: baseTitle + ":" + index,
                    cacheKey: section.cacheKey + ":" + index,
                    sources: collectSectionSources(group.parts, section.fallbackSource),
                    displayParts: group.parts,
                    body: group.parts.map(part => part.text),
                    metadataText: index === 0 ? section.metadataText : undefined
                }));
            }).map(section => ({ ...section, text: section.body ? section.body.join("\n\n") : typeof section.value === "string" ? section.value : JSON.stringify(section.value, null, 2), count: section.body ? section.body.reduce((sum, text) => sum + text.length, 0) : undefined }));
        }
        function renderCacheDiffSummary(h, record, onJumpBreak) {
            const cacheDiff = record && record.cacheDiff;
            if (!cacheDiff) return null;
            const usage = cacheDiff.usage;
            const est = cacheDiff.estimated;
            const breakPoint = cacheDiff.breakPoint;
            const baseline = cacheDiff.baseline;
            const hasRealUsage = !!(usage && usage.totalInputTokens > 0);
            const showEstimate = !hasRealUsage && cacheDiff.compareStatus === "compared" && est?.totalTokens > 0;
            const rateTone = !hasRealUsage ? "neutral" : usage.hitRate >= 0.6 ? "good" : usage.hitRate >= 0.2 ? "warn" : "bad";
            const rateLabel = hasRealUsage
                ? "实际命中 " + formatCachePercent(usage.hitRate)
                : record.status === "running"
                    ? (showEstimate ? "预估一致前缀 " + formatCachePercent(est.prefixHitRate) + "（请求进行中）" : "请求进行中…")
                    : showEstimate
                        ? "预估一致前缀 " + formatCachePercent(est.prefixHitRate)
                        : cacheDiff.compareStatus === "no-previous"
                            ? "首条请求"
                            : "无对比基线";

            const baselineText = baseline
                ? (baseline.pruned
                    ? "上一条（第 " + baseline.turn + " 轮 · 步骤 " + baseline.step + "）原文已清理"
                    : "与第 " + baseline.turn + " 轮 · 步骤 " + baseline.step + " 对比")
                : "同会话暂无上一条请求";

            let barSegments = [];
            if (hasRealUsage) {
                const total = usage.totalInputTokens;
                barSegments = [
                    { key: "hit", cls: "is-hit", pct: (usage.cacheReadTokens / total) * 100, title: "缓存读取 " + usage.cacheReadTokens.toLocaleString() },
                    { key: "write", cls: "is-write", pct: (usage.cacheWriteTokens / total) * 100, title: "缓存写入 " + usage.cacheWriteTokens.toLocaleString() },
                    { key: "miss", cls: "is-miss", pct: (usage.inputTokens / total) * 100, title: "未缓存输入 " + usage.inputTokens.toLocaleString() }
                ].filter(item => item.pct > 0);
            } else if (showEstimate) {
                const total = est.totalTokens;
                barSegments = [
                    { key: "hit", cls: "is-hit", pct: (est.hitTokens / total) * 100, title: "一致前缀约 " + est.hitTokens.toLocaleString() },
                    { key: "break", cls: "is-break", pct: (est.breakTokens / total) * 100, title: "首处差异段约 " + est.breakTokens.toLocaleString() },
                    { key: "cascade", cls: "is-cascade", pct: (est.cascadeTokens / total) * 100, title: "差异之后约 " + est.cascadeTokens.toLocaleString() },
                    { key: "appended", cls: "is-appended", pct: (est.appendedTokens / total) * 100, title: "本次新增约 " + est.appendedTokens.toLocaleString() }
                ].filter(item => item.pct > 0);
            }

            const ttlDetail = usage && (usage.cacheWrite1hTokens || usage.cacheWrite5mTokens)
                ? "（1h: " + (usage.cacheWrite1hTokens || 0).toLocaleString() + " / 5m: " + (usage.cacheWrite5mTokens || 0).toLocaleString() + "）"
                : "";

            let breakDesc = "";
            if (breakPoint) {
                if (breakPoint.kind === "model") {
                    breakDesc = "模型由 " + breakPoint.previousModel + " 切换为 " + breakPoint.currentModel;
                } else {
                    const delta = breakPoint.diff ? ("+" + breakPoint.diff.addedLines + " / -" + breakPoint.diff.removedLines + " 行") : "结构变动";
                    breakDesc = breakPoint.title + (breakPoint.partLabel ? " · " + breakPoint.partLabel : "") + "（" + delta + "）";
                }
            }
            const zeroNote = !breakPoint ? cacheZeroReadNote(cacheDiff.zeroReadReason) : "";

            return h("div", { className: "dsh-context-cache-card" },
                h("div", { className: "dsh-context-cache-head" },
                    h("div", { className: "dsh-context-cache-title" },
                        h("span", { className: "dsh-context-cache-rate is-" + rateTone }, rateLabel),
                        h("span", { className: "dsh-context-cache-baseline" }, baselineText)),
                    breakPoint ? h("button", { type: "button", className: "dsh-context-cache-jump", onClick: () => onJumpBreak(breakPoint.key) }, "定位前缀差异") : null),
                barSegments.length ? h("div", { className: "dsh-context-cache-bar", role: "img", "aria-label": rateLabel },
                    barSegments.map(seg => h("span", { key: seg.key, className: "dsh-context-cache-seg " + seg.cls, style: { width: Math.max(seg.pct, 0.8) + "%" }, title: seg.title }))) : null,
                hasRealUsage ? h("div", { className: "dsh-context-cache-stats" },
                        "总输入 " + usage.totalInputTokens.toLocaleString() +
                        " · 缓存读 " + usage.cacheReadTokens.toLocaleString() +
                        " · 缓存写 " + usage.cacheWriteTokens.toLocaleString() + ttlDetail +
                        " · 未缓存 " + usage.inputTokens.toLocaleString()) : null,
                showEstimate ? h("div", { className: "dsh-context-cache-stats" },
                    "本地估算共约 " + est.totalTokens.toLocaleString() + " tokens" +
                    barSegments.map(seg => " · " + seg.title).join("")) : null,
                breakDesc ? h("div", { className: "dsh-context-cache-alert is-diff" },
                    h("strong", null, "本地前缀差异："), breakDesc) : null,
                zeroNote ? h("div", { className: "dsh-context-cache-alert is-info" }, zeroNote) : null);
        }
        function renderBreakDiffBox(h, breakPoint) {
            if (!breakPoint) return null;
            if (breakPoint.kind === "model") {
                return h("div", { className: "dsh-context-diff-box" },
                    h("div", { className: "dsh-context-diff-head" }, "与上一条请求的前缀差异 · 模型变更"),
                    h("div", { className: "dsh-context-diff-lines" },
                        h("div", { className: "dsh-context-diff-line is-del" }, h("span", { className: "dsh-context-diff-sign" }, "-"), h("code", null, breakPoint.previousModel)),
                        h("div", { className: "dsh-context-diff-line is-add" }, h("span", { className: "dsh-context-diff-sign" }, "+"), h("code", null, breakPoint.currentModel))));
            }
            const diff = breakPoint.diff;
            if (!diff || !diff.lines || !diff.lines.length) return null;
            return h("div", { className: "dsh-context-diff-box" },
                h("div", { className: "dsh-context-diff-head" },
                    "与上一条请求的前缀差异" + (breakPoint.partLabel ? " · " + breakPoint.partLabel : "") +
                    "（+" + diff.addedLines + " / -" + diff.removedLines + " 行" + (diff.truncated ? "，已截断" : "") + "）"),
                h("div", { className: "dsh-context-diff-lines" },
                    diff.lines.map((line, idx) => h("div", { key: idx, className: "dsh-context-diff-line is-" + line.type },
                        h("span", { className: "dsh-context-diff-sign" }, line.type === "add" ? "+" : line.type === "del" ? "-" : line.type === "omit" ? "⋯" : " "),
                        h("code", null, line.text)))));
        }
		function FullRequestContextView(props) {
			const h = React.createElement;
            const [record, setRecord] = React.useState(null);
            const [error, setError] = React.useState("");
            const [query, setQuery] = React.useState("");
            const [sourceFilter, setSourceFilter] = React.useState("all");
            const [refresh, setRefresh] = React.useState(0);
            const [jumpTarget, setJumpTarget] = React.useState({ key: "", tick: 0 });
            const loaded = React.useRef(null);
            const listRef = React.useRef(null);
            const [loading, setLoading] = React.useState(true);
            React.useEffect(() => {
                let active = true; setError(""); setLoading(true);
                if (loaded.current?.sessionId !== props.contextSessionId) { loaded.current = null; setRecord(null); setSourceFilter("all"); }
                rpc("getLatestRequestContext", { sessionId: props.contextSessionId, knownId: loaded.current?.id || "", knownStatus: loaded.current?.status || "" }, props.contextSessionId)
                    .then(value => { if (active && !value.record?.unchanged) { setRecord(value.record); loaded.current = value.record ? { sessionId: props.contextSessionId, id: value.record.id, status: value.record.status || "" } : null; } })
                    .catch(e => { if (active) setError(String(e.message || e)); })
                    .finally(() => { if (active) setLoading(false); });
                return () => { active = false; };
            }, [props.contextSessionId, refresh]);
            React.useEffect(() => {
                if (!jumpTarget.key || !listRef.current) return;
                const el = listRef.current.querySelector('[data-cache-key="' + jumpTarget.key.replace(/"/g, '\\"') + '"]');
                if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, [jumpTarget]);
			const request = record && record.request;
            const cacheDiff = record && record.cacheDiff;
            const sectionStatusMap = (cacheDiff && cacheDiff.sectionStatus) || {};
            const breakPoint = (cacheDiff && cacheDiff.breakPoint) || null;
            const text = React.useMemo(() => request ? JSON.stringify(request, null, 2) : "", [request]);
            const sections = React.useMemo(() => requestContextSections(request).map(section => {
                const sourceTags = (section.sources || []).map(src => (CONTEXT_SOURCE_CATEGORIES[src.category] || "") + " " + src.label).join(" ");
                return { ...section, tokens: estimateTavernTokens(section.text), searchText: (section.title + " " + sourceTags + " " + section.text).toLowerCase() };
            }), [request]);
            const sourceCounts = React.useMemo(() => {
                const counts = {};
                for (const section of sections) {
                    const cats = new Set((section.sources || []).map(src => src.category));
                    for (const cat of cats) counts[cat] = (counts[cat] || 0) + 1;
                }
                return Object.keys(CONTEXT_SOURCE_CATEGORIES).filter(cat => counts[cat] > 0).map(cat => ({ key: cat, label: CONTEXT_SOURCE_CATEGORIES[cat], count: counts[cat] }));
            }, [sections]);
            // Contexts reach 100k+ characters; filter off the typing path.
            const deferredQuery = React.useDeferredValue(query.toLowerCase());
            function downloadJson() {
                downloadTavernBlob(new Blob([text], { type: "application/json;charset=utf-8" }), "request-context.json");
            }
            function handleJumpBreak(key) {
                if (query) setQuery("");
                if (sourceFilter !== "all") setSourceFilter("all");
                setJumpTarget(prev => ({ key, tick: prev.tick + 1 }));
            }
            const visibleSections = React.useMemo(() => sections.filter(section => {
                if (sourceFilter !== "all" && !(section.sources || []).some(src => src.category === sourceFilter)) return false;
                if (deferredQuery && !section.searchText.includes(deferredQuery)) return false;
                return true;
            }), [sections, sourceFilter, deferredQuery]);
            return h("section", { className: "dsh-tavern-full-context" },
                h("header", { className: "dsh-context-header" },
                    h("div", null, h("h3", null, "完整上下文"), h("p", null, "最近一次请求 · 系统提示、工具与完整消息")),
                    h("button", { disabled: loading, onClick: () => setRefresh(value => value + 1) }, loading ? "读取中…" : "刷新")),
                record ? h("div", { className: "dsh-context-meta" },
                    h("span", { className: "dsh-context-badge" }, "第 " + record.turn + " 轮 · 步骤 " + record.step),
                    h("span", null, request.model || ""),
                    h("time", null, new Date(record.createdAt).toLocaleString())) : null,
                renderCacheDiffSummary(h, record, handleJumpBreak),
                h("div", { className: "dsh-context-toolbar" },
                    h("input", { type: "search", "aria-label": "搜索完整上下文", placeholder: "搜索提示词、来源（如世界书/预设/插件）、消息或工具…", value: query, onChange: e => setQuery(e.target.value) }),
                    request ? h("button", { onClick: async () => { try { await navigator.clipboard.writeText(text); } catch (e) { setError("复制失败：" + String(e.message || e)); } } }, "复制 JSON") : null,
                    request ? h("button", { onClick: downloadJson }, "下载 JSON") : null),
                request && sourceCounts.length > 1 ? h("div", { className: "dsh-context-source-filters", role: "group", "aria-label": "按来源筛选" },
                    h("button", { type: "button", className: "dsh-context-filter-chip" + (sourceFilter === "all" ? " is-active" : ""), onClick: () => setSourceFilter("all") }, "全部 (" + sections.length + ")"),
                    sourceCounts.map(item => h("button", {
                        key: item.key,
                        type: "button",
                        className: "dsh-context-filter-chip is-src-" + item.key + (sourceFilter === item.key ? " is-active" : ""),
                        onClick: () => setSourceFilter(prev => prev === item.key ? "all" : item.key)
                    }, item.label + " (" + item.count + ")"))) : null,
                error ? h("p", { className: "dsh-context-empty", role: "alert" }, error) : null,
                !loading && !record && !error ? h(EmptyState, { noun: "请求记录" }) : null,
                loading && !record ? h("p", { className: "dsh-context-empty" }, "正在读取完整上下文…") : null,
                request ? h("div", { className: "dsh-context-list", ref: listRef },
                    visibleSections.map((section, sectionIndex) => {
                        const status = section.cacheKey ? sectionStatusMap[section.cacheKey] : undefined;
                        const statusMeta = cacheStatusMeta(status);
                        const isBreakSection = Boolean(breakPoint && section.cacheKey === breakPoint.key);
                        const isJumpTarget = Boolean(jumpTarget.key && section.cacheKey === jumpTarget.key);
                        const renderedParts = (section.displayParts || [{ text: section.text }]).filter(part => part.text.trim());
                        const hasPartBreakdown = isBreakSection && !breakPoint.roleChanged && Number.isInteger(breakPoint.partIndex) && (renderedParts.length > 1 || breakPoint.partIndex >= renderedParts.length);
                        const sectionSources = section.sources || [];
                        const shownSources = sectionSources.slice(0, 2);
                        const extraSourceCount = sectionSources.length - shownSources.length;
                        const allSourceTitle = sectionSources.map(s => (CONTEXT_SOURCE_CATEGORIES[s.category] ? CONTEXT_SOURCE_CATEGORIES[s.category] + " · " : "") + s.label).join(" / ");
                        return h(TavernLazyDetails, {
                            key: record.id + ":" + (section.displayKey || section.title) + (deferredQuery ? ":search" : "") + (isJumpTarget ? ":jump:" + jumpTarget.tick : ""),
                            className: statusMeta ? "dsh-context-section " + statusMeta.cls + (hasPartBreakdown ? " has-part-breakdown" : "") : undefined,
                            attributes: section.cacheKey ? { "data-cache-key": section.cacheKey } : undefined,
                            // Searching opens the first matches only; opening every match would lay out the whole request.
                            defaultOpen: (!!deferredQuery && sectionIndex < 20) || isJumpTarget,
                            summary: h("summary", { className: "dsh-context-section-summary" },
                                h("span", { className: "dsh-context-section-head" },
                                    h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"),
                                    h("span", { className: "dsh-context-section-title" }, section.title)),
                                h("span", { className: "dsh-context-section-meta" },
                                    sectionSources.length ? h("span", { className: "dsh-context-source-tags", title: allSourceTitle },
                                        shownSources.map((src, i) => h("span", { key: i, className: "dsh-context-source-pill is-src-" + src.category }, src.label)),
                                        extraSourceCount > 0 ? h("span", { className: "dsh-context-source-pill is-src-more" }, "+" + extraSourceCount) : null) : null,
                                    statusMeta ? h("span", { className: "dsh-context-cache-pill " + statusMeta.cls }, statusMeta.label) : null,
                                    h("span", { className: "dsh-context-count" }, (section.count ?? section.text.length).toLocaleString() + " 字符 · 约 " + section.tokens.toLocaleString() + " tokens"))),
                            render: () => h(React.Fragment, null,
                                isBreakSection ? renderBreakDiffBox(h, breakPoint) : null,
                                ...renderedParts.map((part, index) => {
                                    const partCacheState = hasPartBreakdown
                                        ? (index < breakPoint.partIndex ? "hit" : index === breakPoint.partIndex ? "break" : "cascade")
                                        : (isBreakSection && breakPoint.partIndex === index ? "break" : "");
                                    const partCacheCls = partCacheState === "hit"
                                        ? " is-part-hit"
                                        : partCacheState === "break"
                                            ? " is-break-part"
                                            : partCacheState === "cascade"
                                                ? " is-part-cascade"
                                                : "";
                                    const partCacheTag = partCacheState === "break"
                                        ? h("span", { className: "dsh-context-part-break-tag" }, "首处差异")
                                        : partCacheState === "hit"
                                            ? h("span", { className: "dsh-context-part-hit-tag" }, "一致前缀")
                                            : partCacheState === "cascade"
                                                ? h("span", { className: "dsh-context-part-cascade-tag" }, "差异之后")
                                                : null;
                                    const partCat = part.sourceCategory && CONTEXT_SOURCE_CATEGORIES[part.sourceCategory];
                                    return part.catalog
                                        ? h("details", { key: index, className: "dsh-context-source" + partCacheCls },
                                            h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), part.label, partCacheTag),
                                            h("pre", null, part.text))
                                        : h("div", { key: index, className: partCacheCls ? "dsh-context-part" + partCacheCls : undefined },
                                            part.label ? h("div", { className: "dsh-context-part-label" },
                                                partCat ? h("span", { className: "dsh-context-source-pill is-src-" + part.sourceCategory }, partCat) : null,
                                                part.label,
                                                partCacheTag) : null,
                                            h("pre", null, part.text));
                                }),
                                section.metadataText && section.metadataText !== "{}" ? h("details", { className: "dsh-context-source" },
                                    h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), "来源与消息信息"),
                                    h("pre", null, section.metadataText)) : null)
                        });
                    }),
                    (deferredQuery || sourceFilter !== "all") && !visibleSections.length ? h(EmptyState, { query: query || (CONTEXT_SOURCE_CATEGORIES[sourceFilter] || ""), onClear: () => { setQuery(""); setSourceFilter("all"); } }) : null) : null,
                request ? h("p", { className: "dsh-context-footnote" }, "发送时的上下文快照 · 供应商协议转换前 · 前缀标记来自本地请求对比") : null
            );
		}

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
            if (status === "hit") return { label: "命中前缀", cls: "is-cache-hit" };
            if (status === "break") return { label: "破坏命中", cls: "is-cache-break" };
            if (status === "cascade") return { label: "受波及失效", cls: "is-cache-cascade" };
            if (status === "appended") return { label: "本轮新增", cls: "is-cache-appended" };
            return null;
        }
        function cacheZeroReadNote(reason) {
            if (reason === "first-request") return "本会话首条请求，正在建立初始缓存。";
            if (reason === "model-changed") return "本轮切换了模型，无法复用上一条请求的缓存。";
            if (reason === "prefix-too-short") return "前缀一致部分估算不足 1,024 tokens，未达到常见供应商的最小缓存阈值。";
            if (reason === "ttl-or-provider") return "前缀与上一条完全一致，但供应商返回缓存读取为 0（可能已过 TTL、首次写入未生效或上游通道未开启/未透传缓存统计）。";
            return "";
        }
        function requestContextSections(request) {
            if (!request) return [];
            const sections = [];
            // System and tool declarations are independent request fields, not trailing messages.
            const metadata = Object.fromEntries(Object.entries(request).filter(([key]) => !['system', 'tools', 'messages'].includes(key)));
            if (Object.keys(metadata).length) sections.push({ title: "调用参数", value: metadata, cacheKey: "field:metadata" });
            function addField(key) {
                if (!Object.hasOwn(request, key)) return;
                const labels = { system: "系统提示词", tools: "工具定义", messages: "消息" };
                sections.push({ title: key + " · " + labels[key], value: request[key], cacheKey: "field:" + key });
            }
            function addMessage(message, index) {
                const labels = { "tavern:runtime-preset-front": "前段预设", "tavern:runtime-preset-middle": "中段预设", "tavern:runtime-preset-back": "末尾预设投影" };
                const phases = [...new Set((message?.source?.sections || []).map(section => labels[section.name]).filter(Boolean))];
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
                        if (match.index > cursor) displayParts.push({ text: plain.slice(cursor, match.index), label: message.role === "user" ? "消息正文" : undefined });
                        displayParts.push({ text: match[0], label: "系统附加 · Skill 目录", catalog: true });
                        cursor = match.index + match[0].length;
                    }
                    if (cursor < plain.length || !plain.length) displayParts.push({ text: plain.slice(cursor), label: cursor ? "消息正文" : undefined });
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
                        if (start > cursor) parts.push({ text: text.slice(cursor, start), label: text.slice(cursor, start).trim() ? rest : undefined });
                        const name = section.name || "";
                        const label = labels[name] || (name.includes(":writingRules:") ? "写作规则" : name.includes(":activeWorldbook:") ? "本轮世界书" : name.includes(":currentStateProjection:") ? "当前状态" : name === "tavern:dsh-system" || name === "tavern:turn" ? rest : name);
                        parts.push({ text: section.text, label: label || "附加上下文", presetPhase: labels[name] ? name : undefined });
                        cursor = start + section.text.length;
                    }
                    if (aligned) {
                        if (cursor < text.length) parts.push({ text: text.slice(cursor), label: text.slice(cursor).trim() ? rest : undefined });
                        displayParts = parts;
                    }
                }
                sections.push({ title: "messages[" + index + "] · " + (message?.role || "消息") + (phases.length ? " · 含" + phases.join("、") : ""), value: message,
                    cacheKey: "msg:" + index,
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
            const primaryRate = hasRealUsage ? usage.hitRate : (cacheDiff.compareStatus === "compared" ? est?.prefixHitRate : null);
            const rateTone = primaryRate === null ? "neutral" : primaryRate >= 0.6 ? "good" : primaryRate >= 0.2 ? "warn" : "bad";
            const rateLabel = hasRealUsage
                ? "实际命中 " + formatCachePercent(usage.hitRate)
                : record.status === "running"
                    ? (est?.prefixHitRate !== null && est?.prefixHitRate !== undefined ? "预估前缀 " + formatCachePercent(est.prefixHitRate) + "（请求进行中）" : "请求进行中…")
                    : cacheDiff.compareStatus === "compared" && est?.prefixHitRate !== null
                        ? "预估前缀 " + formatCachePercent(est.prefixHitRate)
                        : cacheDiff.compareStatus === "no-previous"
                            ? "首条请求"
                            : "无对比基线";

            const baselineText = baseline
                ? (baseline.pruned
                    ? "上一条（第 " + baseline.turn + " 轮 · 步骤 " + baseline.step + "）原文已清理"
                    : "对比：第 " + baseline.turn + " 轮 · 步骤 " + baseline.step)
                : "同会话暂无上一条请求";

            let barSegments = [];
            if (hasRealUsage) {
                const total = usage.totalInputTokens;
                barSegments = [
                    { key: "hit", cls: "is-hit", pct: (usage.cacheReadTokens / total) * 100, title: "缓存读取 " + usage.cacheReadTokens.toLocaleString() },
                    { key: "write", cls: "is-write", pct: (usage.cacheWriteTokens / total) * 100, title: "缓存写入 " + usage.cacheWriteTokens.toLocaleString() },
                    { key: "miss", cls: "is-miss", pct: (usage.inputTokens / total) * 100, title: "未缓存输入 " + usage.inputTokens.toLocaleString() }
                ].filter(item => item.pct > 0);
            } else if (cacheDiff.compareStatus === "compared" && est && est.totalTokens > 0) {
                const total = est.totalTokens;
                barSegments = [
                    { key: "hit", cls: "is-hit", pct: (est.hitTokens / total) * 100, title: "命中前缀 ~" + est.hitTokens.toLocaleString() },
                    { key: "break", cls: "is-break", pct: (est.breakTokens / total) * 100, title: "破坏源头 ~" + est.breakTokens.toLocaleString() },
                    { key: "cascade", cls: "is-cascade", pct: (est.cascadeTokens / total) * 100, title: "受波及失效 ~" + est.cascadeTokens.toLocaleString() },
                    { key: "appended", cls: "is-appended", pct: (est.appendedTokens / total) * 100, title: "本轮新增 ~" + est.appendedTokens.toLocaleString() }
                ].filter(item => item.pct > 0);
            }

            const ttlDetail = usage && (usage.cacheWrite1hTokens || usage.cacheWrite5mTokens)
                ? "（1h: " + (usage.cacheWrite1hTokens || 0).toLocaleString() + " / 5m: " + (usage.cacheWrite5mTokens || 0).toLocaleString() + "）"
                : "";

            let breakDesc = "";
            if (breakPoint) {
                if (breakPoint.kind === "model") {
                    breakDesc = "模型由 " + breakPoint.previousModel + " 切换为 " + breakPoint.currentModel + "，导致后续 " + breakPoint.affectedSections + " 段（约 " + breakPoint.affectedTokens.toLocaleString() + " tokens）失去前缀缓存。";
                } else {
                    const delta = breakPoint.diff ? ("+" + breakPoint.diff.addedLines + " / -" + breakPoint.diff.removedLines + " 行") : "结构变动";
                    const cascadeNote = breakPoint.affectedSections > 0
                        ? "，连带失效后续 " + breakPoint.affectedSections + " 段（约 " + breakPoint.affectedTokens.toLocaleString() + " tokens）"
                        : "";
                    breakDesc = breakPoint.title + (breakPoint.partLabel ? " · " + breakPoint.partLabel : "") + "（" + delta + "）" + cascadeNote;
                }
            }
            const zeroNote = !breakPoint ? cacheZeroReadNote(cacheDiff.zeroReadReason) : "";

            return h("div", { className: "dsh-context-cache-card" },
                h("div", { className: "dsh-context-cache-head" },
                    h("div", { className: "dsh-context-cache-title" },
                        h("span", { className: "dsh-context-cache-rate is-" + rateTone }, rateLabel),
                        h("span", { className: "dsh-context-cache-baseline" }, baselineText)),
                    breakPoint ? h("button", { type: "button", className: "dsh-context-cache-jump", onClick: () => onJumpBreak(breakPoint.key) }, "定位破坏点") : null),
                barSegments.length ? h("div", { className: "dsh-context-cache-bar", role: "img", "aria-label": rateLabel },
                    barSegments.map(seg => h("span", { key: seg.key, className: "dsh-context-cache-seg " + seg.cls, style: { width: Math.max(seg.pct, 0.8) + "%" }, title: seg.title }))) : null,
                h("div", { className: "dsh-context-cache-stats" },
                    hasRealUsage ? h("span", null,
                        "总输入 " + usage.totalInputTokens.toLocaleString() +
                        " · 缓存读 " + usage.cacheReadTokens.toLocaleString() +
                        " · 缓存写 " + usage.cacheWriteTokens.toLocaleString() + ttlDetail +
                        " · 未缓存 " + usage.inputTokens.toLocaleString()) : null,
                    cacheDiff.compareStatus === "compared" && est ? h("span", { className: "dsh-context-cache-est" },
                        "前缀估算：命中 ~" + est.hitTokens.toLocaleString() +
                        (est.breakTokens ? " · 破坏点 ~" + est.breakTokens.toLocaleString() : "") +
                        (est.cascadeTokens ? " · 连带失效 ~" + est.cascadeTokens.toLocaleString() : "") +
                        (est.appendedTokens ? " · 本轮新增 ~" + est.appendedTokens.toLocaleString() : "") + " tokens") : null),
                breakDesc ? h("div", { className: "dsh-context-cache-alert is-break" },
                    h("strong", null, "破坏命中源头："), breakDesc) : null,
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
            const [refresh, setRefresh] = React.useState(0);
            const [jumpTarget, setJumpTarget] = React.useState({ key: "", tick: 0 });
            const loaded = React.useRef(null);
            const listRef = React.useRef(null);
            const [loading, setLoading] = React.useState(true);
            React.useEffect(() => {
                let active = true; setError(""); setLoading(true);
                if (loaded.current?.sessionId !== props.contextSessionId) { loaded.current = null; setRecord(null); }
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
            const sections = React.useMemo(() => requestContextSections(request).map(section => ({ ...section, tokens: estimateTavernTokens(section.text), searchText: (section.title + section.text).toLowerCase() })), [request]);
            // Contexts reach 100k+ characters; filter off the typing path.
            const deferredQuery = React.useDeferredValue(query.toLowerCase());
            function downloadJson() {
                downloadTavernBlob(new Blob([text], { type: "application/json;charset=utf-8" }), "request-context.json");
            }
            function handleJumpBreak(key) {
                if (query) setQuery("");
                setJumpTarget(prev => ({ key, tick: prev.tick + 1 }));
            }
            const visibleSections = React.useMemo(() => sections.filter(section => !deferredQuery || section.searchText.includes(deferredQuery)), [sections, deferredQuery]);
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
                    h("input", { type: "search", "aria-label": "搜索完整上下文", placeholder: "搜索提示词、消息或工具…", value: query, onChange: e => setQuery(e.target.value) }),
                    request ? h("button", { onClick: async () => { try { await navigator.clipboard.writeText(text); } catch (e) { setError("复制失败：" + String(e.message || e)); } } }, "复制 JSON") : null,
                    request ? h("button", { onClick: downloadJson }, "下载 JSON") : null),
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
                        return h(TavernLazyDetails, {
                            key: record.id + ":" + (section.displayKey || section.title) + (deferredQuery ? ":search" : "") + (isJumpTarget ? ":jump:" + jumpTarget.tick : ""),
                            className: statusMeta ? "dsh-context-section " + statusMeta.cls : undefined,
                            attributes: section.cacheKey ? { "data-cache-key": section.cacheKey } : undefined,
                            // Searching opens the first matches only; opening every match would lay out the whole request.
                            defaultOpen: (!!deferredQuery && sectionIndex < 20) || isJumpTarget,
                            summary: h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"),
                                h("span", { className: "dsh-context-section-title" }, section.title),
                                statusMeta ? h("span", { className: "dsh-context-cache-pill " + statusMeta.cls }, statusMeta.label) : null,
                                h("span", { className: "dsh-context-count" }, (section.count ?? section.text.length).toLocaleString() + " 字符 · 约 " + section.tokens.toLocaleString() + " tokens")),
                            render: () => h(React.Fragment, null,
                                isBreakSection ? renderBreakDiffBox(h, breakPoint) : null,
                                ...renderedParts.map((part, index) => {
                                    const isBreakPart = isBreakSection && breakPoint.partIndex === index;
                                    return part.catalog
                                        ? h("details", { key: index, className: "dsh-context-source" + (isBreakPart ? " is-break-part" : "") },
                                            h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), part.label),
                                            h("pre", null, part.text))
                                        : h("div", { key: index, className: isBreakPart ? "dsh-context-part is-break-part" : undefined },
                                            part.label ? h("div", { className: "dsh-context-part-label" }, part.label, isBreakPart ? h("span", { className: "dsh-context-part-break-tag" }, "破坏点") : null) : null,
                                            h("pre", null, part.text));
                                }),
                                section.metadataText && section.metadataText !== "{}" ? h("details", { className: "dsh-context-source" },
                                    h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), "来源与消息信息"),
                                    h("pre", null, section.metadataText)) : null)
                        });
                    }),
                    deferredQuery && !visibleSections.length ? h(EmptyState, { query, onClear: () => setQuery("") }) : null) : null,
                request ? h("p", { className: "dsh-context-footnote" }, "发送时的上下文快照 · 供应商协议转换前 · 消息顺序保持不变") : null
            );
		}

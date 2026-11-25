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
            skill: "写作 Skill",
            preset: "预设",
            card: "人物卡",
            story: "正文",
            state: "状态",
            injection: "白手套注入",
            plugin: "插件",
            tool: "工具",
            system: "系统"
        };
        function isWhiteGloveMessage(message, form) {
            return message?.source?.kind === "plugin:dsh-tavern-pure-writer" && message.source.form === form;
        }
        function isCurrentWhiteGloveInjection(message, turn) {
            if (!isWhiteGloveMessage(message, "inject")) return false;
            const injectedTurn = message.source.trace?.turn;
            return injectedTurn === undefined || injectedTurn === turn;
        }
        function describeWhiteGloveMaterials(parts) {
            // The handoff is a single text block. Its receipt headings identify the
            // material for filters without changing the block or its cache position.
            const kinds = new Set(tavernWritingReceiptSections(parts.map(part => part.text).join("\n")).map(section => section.kind));
            const sources = [
                { heading: "世界书", category: "worldbook", label: "世界书" },
                { heading: "写作指引", category: "skill", label: "写作 Skill" },
                { heading: "剧情记忆", category: "story", label: "剧情记忆" },
                { heading: "当前状态", category: "state", label: "当前状态" },
                { heading: "当前变量", category: "state", label: "当前变量" }
            ];
            return sources.filter(({ heading }) => kinds.has(heading))
                .map(({ category, label }) => ({ category, label }));
        }
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
            if (form === "worldbook-title-hints") return { category: "worldbook", label: "世界书标题提示" };
            if (isWhiteGloveMessage(message, "inject")) return { category: "injection", label: "白手套注入" };
            if (form === "worldbook-snapshot") return { category: "worldbook", label: "世界书快照" };
            if (form === "worldbook-recovery") return { category: "worldbook", label: "世界书恢复" };
            if (form === "writing-rules") return { category: "plugin", label: "写作规则" };
            if (form === "writing-skill-state") return { category: "plugin", label: "写作技能" };
            if (form === "variable-changes") return { category: "state", label: "变量变更" };
            if (form === "card-system-prompt-update") return { category: "card", label: "人物卡系统提示" };
            if (form === "player-identity") return { category: "state", label: "玩家称呼" };
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
            const metadata = Object.fromEntries(Object.entries(request).filter(([key]) => !['system', 'tools', 'messages', 'toolHistory'].includes(key)));
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
                const injection = isWhiteGloveMessage(message, "inject");
                if (injection) messageSources.push(...describeWhiteGloveMaterials(displayParts));
                const injectedTurn = injection ? message.source.trace?.turn : undefined;
                const injectionTitle = Number.isInteger(injectedTurn) ? " · 第 " + injectedTurn + " 轮注入" : "";
                sections.push({ title: "messages[" + index + "] · " + (message?.role || "消息") + (phases.length ? " · 含" + phases.join("、") : "") + injectionTitle, value: message,
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
        function foregroundRequestMode(record) {
            if (record?.scope !== "foreground" || record.task !== "reply" || !record.request) return "";
            if (record.frame?.append?.reason === "pure-writing") return "white-glove";
            const pure = record.request.messages?.some(message => isWhiteGloveMessage(message, "write") || isCurrentWhiteGloveInjection(message, record.turn));
            return pure ? "white-glove" : "standard";
        }
        function buildEnrichedSections(request) {
            return requestContextSections(request).map(section => {
                const sourceTags = (section.sources || []).map(src => (CONTEXT_SOURCE_CATEGORIES[src.category] || "") + " " + src.label).join(" ");
                return { ...section, tokens: estimateTavernTokens(section.text), searchText: (section.title + " " + sourceTags + " " + section.text).toLowerCase() };
            });
        }
        function syncBootTriggerVisual(sessionId, summary) {
            if (typeof window === "undefined") return;
            const bridge = window.__dshTavernGenerationStreamMode;
            if (!bridge || typeof bridge.setContextVisual !== "function") return;
            bridge.setContextVisual({
                sessionId: sessionId || "",
                triggerState: summary ? summary.triggerState : null
            });
        }
        function safeBucketLabel(bucketKey) {
            if (typeof TAVERN_CONTEXT_BUCKETS !== "undefined") {
                const hit = TAVERN_CONTEXT_BUCKETS.find(item => item.key === bucketKey);
                if (hit) return hit.label;
            }
            return bucketKey;
        }
        function safeFormatTokens(tokens) {
            if (typeof formatContextTokens === "function") return formatContextTokens(tokens);
            return typeof tokens === "number" ? tokens.toLocaleString() : "—";
        }
        function safeHealthLabel(summary) {
            if (!summary) return "健康";
            if (summary.health === "danger") return "需压缩";
            if (summary.health === "warn") return summary.cache?.hasAlert ? "缓存中断" : "注意容量";
            return "健康";
        }
        function renderSectionDetailContent(h, section, breakPoint, keyPrefix) {
            if (!section) return null;
            const isBreakSection = Boolean(breakPoint && section.cacheKey === breakPoint.key);
            const renderedParts = (section.displayParts || [{ text: section.text }]).filter(part => part.text && part.text.trim());
            const hasPartBreakdown = isBreakSection && !breakPoint.roleChanged && Number.isInteger(breakPoint.partIndex) && (renderedParts.length > 1 || breakPoint.partIndex >= renderedParts.length);
            return h(React.Fragment, null,
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
                        ? h("details", { key: (keyPrefix || "") + "part-" + index, className: "dsh-context-source" + partCacheCls },
                            h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), part.label, partCacheTag),
                            h("pre", null, part.text))
                        : h("div", { key: (keyPrefix || "") + "part-" + index, className: partCacheCls ? "dsh-context-part" + partCacheCls : undefined },
                            part.label ? h("div", { className: "dsh-context-part-label" },
                                partCat ? h("span", { className: "dsh-context-source-pill is-src-" + part.sourceCategory }, partCat) : null,
                                part.label,
                                partCacheTag) : null,
                            h("pre", null, part.text));
                }),
                section.metadataText && section.metadataText !== "{}" ? h("details", { className: "dsh-context-source" },
                    h("summary", null, h("span", { className: "dsh-context-chevron", "aria-hidden": true }, "›"), "来源与消息信息"),
                    h("pre", null, section.metadataText)) : null);
        }
        async function executeSessionCompaction(sessionId) {
            if (!sessionId) throw new Error("当前会话未就绪");
            if (typeof compactionRuns !== "undefined") compactionRuns.set(sessionId, { phase: "running" });
            try {
                const response = await rpc("runCompaction", {}, sessionId);
                const operation = response && response.result;
                if (!operation) throw new Error("当前会话不支持剧情压缩");
                if (operation.status !== "completed") throw new Error("上下文压缩未全部完成");
                if (typeof compactionRuns !== "undefined") compactionRuns.set(sessionId, null);
                return operation;
            } catch (err) {
                if (typeof compactionRuns !== "undefined") {
                    compactionRuns.set(sessionId, { phase: "failed", message: String(err && err.message || err) });
                }
                throw err;
            } finally {
                if (typeof liveTavernView !== "undefined" && typeof liveTavernView.invalidate === "function") {
                    liveTavernView.invalidate(sessionId);
                }
            }
        }
        function TavernContextMapViz(props) {
            const h = React.createElement;
            const summary = props.summary;
            const variant = props.variant || "full";
            const mode = props.mode || "treemap";
            const activeBucket = props.activeBucket || "";
            const selectedTile = props.selectedTile || null;
            const externalFocus = props.hoverFocus || null;
            const [localFocus, setLocalFocus] = React.useState(null);
            const [tipPayload, setTipPayload] = React.useState(null);
            const [tipPos, setTipPos] = React.useState(null);
            const wrapRef = React.useRef(null);
            const stageRef = React.useRef(null);
            const tipRef = React.useRef(null);
            const tipAnchorRef = React.useRef(null);
            const prevHeightRef = React.useRef(null);
            const heightAnimRef = React.useRef(null);
            const didMountRef = React.useRef(false);

            const dims = variant === "popover"
                ? { width: 394, height: 132, maxTiles: 12 }
                : variant === "sheet"
                    ? { width: 342, height: 164, maxTiles: 10 }
                    : { width: 760, height: 176, maxTiles: 18 };
            const treemapData = React.useMemo(() => {
                if (!summary || typeof computeContextMapTiles !== "function") return { tiles: [], thresholdLineX: null };
                return computeContextMapTiles(summary, dims);
            }, [summary, dims.width, dims.height, dims.maxTiles]);
            const waffleCells = React.useMemo(() => {
                if (!summary || mode !== "waffle" || typeof computeContextWaffleCells !== "function") return [];
                return computeContextWaffleCells(summary, 400);
            }, [summary, mode]);

            const bucketItemsMap = React.useMemo(() => {
                const map = Object.create(null);
                for (const item of (summary && Array.isArray(summary.items) ? summary.items : [])) {
                    if (!item || item.tokens <= 0) continue;
                    if (!map[item.bucket]) map[item.bucket] = [];
                    map[item.bucket].push(item);
                }
                for (const key of Object.keys(map)) {
                    map[key].sort((a, b) => (b.tokens !== a.tokens ? b.tokens - a.tokens : a.index - b.index));
                }
                return map;
            }, [summary]);

            const bucketMap = React.useMemo(() => {
                const map = Object.create(null);
                for (const b of (summary && Array.isArray(summary.buckets) ? summary.buckets : [])) {
                    map[b.key] = b;
                }
                return map;
            }, [summary]);

            // Treemap <-> Waffle 切换时平滑过渡容器高度（Magpie 风格）
            React.useLayoutEffect(() => {
                if (!didMountRef.current) {
                    didMountRef.current = true;
                    return;
                }
                const stage = stageRef.current;
                const h0 = prevHeightRef.current;
                prevHeightRef.current = null;
                if (!stage || !(h0 > 0) || typeof stage.animate !== "function") return;
                const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                if (reduced) return;
                const h1 = stage.offsetHeight;
                if (!(h1 > 0) || h0 === h1) return;
                if (heightAnimRef.current) {
                    try { heightAnimRef.current.cancel(); } catch (_) {}
                }
                stage.style.overflow = "hidden";
                const anim = stage.animate(
                    [{ height: h0 + "px" }, { height: h1 + "px" }],
                    { duration: 340, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
                );
                heightAnimRef.current = anim;
                anim.finished.catch(() => {}).finally(() => {
                    if (heightAnimRef.current === anim) {
                        stage.style.overflow = "";
                        heightAnimRef.current = null;
                    }
                });
            }, [mode]);

            // 动态将深色悬浮气泡定位在悬停色块/格子的正上方（顶部不足时自动翻到下方）
            React.useLayoutEffect(() => {
                if (!tipPayload || !tipRef.current || !wrapRef.current || !tipAnchorRef.current) {
                    setTipPos(null);
                    return;
                }
                const wrap = wrapRef.current;
                const tipEl = tipRef.current;
                const anchor = tipAnchorRef.current;
                if (!anchor.isConnected) {
                    setTipPos(null);
                    return;
                }
                const wRect = wrap.getBoundingClientRect();
                const aRect = anchor.getBoundingClientRect();
                const cardEl = typeof wrap.closest === "function" ? wrap.closest(".dsh-ctx-card") : null;
                const cRect = cardEl ? cardEl.getBoundingClientRect() : wRect;
                const tw = tipEl.offsetWidth || 200;
                const th = tipEl.offsetHeight || 52;
                let left = aRect.left - wRect.left + aRect.width / 2 - tw / 2;
                const minLeft = Math.max(0, cRect.left - wRect.left + 6);
                const maxLeft = Math.max(minLeft, cRect.right - wRect.left - tw - 6);
                left = Math.max(minLeft, Math.min(maxLeft, left));
                let top = aRect.top - wRect.top - th - 8;
                if (aRect.top - th - 8 < cRect.top + 4) {
                    top = aRect.bottom - wRect.top + 8;
                }
                setTipPos({ left: Math.round(left), top: Math.round(top) });
            }, [tipPayload]);

            React.useEffect(() => {
                setLocalFocus(null);
                setTipPayload(null);
                tipAnchorRef.current = null;
            }, [mode, summary]);

            if (!summary) return null;

            function clearHover() {
                setLocalFocus(null);
                setTipPayload(null);
                tipAnchorRef.current = null;
            }

            function handleModeSwitch(nextMode) {
                if (nextMode === mode) return;
                prevHeightRef.current = stageRef.current ? stageRef.current.offsetHeight : null;
                clearHover();
                props.onModeChange && props.onModeChange(nextMode);
            }

            function handleTileClick(tile) {
                if (!tile) return;
                if (tile.kind === "free") {
                    props.onSelectTile && props.onSelectTile(tile);
                    return;
                }
                if (tile.kind === "group") {
                    props.onSelectTile && props.onSelectTile(tile);
                    props.onBucketChange && props.onBucketChange(activeBucket === tile.bucket ? "" : tile.bucket);
                    return;
                }
                if (variant === "sheet") {
                    if (selectedTile && selectedTile.id === tile.id && tile.cacheKey) {
                        props.onOpenSection && props.onOpenSection(tile.cacheKey, tile);
                    } else {
                        props.onSelectTile && props.onSelectTile(tile);
                    }
                    return;
                }
                props.onSelectTile && props.onSelectTile(tile);
                if (tile.cacheKey && props.onOpenSection) props.onOpenSection(tile.cacheKey, tile);
            }

            function handleTileEnter(tile, el) {
                if (variant === "sheet") return;
                setLocalFocus({ kind: "tile", tileId: tile.id });
                tipAnchorRef.current = el;
                const usedDenom = Math.max(1, summary.usedTokens || 1);
                const shareUsedPct = Math.round((tile.tokens / usedDenom) * 1000) / 10;
                const shareWinPct = Math.round((tile.share || 0) * 1000) / 10;
                if (tile.kind === "free") {
                    setTipPayload({
                        key: tile.id,
                        bucket: "free",
                        title: "剩余空间",
                        rightMeta: safeFormatTokens(tile.tokens) + " · " + shareWinPct + "%"
                    });
                } else if (tile.kind === "group") {
                    const members = Array.isArray(tile.members) ? tile.members : (bucketItemsMap[tile.bucket] || []);
                    setTipPayload({
                        key: tile.id,
                        bucket: tile.bucket,
                        title: safeBucketLabel(tile.bucket) + " · " + tile.label,
                        rightMeta: safeFormatTokens(tile.tokens) + " · " + shareUsedPct + "%",
                        rows: members.slice(0, 5).map(m => ({ id: m.id, label: m.label, tokens: m.tokens })),
                        extraCount: Math.max(0, members.length - 5),
                        isFirstBreak: tile.isFirstBreak
                    });
                } else {
                    setTipPayload({
                        key: tile.id,
                        bucket: tile.bucket,
                        title: tile.label,
                        sub: safeBucketLabel(tile.bucket) + " · " + safeFormatTokens(tile.tokens) + " token · " + (summary.contextWindow ? shareWinPct : shareUsedPct) + "%",
                        isFirstBreak: tile.isFirstBreak
                    });
                }
            }

            function handleWaffleCellEnter(cell, el) {
                if (variant === "sheet") return;
                setLocalFocus({ kind: "bucket", bucket: cell.bucket });
                tipAnchorRef.current = el;
                if (cell.isFree) {
                    const pctFree = summary.contextWindow > 0 ? Math.round(((summary.freeTokens || 0) / summary.contextWindow) * 1000) / 10 : 0;
                    setTipPayload({
                        key: "waffle-free",
                        bucket: "free",
                        title: "剩余空间",
                        rightMeta: safeFormatTokens(summary.freeTokens) + " · " + pctFree + "%"
                    });
                    return;
                }
                const bInfo = bucketMap[cell.bucket];
                const bTokens = bInfo ? bInfo.tokens : 0;
                const bPct = Math.round((bTokens / Math.max(1, summary.usedTokens || 1)) * 1000) / 10;
                const items = bucketItemsMap[cell.bucket] || [];
                const shown = items.slice(0, 4);
                const hit = cell.itemId ? items.find(it => it.id === cell.itemId) : null;
                if (hit && !shown.includes(hit)) shown[3] = hit;
                setTipPayload({
                    key: "waffle-" + cell.bucket + "-" + (cell.itemId || cell.index),
                    bucket: cell.bucket,
                    title: safeBucketLabel(cell.bucket),
                    rightMeta: safeFormatTokens(bTokens) + " · " + bPct + "%",
                    rows: shown.map(it => ({ id: it.id, label: it.label, tokens: it.tokens, active: Boolean(hit && it.id === hit.id) })),
                    extraCount: Math.max(0, items.length - shown.length)
                });
            }

            function handleWaffleCellClick(cell) {
                if (!cell || cell.isFree) return;
                const items = bucketItemsMap[cell.bucket] || [];
                const target = (cell.itemId && items.find(it => it.id === cell.itemId)) || items[0];
                if (target && target.cacheKey && props.onOpenSection) {
                    clearHover();
                    props.onOpenSection(target.cacheKey, target);
                }
            }

            const effectiveFocus = localFocus
                || externalFocus
                || (activeBucket ? { kind: "bucket", bucket: activeBucket } : null)
                || (variant === "sheet" && selectedTile ? { kind: "tile", tileId: selectedTile.id } : null);
            const hasFocus = Boolean(effectiveFocus);

            function isTileFocused(tile) {
                if (!effectiveFocus) return false;
                if (effectiveFocus.kind === "tile") return tile.id === effectiveFocus.tileId;
                if (effectiveFocus.kind === "bucket") return tile.bucket === effectiveFocus.bucket;
                if (effectiveFocus.kind === "item") {
                    if (tile.id === effectiveFocus.itemId) return true;
                    if (tile.kind === "group" && Array.isArray(tile.memberIds) && tile.memberIds.includes(effectiveFocus.itemId)) return true;
                    return false;
                }
                return false;
            }

            function isWaffleCellFocused(cell) {
                if (!effectiveFocus) return false;
                if (effectiveFocus.kind === "bucket") return cell.bucket === effectiveFocus.bucket;
                if (effectiveFocus.kind === "item") {
                    if (cell.itemId) return cell.itemId === effectiveFocus.itemId;
                    return !cell.isFree && cell.bucket === effectiveFocus.bucket;
                }
                if (effectiveFocus.kind === "tile") return cell.bucket === effectiveFocus.bucket;
                return false;
            }

            const bucketsForLegend = (summary.buckets || []).filter(b => b.tokens > 0);
            const displayLegend = bucketsForLegend.length ? bucketsForLegend : (summary.buckets || []);

            return h("div", { className: "dsh-ctx-viz-wrap", "data-variant": variant, ref: wrapRef },
                h("div", { className: "dsh-ctx-viz-stage", ref: stageRef, "data-mode": mode },
                    mode === "treemap"
                        ? h("div", {
                            className: "dsh-ctx-treemap is-" + variant,
                            role: "region",
                            "aria-label": "上下文空间 Treemap 分布",
                            "data-focus": hasFocus ? effectiveFocus.kind : undefined,
                            onMouseLeave: variant === "sheet" ? undefined : clearHover
                        },
                        treemapData.thresholdLineX !== null && treemapData.thresholdLineX > 4 && treemapData.thresholdLineX < 98
                            ? h("div", {
                                className: "dsh-ctx-threshold-line",
                                style: { left: treemapData.thresholdLineX.toFixed(2) + "%" },
                                "aria-hidden": "true"
                            }, h("span", { className: "dsh-ctx-threshold-tag" }, summary.compactionThresholdPercent + "%"))
                            : null,
                        treemapData.tiles.map((tile, idx) => {
                            const isOn = isTileFocused(tile);
                            const isSelected = selectedTile && selectedTile.id === tile.id;
                            const isBare = !tile.showLabel;
                            const isLow = tile.showLabel && !tile.showTokens;
                            const cls = "dsh-ctx-tile is-bucket-" + tile.bucket +
                                (tile.kind === "free" ? " is-free" : "") +
                                (tile.kind === "group" ? " is-group" : "") +
                                (tile.isFirstBreak ? " is-break" : "") +
                                (isBare ? " is-bare" : "") +
                                (isLow ? " is-low" : "") +
                                (isOn ? " is-on" : "") +
                                (isSelected ? " is-selected" : "");
                            const pctStr = Math.round((tile.share || 0) * 1000) / 10;
                            const ariaLabel = tile.label + " · " + safeFormatTokens(tile.tokens) + " tokens · " + pctStr + "%";
                            return h("button", {
                                key: tile.id,
                                type: "button",
                                className: cls,
                                style: {
                                    left: "calc(" + tile.x.toFixed(3) + "% + 1.5px)",
                                    top: "calc(" + tile.y.toFixed(3) + "% + 1.5px)",
                                    width: "max(0px, calc(" + tile.w.toFixed(3) + "% - 3px))",
                                    height: "max(0px, calc(" + tile.h.toFixed(3) + "% - 3px))",
                                    "--d": (30 + Math.min(idx, 16) * 20) + "ms"
                                },
                                "data-ctx-tile": tile.id,
                                "data-ctx-bucket": tile.bucket,
                                "aria-label": ariaLabel,
                                onMouseEnter: variant === "sheet" ? undefined : e => handleTileEnter(tile, e.currentTarget),
                                onFocus: variant === "sheet" ? undefined : e => handleTileEnter(tile, e.currentTarget),
                                onBlur: variant === "sheet" ? undefined : clearHover,
                                onClick: () => handleTileClick(tile)
                            },
                            tile.isFirstBreak && !isBare ? h("span", { className: "dsh-ctx-tile-break", title: "首处缓存断层" }, "!") : null,
                            tile.showLabel ? h("span", { className: "dsh-ctx-tile-title" }, tile.label) : null,
                            tile.showTokens ? h("span", { className: "dsh-ctx-tile-val" }, safeFormatTokens(tile.tokens) + (tile.kind === "free" ? " · " + pctStr + "%" : " · " + safeBucketLabel(tile.bucket))) : null);
                        }))
                        : h("div", {
                            className: "dsh-ctx-waffle is-" + variant,
                            role: "img",
                            "aria-label": "400 格上下文占比网格",
                            "data-focus": hasFocus ? effectiveFocus.kind : undefined,
                            onMouseLeave: variant === "sheet" ? undefined : clearHover
                        },
                        waffleCells.map(cell => {
                            const isOn = isWaffleCellFocused(cell);
                            const isItemLift = isOn && effectiveFocus && effectiveFocus.kind === "item";
                            return h("span", {
                                key: cell.index,
                                className: "dsh-ctx-waffle-cell is-bucket-" + cell.bucket +
                                    (cell.isFree ? " is-free" : "") +
                                    (isOn ? " is-on" : "") +
                                    (isItemLift ? " is-item-on" : ""),
                                style: { "--d": Math.round(cell.index * 1.4) + "ms" },
                                onMouseEnter: variant === "sheet" ? undefined : e => handleWaffleCellEnter(cell, e.currentTarget),
                                onClick: cell.isFree ? undefined : () => handleWaffleCellClick(cell)
                            });
                        }))),
                variant !== "sheet" && tipPayload ? h("div", {
                    ref: tipRef,
                    className: "dsh-ctx-tip" + (tipPos ? " is-placed" : ""),
                    role: "tooltip",
                    style: tipPos ? { left: tipPos.left + "px", top: tipPos.top + "px" } : { left: "0px", top: "0px", visibility: "hidden" }
                },
                h("div", { className: "dsh-ctx-tip-head" },
                    h("span", { className: "dsh-ctx-dot is-bucket-" + tipPayload.bucket }),
                    h("b", { className: "dsh-ctx-tip-title" }, tipPayload.title),
                    tipPayload.isFirstBreak ? h("span", { className: "dsh-ctx-tip-break" }, "断层") : null,
                    tipPayload.rightMeta ? h("span", { className: "dsh-ctx-tip-meta" }, tipPayload.rightMeta) : null),
                tipPayload.sub ? h("div", { className: "dsh-ctx-tip-sub" }, tipPayload.sub) : null,
                Array.isArray(tipPayload.rows) && tipPayload.rows.length
                    ? tipPayload.rows.map(row => h("div", { key: row.id, className: "dsh-ctx-tip-row" + (row.active ? " is-active" : "") },
                        h("span", { className: "dsh-ctx-tip-row-n" }, row.label),
                        h("span", { className: "dsh-ctx-tip-row-v" }, safeFormatTokens(row.tokens))))
                    : null,
                tipPayload.extraCount > 0 ? h("div", { className: "dsh-ctx-tip-more" }, "另外 " + tipPayload.extraCount + " 项") : null) : null,
                variant === "sheet" && selectedTile ? h("div", { className: "dsh-ctx-selected-bar" },
                    h("span", { className: "dsh-ctx-dot is-bucket-" + selectedTile.bucket }),
                    h("span", { className: "dsh-ctx-selected-name" }, selectedTile.label),
                    h("span", { className: "dsh-ctx-selected-meta" }, safeFormatTokens(selectedTile.tokens) + " · " + (Math.round((selectedTile.share || 0) * 1000) / 10) + "%"),
                    selectedTile.cacheKey && selectedTile.kind !== "free"
                        ? h("button", {
                            type: "button",
                            className: "dsh-ctx-selected-action",
                            onClick: () => props.onOpenSection && props.onOpenSection(selectedTile.cacheKey, selectedTile)
                        }, "查看原文 ›")
                        : null) : null,
                h("div", { className: "dsh-ctx-viz-footer" },
                    h("div", { className: "dsh-ctx-legend", role: "group", "aria-label": "语境桶图例" },
                        displayLegend.map(b => h("button", {
                            key: b.key,
                            type: "button",
                            className: "dsh-ctx-legend-item" + (activeBucket === b.key ? " is-active" : "") + (b.tokens <= 0 ? " is-empty" : ""),
                            onMouseEnter: variant === "sheet" ? undefined : () => setLocalFocus({ kind: "bucket", bucket: b.key }),
                            onMouseLeave: variant === "sheet" ? undefined : clearHover,
                            onClick: () => props.onBucketChange && props.onBucketChange(activeBucket === b.key ? "" : b.key)
                        },
                        h("span", { className: "dsh-ctx-dot is-bucket-" + b.key }),
                        h("span", { className: "dsh-ctx-legend-name" }, variant === "popover" ? b.shortLabel : b.label),
                        h("span", { className: "dsh-ctx-legend-val" }, safeFormatTokens(b.tokens)))),
                        summary.freeTokens > 0 ? h("span", {
                            className: "dsh-ctx-legend-item is-readonly",
                            onMouseEnter: variant === "sheet" ? undefined : () => setLocalFocus({ kind: "bucket", bucket: "free" }),
                            onMouseLeave: variant === "sheet" ? undefined : clearHover
                        },
                        h("span", { className: "dsh-ctx-dot is-bucket-free" }),
                        h("span", { className: "dsh-ctx-legend-name" }, "剩余"),
                        h("span", { className: "dsh-ctx-legend-val" }, safeFormatTokens(summary.freeTokens))) : null),
                    h("div", { className: "dsh-ctx-mode-switch", role: "group", "aria-label": "视图模式切换" },
                        h("button", {
                            type: "button",
                            className: "dsh-ctx-mode-btn" + (mode === "treemap" ? " is-active" : ""),
                            "aria-label": "Treemap 块状图",
                            "aria-pressed": mode === "treemap",
                            title: "Treemap 面积视图",
                            onClick: () => handleModeSwitch("treemap")
                        }, h("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true },
                            h("rect", { x: 1.5, y: 2, width: 5.5, height: 12, rx: 1.6, fill: "currentColor" }),
                            h("rect", { x: 8.5, y: 2, width: 6, height: 6.5, rx: 1.6, fill: "currentColor" }),
                            h("rect", { x: 8.5, y: 10, width: 6, height: 4, rx: 1.4, fill: "currentColor" }))),
                        h("button", {
                            type: "button",
                            className: "dsh-ctx-mode-btn" + (mode === "waffle" ? " is-active" : ""),
                            "aria-label": "Waffle 网格图",
                            "aria-pressed": mode === "waffle",
                            title: "400 格精确网格",
                            onClick: () => handleModeSwitch("waffle")
                        }, h("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true },
                            h("rect", { x: 2, y: 2, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 6.5, y: 2, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 11, y: 2, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 2, y: 6.5, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 6.5, y: 6.5, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 11, y: 6.5, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 2, y: 11, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 6.5, y: 11, width: 3, height: 3, rx: 0.8, fill: "currentColor" }),
                            h("rect", { x: 11, y: 11, width: 3, height: 3, rx: 0.8, fill: "currentColor" }))))));
        }
        function TavernContextSparkline(props) {
            const h = React.createElement;
            const series = (Array.isArray(props.series) ? props.series : []).filter(p => Number(p && p.tokens) > 0);
            if (!series.length) return null;
            const contextWindow = Number(props.contextWindow) || 0;
            const latest = series[series.length - 1];
            if (series.length < 2) {
                return h("div", { className: "dsh-ctx-sparkline-box is-single" },
                    h("span", { className: "dsh-ctx-sparkline-label" }, "第 " + (latest.turn || 1) + " 轮 · 输入 " + safeFormatTokens(latest.tokens)));
            }
            const maxVal = Math.max(contextWindow, ...series.map(p => p.tokens), 1);
            const W = 220;
            const H = 38;
            const padY = 4;
            const usableH = H - padY * 2;
            const pts = series.map((item, idx) => {
                const x = (idx / Math.max(1, series.length - 1)) * W;
                const y = padY + (1 - Math.min(1, item.tokens / maxVal)) * usableH;
                return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), item };
            });
            const polyLine = pts.map(p => p.x + "," + p.y).join(" ");
            const areaPts = "0," + H + " " + polyLine + " " + W + "," + H;
            const thresholdRatio = contextWindow > 0 && props.thresholdPercent > 0 ? Math.min(1, props.thresholdPercent / 100) : 0;
            const thresholdY = thresholdRatio > 0 ? Number((padY + (1 - thresholdRatio) * usableH).toFixed(1)) : null;
            const last = pts[pts.length - 1];
            return h("div", { className: "dsh-ctx-sparkline-box" },
                h("div", { className: "dsh-ctx-sparkline-meta" },
                    h("span", { className: "dsh-ctx-sparkline-label" }, "近 " + series.length + " 轮输入走势"),
                    h("span", { className: "dsh-ctx-sparkline-latest" }, safeFormatTokens(latest.tokens))),
                h("svg", { className: "dsh-ctx-sparkline-svg", viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "none", "aria-hidden": true },
                    thresholdY !== null ? h("line", { className: "dsh-ctx-sparkline-thresh", x1: 0, y1: thresholdY, x2: W, y2: thresholdY }) : null,
                    h("polygon", { className: "dsh-ctx-sparkline-area", points: areaPts }),
                    h("polyline", { className: "dsh-ctx-sparkline-line", points: polyLine }),
                    h("circle", { className: "dsh-ctx-sparkline-dot", cx: last.x, cy: last.y, r: 2.8 })));
        }
        function TavernContextOverviewCard(props) {
            const h = React.createElement;
            const summary = props.summary;
            const variant = props.variant || "full";
            const [mode, setMode] = React.useState("treemap");
            const [activeBucket, setActiveBucket] = React.useState("");
            const [selectedTile, setSelectedTile] = React.useState(null);
            const [rowHover, setRowHover] = React.useState(null);
            const [showAll, setShowAll] = React.useState(false);

            React.useEffect(() => {
                setSelectedTile(null);
                setRowHover(null);
            }, [props.record && props.record.id, props.scope]);

            if (!summary) return null;

            const topLimit = variant === "popover" ? 5 : (variant === "sheet" ? 6 : 8);
            const sortedItems = React.useMemo(() => {
                const list = (summary.items || []).filter(item => item.tokens > 0 && (!activeBucket || item.bucket === activeBucket));
                return list.slice().sort((a, b) => {
                    if (b.tokens !== a.tokens) return b.tokens - a.tokens;
                    return a.index - b.index;
                });
            }, [summary, activeBucket]);

            const shownItems = showAll ? sortedItems : sortedItems.slice(0, topLimit);
            const maxItemTokens = sortedItems.length ? Math.max(1, sortedItems[0].tokens) : 1;
            const modelName = props.record?.request?.model || "";
            const usedPctStr = summary.usedPercent !== null ? (Math.round(summary.usedPercent * 10) / 10) + "%" : "—";
            const nonZeroBuckets = (summary.buckets || []).filter(b => b.tokens > 0);
            const canCompact = typeof props.onCompact === "function";

            return h("div", { className: "dsh-ctx-card is-" + variant },
                h("div", { className: "dsh-ctx-card-top" },
                    h("div", { className: "dsh-ctx-card-title-row" },
                        h("span", { className: "dsh-ctx-card-title" }, "上下文窗口"),
                        h("span", { className: "dsh-ctx-health is-" + summary.health }, safeHealthLabel(summary)),
                        variant === "full" && summary.hasBackground && props.onScopeChange
                            ? h("div", { className: "dsh-ctx-scope-switch", role: "group", "aria-label": "作用域切换" },
                                h("button", { type: "button", className: "dsh-ctx-scope-btn" + (props.scope !== "background" ? " is-active" : ""), onClick: () => props.onScopeChange("foreground") }, "前台"),
                                h("button", { type: "button", className: "dsh-ctx-scope-btn" + (props.scope === "background" ? " is-active" : ""), onClick: () => props.onScopeChange("background") }, "后台"))
                            : null),
                    h("div", { className: "dsh-ctx-card-actions" },
                        modelName ? h("span", { className: "dsh-ctx-model-pill", title: modelName }, modelName) : null,
                        variant === "full" && props.onRefresh
                            ? h("button", { type: "button", className: "dsh-ctx-icon-btn", disabled: props.loading, onClick: props.onRefresh }, props.loading ? "读取中…" : "刷新")
                            : null,
                        props.onClose
                            ? h("button", { type: "button", className: "dsh-ctx-close-btn", "aria-label": "关闭上下文窗口", onClick: props.onClose }, "×")
                            : null)),
                h("div", { className: "dsh-ctx-kpi-grid" },
                    h("div", { className: "dsh-ctx-kpi" },
                        h("div", { className: "dsh-ctx-kpi-label" },
                            h("span", null, "已用上下文"),
                            h("span", { className: "dsh-ctx-measure-tag" }, summary.measured ? "实测" : "估算")),
                        h("div", { className: "dsh-ctx-kpi-main" },
                            h("strong", { className: "dsh-ctx-kpi-value" }, safeFormatTokens(summary.usedTokens)),
                            h("span", { className: "dsh-ctx-kpi-cap" }, summary.contextWindow ? (" / " + safeFormatTokens(summary.contextWindow) + " token") : " token")),
                        h("div", { className: "dsh-ctx-kpi-sub" },
                            summary.contextWindow
                                ? ("已用 " + usedPctStr + " · 剩余 " + safeFormatTokens(summary.freeTokens))
                                : "模型窗口上限未知")),
                    h("div", { className: "dsh-ctx-kpi" },
                        h("div", { className: "dsh-ctx-kpi-label" },
                            h("span", null, "缓存命中率"),
                            summary.cache?.hasAlert ? h("span", { className: "dsh-ctx-cache-alert-dot" }, "缓存中断") : null),
                        h("div", { className: "dsh-ctx-kpi-main" },
                            h("strong", { className: "dsh-ctx-kpi-value" + (summary.cache?.hasAlert ? " is-warn" : "") },
                                summary.cache?.measured ? formatCachePercent(summary.cache.hitRate) : "—"),
                            summary.cache?.hasAlert && summary.firstBreakKey && props.onSelectSection
                                ? h("button", {
                                    type: "button",
                                    className: "dsh-ctx-break-link",
                                    onClick: () => props.onSelectSection(summary.firstBreakKey)
                                }, "定位首处断层 ›")
                                : null),
                        h("div", { className: "dsh-ctx-kpi-sub" },
                            summary.cache?.measured
                                ? ("读 " + safeFormatTokens(summary.cache.readTokens) + " · 写 " + safeFormatTokens(summary.cache.writeTokens) + " · 未命中 " + safeFormatTokens(summary.cache.uncachedTokens))
                                : "等待供应商缓存统计"))),
                h(TavernContextMapViz, {
                    summary,
                    mode,
                    onModeChange: setMode,
                    variant,
                    activeBucket,
                    onBucketChange: setActiveBucket,
                    selectedTile,
                    onSelectTile: setSelectedTile,
                    hoverFocus: rowHover,
                    onOpenSection: props.onSelectSection
                }),
                variant !== "popover" && (summary.recentSeries?.length > 0 || canCompact)
                    ? h("div", { className: "dsh-ctx-trend-row" },
                        h(TavernContextSparkline, {
                            series: summary.recentSeries,
                            contextWindow: summary.contextWindow,
                            thresholdPercent: summary.compactionThresholdPercent
                        }),
                        variant === "full" && canCompact
                            ? h("div", { className: "dsh-ctx-compact-wrap" },
                                h("button", {
                                    type: "button",
                                    className: "dsh-ctx-action-btn is-primary",
                                    disabled: props.compacting || props.compactDisabled,
                                    onClick: props.onCompact
                                }, props.compacting ? "压缩中…" : "手动压缩上下文"),
                                props.compactionNotice ? h("span", { className: "dsh-ctx-compact-note" }, props.compactionNotice) : null)
                            : null)
                    : null,
                h("div", { className: "dsh-ctx-ranking" },
                    h("div", { className: "dsh-ctx-ranking-head" },
                        h("span", { className: "dsh-ctx-ranking-title" }, "内容分布"),
                        nonZeroBuckets.length > 1
                            ? h("div", { className: "dsh-ctx-chips", role: "group", "aria-label": "按语境桶筛选内容" },
                                h("button", { type: "button", className: "dsh-ctx-chip" + (!activeBucket ? " is-active" : ""), onClick: () => setActiveBucket("") }, "全部"),
                                nonZeroBuckets.map(b => h("button", {
                                    key: b.key,
                                    type: "button",
                                    className: "dsh-ctx-chip" + (activeBucket === b.key ? " is-active" : ""),
                                    onClick: () => setActiveBucket(prev => prev === b.key ? "" : b.key)
                                }, variant === "popover" ? b.shortLabel : b.label)))
                            : null),
                    h("div", { className: "dsh-ctx-rows" },
                        shownItems.map(item => {
                            const barPct = Math.max(3, Math.round((item.tokens / maxItemTokens) * 100));
                            return h("button", {
                                key: item.id,
                                type: "button",
                                className: "dsh-ctx-row" + (item.isFirstBreak ? " is-break" : ""),
                                onMouseEnter: variant === "sheet" ? undefined : () => setRowHover({ kind: "item", itemId: item.id, bucket: item.bucket }),
                                onMouseLeave: variant === "sheet" ? undefined : () => setRowHover(prev => (prev && prev.itemId === item.id ? null : prev)),
                                onClick: () => item.cacheKey && props.onSelectSection && props.onSelectSection(item.cacheKey, item)
                            },
                            h("span", { className: "dsh-ctx-dot is-bucket-" + item.bucket }),
                            h("span", { className: "dsh-ctx-row-main" },
                                h("span", { className: "dsh-ctx-row-title" }, item.title),
                                item.subtitle ? h("span", { className: "dsh-ctx-row-sub" }, item.subtitle) : null),
                            item.isFirstBreak
                                ? h("span", { className: "dsh-ctx-row-badge is-break" }, "首处差异")
                                : (item.cacheStatus === "appended"
                                    ? h("span", { className: "dsh-ctx-row-badge is-appended" }, "新增")
                                    : null),
                            h("span", { className: "dsh-ctx-row-meter", "aria-hidden": true },
                                h("span", { className: "dsh-ctx-row-fill is-bucket-" + item.bucket, style: { width: barPct + "%" } })),
                            h("span", { className: "dsh-ctx-row-val" }, safeFormatTokens(item.tokens)));
                        })),
                    sortedItems.length > topLimit
                        ? h("button", {
                            type: "button",
                            className: "dsh-ctx-show-all",
                            onClick: () => setShowAll(prev => !prev)
                        }, showAll ? "收起明细" : ("显示全部 " + sortedItems.length + " 项"))
                        : null),
                variant === "popover"
                    ? h("div", { className: "dsh-ctx-popover-footer" },
                        canCompact
                            ? h("button", {
                                type: "button",
                                className: "dsh-ctx-action-btn",
                                disabled: props.compacting || props.compactDisabled,
                                onClick: props.onCompact
                            }, props.compacting ? "压缩中…" : "压缩上下文")
                            : h("span", { className: "dsh-ctx-footer-hint" }, props.record ? ("第 " + props.record.turn + " 轮 · 步骤 " + props.record.step) : ""),
                        props.onOpenFull
                            ? h("button", { type: "button", className: "dsh-ctx-action-btn is-primary", onClick: props.onOpenFull }, "完整分析 ›")
                            : null)
                    : null);
        }
        function FullRequestContextView(props) {
            const h = React.createElement;
            const [record, setRecord] = React.useState(null);
            const [meta, setMeta] = React.useState(null);
            const [scope, setScope] = React.useState("foreground");
            const [error, setError] = React.useState("");
            const [query, setQuery] = React.useState("");
            const [sourceFilter, setSourceFilter] = React.useState("all");
            const [refresh, setRefresh] = React.useState(0);
            const [jumpTarget, setJumpTarget] = React.useState({ key: "", tick: 0 });
            const [compacting, setCompacting] = React.useState(false);
            const [compactionNotice, setCompactionNotice] = React.useState("");
            const loaded = React.useRef(null);
            const listRef = React.useRef(null);
            const [loading, setLoading] = React.useState(true);
            const compaction = typeof useCompactionState === "function"
                ? useCompactionState(props.contextSessionId, [["contextCompaction"]])
                : { running: false };
            // Contexts reach 100k+ characters; filter off the typing path.
            const deferredQuery = React.useDeferredValue(query.toLowerCase());
            React.useEffect(() => {
                if (!props.contextSessionId || typeof tavernSessionSignals === "undefined") return;
                const reload = () => setRefresh(value => value + 1);
                return tavernSessionSignals?.subscribe(props.contextSessionId, "model-request", reload, undefined, reload);
            }, [props.contextSessionId]);
            React.useEffect(() => {
                let active = true; setError(""); setLoading(true);
                const cacheTag = props.contextSessionId + ":" + scope;
                if (loaded.current?.cacheTag !== cacheTag) { loaded.current = null; setRecord(null); setSourceFilter("all"); }
                rpc("getLatestRequestContext", {
                    sessionId: props.contextSessionId,
                    knownId: loaded.current?.id || "",
                    knownStatus: loaded.current?.status || "",
                    scope,
                    includeMeta: true
                }, props.contextSessionId)
                    .then(value => {
                        if (!active) return;
                        if (value.meta) setMeta(value.meta);
                        if (!value.record?.unchanged) {
                            setRecord(value.record);
                            loaded.current = value.record ? { cacheTag, sessionId: props.contextSessionId, id: value.record.id, status: value.record.status || "" } : null;
                        }
                    })
                    .catch(e => { if (active) setError(String(e.message || e)); })
                    .finally(() => { if (active) setLoading(false); });
                return () => { active = false; };
            }, [props.contextSessionId, scope, refresh]);
            React.useEffect(() => {
                if (!jumpTarget.key || !listRef.current || deferredQuery || sourceFilter !== "all") return;
                const el = listRef.current.querySelector('[data-cache-key="' + jumpTarget.key.replace(/"/g, '\\"') + '"]');
                if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "center" });
            }, [jumpTarget, deferredQuery, sourceFilter]);
            const request = record && record.request;
            const foregroundMode = foregroundRequestMode(record);
            const cacheDiff = record && record.cacheDiff;
            const sectionStatusMap = (cacheDiff && cacheDiff.sectionStatus) || {};
            const breakPoint = (cacheDiff && cacheDiff.breakPoint) || null;
            const text = React.useMemo(() => request ? JSON.stringify(request, null, 2) : "", [request]);
            const sections = React.useMemo(() => buildEnrichedSections(request), [request]);
            const summary = React.useMemo(() => {
                if (!record && !meta) return null;
                if (typeof buildContextWindowSummary !== "function") return null;
                return buildContextWindowSummary(record, meta, sections);
            }, [record, meta, sections]);
            React.useEffect(() => {
                if (scope === "foreground" && summary) syncBootTriggerVisual(props.contextSessionId, summary);
            }, [props.contextSessionId, scope, summary]);
            const injection = foregroundMode === "white-glove"
                ? sections.findLast(section => isCurrentWhiteGloveInjection(section.value, record.turn)) : undefined;
            const sourceCounts = React.useMemo(() => {
                const counts = {};
                for (const section of sections) {
                    const cats = new Set((section.sources || []).map(src => src.category));
                    for (const cat of cats) counts[cat] = (counts[cat] || 0) + 1;
                }
                return Object.keys(CONTEXT_SOURCE_CATEGORIES).filter(cat => counts[cat] > 0).map(cat => ({ key: cat, label: CONTEXT_SOURCE_CATEGORIES[cat], count: counts[cat] }));
            }, [sections]);
            function downloadJson() {
                downloadTavernBlob(new Blob([text], { type: "application/json;charset=utf-8" }), "request-context.json");
            }
            function jumpToSection(key) {
                if (!key) return;
                if (query) setQuery("");
                if (sourceFilter !== "all") setSourceFilter("all");
                setJumpTarget(prev => ({ key, tick: prev.tick + 1 }));
            }
            async function handleCompact() {
                if (compacting || compaction.running) return;
                setCompacting(true);
                setCompactionNotice("");
                try {
                    const op = await executeSessionCompaction(props.contextSessionId);
                    setCompactionNotice(op.backgroundSessionId ? "前后台压缩已启动" : "压缩已完成");
                    setRefresh(v => v + 1);
                } catch (err) {
                    setCompactionNotice(String(err && err.message || err));
                } finally {
                    setCompacting(false);
                }
            }
            const visibleSections = React.useMemo(() => sections.filter(section => {
                if (sourceFilter !== "all" && !(section.sources || []).some(src => src.category === sourceFilter)) return false;
                if (deferredQuery && !section.searchText.includes(deferredQuery)) return false;
                return true;
            }), [sections, sourceFilter, deferredQuery]);
            return h("section", { className: "dsh-tavern-full-context" },
                summary
                    ? h(TavernContextOverviewCard, {
                        summary,
                        record,
                        meta,
                        variant: "full",
                        scope,
                        onScopeChange: setScope,
                        onSelectSection: jumpToSection,
                        onCompact: handleCompact,
                        compacting: compacting || compaction.running,
                        compactionNotice,
                        loading,
                        onRefresh: () => setRefresh(value => value + 1),
                        onClose: props.onCloseModal
                    })
                    : h("header", { className: "dsh-context-header" },
                        h("div", null, h("h3", null, "完整上下文"), h("p", null, "最近一次请求 · 系统提示、工具与完整消息")),
                        h("div", { className: "dsh-ctx-card-actions" },
                            h("button", { disabled: loading, onClick: () => setRefresh(value => value + 1) }, loading ? "读取中…" : "刷新"),
                            props.onCloseModal ? h("button", { type: "button", className: "dsh-ctx-close-btn", "aria-label": "关闭", onClick: props.onCloseModal }, "×") : null)),
                record ? h("div", { className: "dsh-context-meta" },
                    h("span", { className: "dsh-context-badge" }, "第 " + record.turn + " 轮 · 步骤 " + record.step),
                    foregroundMode ? h("span", { className: "dsh-context-badge" }, foregroundMode === "white-glove" ? "白手套模式 · 前台" : "普通前台") : null,
                    injection ? h("button", { type: "button", className: "dsh-context-filter-chip", onClick: () => jumpToSection(injection.cacheKey) }, "查看本轮白手套注入")
                        : foregroundMode === "white-glove"
                            ? h("span", null, "本轮无新资料注入") : null,
                    h("span", null, request?.model || ""),
                    h("time", null, new Date(record.createdAt).toLocaleString())) : null,
                renderCacheDiffSummary(h, record, jumpToSection),
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
                        const isJumpTarget = Boolean(jumpTarget.key && section.cacheKey === jumpTarget.key);
                        const renderedParts = (section.displayParts || [{ text: section.text }]).filter(part => part.text.trim());
                        const hasPartBreakdown = Boolean(breakPoint && section.cacheKey === breakPoint.key) && !breakPoint.roleChanged && Number.isInteger(breakPoint.partIndex) && (renderedParts.length > 1 || breakPoint.partIndex >= renderedParts.length);
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
                            render: () => renderSectionDetailContent(h, section, breakPoint, record.id + ":" + sectionIndex + ":")
                        });
                    }),
                    (deferredQuery || sourceFilter !== "all") && !visibleSections.length ? h(EmptyState, { query: query || (CONTEXT_SOURCE_CATEGORIES[sourceFilter] || ""), onClear: () => { setQuery(""); setSourceFilter("all"); } }) : null) : null,
                request ? h("p", { className: "dsh-context-footnote" }, "发送时的上下文快照 · 供应商协议转换前 · 前缀标记来自本地请求对比") : null
            );
        }
        function TavernContextWindowOverlay(props) {
            const h = React.createElement;
            const sessionId = props.sessionId || "";
            const [latest, setLatest] = React.useState({ record: null, meta: null });
            const [refresh, setRefresh] = React.useState(0);
            const [desktopAnchor, setDesktopAnchor] = React.useState(null);
            const [fullModalOpen, setFullModalOpen] = React.useState(false);
            const [sheetState, setSheetState] = React.useState({ open: false, view: "overview", detailKey: "" });
            const [compacting, setCompacting] = React.useState(false);
            const [compactError, setCompactError] = React.useState("");
            const loadedRef = React.useRef(null);
            const popoverRef = React.useRef(null);
            const compaction = typeof useCompactionState === "function"
                ? useCompactionState(sessionId, [["contextCompaction"]])
                : { running: false };

            React.useEffect(() => {
                if (!sessionId || typeof tavernSessionSignals === "undefined") return;
                const reload = () => setRefresh(v => v + 1);
                return tavernSessionSignals?.subscribe(sessionId, "model-request", reload, undefined, reload);
            }, [sessionId]);

            React.useEffect(() => {
                if (!sessionId) {
                    setLatest({ record: null, meta: null });
                    syncBootTriggerVisual("", null);
                    return;
                }
                let active = true;
                if (loadedRef.current?.sessionId !== sessionId) loadedRef.current = null;
                rpc("getLatestRequestContext", {
                    sessionId,
                    knownId: loadedRef.current?.id || "",
                    knownStatus: loadedRef.current?.status || "",
                    scope: "foreground",
                    includeMeta: true
                }, sessionId)
                    .then(value => {
                        if (!active || !value) return;
                        setLatest(prev => {
                            const nextRecord = value.record?.unchanged ? prev.record : value.record;
                            const nextMeta = value.meta !== undefined ? value.meta : prev.meta;
                            if (nextRecord) {
                                loadedRef.current = { sessionId, id: nextRecord.id, status: nextRecord.status || "" };
                            }
                            return { record: nextRecord || null, meta: nextMeta || null };
                        });
                    })
                    .catch(() => {});
                return () => { active = false; };
            }, [sessionId, refresh]);

            const sections = React.useMemo(() => buildEnrichedSections(latest.record?.request), [latest.record]);
            const summary = React.useMemo(() => {
                if (!latest.record && !latest.meta) return null;
                if (typeof buildContextWindowSummary !== "function") return null;
                return buildContextWindowSummary(latest.record, latest.meta, sections);
            }, [latest.record, latest.meta, sections]);

            React.useEffect(() => {
                syncBootTriggerVisual(sessionId, summary);
            }, [sessionId, summary]);

            // 桌面端捕获点击原生 .JObwrW_trigger，改为弹出 426px Magpie 浮层
            React.useEffect(() => {
                if (typeof document === "undefined") return;
                function onDocClick(event) {
                    if (window.innerWidth < 1024) return;
                    const trigger = event.target && typeof event.target.closest === "function"
                        ? event.target.closest("[data-composer-dock] .JObwrW_trigger")
                        : null;
                    if (!trigger) return;
                    event.preventDefault();
                    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
                    event.stopPropagation();
                    setDesktopAnchor(prev => {
                        if (prev) return null;
                        const rect = trigger.getBoundingClientRect();
                        const popWidth = Math.min(426, window.innerWidth - 24);
                        const left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, Math.round(rect.right - popWidth)));
                        return {
                            bottom: Math.max(12, Math.round(window.innerHeight - rect.top + 8)),
                            left,
                            maxHeight: Math.max(260, Math.round(rect.top - 18))
                        };
                    });
                    setRefresh(v => v + 1);
                }
                document.addEventListener("click", onDocClick, true);
                return () => document.removeEventListener("click", onDocClick, true);
            }, []);

            // 监听移动端菜单底栏派发的开启事件
            React.useEffect(() => {
                if (typeof window === "undefined") return;
                function onOpenMobileSheet() {
                    setDesktopAnchor(null);
                    setCompactError("");
                    setSheetState({ open: true, view: "overview", detailKey: "" });
                    setRefresh(v => v + 1);
                }
                window.addEventListener("dsh-tavern:open-context-window", onOpenMobileSheet);
                return () => window.removeEventListener("dsh-tavern:open-context-window", onOpenMobileSheet);
            }, []);

            // 桌面 Popover 外部点击与 Escape 关闭
            React.useEffect(() => {
                if (!desktopAnchor && !fullModalOpen && !sheetState.open) return;
                function onKeyDown(event) {
                    if (event.key !== "Escape") return;
                    if (fullModalOpen) setFullModalOpen(false);
                    else if (desktopAnchor) setDesktopAnchor(null);
                    else if (sheetState.open) setSheetState({ open: false, view: "overview", detailKey: "" });
                }
                function onDocMouseDown(event) {
                    if (!desktopAnchor || !popoverRef.current) return;
                    if (popoverRef.current.contains(event.target)) return;
                    if (event.target && typeof event.target.closest === "function" && event.target.closest("[data-composer-dock] .JObwrW_trigger")) return;
                    setDesktopAnchor(null);
                }
                document.addEventListener("keydown", onKeyDown);
                document.addEventListener("mousedown", onDocMouseDown, true);
                return () => {
                    document.removeEventListener("keydown", onKeyDown);
                    document.removeEventListener("mousedown", onDocMouseDown, true);
                };
            }, [desktopAnchor, fullModalOpen, sheetState.open]);

            function openFullAnalysis(initialKey) {
                setDesktopAnchor(null);
                const tab = typeof document !== "undefined"
                    ? document.querySelector('[data-tavern-view-tab="dsh-tavern:full-context"]')
                    : null;
                const tabVisible = tab && (tab.offsetParent !== null || (typeof tab.getClientRects === "function" && tab.getClientRects().length > 0));
                if (tabVisible && !initialKey) {
                    tab.click();
                    return;
                }
                if (tabVisible && initialKey) {
                    tab.click();
                    return;
                }
                setFullModalOpen(true);
            }

            async function handleCompact() {
                if (compacting || compaction.running) return;
                setCompacting(true);
                setCompactError("");
                try {
                    await executeSessionCompaction(sessionId);
                    setRefresh(v => v + 1);
                } catch (err) {
                    setCompactError(String(err && err.message || err));
                } finally {
                    setCompacting(false);
                }
            }

            function openSheetDetail(cacheKey) {
                const targetKey = cacheKey || summary?.firstBreakKey || (summary?.items?.[0]?.cacheKey) || (sections[0]?.cacheKey) || "";
                setSheetState({ open: true, view: "detail", detailKey: targetKey });
            }

            const renderInPortal = node => {
                if (typeof ReactDOM !== "undefined" && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && document.body) {
                    return ReactDOM.createPortal(node, document.body);
                }
                return node;
            };

            const breakPoint = latest.record?.cacheDiff?.breakPoint || null;
            const detailSection = sheetState.open && sheetState.view === "detail"
                ? (sections.find(s => s.cacheKey === sheetState.detailKey) || sections[0] || null)
                : null;
            const focusKey = summary?.firstBreakKey || (summary?.items?.[0]?.cacheKey) || (sections[0]?.cacheKey) || "";

            const popoverNode = desktopAnchor
                ? renderInPortal(h("div", {
                    ref: popoverRef,
                    className: "dsh-ctx-popover",
                    role: "dialog",
                    "aria-label": "上下文窗口分布",
                    style: {
                        bottom: desktopAnchor.bottom + "px",
                        left: desktopAnchor.left + "px",
                        maxHeight: desktopAnchor.maxHeight + "px"
                    }
                },
                summary
                    ? h(TavernContextOverviewCard, {
                        summary,
                        record: latest.record,
                        meta: latest.meta,
                        variant: "popover",
                        onSelectSection: key => openFullAnalysis(key),
                        onCompact: handleCompact,
                        compacting: compacting || compaction.running,
                        onOpenFull: () => openFullAnalysis(""),
                        onClose: () => setDesktopAnchor(null)
                    })
                    : h("div", { className: "dsh-ctx-card is-popover" },
                        h("div", { className: "dsh-ctx-card-top" },
                            h("span", { className: "dsh-ctx-card-title" }, "上下文窗口"),
                            h("button", { type: "button", className: "dsh-ctx-close-btn", "aria-label": "关闭", onClick: () => setDesktopAnchor(null) }, "×")),
                        h("p", { className: "dsh-context-empty" }, "暂无已记录的请求上下文"),
                        h("div", { className: "dsh-ctx-popover-footer" },
                            h("span", null),
                            h("button", { type: "button", className: "dsh-ctx-action-btn is-primary", onClick: () => openFullAnalysis("") }, "完整分析 ›")))))
                : null;

            const modalNode = fullModalOpen
                ? renderInPortal(h("div", {
                    className: "dsh-ctx-modal-backdrop",
                    onClick: e => { if (e.target === e.currentTarget) setFullModalOpen(false); }
                }, h("div", {
                    className: "dsh-ctx-modal",
                    role: "dialog",
                    "aria-modal": "true",
                    "aria-label": "完整上下文分析"
                }, h(FullRequestContextView, {
                    contextSessionId: sessionId,
                    onCloseModal: () => setFullModalOpen(false)
                }))))
                : null;

            const sheetNode = sheetState.open
                ? renderInPortal(h("div", {
                    className: "dsh-ctx-sheet-backdrop",
                    onClick: e => { if (e.target === e.currentTarget) setSheetState({ open: false, view: "overview", detailKey: "" }); }
                }, h("div", {
                    className: "dsh-ctx-sheet",
                    role: "dialog",
                    "aria-modal": "true",
                    "aria-label": "移动端上下文分布"
                },
                h("div", { className: "dsh-ctx-sheet-handle", "aria-hidden": "true" }, h("span", null)),
                sheetState.view === "overview"
                    ? h(React.Fragment, null,
                        h("div", { className: "dsh-ctx-sheet-body" },
                            summary
                                ? h(TavernContextOverviewCard, {
                                    summary,
                                    record: latest.record,
                                    meta: latest.meta,
                                    variant: "sheet",
                                    onSelectSection: key => openSheetDetail(key),
                                    onCompact: handleCompact,
                                    compacting: compacting || compaction.running,
                                    onClose: () => setSheetState({ open: false, view: "overview", detailKey: "" })
                                })
                                : h("div", { className: "dsh-ctx-card is-sheet" },
                                    h("div", { className: "dsh-ctx-card-top" },
                                        h("span", { className: "dsh-ctx-card-title" }, "上下文窗口"),
                                        h("button", { type: "button", className: "dsh-ctx-close-btn", "aria-label": "关闭", onClick: () => setSheetState({ open: false, view: "overview", detailKey: "" }) }, "×")),
                                    h("p", { className: "dsh-context-empty" }, "暂无已记录的请求上下文")),
                            compactError ? h("p", { className: "dsh-ctx-sheet-err", role: "alert" }, compactError) : null),
                        h("div", { className: "dsh-ctx-sheet-sticky" },
                            h("button", {
                                type: "button",
                                className: "dsh-ctx-action-btn",
                                disabled: compacting || compaction.running,
                                onClick: handleCompact
                            }, compacting || compaction.running ? "压缩中…" : "压缩上下文"),
                            focusKey
                                ? h("button", {
                                    type: "button",
                                    className: "dsh-ctx-action-btn is-primary",
                                    onClick: () => openSheetDetail(focusKey)
                                }, summary?.firstBreakKey ? "查看断层原文 ›" : "查看重点原文 ›")
                                : null))
                    : h(React.Fragment, null,
                        h("div", { className: "dsh-ctx-sheet-subhead" },
                            h("button", {
                                type: "button",
                                className: "dsh-ctx-back-btn",
                                onClick: () => setSheetState(prev => ({ ...prev, view: "overview" }))
                            }, "‹ 返回总览"),
                            h("span", { className: "dsh-ctx-subhead-title" }, detailSection ? detailSection.title : "分段详情"),
                            h("button", {
                                type: "button",
                                className: "dsh-ctx-close-btn",
                                "aria-label": "关闭",
                                onClick: () => setSheetState({ open: false, view: "overview", detailKey: "" })
                            }, "×")),
                        h("div", { className: "dsh-ctx-sheet-body is-detail" },
                            detailSection
                                ? h("div", { className: "dsh-ctx-sheet-detail-inner" },
                                    h("div", { className: "dsh-ctx-sheet-detail-meta" },
                                        detailSection.tokens ? h("span", { className: "dsh-context-badge" }, "约 " + detailSection.tokens.toLocaleString() + " tokens") : null,
                                        (detailSection.sources || []).slice(0, 3).map((src, idx) => h("span", { key: idx, className: "dsh-context-source-pill is-src-" + src.category }, src.label))),
                                    renderSectionDetailContent(h, detailSection, breakPoint, "sheet-detail:"))
                                : h("p", { className: "dsh-context-empty" }, "未找到该分段的原文内容"))))))
                : null;

            return h(React.Fragment, null, popoverNode, modalNode, sheetNode);
        }

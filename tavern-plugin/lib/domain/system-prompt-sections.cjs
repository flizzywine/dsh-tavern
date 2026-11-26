// 共享的系统提示词区块识别与拆分工具（供服务端日志对比与前端上下文窗口共同使用）。
// 通过 `// @include-domain system-prompt-sections.cjs` 编入前端脚本，并与请求上下文 UI 共享作用域。

const TAVERN_KNOWN_SYSTEM_TAGS = Object.freeze({
    lorebook_constant: { sourceCategory: "worldbook", label: "常驻世界书", groupKey: "worldbook:constant", sectionName: "tavern:constant-worldbook" },
    constant_worldbook: { sourceCategory: "worldbook", label: "常驻世界书", groupKey: "worldbook:constant", sectionName: "tavern:constant-worldbook" },
    lorebook_files: { sourceCategory: "worldbook", label: "世界书 Skill", groupKey: "worldbook:skills", sectionName: "tavern:worldbook-skills" },
    lorebook_activated: { sourceCategory: "worldbook", label: "本轮世界书", groupKey: "worldbook:active" },

    character_card_name: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    character_card: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    character_description: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    character_personality: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    opening_scenario: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    style_examples: { sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    card_system: { sourceCategory: "card", label: "人物卡系统提示", groupKey: "card:system", sectionName: "tavern:card-system-prompt" },
    card_system_scope: { sourceCategory: "card", label: "人物卡系统提示", groupKey: "card:system", sectionName: "tavern:card-system-prompt" },
    post_history: { sourceCategory: "card", label: "人物卡后置指令", groupKey: "card:post-history", sectionName: "tavern:card-post-history" },

    user_preferences: { sourceCategory: "preset", label: "长期偏好", groupKey: "preset:preference", sectionName: "tavern:user-preference" },
    card_agent_persona: { sourceCategory: "preset", label: "卡片工作台性格", groupKey: "preset:card-persona", sectionName: "tavern:card-system" },

    variable_directory: { sourceCategory: "state", label: "变量目录", groupKey: "state:variable-directory", sectionName: "tavern:variable-directory" },
    character_state: { sourceCategory: "state", label: "当前状态", groupKey: "state:current" },
    user_guide: { sourceCategory: "state", label: "创作指引", groupKey: "state:guide" },

    script_reference: { sourceCategory: "story", label: "剧本参考", groupKey: "story:script" },
    script_window: { sourceCategory: "story", label: "剧本参考", groupKey: "story:script" },

    system_append: { sourceCategory: "system", label: "系统追加", groupKey: "system", sectionName: "tavern:system-append" },
    output_method: { sourceCategory: "plugin", label: "工具提交规范", groupKey: "system", sectionName: "tavern:story-tool-submission" },
    output_method_reminder: { sourceCategory: "plugin", label: "工具提交规范", groupKey: "system", sectionName: "tavern:story-tool-submission-reminder" },
    foreground_style_reference: { sourceCategory: "plugin", label: "文风参考", groupKey: "system", sectionName: "tavern:foreground-style-reference" },
    foreground_story_candidates: { sourceCategory: "plugin", label: "候选参考", groupKey: "system", sectionName: "tavern:foreground-candidates" },
    stage_assets: { sourceCategory: "plugin", label: "舞台素材", groupKey: "system" }
});

const TAVERN_LEGACY_SYSTEM_HEADINGS = Object.freeze([
    { heading: "【常驻世界书】", sourceCategory: "worldbook", label: "常驻世界书", groupKey: "worldbook:constant", sectionName: "tavern:constant-worldbook" },
    { heading: "【故事设定 · 人物卡】", sourceCategory: "card", label: "人物卡", groupKey: "card:profile", sectionName: "tavern:character-card" },
    { heading: "【人物卡系统提示】", sourceCategory: "card", label: "人物卡系统提示", groupKey: "card:system", sectionName: "tavern:card-system-prompt" },
    { heading: "【用户已确认的长期偏好】", sourceCategory: "preset", label: "长期偏好", groupKey: "preset:preference", sectionName: "tavern:user-preference" }
]);

function fallbackGroupKeyForCategory(category) {
    if (category === "worldbook") return "worldbook";
    if (category === "card") return "card";
    if (category === "state" || category === "injection") return "state";
    if (category === "story") return "story";
    if (category === "tool") return "tool";
    return "system";
}

/** 将内部 section 名称统一映射为来源分类、中文标签与语境摘要分组键。 */
function describeTavernSystemSection(name, rest) {
    const key = typeof name === "string" ? name : "";
    if (!key) return { category: "plugin", label: "附加上下文", groupKey: "system" };
    if (key === "tavern:runtime-preset-front") return { category: "preset", label: "前段预设", groupKey: "preset:front" };
    if (key === "tavern:runtime-preset-middle") return { category: "preset", label: "中段预设", groupKey: "preset:middle" };
    if (key === "tavern:runtime-preset-back") return { category: "preset", label: "末尾预设投影", groupKey: "preset:back" };
    if (key === "tavern:constant-worldbook") return { category: "worldbook", label: "常驻世界书", groupKey: "worldbook:constant" };
    if (key === "tavern:worldbook-skills") return { category: "worldbook", label: "世界书 Skill", groupKey: "worldbook:skills" };
    if (key.includes(":activeWorldbook:")) return { category: "worldbook", label: "本轮世界书", groupKey: "worldbook:active" };
    if (key === "tavern:character-card") return { category: "card", label: "人物卡", groupKey: "card:profile" };
    if (key === "tavern:card-system-prompt") return { category: "card", label: "人物卡系统提示", groupKey: "card:system" };
    if (key === "tavern:card-post-history") return { category: "card", label: "人物卡后置指令", groupKey: "card:post-history" };
    if (key === "tavern:card-system") return { category: "preset", label: "卡片工作台性格", groupKey: "preset:card-persona" };
    if (key === "tavern:card-reference") return { category: "card", label: "人物卡参考", groupKey: "card:reference" };
    if (key === "tavern:user-preference") return { category: "preset", label: "长期偏好", groupKey: "preset:preference" };
    if (key === "tavern:variable-directory") return { category: "state", label: "变量目录", groupKey: "state:variable-directory" };
    if (key.includes(":currentStateProjection:")) return { category: "state", label: "当前状态", groupKey: "state:current" };
    if (key === "tavern:user-guide") return { category: "state", label: "创作指引", groupKey: "state:guide" };
    if (key === "tavern:script-reference") return { category: "story", label: "剧本参考", groupKey: "story:script" };
    if (key === "tavern:turn") return { category: "story", label: "玩家输入", groupKey: "story:turn" };
    if (key === "tavern:story-base") return { category: "system", label: "正文基础规则", groupKey: "system" };
    if (key.includes(":writingRules:")) return { category: "plugin", label: "写作规则", groupKey: "system" };
    if (key === "tavern:resource-workspace") return { category: "plugin", label: "工作区资源", groupKey: "system" };
    if (key === "tavern:play-chat-diagnostics") return { category: "plugin", label: "游玩记录排查指引", groupKey: "system" };
    if (key === "tavern:plugin-body-generation" || key === "tavern:plugin-body-generation-reminder") return { category: "plugin", label: "正文生成规范", groupKey: "system" };
    if (key === "tavern:story-tool-submission" || key === "tavern:story-tool-submission-reminder") return { category: "plugin", label: "工具提交规范", groupKey: "system" };
    if (key === "tavern:no-foreground-tools") return { category: "plugin", label: "工具禁用说明", groupKey: "system" };
    if (key === "tavern:foreground-style-reference") return { category: "plugin", label: "文风参考", groupKey: "system" };
    if (key === "tavern:foreground-candidates") return { category: "plugin", label: "候选参考", groupKey: "system" };
    if (key === "tavern:system-append") return { category: "system", label: "系统追加", groupKey: "system" };
    if (key === "tavern:session-context") return { category: "system", label: "会话上下文", groupKey: "system" };
    if (key === "tavern:dsh-system") return { category: "system", label: rest || "系统提示词", groupKey: "system" };
    if (key.startsWith("deployment:")) return { category: "plugin", label: "后台任务 · " + key.slice("deployment:".length), groupKey: "system" };
    if (key.startsWith("tavern:foreground:")) return { category: "plugin", label: "前台注入", groupKey: "system" };
    return { category: "plugin", label: key, groupKey: "system" };
}

function isLineStart(text, index) {
    return index === 0 || text.charCodeAt(index - 1) === 10;
}

function isLineEndOrCr(text, index) {
    if (index >= text.length) return true;
    const code = text.charCodeAt(index);
    return code === 10 || code === 13;
}

/** 按顺序将装配时的系统分段列表对齐到最终 systemText 中的行边界区间。 */
function buildSystemSectionSpans(systemText, sections) {
    if (typeof systemText !== "string" || !systemText || !Array.isArray(sections) || !sections.length) {
        return [];
    }
    const spans = [];
    let cursor = 0;

    function findAligned(needle, fromIndex) {
        let pos = systemText.indexOf(needle, fromIndex);
        while (pos >= 0) {
            const end = pos + needle.length;
            if (isLineStart(systemText, pos) && isLineEndOrCr(systemText, end)) {
                return { start: pos, end };
            }
            pos = systemText.indexOf(needle, pos + 1);
        }
        return null;
    }

    for (const section of sections) {
        if (!section || typeof section !== "object") continue;
        const name = typeof section.name === "string" ? section.name : "";
        const raw = typeof section.text === "string" ? section.text : "";
        if (!raw.trim()) continue;
        const trimmed = raw.trim();
        let hit = findAligned(raw, cursor);
        if (!hit && trimmed !== raw) {
            hit = findAligned(trimmed, cursor);
        }
        if (!hit) continue;
        cursor = hit.end;
        spans.push({ name, start: hit.start, end: hit.end });
    }

    spans.sort(function (a, b) {
        if (a.start !== b.start) return a.start - b.start;
        return a.end - b.end;
    });

    const normalized = [];
    let lastEnd = 0;
    for (const span of spans) {
        if (span.start < lastEnd) continue;
        normalized.push(span);
        lastEnd = span.end;
    }
    return normalized;
}

function findNextLineStart(text, fromIndex) {
    const nl = text.indexOf("\n", fromIndex);
    return nl >= 0 ? nl + 1 : text.length;
}

function findMatchingMultilineBlockEnd(text, tag, bodyStart) {
    const openLine = "<" + tag + ">";
    const closeLine = "</" + tag + ">";
    let depth = 1;
    let pos = bodyStart;
    while (pos < text.length) {
        let lineEnd = text.indexOf("\n", pos);
        const hasNl = lineEnd >= 0;
        if (!hasNl) lineEnd = text.length;
        const rawEnd = lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
        const line = text.slice(pos, rawEnd);
        if (line === openLine) {
            depth += 1;
        } else if (line === closeLine) {
            depth -= 1;
            if (depth === 0) return rawEnd;
        }
        if (!hasNl) break;
        pos = lineEnd + 1;
    }
    return -1;
}

function mergeAdjacentKnownMatches(text, matches) {
    if (matches.length <= 1) return matches;
    const merged = [matches[0]];
    for (let i = 1; i < matches.length; i++) {
        const prev = merged[merged.length - 1];
        const cur = matches[i];
        const sameMergeGroup = prev.meta.groupKey === cur.meta.groupKey &&
            (prev.meta.groupKey === "card:profile" || prev.meta.groupKey === "card:system");
        if (sameMergeGroup && !text.slice(prev.end, cur.start).trim()) {
            prev.end = cur.end;
            continue;
        }
        merged.push(cur);
    }
    return merged;
}

function assemblePartsFromMatches(text, matches, fallbackLabel, fallbackCategory) {
    const merged = mergeAdjacentKnownMatches(text, matches);
    const fallbackGroupKey = fallbackGroupKeyForCategory(fallbackCategory);
    const parts = [];
    let cursor = 0;
    for (const item of merged) {
        if (item.start > cursor) {
            const gap = text.slice(cursor, item.start).trim();
            if (gap) {
                parts.push({
                    text: gap,
                    label: fallbackLabel,
                    sourceCategory: fallbackCategory,
                    groupKey: fallbackGroupKey
                });
            }
        }
        const slice = text.slice(item.start, item.end);
        if (slice.trim()) {
            parts.push({
                text: slice,
                label: item.meta.label,
                sourceCategory: item.meta.sourceCategory,
                groupKey: item.meta.groupKey,
                ...(item.meta.sectionName ? { sectionName: item.meta.sectionName } : {}),
                explicitLabel: true
            });
        }
        cursor = item.end;
    }
    if (cursor < text.length) {
        const tail = text.slice(cursor).trim();
        if (tail) {
            parts.push({
                text: tail,
                label: fallbackLabel,
                sourceCategory: fallbackCategory,
                groupKey: fallbackGroupKey
            });
        }
    }
    return parts;
}

function splitByLegacyHeadings(text, fallbackLabel, fallbackCategory) {
    const starts = [];
    let pos = 0;
    while (pos < text.length) {
        let lineEnd = text.indexOf("\n", pos);
        const hasNl = lineEnd >= 0;
        if (!hasNl) lineEnd = text.length;
        const rawEnd = lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
        const line = text.slice(pos, rawEnd);
        for (const def of TAVERN_LEGACY_SYSTEM_HEADINGS) {
            if (line === def.heading) {
                starts.push({ index: pos, meta: def });
                break;
            }
        }
        if (!hasNl) break;
        pos = lineEnd + 1;
    }
    if (!starts.length) return null;
    const matches = starts.map(function (entry, idx) {
        const rawEnd = idx + 1 < starts.length ? starts[idx + 1].index : text.length;
        let trimmedEnd = rawEnd;
        while (trimmedEnd > entry.index && /\s/.test(text[trimmedEnd - 1])) trimmedEnd -= 1;
        return { start: entry.index, end: trimmedEnd, meta: entry.meta };
    });
    return assemblePartsFromMatches(text, matches, fallbackLabel, fallbackCategory);
}

/** 扫描顶层已知 XML 区块标签（及旧版中文标题）切分文本，不递归拆解标签内部内容。 */
function splitSystemTextByKnownTags(text, fallbackLabel = "系统提示词", fallbackCategory = "system") {
    if (typeof text !== "string" || !text.trim()) return null;
    const matches = [];
    let pos = 0;
    while (pos < text.length) {
        let lineEnd = text.indexOf("\n", pos);
        const hasNl = lineEnd >= 0;
        if (!hasNl) lineEnd = text.length;
        const rawEnd = lineEnd > pos && text.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
        if (text.charCodeAt(pos) === 60 /* '<' */) {
            const line = text.slice(pos, rawEnd);
            const openMatch = /^<([a-z][a-z0-9_]*)>$/.exec(line);
            if (openMatch && Object.hasOwn(TAVERN_KNOWN_SYSTEM_TAGS, openMatch[1])) {
                const tag = openMatch[1];
                const blockEnd = hasNl ? findMatchingMultilineBlockEnd(text, tag, lineEnd + 1) : -1;
                if (blockEnd > pos) {
                    matches.push({ start: pos, end: blockEnd, meta: TAVERN_KNOWN_SYSTEM_TAGS[tag] });
                    pos = findNextLineStart(text, blockEnd);
                    continue;
                }
            } else if (line.startsWith("<output_method>") && line.endsWith("</output_method>")) {
                matches.push({ start: pos, end: rawEnd, meta: TAVERN_KNOWN_SYSTEM_TAGS.output_method });
                if (!hasNl) break;
                pos = lineEnd + 1;
                continue;
            }
        }
        if (!hasNl) break;
        pos = lineEnd + 1;
    }

    if (matches.length > 0) {
        return assemblePartsFromMatches(text, matches, fallbackLabel, fallbackCategory);
    }
    return splitByLegacyHeadings(text, fallbackLabel, fallbackCategory);
}

function canExpandContainerSection(name) {
    if (!name) return true;
    if (name === "tavern:dsh-system" || name === "tavern:session-context") return true;
    if (name.startsWith("deployment:")) return true;
    return false;
}

/** 将顶层 system 文本优先按后端记录的区间 span 拆分，缺失或容器块再用标签扫描补全。 */
function splitSystemPromptParts(systemText, systemSpans) {
    if (typeof systemText !== "string" || !systemText) return [];

    const validSpans = [];
    if (Array.isArray(systemSpans) && systemSpans.length > 0) {
        const sorted = systemSpans
            .filter(function (item) {
                return item && typeof item === "object" &&
                    Number.isInteger(item.start) && Number.isInteger(item.end) &&
                    item.start >= 0 && item.end > item.start && item.end <= systemText.length;
            })
            .slice()
            .sort(function (a, b) {
                if (a.start !== b.start) return a.start - b.start;
                return a.end - b.end;
            });
        let lastEnd = 0;
        for (const item of sorted) {
            if (item.start < lastEnd) continue;
            validSpans.push({
                name: typeof item.name === "string" ? item.name : "",
                start: item.start,
                end: item.end
            });
            lastEnd = item.end;
        }
    }

    let rawParts = [];
    if (validSpans.length > 0) {
        let cursor = 0;
        for (const span of validSpans) {
            if (span.start > cursor) {
                const gap = systemText.slice(cursor, span.start).trim();
                if (gap) {
                    const gapSplit = splitSystemTextByKnownTags(gap, "系统提示词", "system");
                    if (gapSplit && gapSplit.length > 0) {
                        rawParts.push(...gapSplit);
                    } else {
                        rawParts.push({
                            text: gap,
                            label: "系统提示词",
                            sourceCategory: "system",
                            groupKey: "system"
                        });
                    }
                }
            }
            const slice = systemText.slice(span.start, span.end);
            if (slice.trim()) {
                const desc = describeTavernSystemSection(span.name, "系统提示词");
                const nested = canExpandContainerSection(span.name)
                    ? splitSystemTextByKnownTags(slice, desc.label, desc.category)
                    : null;
                if (nested && nested.length > 0) {
                    rawParts.push(...nested);
                } else {
                    rawParts.push({
                        text: slice,
                        label: desc.label || "系统提示词",
                        sourceCategory: desc.category || "system",
                        groupKey: desc.groupKey || fallbackGroupKeyForCategory(desc.category),
                        ...(span.name ? { sectionName: span.name } : {}),
                        explicitLabel: true
                    });
                }
            }
            cursor = span.end;
        }
        if (cursor < systemText.length) {
            const tail = systemText.slice(cursor).trim();
            if (tail) {
                const tailSplit = splitSystemTextByKnownTags(tail, "系统提示词", "system");
                if (tailSplit && tailSplit.length > 0) {
                    rawParts.push(...tailSplit);
                } else {
                    rawParts.push({
                        text: tail,
                        label: "系统提示词",
                        sourceCategory: "system",
                        groupKey: "system"
                    });
                }
            }
        }
    } else {
        const tagParts = splitSystemTextByKnownTags(systemText, "系统提示词", "system");
        if (tagParts && tagParts.length > 0) {
            rawParts = tagParts;
        }
    }

    const nonEmpty = rawParts.filter(function (part) {
        return part && typeof part.text === "string" && part.text.trim().length > 0;
    });

    if (nonEmpty.length === 0) {
        return [{
            text: systemText,
            label: undefined,
            sourceCategory: "system",
            groupKey: "system",
            isPlainSystem: true
        }];
    }

    if (nonEmpty.length === 1) {
        const sole = nonEmpty[0];
        if (sole.sourceCategory === "system" && sole.groupKey === "system" && !sole.sectionName && !sole.explicitLabel) {
            return [{
                text: systemText,
                label: undefined,
                sourceCategory: "system",
                groupKey: "system",
                isPlainSystem: true
            }];
        }
    }

    return nonEmpty.map(function (part) {
        const { explicitLabel: _ignored, ...clean } = part;
        return clean;
    });
}

if (typeof window === "undefined") {
    module.exports = {
        describeTavernSystemSection,
        buildSystemSectionSpans,
        splitSystemTextByKnownTags,
        splitSystemPromptParts
    };
}

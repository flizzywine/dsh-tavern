// 酒馆上下文窗口共享纯函数数据模型：
// 负责 6 个酒馆语境桶归类、最大余数法整数归一化、方案 C 触发器状态、
// 非线性 Squarified Treemap 与 400 格 Waffle 计算。
// 通过 main.js 中的 `// @include` 编入前端脚本，并与 request-context.js 共享全局作用域。

const TAVERN_CONTEXT_BUCKETS = [
    { key: "worldbook", label: "世界书", shortLabel: "世界书" },
    { key: "card", label: "人物卡", shortLabel: "人物卡" },
    { key: "system", label: "系统与预设", shortLabel: "系统" },
    { key: "state", label: "状态与注入", shortLabel: "状态" },
    { key: "tool", label: "工具与结果", shortLabel: "工具" },
    { key: "story", label: "剧情对话", shortLabel: "剧情" }
];

const TAVERN_CONTEXT_BUCKET_MAP = Object.fromEntries(TAVERN_CONTEXT_BUCKETS.map(function (bucket) {
    return [bucket.key, bucket];
}));

/** 将 sections 来源分类映射为 6 个酒馆上下文语境桶之一。 */
function mapSourceCategoryToContextBucket(category) {
    const key = typeof category === "string" ? category.trim() : "";
    if (key === "worldbook") return "worldbook";
    if (key === "card") return "card";
    if (key === "state" || key === "injection") return "state";
    if (key === "tool") return "tool";
    if (key === "story") return "story";
    if (key === "system" || key === "preset" || key === "skill" || key === "plugin") return "system";
    return "system";
}

/** 将 token 数量格式化为简洁紧凑字符串（例如 1.2M、63.2K、840）。 */
function formatContextTokens(tokens) {
    if (tokens === null || tokens === undefined || tokens === "") return "—";
    const num = Number(tokens);
    if (!Number.isFinite(num) || num < 0) return "—";
    if (num >= 1000000) {
        const formatted = (num / 1000000).toFixed(num >= 10000000 ? 0 : 1).replace(/\.0$/, "");
        return formatted + "M";
    }
    if (num >= 1000) {
        const formatted = (num / 1000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, "");
        return formatted + "K";
    }
    return String(Math.round(num));
}

function estimateContextTokenFallback(text) {
    if (typeof estimateTavernTokens === "function") return estimateTavernTokens(text);
    const content = String(text ?? "");
    return content ? Math.max(1, Math.ceil(content.length / 3)) : 0;
}

function estimateSectionRawData(section) {
    if (!section || typeof section !== "object") {
        return { rawTokens: 0, bucket: "system", subtitle: "" };
    }
    const bucketWeights = Object.create(null);
    let partTotal = 0;
    const partLabels = [];
    const partList = Array.isArray(section.parts) && section.parts.length > 0
        ? section.parts
        : (Array.isArray(section.displayParts) ? section.displayParts : null);
    if (partList && partList.length > 0) {
        for (const part of partList) {
            if (!part) continue;
            const text = String(part.text ?? "");
            if (!text) continue;
            const est = Math.max(0, estimateContextTokenFallback(text));
            partTotal += est;
            const cat = part.catalog ? "plugin" : (part.sourceCategory || (section.sources && section.sources[0] && section.sources[0].category) || "");
            const bucket = mapSourceCategoryToContextBucket(cat);
            bucketWeights[bucket] = (bucketWeights[bucket] || 0) + Math.max(1, est);
            if (part.label && !partLabels.includes(part.label)) partLabels.push(part.label);
        }
    }
    let rawTokens = partTotal;
    if (rawTokens <= 0) {
        if (Number.isFinite(Number(section.rawTokens)) && Number(section.rawTokens) > 0) {
            rawTokens = Math.round(Number(section.rawTokens));
        } else if (Number.isFinite(Number(section.tokens)) && Number(section.tokens) > 0) {
            rawTokens = Math.round(Number(section.tokens));
        } else if (typeof section.text === "string" && section.text.length > 0) {
            rawTokens = Math.max(0, estimateContextTokenFallback(section.text));
        } else if (section.value !== undefined) {
            const rawText = typeof section.value === "string" ? section.value : JSON.stringify(section.value);
            rawTokens = Math.max(0, estimateContextTokenFallback(rawText || ""));
        }
    }
    let primaryBucket = mapSourceCategoryToContextBucket((section.sources && section.sources[0] && section.sources[0].category) || "");
    let bestWeight = -1;
    for (const def of TAVERN_CONTEXT_BUCKETS) {
        const w = bucketWeights[def.key] || 0;
        if (w > bestWeight && w > 0) {
            bestWeight = w;
            primaryBucket = def.key;
        }
    }
    let subtitle = "";
    if (partLabels.length > 1) {
        subtitle = partLabels.slice(0, 3).join(" · ");
    } else if (Array.isArray(section.sources) && section.sources.length > 0) {
        subtitle = section.sources.map(function (s) { return s && s.label; }).filter(Boolean).slice(0, 2).join(" · ");
    }
    return {
        rawTokens: Math.max(0, rawTokens),
        bucket: primaryBucket,
        subtitle
    };
}

/** 使用最大余数法（Hamilton 方法）将各段整数 token 严格对齐到 targetTotal。 */
function normalizeContextTokenCounts(entries, targetTotal) {
    const count = entries.length;
    if (!count) return [];
    const total = Math.max(0, Math.round(Number(targetTotal) || 0));
    if (total === 0) return entries.map(function () { return 0; });
    const weights = entries.map(function (item) { return Math.max(0, Number(item.rawTokens) || 0); });
    let sumWeights = weights.reduce(function (acc, val) { return acc + val; }, 0);
    const effective = sumWeights > 0 ? weights : entries.map(function () { return 1; });
    if (sumWeights <= 0) sumWeights = count;

    const results = new Array(count);
    const remainders = new Array(count);
    let assigned = 0;
    for (let i = 0; i < count; i++) {
        const exact = (total * effective[i]) / sumWeights;
        const floored = Math.floor(exact);
        results[i] = floored;
        remainders[i] = { index: i, rem: exact - floored };
        assigned += floored;
    }
    const deficit = total - assigned;
    if (deficit > 0) {
        remainders.sort(function (a, b) {
            if (b.rem !== a.rem) return b.rem - a.rem;
            return a.index - b.index;
        });
        for (let i = 0; i < deficit && i < remainders.length; i++) {
            results[remainders[i].index] += 1;
        }
    }
    return results;
}

function readMeasuredUsage(record) {
    const usage = (record && record.cacheDiff && record.cacheDiff.usage) || (record && record.usage) || null;
    if (!usage || typeof usage !== "object") return null;
    const inputTokens = Math.max(0, Math.round(Number(usage.inputTokens) || 0));
    const cacheReadTokens = Math.max(0, Math.round(Number(usage.cacheReadTokens) || 0));
    const cacheWriteTokens = Math.max(0, Math.round(Number(usage.cacheWriteTokens) || 0));
    const explicitTotal = Number(usage.totalInputTokens);
    const totalInputTokens = Number.isFinite(explicitTotal) && explicitTotal > 0
        ? Math.round(explicitTotal)
        : (inputTokens + cacheReadTokens + cacheWriteTokens);
    if (totalInputTokens <= 0) return null;
    return {
        totalInputTokens,
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        cacheWrite1hTokens: Number.isFinite(Number(usage.cacheWrite1hTokens)) ? Math.max(0, Math.round(Number(usage.cacheWrite1hTokens))) : 0,
        cacheWrite5mTokens: Number.isFinite(Number(usage.cacheWrite5mTokens)) ? Math.max(0, Math.round(Number(usage.cacheWrite5mTokens))) : 0
    };
}

/** 构造完整上下文窗口摘要模型，同时服务桌面 Popover、完整页与移动 Bottom Sheet。 */
function buildContextWindowSummary(record, meta, sectionsInput) {
    const sections = Array.isArray(sectionsInput)
        ? sectionsInput
        : (record && record.request && typeof requestContextSections === "function" ? requestContextSections(record.request) : []);
    const sectionStatusMap = (record && record.cacheDiff && record.cacheDiff.sectionStatus) || {};
    const breakPoint = (record && record.cacheDiff && record.cacheDiff.breakPoint) || null;
    const firstBreakKey = (breakPoint && breakPoint.key) || "";
    const measuredUsage = readMeasuredUsage(record);

    const parsed = sections.map(function (section, index) {
        const info = estimateSectionRawData(section);
        const key = section.cacheKey || ("section:" + index);
        const title = section.title || key;
        const cacheStatus = section.cacheKey ? (sectionStatusMap[section.cacheKey] || "") : "";
        return {
            id: key + "#" + index,
            index,
            cacheKey: section.cacheKey || "",
            title,
            label: title,
            subtitle: info.subtitle,
            bucket: info.bucket,
            rawTokens: info.rawTokens,
            cacheStatus,
            isFirstBreak: Boolean(firstBreakKey && section.cacheKey === firstBreakKey),
            sources: Array.isArray(section.sources) ? section.sources : []
        };
    });

    const rawSum = parsed.reduce(function (sum, item) { return sum + item.rawTokens; }, 0);
    const measured = Boolean(measuredUsage && measuredUsage.totalInputTokens > 0);
    const usedTokens = measured ? measuredUsage.totalInputTokens : rawSum;
    const normalized = measured
        ? normalizeContextTokenCounts(parsed, usedTokens)
        : parsed.map(function (item) { return item.rawTokens; });

    const contextWindowRaw = Number(meta && meta.contextWindow);
    const contextWindow = Number.isFinite(contextWindowRaw) && contextWindowRaw > 0 ? Math.round(contextWindowRaw) : null;
    const freeTokens = contextWindow ? Math.max(0, contextWindow - usedTokens) : null;
    const usedRatio = contextWindow ? Math.max(0, Math.min(1, usedTokens / contextWindow)) : null;
    const usedPercent = usedRatio !== null ? Math.round(usedRatio * 1000) / 10 : null;
    const denom = contextWindow || Math.max(1, usedTokens);

    const bucketTotals = Object.create(null);
    const bucketCounts = Object.create(null);
    for (const def of TAVERN_CONTEXT_BUCKETS) {
        bucketTotals[def.key] = 0;
        bucketCounts[def.key] = 0;
    }

    const items = parsed.map(function (item, idx) {
        const tokens = normalized[idx] || 0;
        bucketTotals[item.bucket] = (bucketTotals[item.bucket] || 0) + tokens;
        bucketCounts[item.bucket] = (bucketCounts[item.bucket] || 0) + 1;
        return {
            ...item,
            tokens,
            shareOfUsed: usedTokens > 0 ? tokens / usedTokens : 0,
            shareOfWindow: denom > 0 ? tokens / denom : 0
        };
    });

    const buckets = TAVERN_CONTEXT_BUCKETS.map(function (def) {
        const tokens = bucketTotals[def.key] || 0;
        return {
            key: def.key,
            label: def.label,
            shortLabel: def.shortLabel,
            tokens,
            count: bucketCounts[def.key] || 0,
            shareOfUsed: usedTokens > 0 ? tokens / usedTokens : 0,
            shareOfWindow: denom > 0 ? tokens / denom : 0
        };
    });

    const compactionPolicy = (meta && meta.compactionPolicy) || null;
    const policyPercent = Number(compactionPolicy && compactionPolicy.percent);
    const compactionThresholdPercent = compactionPolicy && compactionPolicy.mode === "percent" && Number.isFinite(policyPercent) && policyPercent > 0
        ? Math.min(98, Math.max(10, Math.round(policyPercent)))
        : 80;

    const cacheReadTokens = measured ? measuredUsage.cacheReadTokens : null;
    const cacheWriteTokens = measured ? measuredUsage.cacheWriteTokens : null;
    const uncachedInputTokens = measured ? Math.max(0, usedTokens - cacheReadTokens - cacheWriteTokens) : null;
    const cacheHitRate = measured && usedTokens > 0 ? Math.max(0, Math.min(1, cacheReadTokens / usedTokens)) : null;
    const zeroReadReason = (record && record.cacheDiff && record.cacheDiff.zeroReadReason) || null;
    const hasCacheAlert = Boolean(
        measured &&
        cacheReadTokens === 0 &&
        record &&
        record.cacheDiff &&
        (record.cacheDiff.compareStatus === "compared" || zeroReadReason === "ttl-or-provider")
    );

    const warnPercent = Math.max(50, compactionThresholdPercent - 15);
    let health = "healthy";
    if (usedPercent !== null && usedPercent >= compactionThresholdPercent) health = "danger";
    else if ((usedPercent !== null && usedPercent >= warnPercent) || hasCacheAlert) health = "warn";

    let tone = "normal";
    if (usedPercent !== null && usedPercent >= compactionThresholdPercent) tone = "danger";
    else if (hasCacheAlert) tone = "cache-break";
    else if (usedPercent !== null && usedPercent >= warnPercent) tone = "warn";

    const intPercent = usedPercent !== null ? Math.round(usedPercent) : null;
    const liquidLevel = intPercent !== null
        ? (intPercent > 0 ? Math.max(6, Math.min(100, intPercent)) : 0)
        : 0;
    const alertPill = tone === "danger" && intPercent !== null
        ? (intPercent + "%")
        : (tone === "cache-break" ? "0%" : "");

    const bucketShares = buckets
        .filter(function (b) { return b.tokens > 0; })
        .map(function (b) { return { key: b.key, share: b.shareOfWindow, shareOfUsed: b.shareOfUsed }; });

    return {
        measured,
        usedTokens,
        contextWindow,
        freeTokens,
        usedRatio,
        usedPercent,
        buckets,
        items,
        cache: {
            measured,
            readTokens: cacheReadTokens,
            writeTokens: cacheWriteTokens,
            uncachedTokens: uncachedInputTokens,
            hitRate: cacheHitRate,
            write1hTokens: measured ? measuredUsage.cacheWrite1hTokens : 0,
            write5mTokens: measured ? measuredUsage.cacheWrite5mTokens : 0,
            compareStatus: (record && record.cacheDiff && record.cacheDiff.compareStatus) || "",
            zeroReadReason,
            hasAlert: hasCacheAlert,
            breakPoint
        },
        health,
        compactionThresholdPercent,
        compactionPolicy,
        recentSeries: Array.isArray(meta && meta.recentSeries) ? meta.recentSeries : [],
        scope: (meta && meta.scope) || (record && record.scope) || "foreground",
        hasBackground: Boolean(meta && meta.hasBackground),
        firstBreakKey,
        triggerState: {
            percent: intPercent,
            level: liquidLevel,
            tone,
            alertPill,
            bucketShares
        }
    };
}

/** 标准 Squarified Treemap 递归布局，输出与输入对应的绝对矩形（单位继承 x/y/w/h）。 */
function squarifyContextRects(items, x, y, w, h) {
    const valid = (Array.isArray(items) ? items : [])
        .filter(function (item) { return item && Number(item.weight) > 0; })
        .map(function (item) { return { ...item, weight: Number(item.weight) }; })
        .sort(function (a, b) { return b.weight - a.weight; });
    if (!valid.length || w <= 0 || h <= 0) return [];

    const totalWeight = valid.reduce(function (sum, item) { return sum + item.weight; }, 0);
    if (totalWeight <= 0) return [];

    const totalArea = w * h;
    const weighted = valid.map(function (item) {
        return { ...item, _area: (item.weight / totalWeight) * totalArea };
    });

    const out = [];

    function worstAspect(row, shortSide) {
        if (!row.length || shortSide <= 0) return Infinity;
        let sumArea = 0;
        let maxArea = 0;
        let minArea = Infinity;
        for (const item of row) {
            sumArea += item._area;
            if (item._area > maxArea) maxArea = item._area;
            if (item._area < minArea) minArea = item._area;
        }
        if (minArea <= 0 || sumArea <= 0) return Infinity;
        const s2 = shortSide * shortSide;
        return Math.max((s2 * maxArea) / (sumArea * sumArea), (sumArea * sumArea) / (s2 * minArea));
    }

    function layoutRow(row, rx, ry, rw, rh, horizontal) {
        const rowArea = row.reduce(function (sum, item) { return sum + item._area; }, 0);
        if (horizontal) {
            const bandW = rh > 0 ? rowArea / rh : 0;
            let cy = ry;
            for (const item of row) {
                const ih = bandW > 0 ? item._area / bandW : 0;
                out.push({ ...item, x: rx, y: cy, w: bandW, h: ih });
                cy += ih;
            }
            return { x: rx + bandW, y: ry, w: Math.max(0, rw - bandW), h: rh };
        }
        const bandH = rw > 0 ? rowArea / rw : 0;
        let cx = rx;
        for (const item of row) {
            const iw = bandH > 0 ? item._area / bandH : 0;
            out.push({ ...item, x: cx, y: ry, w: iw, h: bandH });
            cx += iw;
        }
        return { x: rx, y: ry + bandH, w: rw, h: Math.max(0, rh - bandH) };
    }

    function recurse(list, rx, ry, rw, rh) {
        if (!list.length) return;
        if (list.length === 1) {
            out.push({ ...list[0], x: rx, y: ry, w: rw, h: rh });
            return;
        }
        const shortSide = Math.min(rw, rh);
        const horizontal = rw >= rh;
        const row = [list[0]];
        let best = worstAspect(row, shortSide);
        let idx = 1;
        while (idx < list.length) {
            const candidate = row.concat([list[idx]]);
            const nextRatio = worstAspect(candidate, shortSide);
            if (nextRatio <= best) {
                row.push(list[idx]);
                best = nextRatio;
                idx++;
            } else {
                break;
            }
        }
        const restBox = layoutRow(row, rx, ry, rw, rh, horizontal);
        recurse(list.slice(idx), restBox.x, restBox.y, restBox.w, restBox.h);
    }

    recurse(weighted, x, y, w, h);
    return out;
}

/** 计算 Magpie 风格的 Treemap 瓦片布局（含非线性 ^0.35 缩放、碎项折叠与斜纹 free 区域）。 */
function computeContextMapTiles(summary, options) {
    const opts = options || {};
    const width = Math.max(200, Number(opts.width) || 400);
    const height = Math.max(80, Number(opts.height) || 132);
    const maxTiles = Math.max(4, Number(opts.maxTiles) || 12);
    const items = (summary && Array.isArray(summary.items) ? summary.items : []).filter(function (item) {
        return item && item.tokens > 0;
    });

    if (!items.length && !(summary && summary.freeTokens > 0)) {
        return { tiles: [], thresholdLineX: null };
    }

    let usedWidthPct = 100;
    let freeTile = null;
    if (summary && summary.freeTokens > 0 && summary.contextWindow > 0) {
        const freeShare = Math.max(0, Math.min(1, summary.freeTokens / summary.contextWindow));
        const usedRatio = summary.usedRatio || 0;
        let freeVisualShare = Math.max(0.22, Math.min(0.6, Math.pow(freeShare, 0.45)));
        if (usedRatio >= 0.9) freeVisualShare = Math.max(0.06, freeShare);
        if (!items.length) freeVisualShare = 1;
        usedWidthPct = Math.max(0, (1 - freeVisualShare) * 100);
        freeTile = {
            id: "free-space",
            kind: "free",
            bucket: "free",
            label: "剩余空间",
            subtitle: summary.freeTokens ? (formatContextTokens(summary.freeTokens) + " 可用") : "",
            tokens: summary.freeTokens,
            share: freeShare,
            cacheStatus: "",
            isFirstBreak: false,
            cacheKey: "",
            count: 1,
            x: usedWidthPct,
            y: 0,
            w: freeVisualShare * 100,
            h: 100,
            showLabel: freeVisualShare * width >= 54,
            showTokens: freeVisualShare * width >= 68
        };
    }

    let thresholdLineX = null;
    if (summary && summary.contextWindow > 0 && summary.compactionThresholdPercent > 0) {
        const thresholdRatio = summary.compactionThresholdPercent / 100;
        const usedRatio = summary.usedRatio || 0;
        if (freeTile) {
            if (usedRatio <= thresholdRatio && thresholdRatio < 1) {
                const freeProgress = usedRatio < 1 ? (thresholdRatio - usedRatio) / Math.max(0.001, 1 - usedRatio) : 0;
                thresholdLineX = usedWidthPct + freeProgress * freeTile.w;
            } else if (usedRatio > thresholdRatio && usedRatio > 0) {
                thresholdLineX = (thresholdRatio / usedRatio) * usedWidthPct;
            }
        } else {
            thresholdLineX = summary.compactionThresholdPercent;
        }
    }

    if (!items.length) {
        return { tiles: freeTile ? [freeTile] : [], thresholdLineX };
    }

    const usedTokens = Math.max(1, summary.usedTokens || items.reduce(function (s, x) { return s + x.tokens; }, 0));
    const sorted = items.slice().sort(function (a, b) {
        if (b.tokens !== a.tokens) return b.tokens - a.tokens;
        return a.index - b.index;
    });

    const floorShare = 0.012;
    const major = [];
    const minorByBucket = Object.create(null);

    for (const item of sorted) {
        const share = item.tokens / usedTokens;
        if (major.length < maxTiles && (share >= floorShare || major.length < 4)) {
            major.push({
                id: item.id,
                kind: "item",
                bucket: item.bucket,
                label: item.label,
                subtitle: item.subtitle,
                tokens: item.tokens,
                share: summary.contextWindow ? item.shareOfWindow : item.shareOfUsed,
                cacheStatus: item.cacheStatus,
                isFirstBreak: item.isFirstBreak,
                cacheKey: item.cacheKey,
                count: 1,
                weight: Math.pow(Math.max(share, 0.0005), 0.35)
            });
        } else {
            if (!minorByBucket[item.bucket]) minorByBucket[item.bucket] = [];
            minorByBucket[item.bucket].push(item);
        }
    }

    for (const def of TAVERN_CONTEXT_BUCKETS) {
        const list = minorByBucket[def.key];
        if (!list || !list.length) continue;
        if (list.length === 1) {
            const sole = list[0];
            major.push({
                id: sole.id,
                kind: "item",
                bucket: sole.bucket,
                label: sole.label,
                subtitle: sole.subtitle,
                tokens: sole.tokens,
                share: summary.contextWindow ? sole.shareOfWindow : sole.shareOfUsed,
                cacheStatus: sole.cacheStatus,
                isFirstBreak: sole.isFirstBreak,
                cacheKey: sole.cacheKey,
                count: 1,
                weight: Math.pow(Math.max(sole.tokens / usedTokens, 0.0005), 0.35)
            });
            continue;
        }
        const sumTokens = list.reduce(function (s, x) { return s + x.tokens; }, 0);
        major.push({
            id: "group:" + def.key,
            kind: "group",
            bucket: def.key,
            label: "另外 " + list.length + " 项",
            subtitle: def.label,
            tokens: sumTokens,
            share: summary.contextWindow ? sumTokens / summary.contextWindow : sumTokens / usedTokens,
            cacheStatus: list.some(function (x) { return x.cacheStatus === "break"; }) ? "break" : "",
            isFirstBreak: list.some(function (x) { return x.isFirstBreak; }),
            cacheKey: list[0].cacheKey,
            count: list.length,
            weight: Math.pow(Math.max(sumTokens / usedTokens, 0.0005), 0.35)
        });
    }

    let layout = squarifyContextRects(major, 0, 0, usedWidthPct, 100);
    // 二次检查最小像素边长，过滤掉过小个体合并为同桶聚合项重算
    const minTileW = 34;
    const minTileH = 22;
    const tooSmall = layout.filter(function (tile) {
        return tile.kind === "item" && ((tile.w / 100) * width < minTileW || (tile.h / 100) * height < minTileH);
    });
    if (tooSmall.length > 1) {
        const smallIds = new Set(tooSmall.map(function (t) { return t.id; }));
        const kept = major.filter(function (t) { return !smallIds.has(t.id); });
        for (const def of TAVERN_CONTEXT_BUCKETS) {
            const bucketSmall = tooSmall.filter(function (t) { return t.bucket === def.key; });
            if (!bucketSmall.length) continue;
            const existingGroup = kept.find(function (t) { return t.kind === "group" && t.bucket === def.key; });
            const addedTokens = bucketSmall.reduce(function (s, x) { return s + x.tokens; }, 0);
            const addedCount = bucketSmall.length;
            if (existingGroup) {
                existingGroup.tokens += addedTokens;
                existingGroup.count += addedCount;
                existingGroup.label = "另外 " + existingGroup.count + " 项";
                existingGroup.share = summary.contextWindow ? existingGroup.tokens / summary.contextWindow : existingGroup.tokens / usedTokens;
                existingGroup.weight = Math.pow(Math.max(existingGroup.tokens / usedTokens, 0.0005), 0.35);
                if (bucketSmall.some(function (x) { return x.isFirstBreak; })) existingGroup.isFirstBreak = true;
            } else if (bucketSmall.length === 1) {
                const sole = bucketSmall[0];
                kept.push({ ...sole });
            } else {
                kept.push({
                    id: "group:" + def.key,
                    kind: "group",
                    bucket: def.key,
                    label: "另外 " + addedCount + " 项",
                    subtitle: def.label,
                    tokens: addedTokens,
                    share: summary.contextWindow ? addedTokens / summary.contextWindow : addedTokens / usedTokens,
                    cacheStatus: bucketSmall.some(function (x) { return x.cacheStatus === "break"; }) ? "break" : "",
                    isFirstBreak: bucketSmall.some(function (x) { return x.isFirstBreak; }),
                    cacheKey: bucketSmall[0].cacheKey,
                    count: addedCount,
                    weight: Math.pow(Math.max(addedTokens / usedTokens, 0.0005), 0.35)
                });
            }
        }
        layout = squarifyContextRects(kept, 0, 0, usedWidthPct, 100);
    }

    const tiles = layout.map(function (tile) {
        const pxW = (tile.w / 100) * width;
        const pxH = (tile.h / 100) * height;
        return {
            id: tile.id,
            kind: tile.kind,
            bucket: tile.bucket,
            label: tile.label,
            subtitle: tile.subtitle || "",
            tokens: tile.tokens,
            share: tile.share,
            cacheStatus: tile.cacheStatus || "",
            isFirstBreak: Boolean(tile.isFirstBreak),
            cacheKey: tile.cacheKey || "",
            count: tile.count || 1,
            x: tile.x,
            y: tile.y,
            w: tile.w,
            h: tile.h,
            showLabel: pxW >= 44 && pxH >= 24,
            showTokens: pxW >= 54 && pxH >= 38
        };
    });

    if (freeTile) tiles.push(freeTile);
    return { tiles, thresholdLineX };
}

/** 计算 400 格 Waffle 网格单元，严格保证总格数等于 totalCells 且非零桶保底 1 格。 */
function computeContextWaffleCells(summary, totalCells) {
    const targetCells = Math.max(10, Math.round(Number(totalCells) || 400));
    const buckets = (summary && Array.isArray(summary.buckets) ? summary.buckets : []).map(function (b) {
        return { key: b.key, label: b.label, tokens: Math.max(0, Number(b.tokens) || 0) };
    });
    const freeTokens = summary && summary.contextWindow > 0 ? Math.max(0, Number(summary.freeTokens) || 0) : 0;
    const pool = buckets.map(function (b) { return { key: b.key, label: b.label, rawTokens: b.tokens, isFree: false }; });
    if (freeTokens > 0) {
        pool.push({ key: "free", label: "剩余空间", rawTokens: freeTokens, isFree: true });
    }
    const counts = normalizeContextTokenCounts(pool, targetCells);

    // 为非零占用的语境桶保底分配至少 1 格（从格数最多的非零项中借用），保证小类在视觉上可感知
    for (let i = 0; i < pool.length; i++) {
        if (!pool[i].isFree && pool[i].rawTokens > 0 && counts[i] === 0) {
            let donor = -1;
            let maxCount = 1;
            for (let j = 0; j < counts.length; j++) {
                if (counts[j] > maxCount) {
                    maxCount = counts[j];
                    donor = j;
                }
            }
            if (donor !== -1) {
                counts[donor] -= 1;
                counts[i] += 1;
            }
        }
    }

    const cells = [];
    for (let i = 0; i < pool.length; i++) {
        const entry = pool[i];
        const len = counts[i] || 0;
        for (let k = 0; k < len; k++) {
            cells.push({
                index: cells.length,
                bucket: entry.key,
                isFree: entry.isFree,
                label: entry.label
            });
        }
    }
    while (cells.length < targetCells) {
        cells.push({ index: cells.length, bucket: "free", isFree: true, label: "剩余空间" });
    }
    return cells.slice(0, targetCells);
}

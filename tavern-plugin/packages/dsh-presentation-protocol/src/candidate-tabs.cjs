// 候选项 Tab 分组、徽章投影与发送文本格式化（聊天视图、舞台视图与服务端共用同一规范）。
const candidateTabs = (() => {
    function normalizeCandidateChoice(choice, index, decode = String) {
        const decodeText = typeof decode === "function" ? decode : String;
        if (choice !== null && typeof choice === "object") {
            const actor = choice.actor ? decodeText(String(choice.actor)).trim() : "";
            const actors = Array.isArray(choice.actors)
                ? choice.actors.map(name => decodeText(String(name)).trim()).filter(Boolean)
                : [];
            const item = {
                ...choice,
                ...(actor ? { actor } : {}),
                ...(actors.length > 0 ? { actors } : {}),
                text: decodeText(choice.text)
            };
            if (index !== undefined) item.index = index;
            return item;
        }
        const item = { type: "action", text: decodeText(String(choice)) };
        if (index !== undefined) item.index = index;
        return item;
    }

    function buildCandidateChoiceTabs(items, { isScript = false } = {}) {
        const list = Array.isArray(items) ? items : [];
        if (isScript || !list.some(item => Boolean(item.actor) || item.type === "event" || item.type === "featured")) {
            return { hasTabs: false, tabs: [], current: { key: "all", kind: "all", items: list } };
        }
        const featuredItems = [];
        const actorMap = new Map();
        const globalItems = [];
        for (const item of list) {
            if (item.type === "featured") {
                featuredItems.push(item);
                continue;
            }
            if (item.type === "scene" || item.type === "event") {
                globalItems.push(item);
                continue;
            }
            const actor = String(item.actor || "").trim() || "行动";
            if (!actorMap.has(actor)) actorMap.set(actor, []);
            actorMap.get(actor).push(item);
        }
        let defaultFeatured = featuredItems;
        const customFeatured = featuredItems.length > 0;
        if (!customFeatured) {
            // 兼容未提供融合精选的旧数据或降级响应：按角色轮询抽取代表项再拼接全局项。
            const actorGroups = Array.from(actorMap.values());
            const featuredActors = [];
            for (let round = 0; featuredActors.length < 4; round++) {
                let progressed = false;
                for (let g = 0; g < actorGroups.length && featuredActors.length < 4; g++) {
                    if (round < actorGroups[g].length) {
                        featuredActors.push(actorGroups[g][round]);
                        progressed = true;
                    }
                }
                if (!progressed) break;
            }
            defaultFeatured = featuredActors.concat(globalItems);
        }
        const tabs = [];
        if (defaultFeatured.length > 0) {
            tabs.push({ key: "featured", label: "精选", kind: "featured", custom: customFeatured, items: defaultFeatured });
        }
        for (const [actor, group] of actorMap.entries()) {
            tabs.push({ key: "actor:" + actor, label: actor, kind: "actor", actor, items: group });
        }
        if (globalItems.length > 0) {
            tabs.push({ key: "global", label: "全局", kind: "global", items: globalItems });
        }
        if (tabs.length === 0) {
            return { hasTabs: false, tabs: [], current: { key: "all", kind: "all", items: list } };
        }
        return { hasTabs: tabs.length > 1, tabs, current: tabs[0] };
    }

    function candidateChoiceBadges(item, { tabKind = "featured", hasTabs = true } = {}) {
        if (!item || typeof item !== "object") return [];
        const routeTag = typeof item.routeTag === "string" ? item.routeTag.trim() : "";
        const routeBadge = routeTag ? [{ kind: "route", label: routeTag }] : [];
        if (!hasTabs) return routeBadge;
        if (item.type === "featured") {
            const badges = (Array.isArray(item.actors) ? item.actors : [])
                .map(name => String(name || "").trim())
                .filter(Boolean)
                .map(label => ({ kind: "actor", label }));
            if (item.hasEvent === true) badges.push({ kind: "event", label: "突发事件" });
            if (item.hasScene === true) badges.push({ kind: "scene", label: "场景变化" });
            return routeBadge.concat(badges);
        }
        if (item.type === "scene") return routeBadge.concat([{ kind: "scene", label: "场景变化" }]);
        if (item.type === "event") return routeBadge.concat([{ kind: "event", label: "突发事件" }]);
        if (tabKind === "featured" && item.actor) return routeBadge.concat([{ kind: "actor", label: item.actor }]);
        return routeBadge;
    }

    function formatCandidateChoiceText(item) {
        if (!item || typeof item !== "object") return "";
        const text = typeof item.text === "string" ? item.text.trim() : String(item.text || "").trim();
        if (!text) return "";
        if (item.type === "scene") return text.startsWith("【场景变化】") ? text : "【场景变化】" + text;
        if (item.type === "event") return text.startsWith("【突发事件】") ? text : "【突发事件】" + text;
        if (item.type === "featured") {
            if (item.hasScene === true && !text.startsWith("【场景变化】")) return "【场景变化】" + text;
            return text;
        }
        const actor = typeof item.actor === "string" ? item.actor.trim() : "";
        if (actor && actor !== "我" && !text.includes(actor)) return actor + "：" + text;
        return text;
    }

    return {
        normalizeCandidateChoice,
        buildCandidateChoiceTabs,
        candidateChoiceBadges,
        formatCandidateChoiceText
    };
})();
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = candidateTabs;

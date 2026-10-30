// the variable receipt dialog.
// Works for any MVU shape: the first path segment is the section ("剧情角色"), the
// segments between it and the field form a sub-heading ("鹿目圆 › 装备"), and each row
// shows the field name and "旧 → 新"; long text shows the new value in full and keeps
// the old value one click away. Object values render as nested key/value lists. Upstream's TavernMvuReceipt stays untouched for the
// non-play views; this only replaces what the fork dialog renders.

const VARIABLE_OPERATION_TAGS = { insert: "新增", add: "新增", delete: "删除", remove: "删除", move: "移动" };
const VARIABLE_MISSING = "（不存在）";
const VARIABLE_HIDDEN_ROOTS = /^\/(?:delta_data|display_data|schema)(?:\/|$)/;

function variableText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value === VARIABLE_MISSING ? "" : value;
    try { return JSON.stringify(value); } catch (_error) { return String(value); }
}

function variableSegments(path) {
    const segments = String(path || "").split("/").slice(1).map(function (segment) { return segment.replace(/~1/g, "/").replace(/~0/g, "~"); });
    if (segments[0] === "stat_data") segments.shift();
    return segments.filter(function (segment) { return segment !== ""; });
}

function variableSegmentName(segment) {
    return /^\d+$/.test(segment) ? "#" + (Number(segment) + 1) : segment;
}

// { section, trail, key } for a change path. Array items read as "可能出现的敌人 #2".
function variableLabel(path) {
    const segments = variableSegments(path);
    if (!segments.length) return { section: "", trail: [], key: "全部变量" };
    let key = segments.pop();
    if (/^\d+$/.test(key) && segments.length) key = segments.pop() + " #" + (Number(key) + 1);
    const section = segments.length ? segments.shift() : "";
    return { section: section, trail: segments.map(variableSegmentName), key: key };
}

// Deep trails keep their first and last two steps: "A › … › Y › Z".
function variableTrail(trail) {
    const shown = trail.length > 4 ? [trail[0], "…"].concat(trail.slice(-2)) : trail;
    return shown.join(" › ");
}

function variableParse(text) {
    if (!/^\s*[\[{]/.test(text)) return null;
    try { const parsed = JSON.parse(text); return parsed && typeof parsed === "object" ? parsed : null; } catch (_error) { return null; }
}

function variableExpandable(value) {
    if (!value || typeof value !== "object") return false;
    const items = Array.isArray(value) ? value : Object.values(value);
    return items.length > 0 && (!Array.isArray(value) || items.some(function (item) { return item && typeof item === "object"; }));
}

// A whole object added or removed (a new character, an inventory entry) becomes one
// row per field under its own sub-heading, which carries the 新增 / 已移除 mark.
function variableExpand(changes) {
    const result = [];
    function walk(path, value, origin, depth) {
        if (depth < 4 && variableExpandable(value)) {
            (Array.isArray(value) ? value.map(function (item, index) { return [String(index), item]; }) : Object.entries(value)).forEach(function (entry) {
                walk(path + "/" + String(entry[0]).replace(/~/g, "~0").replace(/\//g, "~1"), entry[1], origin, depth + 1);
            });
            return;
        }
        const text = value !== null && typeof value === "object" ? JSON.stringify(value) : variableText(value);
        result.push(origin === "added" ? { path: path, before: "", after: text, origin: origin } : { path: path, before: text, after: "", origin: origin });
    }
    changes.forEach(function (change) {
        const before = variableText(change && change.before), after = variableText(change && change.after);
        const operation = String(change && change.operation || "");
        const removed = operation === "delete" || operation === "remove" || (before !== "" && after === "");
        const value = removed ? variableParse(before) : before === "" ? variableParse(after) : null;
        if (variableExpandable(value)) walk(String(change.path || ""), value, removed ? "removed" : "added", 0);
        else result.push(change || {});
    });
    return result;
}

function variableGroups(changes) {
    const sections = [], bySection = new Map();
    variableExpand(changes).forEach(function (change, index) {
        const label = variableLabel(change && change.path);
        let section = bySection.get(label.section);
        if (!section) { section = { name: label.section, groups: [], byTrail: new Map() }; bySection.set(label.section, section); sections.push(section); }
        const trailKey = label.trail.join("\u0000");
        let group = section.byTrail.get(trailKey);
        if (!group) { group = { trail: label.trail, rows: [] }; section.byTrail.set(trailKey, group); section.groups.push(group); }
        group.rows.push({ id: index, key: label.key, path: String(change && change.path || "/"), change: change || {} });
    });
    // A heading is marked when every row under it came from one added/removed object.
    function markOf(rows) {
        const origin = rows[0] && rows[0].change.origin;
        return origin && rows.every(function (row) { return row.change.origin === origin; }) ? origin : "";
    }
    sections.forEach(function (section) {
        section.groups.forEach(function (group) { group.mark = markOf(group.rows); });
        section.mark = markOf(section.groups.flatMap(function (group) { return group.rows; }));
    });
    // Loose top-level fields first, then sections in the order the Agent touched them.
    sections.sort(function (a, b) { return (a.name ? 1 : 0) - (b.name ? 1 : 0); });
    return sections;
}

function variableNumber(text) {
    return /^-?\d+(?:\.\d+)?$/.test(String(text).trim()) ? Number(text) : null;
}

// Objects arrive as JSON text; show them as nested "key value" lists instead of raw JSON.
// Arrays of plain values read as a comma list; nesting past four levels falls back to JSON.
function variableTree(h, value, depth) {
    if (value === null || typeof value !== "object") return variableText(value);
    const entries = Array.isArray(value) ? value.map(function (item, index) { return ["#" + (index + 1), item]; }) : Object.entries(value);
    if (!entries.length) return Array.isArray(value) ? "（空列表）" : "（空）";
    if (Array.isArray(value) && value.every(function (item) { return item === null || typeof item !== "object"; })) return value.map(variableText).join("、");
    if (depth >= 4) return JSON.stringify(value);
    return h("dl", { className: "fork-var-object" }, entries.flatMap(function (entry, index) {
        return [h("dt", { key: "k" + index }, entry[0]), h("dd", { key: "v" + index }, variableTree(h, entry[1], depth + 1))];
    }));
}

function variableRich(h, text, className) {
    let parsed = null;
    if (/^\s*[\[{]/.test(text)) { try { parsed = JSON.parse(text); } catch (_error) { parsed = null; } }
    if (!parsed || typeof parsed !== "object") return h("span", { className: className }, text);
    return h("div", { className: className + " fork-var-tree" }, variableTree(h, parsed, 0));
}

function VariableValue(props) {
    const h = React.createElement;
    const change = props.change;
    const before = variableText(change.before), after = variableText(change.after);
    const operation = String(change.operation || "");
    // Fields of an added/removed object: the heading carries the mark, the row just the value.
    if (change.origin === "added") return h("div", { className: "fork-var-value", "data-kind": "plain" }, variableRich(h, after, "fork-var-new"));
    if (change.origin === "removed") return h("div", { className: "fork-var-value", "data-kind": "plain" }, h("span", { className: "fork-var-old" }, before));
    const removed = operation === "delete" || operation === "remove" || (before !== "" && after === "");
    const added = !removed && (VARIABLE_OPERATION_TAGS[operation] === "新增" || before === "");
    if (removed) return h("div", { className: "fork-var-value", "data-kind": "removed" },
        h("span", { className: "fork-var-old" }, before || "（空）"), h("span", { className: "fork-var-tag", "data-mark": "removed" }, operation === "delete" || operation === "remove" ? "已删除" : "已清空"));
    if (added) return h("div", { className: "fork-var-value", "data-kind": "added" },
        variableRich(h, after, "fork-var-new"), h("span", { className: "fork-var-tag", "data-mark": "added" }, "新增"));
    const beforeNumber = variableNumber(before), afterNumber = variableNumber(after);
    if (beforeNumber !== null && afterNumber !== null) {
        const delta = Math.round((afterNumber - beforeNumber) * 1000) / 1000;
        return h("div", { className: "fork-var-value", "data-kind": "number" },
            h("span", { className: "fork-var-old" }, before), h("span", { className: "fork-var-arrow", "aria-hidden": true }, "→"),
            h("span", { className: "fork-var-new" }, after),
            delta ? h("span", { className: "fork-var-delta", "data-sign": delta > 0 ? "up" : "down" }, (delta > 0 ? "+" : "−") + Math.abs(delta)) : null);
    }
    const multiline = /\n/.test(before + after);
    if (!multiline && before.length + after.length <= 24) return h("div", { className: "fork-var-value", "data-kind": "short" },
        h("span", { className: "fork-var-old" }, before), h("span", { className: "fork-var-arrow", "aria-hidden": true }, "→"),
        h("span", { className: "fork-var-new" }, after));
    // Medium values: old value on its own quiet line above the new one.
    if (!multiline && before.length <= 32 && after.length <= 32) return h("div", { className: "fork-var-value", "data-kind": "stacked" },
        h("span", { className: "fork-var-old" }, before), h("span", { className: "fork-var-new" }, after));
    return h("div", { className: "fork-var-value", "data-kind": "long" },
        variableRich(h, after, "fork-var-new"),
        h("details", { className: "fork-var-before" }, h("summary", null, "之前"), variableRich(h, before, "fork-var-old")));
}

function variableMark(h, mark) {
    return mark ? h("span", { className: "fork-var-tag", "data-mark": mark }, mark === "added" ? "新增" : "已移除") : null;
}

function VariableGroups(props) {
    const h = React.createElement;
    return variableGroups(props.changes).map(function (section, index) {
        return h("section", { key: "section:" + index, className: "fork-var-group" },
            section.name ? h("h4", { className: "fork-var-group-name" }, section.name, variableMark(h, section.groups.length === 1 && !section.groups[0].trail.length ? section.mark : "")) : null,
            section.groups.map(function (group, groupIndex) {
                return h("div", { key: "group:" + groupIndex, className: "fork-var-sub", "data-mark": group.mark || undefined },
                    group.trail.length ? h("div", { className: "fork-var-sub-name", title: group.trail.join(" › ") }, variableTrail(group.trail), variableMark(h, group.mark)) : null,
                    group.rows.map(function (row) {
                        return h("div", { key: row.id, className: "fork-var-row", title: row.path },
                            h("div", { className: "fork-var-key" }, row.key),
                            h(VariableValue, { change: row.change }));
                    }));
            }));
    });
}

function VariableReceipt(props) {
    const h = React.createElement;
    const receipt = props.receipt || {};
    const changes = Array.isArray(receipt.changes) ? receipt.changes : [];
    const sideEffects = (Array.isArray(receipt.sideEffects) ? receipt.sideEffects : []).filter(function (change) { return !VARIABLE_HIDDEN_ROOTS.test(String(change && change.path || "")); });
    const failures = Array.isArray(receipt.failures) ? receipt.failures : [];
    const status = ["pending", "updated", "partial", "error", "stale", "interrupted", "unchanged"].includes(receipt.status) ? receipt.status : "unchanged";
    const notices = {
        pending: props.busy ? "正在结算本轮变量…" : "变量结算排队中，等待后台处理。",
        interrupted: "变量结算被中断，本轮变量可能没有更新。",
        partial: "有 " + failures.length + " 项变量没能写入，其余已更新。",
        error: "变量更新失败，本轮变量没有变化。",
        stale: "这次结算已过期，没有覆盖当前状态。",
        unchanged: changes.length ? "" : "本轮没有需要更新的变量。",
        updated: changes.length ? "" : "变量已更新（旧记录没有明细）。"
    };
    const runtime = (status === "error" || status === "partial") && Array.isArray(receipt.runtimeDiagnostics)
        ? receipt.runtimeDiagnostics.filter(function (item) { return item && item.message && ["warn", "error"].includes(item.level); }).slice(-3) : [];
    return h("div", { className: "fork-var-receipt", "data-status": status },
        notices[status] ? h("div", { className: "fork-var-notice", "data-status": status }, notices[status]) : null,
        receipt.summary ? h("p", { className: "fork-var-reason" }, String(receipt.summary)) : null,
        failures.length || runtime.length ? h("ul", { className: "fork-var-failures" },
            failures.map(function (failure, index) {
                const label = variableLabel(failure.path || failure.command);
                return h("li", { key: "failure:" + index, title: String(failure.path || failure.command || "") },
                    h("strong", null, [label.section].concat(label.trail, [label.key]).filter(Boolean).join(" › ")), String(failure.message || "未知错误"));
            }),
            runtime.map(function (item, index) { return h("li", { key: "runtime:" + index }, h("strong", null, "运行时"), String(item.message)); })) : null,
        changes.length ? h(VariableGroups, { changes: changes }) : null,
        sideEffects.length ? h("details", { className: "fork-var-side-effects" },
            h("summary", null, "人物卡脚本联动 · " + sideEffects.length + " 项"),
            h(VariableGroups, { changes: sideEffects })) : null);
}

// Re-settle this round: a circular-arrow icon beside the dialog title (latest round only).
function VariableRetryButton(props) {
    const h = React.createElement;
    const [retrying, setRetrying] = React.useState(false);
    const status = props.status;
    async function retry() {
        if (retrying) return;
        setRetrying(true);
        try {
            if (status === "pending") {
                await rpc("retrySettlement", { turn: props.turn }, props.sessionId);
                liveTavernView.invalidate(props.sessionId);
                return;
            }
            await askTavernText({
                title: "重新结算变量", description: "指导意见（选填），仅对本次结算生效。正文保持不变。",
                placeholder: "例如：这轮还没有交付物品，不要扣除库存。",
                allowEmpty: true, maxLength: 4000, confirmLabel: "重新结算",
                onSubmit: function (guidance) { return rpc("retrySettlement", { turn: props.turn, guidance: guidance }, props.sessionId); }
            });
            liveTavernView.invalidate(props.sessionId);
        } catch (error) { tavernErrorHub.report("重试变量结算", error); }
        finally { setRetrying(false); }
    }
    const label = props.busy ? "结算中…" : retrying ? "重试中…" : status === "pending" ? "重新投递结算" : ["error", "stale", "interrupted", "partial"].includes(status) ? "重试变量结算" : "重新结算变量";
    return h("button", { type: "button", className: "fork-var-retry", "data-busy": props.busy || retrying || undefined, title: label, "aria-label": label, disabled: retrying || props.busy, onClick: retry });
}

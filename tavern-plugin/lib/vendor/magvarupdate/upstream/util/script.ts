export function teleportStyle(
    append_to:
        | JQuery.Selector
        | JQuery.htmlString
        | JQuery.TypeOrArray<Element | DocumentFragment>
        | JQuery = 'head'
): { destroy: () => void } {
    const $div = $(`<div>`)
        .attr('script_id', getScriptId())
        .append($(`head > style`, document).clone())
        .appendTo(append_to);

    return {
        destroy: () => $div.remove(),
    };
}

export function createScriptIdDiv(): JQuery<HTMLDivElement> {
    return $('<div>').attr('script_id', getScriptId()) as JQuery<HTMLDivElement>;
}

/**
 * 将当前脚本实例注册到共享的“唯一脚本”命名空间。
 *
 * 当同一脚本被重复加载时，优先实例为：仍存在于 TavernHelper 脚本列表中、
 * 且在注册顺序上最后出现的 script id。
 * 调用方可通过 `listenPreferenceState` 订阅优先实例变化，并仅在
 * `getScriptId()` 与优先实例一致时启用功能。
 */
export function registerAsUniqueScript(id: string): {
    unregister: () => void;
    getPreferredScriptId: () => string | undefined;
    listenPreferenceState: (callback: (perferred_script_id: string) => void) => EventOnReturn;
} {
    // 当前实例在 TavernHelper 中的唯一脚本 ID。
    const script_id = getScriptId();
    // 以业务 id 作为命名空间，避免不同功能之间冲突。
    const path = `th_unique_check.${id}`;

    const getPreferredScriptId = () => {
        // 从共享状态中取出已注册实例集合（跨脚本实例共享在 window.parent）。
        const registered_scripts = _.get(window.parent, path, new Set<string>());
        // 以页面上实际存在的脚本顺序为准，选出“最后一个仍有效”的实例作为优先实例。
        return _($('#tavern_helper').find('div[data-script-id]').toArray())
            .map(element => String($(element).attr('data-script-id')))
            .filter(element => registered_scripts.has(element))
            .last();
    };

    // 将当前实例加入注册集合。不存在的场合创建。
    _.update(window.parent, path, (value: Set<string> | undefined) => {
        if (value === undefined) {
            return new Set([script_id]);
        }
        //避免重复添加
        if (value.has(script_id)) return value;
        value.add(script_id);
        return value;
    });
    // 广播一次当前优先实例，通知监听方更新启用状态。
    eventEmit(path, getPreferredScriptId());

    return {
        unregister: () => {
            // 卸载时从注册集合移除，并重新广播优先实例。
            _.update(window.parent, path, (value: Set<string> | undefined) => {
                if (value !== undefined) {
                    value.delete(script_id);
                }
                return value;
            });
            eventEmit(path, getPreferredScriptId());
        },
        getPreferredScriptId,
        // 监听优先实例变化（回调入参是当前优先实例 script id）。
        listenPreferenceState: (callback: (enabled_script_id: string) => void) => {
            const ret = eventOn(path, callback);
            // 广播一次当前优先实例，通知监听方更新启用状态。
            eventEmit(path, getPreferredScriptId());
            return ret;
        },
    };
}

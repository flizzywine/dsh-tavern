import { cleanUpMetadata, EXTENSIBLE_MARKER, generateSchema } from '@/function/schema';
import { updateVariables } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { getLastValidVariable } from '@/util';
import {
    isObjectSchema,
    MvuData,
    RootAdditionalProps,
    SchemaNode,
    StatData,
    variable_events,
} from '@/variable_def';
import { correctlyMerge, parseString } from '@util/common';
import { klona } from 'klona';

type LorebookEntry = {
    content: string;
    comment?: string;
};

export async function initCheck() {
    if ($('#chat > .welcomePanel').length > 0) {
        return;
    }

    let variables: MvuData & Record<string, any>;
    //这个函数需要处理 dryRun,因为0层。

    try {
        if (SillyTavern.chat.length === 0) {
            console.error(tr('runtime.initvar.noMessagesLog'));
            toastr.error(
                tr('runtime.initvar.greetingRequired'),
                tr('runtime.initvar.initializationFailedTitle')
            );
            return;
        }
        variables = getLastValidVariable(getLastMessageId() + 1) ?? createEmptyGameData();
    } catch (_error) {
        console.error(tr('runtime.initvar.noMessagesLog'));
        return;
    }

    // 确保变量结构完整
    if (variables === undefined) {
        variables = createEmptyGameData();
    }
    if (!_.has(variables, 'initialized_lorebooks')) {
        variables.initialized_lorebooks = {};
    }
    if (Array.isArray(variables.initialized_lorebooks)) {
        console.warn(tr('runtime.initvar.oldLorebookFormatLog'));
        const oldArray = variables.initialized_lorebooks as string[];
        const newObject: Record<string, any[]> = {};
        for (const lorebookName of oldArray) {
            newObject[lorebookName] = []; // 按照新格式，值为一个空数组
        }
        variables.initialized_lorebooks = newObject;
    }
    if (!variables.stat_data) {
        variables.stat_data = {};
    }
    if (!variables.schema) {
        variables.schema = { extensible: false, properties: {}, type: 'object' };
    }

    // 加载 InitVar 数据
    const is_updated = await loadInitVarData(variables);

    // --- 一次性清理所有魔法字符串 ---
    if (is_updated) {
        // 递归遍历整个 stat_data，移除所有魔法字符串
        const cleanData = (data: any) => {
            if (Array.isArray(data)) {
                // 使用 filter 创建一个不含标记的新数组
                const cleanedArray = data.filter(item => item !== EXTENSIBLE_MARKER);
                // 递归清理数组内的对象或数组
                cleanedArray.forEach(cleanData);
                return cleanedArray;
            }
            if (_.isObject(data)) {
                const newObj: Record<string, any> = {};
                const typedData = data as Record<string, any>; // 类型断言
                for (const key in data) {
                    // 递归清理子节点，并将结果赋给新对象
                    newObj[key] = cleanData(typedData[key]);
                }
                return newObj;
            }
            return data;
        };
        // 在生成 Schema 之前，先清理一遍 stat_data
        // 这里需要先生成 Schema，再清理数据
        // 所以还是得用克隆
    }

    // 在所有 lorebook 初始化完成后，生成最终的模式
    if (is_updated || !variables.schema || _.isEmpty(variables.schema)) {
        // 1. 克隆数据用于 Schema 生成
        const dataForSchema = klona(variables.stat_data);
        // 2. generateSchema 会读取并移除克隆体中的标记，生成正确的 schema
        // 对于增量场景，会以之前的 schema 为基础生成。
        const generated_schema: SchemaNode & RootAdditionalProps = generateSchema(
            dataForSchema,
            variables.schema
        );

        // 使用类型守卫确保生成的 schema 是 ObjectSchemaNode
        if (isObjectSchema(generated_schema)) {
            if (_.has(variables.stat_data, '$meta.strictTemplate'))
                generated_schema.strictTemplate = variables.stat_data['$meta']
                    ?.strictTemplate as boolean;
            if (_.has(variables.stat_data, '$meta.concatTemplateArray'))
                generated_schema.concatTemplateArray = variables.stat_data['$meta']
                    ?.concatTemplateArray as boolean;
            if (_.has(variables.stat_data, '$meta.strictSet'))
                generated_schema.strictSet = variables.stat_data['$meta']?.strictSet as boolean;
            variables.schema = generated_schema;
        }

        // 3. 现在，清理真实的 stat_data，让它在后续操作中保持干净
        cleanUpMetadata(variables.stat_data);
    }

    if (!is_updated) {
        return;
    }

    if (useDataStore().effective_settings.兼容性.更新到聊天变量) {
        console.info(tr('runtime.initvar.chatVariablesInitializedLog'));
        await updateVariablesWith(data => _.assign(data, variables), { type: 'chat' });
    }

    if (getLastMessageId() == 0) {
        const last_msg = getChatMessages(0, { include_swipes: true })[0];
        // 更新所有 swipes
        await setChatMessages([
            {
                // last_msg 不一定存在 message_id
                message_id: 0,
                swipes_data: await Promise.all(
                    last_msg.swipes!.map(async (swipe, index) => {
                        let vanilla_variable_data: Record<string, any> = klona(
                            last_msg.swipes_data[index]
                        );
                        if (vanilla_variable_data === undefined) {
                            vanilla_variable_data = {};
                        }
                        const current_data = correctlyMerge(
                            vanilla_variable_data,
                            klona(variables)
                        );

                        const matched_init = swipe.matchAll(
                            /<(initvar)>(?:\s*```.*)?([\s\S]*?)(?:```\s*)?<\/\1>/gim
                        );
                        // 对于在开场白中的 <initvar> 块的规则是：
                        // 使用了这个块后，会以 <initvar> 块内的内容为基准，忽略角色世界书中 [initvar] 的内容
                        let is_initvar_applied = false;
                        const overrided_initvar: StatData = {};
                        for (const match of matched_init) {
                            const init_content = match[2];
                            try {
                                const init_variables = parseString(substitudeMacros(init_content));
                                correctlyMerge(overrided_initvar, init_variables);
                                is_initvar_applied = true;
                            } catch (e) {
                                console.error(
                                    tr('runtime.initvar.blockParseFailedLog', {
                                        cause: String(e),
                                    })
                                );
                            }
                        }
                        if (is_initvar_applied) {
                            current_data.stat_data = overrided_initvar;
                            const char_lorebook =
                                getCharWorldbookNames('current').primary ?? 'unknown';
                            //此处的含义是，将 角色卡世界书 以外的其他世界书进行重置
                            //避免 <initvar> 的覆盖行为导致其他世界书无法正常加载
                            current_data.initialized_lorebooks = {};
                            current_data.initialized_lorebooks[char_lorebook] = [];
                            //重新进行其他全局世界书的初始化。
                            await loadInitVarData(current_data);
                        }

                        await eventEmit(variable_events.VARIABLE_INITIALIZED, current_data, index);
                        // 此处调用的是新版 updateVariables，它将支持更多命令
                        // 不再需要手动调用 substitudeMacros，updateVariables 会处理
                        await updateVariables(swipe, current_data);
                        console.log(tr('runtime.initvar.initializationCompletedLog'));
                        return current_data;
                    })
                ),
            },
        ]);
    } else {
        // 非开局直接更新到最后一条即可，也并不需要重新结算当前的变量
        await replaceVariables(variables, { type: 'message' });
    }
    try {
        if (useDataStore().settings.通知.变量初始化成功) {
            // 输出构建信息
            const books = Object.entries(variables.initialized_lorebooks ?? {})
                .map(
                    ([key, value]) =>
                        `- ${_.escape(key)}: ${_.escape(String(JSON.stringify(value)))}`
                )
                .join('<br>');
            toastr.info(
                tr('runtime.initvar.initializationSucceeded', { books }),
                tr('runtime.initvar.initializationSucceededTitle'),
                {
                    escapeHtml: false,
                }
            );
        }
    } catch (_e) {
        /* empty */
    }

    // 更新 lorebook 设置
    await updateLorebookSettings();
}

/**
 * 获取所有启用的 lorebook 列表
 */
export async function getEnabledLorebookList(): Promise<string[]> {
    const lorebook_settings = await getLorebookSettings();
    const enabled_lorebook_list = [...lorebook_settings.selected_global_lorebooks];
    try {
        const char_lorebook = await getCharLorebooks();
        if (char_lorebook.primary !== null) {
            enabled_lorebook_list.push(char_lorebook.primary);
        }
        if (char_lorebook.additional !== null) {
            enabled_lorebook_list.push(...char_lorebook.additional);
        }
    } catch (_e) {
        console.warn(tr('runtime.initvar.primaryLorebookReadFailedLog'), _e);
    }
    return enabled_lorebook_list;
}

/**
 * 从 lorebook 中加载所有 InitVar 数据并合并到提供的 GameData 中
 */
export async function loadInitVarData(
    mvu_data: MvuData,
    lorebook_list?: string[]
): Promise<boolean> {
    const enabled_lorebook_list = lorebook_list || (await getEnabledLorebookList());
    let is_updated = false;

    // 确保 initialized_lorebooks 是对象格式
    if (!mvu_data.initialized_lorebooks || Array.isArray(mvu_data.initialized_lorebooks)) {
        mvu_data.initialized_lorebooks = {};
    }

    for (const current_lorebook of enabled_lorebook_list) {
        // 适配 beta 分支的对象结构
        if (_.has(mvu_data.initialized_lorebooks, current_lorebook)) continue;
        mvu_data.initialized_lorebooks[current_lorebook] = [];
        try {
            const init_entries = (await getLorebookEntries(current_lorebook)) as LorebookEntry[];

            const merged_data: Record<string, any> = {};
            for (const entry of init_entries) {
                if (entry.comment?.toLowerCase().includes('[initvar]')) {
                    const xml_match = entry.content
                        .trim()
                        .match(/.*<initvar>.*\n([\s\S]*)\n.*<\/initvar>.*/m);
                    if (xml_match) {
                        entry.content = xml_match[1];
                    }
                    const codeblock_match = entry.content.trim().match(/```.*\n([\s\S]*)\n```/m);
                    if (codeblock_match) {
                        entry.content = codeblock_match[1];
                    }
                    const content = substitudeMacros(entry.content);
                    let parsedData: any = null;
                    let parseError: Error | null = null;

                    // Try YAML first (which also handles JSON)
                    try {
                        parsedData = parseString(content);
                    } catch (e) {
                        parseError = e as Error;
                    }

                    if (parseError) {
                        console.error(
                            tr('runtime.initvar.entryParseFailedLog', {
                                comment: entry.comment ?? '',
                                cause: String(parseError),
                            })
                        );
                        toastr.error(
                            tr('runtime.common.errorCause', {
                                cause: _.escape(parseError.message),
                            }),
                            tr('runtime.initvar.entryParseFailedTitle', {
                                comment: _.escape(entry.comment ?? ''),
                            }),
                            {
                                timeOut: 5000,
                            }
                        );
                        throw parseError;
                    }

                    if (parsedData) {
                        correctlyMerge(merged_data, parsedData);
                    }
                }
            }
            mvu_data.stat_data = { ...merged_data, ...mvu_data.stat_data };
            is_updated = true;
        } catch (e) {
            console.error(e);
        }
    }

    return is_updated;
}

/**
 * 创建一个新的空 GameData 对象
 */
export function createEmptyGameData(): MvuData {
    return {
        display_data: {},
        initialized_lorebooks: {}, // 适配 beta 分支的对象结构
        stat_data: {},
        delta_data: {},
        schema: {
            type: 'object',
            properties: {},
        }, // beta 分支新增的 schema 字段
    };
}

/**
 * 获取最后一条消息的变量数据
 */
export async function getLastMessageVariables(): Promise<{
    message: ChatMessageSwiped;
    variables: MvuData | undefined;
}> {
    let last_chat_msg: ChatMessageSwiped[] = [];
    try {
        last_chat_msg = (await getChatMessages(-2, {
            role: 'assistant',
            include_swipes: true,
        })) as ChatMessageSwiped[];
    } catch (e) {
        // 在第一行时，必定发生异常。
    }

    if (!last_chat_msg || last_chat_msg.length <= 0) {
        const first_msg = await getChatMessages(0, {
            include_swipes: true,
        });
        if (first_msg && first_msg.length > 0) {
            last_chat_msg = first_msg;
        } else {
            throw new Error(tr('runtime.initvar.noMessages'));
        }
    }

    const last_msg = last_chat_msg[0];
    const variables = last_msg.swipes_data[last_msg.swipe_id] as MvuData & Record<string, any>;

    return { message: last_msg, variables };
}

/**
 * 更新 lorebook 设置为推荐配置
 */
export async function updateLorebookSettings(): Promise<void> {
    /*Ref:https://github.com/lolo-desu/lolocard/blob/master/src/%E6%97%A5%E8%AE%B0%E7%BB%9C%E7%BB%9C/%E8%84%9A%E6%9C%AC/%E8%B0%83%E6%95%B4%E4%B8%96%E7%95%8C%E4%B9%A6%E5%85%A8%E5%B1%80%E8%AE%BE%E7%BD%AE.ts
     */
    const dst_setting: Partial<LorebookSettings> = {
        scan_depth: 2,
        context_percentage: 100,
        budget_cap: 0,
        min_activations: 0,
        max_depth: 0,
        max_recursion_steps: 0,

        insertion_strategy: 'character_first',

        include_names: false,
        recursive: true,
        case_sensitive: false,
        match_whole_words: false,
        use_group_scoring: false,
        overflow_alert: false,
    };
    const settings = getLorebookSettings();
    if (!_.isEqual(_.merge({}, settings, dst_setting), settings)) {
        setLorebookSettings(dst_setting);
    }
}

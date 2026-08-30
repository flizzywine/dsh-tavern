import { updateVariables } from '@/function/update_variables';
import { tr } from '@/i18n';
import { useDataStore } from '@/store';
import { getLastValidVariable, isJsonPatch } from '@/util';
import { parseString } from '@util/common';

/**
 * 最终的变量更新机制实际上是专门generate 一个新的请求，那个请求会通过 tool_call 直接更新变量。
 * 并不会直接在一条输出消息里面进行 tool_call，因为这种情况很可能 llm 直接无视你的tool call请求（auto/any）
 * 或者 tool call 请求直接把正文肘掉（required）
 * 如果想不肘正文，需要从外部输入格式强调才行，因此直接把 mvu 更新移动到函数调用中不现实。
 * 目前的折衷方式是在 generate 中触发函数调用，在这个情况下可以利用 required 肘掉正文的特性，来精简输出。
 */

export const MVU_FUNCTION_NAME = `mvu_VariableUpdate_${getScriptId()}`;
const mvu_update_call_function_name = 'mvu_updateRound';

const mvu_update_schema = Object.freeze({
    $schema: 'http://json-schema.org/draft-04/schema#',
    type: 'object',
    additionalProperties: false,
    properties: {
        analysis: {
            type: 'string',
            minLength: 1,
            description:
                'Write in ENGLISH. A compact reasoning summary that includes: (1) calculate time passed; (2) decide whether dramatic updates are allowed (special case or sufficiently long time); (3) list every variable name BEFORE actual variable analysis, without revealing their contents; (4) for each variable, judge whether it satisfies its change conditions and output only Y/N without reasons; (5) only evaluate stories inside <past_observe> block.',
        },
        delta: {
            type: 'string',
            minLength: 0,
            description: 'variable update block',
        },
    },
    required: ['delta'],
});

const json_primitive_value_schemas = [
    { type: 'string' },
    { type: 'number' },
    { type: 'integer' },
    { type: 'boolean' },
    { type: 'null' },
];

const json_array_item_schema = {
    anyOf: [...json_primitive_value_schemas, { type: 'object' }, { type: 'array' }],
};

const json_value_schema = {
    anyOf: [
        ...json_primitive_value_schemas,
        { type: 'object' },
        {
            type: 'array',
            items: json_array_item_schema,
        },
    ],
};

const json_patch_operation_schema = {
    anyOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['replace'] },
                path: { type: 'string' },
                value: json_value_schema,
            },
            required: ['op', 'path', 'value'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['delta'] },
                path: { type: 'string' },
                value: { type: 'number' },
            },
            required: ['op', 'path', 'value'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['insert', 'add'] },
                path: { type: 'string' },
                value: json_value_schema,
            },
            required: ['op', 'path', 'value'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['remove'] },
                path: { type: 'string' },
            },
            required: ['op', 'path'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['move'] },
                from: { type: 'string' },
                path: { type: 'string' },
            },
            required: ['op', 'from', 'path'],
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                op: { type: 'string', enum: ['move'] },
                from: { type: 'string' },
                to: { type: 'string' },
            },
            required: ['op', 'from', 'to'],
        },
    ],
};

export const MVU_JSON_PATCH_RESPONSE_SCHEMA = Object.freeze({
    name: 'mvu_json_patch',
    description: 'MVU JsonPatch dialect response. Return analysis plus json_patch operations only.',
    strict: false,
    value: {
        type: 'object',
        additionalProperties: false,
        properties: {
            analysis: {
                type: 'string',
                description:
                    'Write in ENGLISH. Compactly summarize the variable update decision without revealing variable contents.',
            },
            json_patch: {
                type: 'array',
                description:
                    'MVU JsonPatch dialect operations. Use replace, delta, insert/add, remove, or move with JSON Pointer paths.',
                items: json_patch_operation_schema,
            },
        },
        required: ['analysis', 'json_patch'],
    },
}) satisfies JsonSchema;

export const MVU_TOOL_DEFINITION = Object.freeze({
    type: 'function',
    function: {
        name: MVU_FUNCTION_NAME,
        description: 'use this tool to UpdateVariable.',
        parameters: mvu_update_schema,
    },
}) satisfies ToolDefinition;

/*
    e.g.: [
    [
        {
            "index": 0,
            "id": "tool_0_mvu_VariableUpdate_2lJb8gNNBxCT4Gi4QDkF",
            "type": "function",
            "function": {
                "name": "mvu_VariableUpdate",
                "arguments": "{\"delta\":\"\\n_.set('世界.当前时间','19:30');//赤油们因为饥饿最终选择了吃饲料\\n_.set('yukkuri.yukkuri_1.fullness_level',45);\\n_.set('yukkuri.yukkuri_1.pickiness_level',40);\\n_.set('yukkuri.yukkuri_1.monologue','姆Q……难吃……但是……肚子不饿了……麻麻……什么时候回来……');\\n_.set('yukkuri.yukkuri_2.fullness_level',45);\\n_.set('yukkuri.yukkuri_2.pickiness_level',40);\\n_.set('yukkuri.yukkuri_2.monologue','谬嗯……嚼嚼……不甜……但是……肚子……不空了……麻麻……');\\n_.set('yukkuri.yukkuri_3.fullness_level',45);\\n_.set('yukkuri.yukkuri_3.pickiness_level',40);\\n_.set('yukkuri.yukkuri_3.monologue','麻麻……为什么不给灵缪甜甜……灵缪是坏孩子吗……嚼嚼……好难吃……但是……肚子……');\\n_.set('yukkuri.yukkuri_4.fullness_level',30);\\n_.set('yukkuri.yukkuri_4.pickiness_level',45);\\n_.set('yukkuri.yukkuri_4.monologue','诺杰……好饿……可恶的麻麻……竟然给麻理洽吃这种东西……嚼嚼……呜……好难吃……但是……好饿……');\\n_.set('yukkuri.yukkuri_5.fullness_level',30);\\n_.set('yukkuri.yukkuri_5.pickiness_level',45);\\n_.set('yukkuri.yukkuri_5.monologue','呜……蕾咪才不要吃这种垃圾……蕾咪是高贵的吸血鬼……要吃肉肉……好饿……可恶的麻麻……呜……');\\n\",\"analysis\":\"\\nTime passed: 1 hour. Not a special case, so no dramatic updates.\\nVariables to check: 世界.当前时间, yukkuri.yukkuri_1.fullness_level, yukkuri.yukkuri_1.pickiness_level, yukkuri.yukkuri_1.monologue, yukkuri.yukkuri_2.fullness_level, yukkuri.yukkuri_2.pickiness_level, yukkuri.yukkuri_2.monologue, yukkuri.yukkuri_3.fullness_level, yukkuri.yukkuri_3.pickiness_level, yukkuri.yukkuri_3.monologue, yukkuri.yukkuri_4.fullness_level, yukkuri.yukkuri_4.pickiness_level, yukkuri.yukkuri_4.monologue, yukkuri.yukkuri_5.fullness_level, yukkuri.yukkuri_5.pickiness_level, yukkuri.yukkuri_5.monologue\\n\\n世界.当前时间: Y\\nyukkuri.yukkuri_1.fullness_level: Y\\nyukkuri.yukkuri_1.pickiness_level: Y\\nyukkuri.yukkuri_1.monologue: Y\\nyukkuri.yukkuri_2.fullness_level: Y\\nyukkuri.yukkuri_2.pickiness_level: Y\\nyukkuri.yukkuri_2.monologue: Y\\nyukkuri.yukkuri_3.fullness_level: Y\\nyukkuri.yukkuri_3.pickiness_level: Y\\nyukkuri.yukkuri_3.monologue: Y\\nyukkuri.yukkuri_4.fullness_level: Y\\nyukkuri.yukkuri_4.pickiness_level: Y\\nyukkuri.yukkuri_4.monologue: Y\\nyukkuri.yukkuri_5.fullness_level: Y\\nyukkuri.yukkuri_5.pickiness_level: Y\\nyukkuri.yukkuri_5.monologue: Y\\n\"}"
            }
        }
    ]
]
 */

/** 已知的工具名：先收窄 mvu_VariableUpdate，保留 string 兼容其它 */
type ToolName = typeof MVU_FUNCTION_NAME | (string & {});

/** 工具调用的“函数体” */
interface FunctionCallBody {
    /** 工具名，例如 "mvu_VariableUpdate"。你也可以扩成联合类型做更强约束 */
    name: ToolName;
    /** 注意：这里是**字符串里包 JSON**。解析请看后面的辅助函数 */
    arguments: string;
}

/** 单个工具调用（function-calling 形态） */
interface ToolFunctionCall {
    index?: number; // 这条 tool_call 在“本批次”中的顺序
    id: string; // 流式/合并用的临时 ID
    type: 'function'; // 本题场景锁定 function；留扩展点以兼容其它类型
    function: FunctionCallBody;
}

/** 一批（组）工具调用：你示例里的内层数组 */
type ToolCallBatch = ToolFunctionCall[];

/** 多批（组）工具调用：你示例的最外层 */
type ToolCallBatches = ToolCallBatch[];

/*
async function _onStoryEndCall(_args: any): Promise<string> {
    const variables = await getLastValidVariable(getLastMessageId());
    const val = variables.stat_data;
    let content = ExtraLLMRequestContent;
    if (val !== undefined) {
        content = content.replaceAll(
            "<%= YAML.stringify(getvar('stat_data'), { blockQuote: 'literal' }) _%>",
            YAML.stringify(val, { blockQuote: 'literal' })
        );
    }
    content += `\nuse \`${MVUFunctionName}\` tool to update variables.`;
    return content;
}
*/

async function onVariableUpdatedCall(args: any): Promise<string> {
    if (!args?.delta) return '';
    let message_id = getLastMessageId();
    let chat_message = getChatMessages(message_id).at(-1);
    if (chat_message && chat_message.role === 'system') {
        //移动到前一条，说明这一条是用来显示 mvu 更新的
        message_id -= 1;
        chat_message = getChatMessages(message_id).at(-1);
    }
    if (!chat_message) {
        return '';
    }

    let message_content = chat_message.message.trimEnd();
    const variables = getLastValidVariable(message_id + 1);
    if (!_.has(variables, 'stat_data')) {
        return '';
    }

    const has_variable_modified = await updateVariables(args.delta, variables);
    if (has_variable_modified && useDataStore().effective_settings.兼容性.更新到聊天变量) {
        await replaceVariables(variables, { type: 'chat' });
    }
    await replaceVariables(variables, { type: 'message', message_id: message_id });

    message_content += `\n\n<UpdateVariable>\n<Analysis>${args.analysis}</Analysis></Analysis>${args.delta}\n</UpdateVariable>`;

    if (chat_message.role !== 'user' && !message_content.includes('<StatusPlaceHolderImpl/>')) {
        //同时追加 PlaceHolder。
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content + '\n\n<StatusPlaceHolderImpl/>',
                },
            ],
            {
                refresh: 'affected',
            }
        );
    } else {
        //只追加新增的 UpdateVaraible 块
        await setChatMessages(
            [
                {
                    message_id: message_id,
                    message: message_content,
                },
            ],
            {
                refresh: 'affected',
            }
        );
    }
    return JSON.stringify(variables.delta_data);
}

export function registerFunction() {
    const { registerFunctionTool } = SillyTavern;
    if (!registerFunctionTool) {
        console.debug('MVU: function tools are not supported');
        return () => {};
    }

    registerFunctionTool({
        name: MVU_FUNCTION_NAME,
        displayName: 'MVU update',
        stealth: true,
        description: 'use this tool to UpdateVariable.',
        parameters: mvu_update_schema,
        shouldRegister: () => {
            const store = useDataStore();
            if (!store.should_enable || !store.runtimes.is_function_call_enabled) {
                return false;
            }
            return store.settings.额外模型解析配置.应答格式 === '工具调用';
        },
        action: onVariableUpdatedCall,
        formatMessage: () => '',
    });

    /* 目前验证单独新开一个消息来做变量分析和目前的双模型实现(带预设)没有显著区别，且 llm 不一定会调用，因此暂时搁置。
    const mvuRoundUpdateSchema = Object.freeze({
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        additionalProperties: false,

        properties: {},
    });

    registerFunctionTool({
        name: MVUUpdateCallFunctionName,
        displayName: 'MVU update',
        stealth: false,
        description:
            '**ALWAYS** call this function to end each response. By use this tool, output the `<UpdateVariable>` block is no longer necessary;',
        parameters: mvuRoundUpdateSchema,
        shouldRegister: () => {
            const settings = useDataStore().settings;
            if (settings.更新方式 === '额外轮次函数调用') {
                const message_id = getLastMessageId();
                const chat_message = getChatMessages(message_id).at(-1);
                if (!chat_message) {
                    return false;
                }

                let message_content = chat_message.message;
                //如果已经是一次函数调用的应答，则不进行处理
                if (message_content.indexOf(`以旁白视角分析最新剧情，按照变量更新规则更新`) != -1)
                    return false;
                return true;
            }
            return false;
        },
        action: onStoryEndCall,
        formatMessage: () => '',
    });
    */

    return () => {
        SillyTavern.unregisterFunctionTool(MVU_FUNCTION_NAME);
        SillyTavern.unregisterFunctionTool(mvu_update_call_function_name);
    };
}

export function overrideToolRequest(generate_data: any) {
    const store = useDataStore();
    if (
        store.effective_settings.更新方式 !== '额外模型解析' ||
        store.settings.额外模型解析配置.应答格式 !== '工具调用'
    ) {
        return;
    }
    if (!store.runtimes.is_function_call_enabled) {
        return;
    }
    if (generate_data.tools !== undefined && _.size(generate_data.tools) > 0) {
        //如 v3之类的模型， required之后效力会更好。
        /*
        const message_id = getLastMessageId();
        const chat_message = getChatMessages(message_id).at(-1);
        if (!chat_message) {
            generate_data.tool_choice = 'auto';
            return;
        }
        const function_info = _.get(chat_message, 'extra.tool_invocations');
        if (_.isArray(function_info)) {
            //为required 会更可能出发纯prompt的输出
            generate_data.tool_choice = 'required';
            return;
        }
        */
        generate_data.tool_choice = 'required';
    }
}

function stripOuterTagBlock(input: string, tagPattern: string): string {
    const match = input.match(
        new RegExp(`^\\s*<${tagPattern}>\\s*([\\s\\S]*?)\\s*</${tagPattern}>\\s*$`, 'i')
    );
    return match?.[1]?.trim() ?? input.trim();
}

function stripLeadingTagBlock(input: string, tagPattern: string): string {
    const match = input.match(
        new RegExp(`^\\s*<${tagPattern}>\\s*[\\s\\S]*?\\s*</${tagPattern}>\\s*`, 'i')
    );
    return match ? input.slice(match[0].length).trim() : input.trim();
}

function cleanStructuredPayload(input: string): string {
    return input.replaceAll(/```.*/gm, '').trim();
}

function normalizeJsonPatchPayload(input: unknown): string | null {
    if (isJsonPatch(input)) {
        return JSON.stringify(input, null, 2);
    }
    if (typeof input !== 'string') {
        return null;
    }

    let input_str = cleanStructuredPayload(input);
    input_str = stripOuterTagBlock(input_str, 'UpdateVariable');
    input_str = stripLeadingTagBlock(input_str, 'Analysis');
    input_str = stripLeadingTagBlock(input_str, 'Analyze');
    input_str = stripOuterTagBlock(input_str, 'json_?patch');

    const parsed = parseString(input_str);
    if (!isJsonPatch(parsed)) {
        return null;
    }
    return JSON.stringify(parsed, null, 2);
}

function formatJsonPatchUpdate(analysis: unknown, json_patch: string): string {
    return [
        '<UpdateVariable>',
        '<Analyze>',
        typeof analysis === 'string' ? analysis : '',
        '</Analyze>',
        '<JSONPatch>',
        json_patch,
        '</JSONPatch>',
        '</UpdateVariable>',
    ].join('\n');
}

export function extractFromToolCall(tool_calls: ToolCallBatches | undefined): string | null {
    if (!tool_calls) {
        return null;
    }

    const tool_call = _.get(tool_calls as ToolCallBatches, '[0]');
    if (!tool_call) {
        return null;
    }

    const mvu_call = _(tool_call).findLast(fn => fn.function.name === MVU_FUNCTION_NAME);
    if (!mvu_call) {
        return null;
    }

    const content = _.get(mvu_call, 'function.arguments');
    if (!content) {
        return null;
    }

    try {
        const json = parseString(content);
        if (json.delta && json.delta.length > 5) {
            let result = '';
            result += `<UpdateVariable>\n`;
            result += `<Analyze>\n${json.analysis}\n</Analyze>\n`;
            //如果返回的内容中已包含 <JsonPatch> 块，则要求这里必须能被解释成有效的对象
            //否则需要在这里拒绝
            // 主要有两种情况， llm加了 <json_patch> 和没有加的情况，所以下面是try，解码错误的时候fallback一下。
            const json_patch_match = /json_?patch/i.test(json.delta);
            try {
                const json_patch = normalizeJsonPatchPayload(json.delta);
                if (!json_patch) {
                    throw new Error(tr('runtime.functionCall.invalidJsonPatch'));
                }
                json.delta = json_patch;
                result += `<JSONPatch>\n${json.delta}\n</JSONPatch>\n`;
            } catch (error) {
                if (json_patch_match) {
                    console.error(
                        tr('runtime.functionCall.updateBlockParseFailedLog', {
                            content: String(json.delta),
                            cause: String(error),
                        })
                    );
                    return null;
                }
                const fn_call_match =
                    /_\.(?:set|insert|assign|remove|unset|delete|add)\s*\([\s\S]*?\)\s*;/.test(
                        json.delta
                    );
                //在错误路径上只可能是以往的变量更新语句，因此无效的场合需要拒绝。
                if (fn_call_match) {
                    result += `${json.delta}\n`;
                } else {
                    return null;
                }
            }
            result += `</UpdateVariable>`;
            return result;
        }
    } catch (e) {
        console.log(
            tr('runtime.functionCall.resultParseFailedLog', {
                cause: String(e),
            })
        );
    }
    return null;
}

export function extractFromFormattedOutput(result: string | GenerateToolCallResult): string | null {
    const content = typeof result === 'string' ? result : result.content;
    if (!content) {
        return null;
    }

    try {
        const parsed = parseString(cleanStructuredPayload(content));
        const patch_source = isJsonPatch(parsed)
            ? parsed
            : (_.get(parsed, 'json_patch') ??
              _.get(parsed, 'jsonPatch') ??
              _.get(parsed, 'patch') ??
              _.get(parsed, 'delta'));
        const json_patch = normalizeJsonPatchPayload(patch_source);
        if (!json_patch) {
            throw new Error(tr('runtime.functionCall.invalidJsonPatch'));
        }
        const analysis = isJsonPatch(parsed)
            ? ''
            : (_.get(parsed, 'analysis') ?? _.get(parsed, 'analyze') ?? '');
        return formatJsonPatchUpdate(analysis, json_patch);
    } catch (error) {
        console.error(
            tr('runtime.functionCall.formattedOutputParseFailedLog', {
                content,
                cause: String(error),
            })
        );
        return null;
    }
}

export function extractFromGenerateToolCallResult(result: GenerateToolCallResult): string | null {
    return extractFromToolCall([result.tool_calls]);
}

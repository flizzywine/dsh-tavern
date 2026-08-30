import { migrateExtraModelApiProfiles } from '@/function/update/extra_model_api_profiles';
import {
    CharacterSettingsOverride,
    CharacterSettingsOverridePath,
    getCharacterSettingsOverrideValue,
    hasActiveCharacterSettingsOverride,
    hasOwnCharacterSettingsOverride,
} from '@/function/character_override/schema';
import { is_jest_environment } from '@/jest';
import { registerAsUniqueScript } from '@util/script';
import { klona } from 'klona';
import { defineStore } from 'pinia';
import { computed, ref, toRaw, watch } from 'vue';
import * as z from 'zod';

const ExtraModelApiProfile = z
    .object({
        名称: z.string().min(1),
        api地址: z.string().default(''),
        密钥: z.string().default(''),
        模型名称: z.string().default(''),
    })
    .loose();

export const EXTRA_MODEL_RESPONSE_FORMATS = [
    '聊天消息',
    '工具调用',
    '格式化输出',
    '格式化输出(v4兼容)',
] as const;

const ExtraModelResponseFormat = z.enum(EXTRA_MODEL_RESPONSE_FORMATS);

const OldSettings = z
    .object({
        通知: z
            .object({
                变量更新出错: z.boolean(),
                额外模型解析中: z.boolean(),
            })
            .loose(),
        更新方式: z.enum(['随AI输出', '额外模型解析']),
        自动触发额外模型解析: z.boolean(),
        额外模型解析配置: z
            .object({
                发送预设: z.boolean(),
                使用函数调用: z.boolean(),
                模型来源: z.enum(['与插头相同', '自定义']),
                api地址: z.string(),
                密钥: z.string(),
                模型名称: z.string(),
                温度: z.coerce.number(),
                频率惩罚: z.coerce.number(),
                存在惩罚: z.coerce.number(),
                top_p: z.coerce.number(),
                最大回复token数: z.coerce.number(),
            })
            .loose(),
        快照保留间隔: z.number(),
        更新到聊天变量: z.boolean(),
        legacy: z
            .object({
                显示老旧功能: z.boolean(),
            })
            .loose(),
        auto_cleanup: z
            .object({
                启用: z.boolean(),
                要保留变量的最近楼层数: z.number(),
                触发恢复变量的最近楼层数: z.number(),
            })
            .loose(),
        internal: z
            .object({
                已提醒更新了配置界面: z.boolean(),
                已提醒自动清理旧变量功能: z.boolean(),
                已提醒更新了API温度等配置: z.boolean(),
                已默认开启自动清理旧变量功能: z.boolean(),
            })
            .loose(),
    })
    .loose()
    .transform(data => {
        const {
            自动触发额外模型解析,
            额外模型解析配置: { 发送预设, 使用函数调用, ...extra_model_settings },
            快照保留间隔,
            更新到聊天变量,
            legacy,
            auto_cleanup,
            自动清理变量: existing_auto_cleanup,
            兼容性: existing_compatibility,
            ...settings
        } = data;
        const existing_auto_cleanup_settings = _.isPlainObject(existing_auto_cleanup)
            ? (existing_auto_cleanup as Record<string, unknown>)
            : {};
        const existing_compatibility_settings = _.isPlainObject(existing_compatibility)
            ? (existing_compatibility as Record<string, unknown>)
            : {};

        return NewSettings.decode({
            ...settings,
            额外模型解析配置: {
                破限方案: 发送预设 ? '使用当前预设' : '使用内置破限',
                启用自动请求: 自动触发额外模型解析,
                应答格式: 使用函数调用 ? '工具调用' : '聊天消息',
                ...extra_model_settings,
            },
            自动清理变量: {
                ...auto_cleanup,
                快照保留间隔,
                ...existing_auto_cleanup_settings,
            },
            兼容性: {
                ...legacy,
                更新到聊天变量,
                ...existing_compatibility_settings,
            },
        });
    });

const NewSettings = z
    .object({
        通知: z
            .object({
                MVU框架加载成功: z.boolean().default(true),
                变量初始化成功: z.boolean().default(true),
                变量更新出错: z.boolean().default(false),
                额外模型解析中: z.boolean().default(true),
            })
            .loose()
            .prefault({}),
        更新方式: z.enum(['随AI输出', '额外模型解析']).default('随AI输出'),
        额外模型解析配置: z
            .object({
                破限方案: z
                    .enum(['使用内置破限', '使用当前预设', '使用其他预设'])
                    .default('使用内置破限'),
                其他预设名称: z.string().default(''),
                使用函数调用: z.boolean().optional(),
                应答格式: ExtraModelResponseFormat.optional(),
                关闭thinking: z.boolean().default(false),
                兼容假流式: z.boolean().default(false),
                随机头部: z.boolean().default(true),

                启用自动请求: z.boolean().default(true),
                请求方式: z
                    .enum([
                        '依次请求，失败后重试',
                        '同时请求多次',
                        '先请求一次, 失败后再同时请求多次',
                    ])
                    .default('依次请求，失败后重试'),
                请求次数: z.number().default(3),
                世界书条目白名单正则: z.string().default(''),
                世界书条目黑名单正则: z.string().default(''),

                模型来源: z.enum(['与插头相同', '自定义']).default('与插头相同'),
                api地址: z.string().default('http://localhost:1234/v1'),
                密钥: z.string().default(''),
                模型名称: z.string().default('gemini-2.5-flash-nothinking'),
                温度: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 2)),
                频率惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                存在惩罚: z.coerce
                    .number()
                    .default(0.0)
                    .transform(value => _.clamp(value, -2, 2)),
                top_p: z.coerce
                    .number()
                    .default(1)
                    .transform(value => _.clamp(value, 0, 1)),
                top_k: z.coerce
                    .number()
                    .default(0)
                    .transform(value => _.clamp(value, 0, 500)),
                max_chat_history: z.coerce
                    .number()
                    .default(2)
                    .transform(value => _.clamp(Math.round(value), 2, 100)),
                最大回复token数: z.coerce
                    .number()
                    .default(4096)
                    .transform(value => Math.max(0, value)),
                api方案列表: z.array(ExtraModelApiProfile).default([]),
                当前api方案: z.string().default(''),
            })
            .loose()
            .transform(({ 使用函数调用, 应答格式, ...data }) =>
                migrateExtraModelApiProfiles({
                    ...data,
                    应答格式: 应答格式 ?? (使用函数调用 ? '工具调用' : '聊天消息'),
                })
            )
            .prefault({}),
        自动清理变量: z
            .object({
                启用: z.boolean().default(true),
                快照保留间隔: z.number().default(50),
                要保留变量的最近楼层数: z.number().default(20),
                触发恢复变量的最近楼层数: z.number().default(10),
            })
            .loose()
            .prefault({}),
        兼容性: z
            .object({
                更新到聊天变量: z.boolean().default(false),
                显示老旧功能: z.boolean().default(false),
                sendas不视为user消息: z.boolean().optional(),
                sandas不视为user消息: z.boolean().optional(),
            })
            .loose()
            .transform(({ sendas不视为user消息, sandas不视为user消息, ...data }) => ({
                ...data,
                更新到聊天变量: data.更新到聊天变量,
                显示老旧功能: data.显示老旧功能,
                sendas不视为user消息: sendas不视为user消息 ?? sandas不视为user消息 ?? false,
            }))
            .prefault({}),
        internal: z
            .object({
                已提醒更新了配置界面: z.boolean().default(false),
                已提醒自动清理旧变量功能: z.boolean().default(false),
                已提醒更新了API温度等配置: z.boolean().default(false),
                已默认开启自动清理旧变量功能: z.boolean().default(false),
                已提醒内置破限: z.boolean().default(false),
                已提醒额外模型同时请求: z.boolean().default(false),
                已开启默认不兼容假流式: z.boolean().default(false),
            })
            .loose()
            .prefault({}),
    })
    .loose()
    .transform(data => {
        if (data.internal.已开启默认不兼容假流式 === false) {
            data.额外模型解析配置.兼容假流式 = false;
            data.internal.已开启默认不兼容假流式 = true;
        }
        return data;
    })
    .prefault({});

const Settings = z.union([OldSettings, NewSettings]).catch(() => NewSettings.parse({}));

export type MvuSettings = z.infer<typeof NewSettings>;

export type CharacterSettingsState = {
    status: 'loading' | 'unbound' | 'ready' | 'error';
    character_name: string;
    worldbook_name: string | null;
    entry_uid: number | null;
    expected_content: string | null;
    draft: CharacterSettingsOverride;
    is_valid: boolean;
    revision: number;
    has_pending_save: boolean;
    is_saving: boolean;
};

function createCharacterSettingsState(): CharacterSettingsState {
    return {
        status: 'loading',
        character_name: '',
        worldbook_name: null,
        entry_uid: null,
        expected_content: null,
        draft: {},
        is_valid: true,
        revision: 0,
        has_pending_save: false,
        is_saving: false,
    };
}

const Runtimes = z
    .object({
        unsupported_warnings: z.string().default(''),
        is_during_extra_analysis: z.boolean().default(false),
        is_function_call_enabled: z.boolean().default(false),
        上次世界书条目过滤结果: z
            .array(
                z.object({
                    lore: z.enum(['globalLore', 'characterLore', 'chatLore', 'personaLore']),
                    world: z.string(),
                    comment: z.string(),
                    reason: z.enum(['白名单', '黑名单']),
                    sources: z.array(z.enum(['用户全局配置', '角色卡配置'])).default([]),
                })
            )
            .default([]),
        debug: z
            .object({
                首次额外请求必失败: z.boolean().default(false),
            })
            .prefault({}),
    })
    .prefault({});

export const useDataStore = defineStore('MVU变量框架', () => {
    const settings = ref(Settings.parse(_.get(SillyTavern.extensionSettings, 'mvu_settings', {})));
    watch(
        settings,
        new_settings => {
            _.set(SillyTavern.extensionSettings, 'mvu_settings', toRaw(new_settings));
            if (!is_jest_environment) SillyTavern.saveSettingsDebounced();
        },
        { deep: true }
    );
    const _reload_settings = () => {
        settings.value = Settings.parse(_.get(SillyTavern.extensionSettings, 'mvu_settings', {}));
    };

    const character_settings = ref<CharacterSettingsState>(createCharacterSettingsState());
    const effective_settings = computed<MvuSettings>(() => {
        // 运行时读取合并后的配置，但不修改用户持久化的全局设置。
        const result = klona(settings.value);
        if (!character_settings.value.is_valid) {
            return result;
        }

        const draft = character_settings.value.draft;
        // 正则采用“全局 + 角色卡”的叠加语义，由 filterEntries 单独合并，不在此处覆盖。
        if (_.has(draft, '更新方式')) {
            result.更新方式 = draft.更新方式!;
        }
        if (_.has(draft, '额外模型解析配置.启用自动请求')) {
            result.额外模型解析配置.启用自动请求 = draft.额外模型解析配置!.启用自动请求!;
        }
        if (_.has(draft, '兼容性.更新到聊天变量')) {
            result.兼容性.更新到聊天变量 = draft.兼容性!.更新到聊天变量!;
        }
        if (_.has(draft, '兼容性.sendas不视为user消息')) {
            result.兼容性.sendas不视为user消息 = draft.兼容性!.sendas不视为user消息!;
        }
        return result;
    });
    const has_character_settings_override = (path: CharacterSettingsOverridePath) =>
        character_settings.value.is_valid &&
        hasOwnCharacterSettingsOverride(character_settings.value.draft, path);
    const get_character_settings_override = (path: CharacterSettingsOverridePath) =>
        character_settings.value.is_valid
            ? getCharacterSettingsOverrideValue(character_settings.value.draft, path)
            : undefined;
    const is_character_settings_override_active = computed(
        () =>
            character_settings.value.is_valid &&
            hasActiveCharacterSettingsOverride(character_settings.value.draft)
    );
    const resetCharacterSettings = () => {
        character_settings.value = createCharacterSettingsState();
    };

    const runtimes = ref(Runtimes.parse({}));
    watch(
        () => runtimes.value.is_during_extra_analysis,
        new_value => insertOrAssignVariables({ extra_analysis: new_value }, { type: 'global' }),
        { immediate: true }
    );
    const resetRuntimes = () => {
        runtimes.value = Runtimes.parse({});
    };

    const versions = ref<{ sillytavern: string; tavernhelper: string }>({
        sillytavern: '',
        tavernhelper: '',
    });
    const _wait_init = async () => {
        versions.value.sillytavern = await fetch('/version')
            .then(res => res.json())
            .then(data => data.pkgVersion)
            .catch(() => '1.0.0');
        versions.value.tavernhelper = await getTavernHelperVersion();
    };

    const should_enable = ref<boolean>(false);
    watch(should_enable, (new_enable, old_enable) => {
        if (new_enable && !old_enable) {
            _reload_settings();
        }
    });

    // 当存在多个 MVU 脚本实例时，仅优先实例应启用运行逻辑。
    registerAsUniqueScript('MVU变量框架').listenPreferenceState(preferred_script_id => {
        should_enable.value = preferred_script_id === getScriptId();
    });

    return {
        settings,
        _reload_settings,
        character_settings,
        effective_settings,
        has_character_settings_override,
        get_character_settings_override,
        is_character_settings_override_active,
        resetCharacterSettings,
        runtimes,
        resetRuntimes,
        versions,
        _wait_init,
        should_enable,
    };
});

<template>
    <Detail :title="title">
        <template #title-suffix>
            <HelpIcon :help="character_override_help" />
        </template>

        <dl class="mvu-character-override__metadata">
            <dt>{{ t('panel.character.worldBook') }}</dt>
            <dd>{{ worldbook_label }}</dd>
        </dl>

        <fieldset class="mvu-character-override__fieldset" :disabled="!is_editable">
            <Field class="mvu-character-override__select-field" :label="t('panel.update.section')">
                <select v-model="update_method_model" class="text_pole">
                    <option :value="INHERIT">{{ t('panel.character.inherit') }}</option>
                    <option value="随AI输出">{{ t('panel.update.method.aiOutput') }}</option>
                    <option value="额外模型解析">
                        {{ t('panel.update.method.extraModel') }}
                    </option>
                </select>
            </Field>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">
                    {{ t('panel.character.extraModelGroup') }}
                </strong>

                <Field
                    class="mvu-character-override__select-field"
                    :label="t('panel.character.autoRequest')"
                >
                    <select v-model="auto_request_model" class="text_pole">
                        <option :value="INHERIT">{{ t('panel.character.inherit') }}</option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                </Field>

                <Field :label="t('panel.character.whitelist')">
                    <input
                        v-model="whitelist_model"
                        type="text"
                        class="text_pole"
                        :placeholder="t('panel.prompt.whitelistPlaceholder', { or: '|' })"
                    />
                    <div v-if="whitelist_regex_error" class="mvu-character-override__regex-error">
                        {{
                            t('panel.character.regexInvalid', {
                                error: whitelist_regex_error,
                            })
                        }}
                    </div>
                </Field>

                <Field :label="t('panel.character.blacklist')">
                    <input
                        v-model="blacklist_model"
                        type="text"
                        class="text_pole"
                        :placeholder="t('panel.prompt.blacklistPlaceholder', { or: '|' })"
                    />
                    <div v-if="blacklist_regex_error" class="mvu-character-override__regex-error">
                        {{
                            t('panel.character.regexInvalid', {
                                error: blacklist_regex_error,
                            })
                        }}
                    </div>
                </Field>
            </div>

            <div class="mvu-character-override__group">
                <strong class="mvu-character-override__group-title">
                    {{ t('panel.compatibility.section') }}
                </strong>

                <Field
                    class="mvu-character-override__select-field"
                    :label="t('panel.compatibility.updateChatVariables')"
                >
                    <select v-model="update_chat_variables_model" class="text_pole">
                        <option :value="INHERIT">{{ t('panel.character.inherit') }}</option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                </Field>

                <Field
                    class="mvu-character-override__select-field"
                    :label="t('panel.compatibility.sendasNotUser')"
                >
                    <select v-model="sendas_not_user_model" class="text_pole">
                        <option :value="INHERIT">{{ t('panel.character.inherit') }}</option>
                        <option value="true">{{ t('common.enabled') }}</option>
                        <option value="false">{{ t('common.disabled') }}</option>
                    </select>
                </Field>
            </div>
        </fieldset>
    </Detail>
</template>

<script setup lang="ts">
import { setCharacterSettingsOverride } from '@/function/character_override';
import type { CharacterSettingsOverridePath } from '@/function/character_override/schema';
import { compileEntryCommentRegex } from '@/function/request/entry_comment_regex';
import { useMvuI18n } from '@/i18n';
import character_override_help_en from '@/panel/character_override_help.en.md';
import character_override_help_zh_cn from '@/panel/character_override_help.zh-CN.md';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import { useDataStore } from '@/store';
import { computed } from 'vue';
import type { WritableComputedRef } from 'vue';

// 下拉框用哨兵值表达“角色卡未设置，继续继承用户全局配置”。
const INHERIT = '__inherit__';
const store = useDataStore();
const { locale, t } = useMvuI18n();

const title = computed(() =>
    t(
        store.is_character_settings_override_active
            ? 'panel.character.titleActive'
            : 'panel.character.titleInactive'
    )
);
const character_override_help = computed(() =>
    locale.value === 'zh-CN' ? character_override_help_zh_cn : character_override_help_en
);

const is_editable = computed(
    () =>
        store.character_settings.status === 'ready' &&
        store.character_settings.worldbook_name !== null
);

const worldbook_label = computed(() => {
    if (store.character_settings.status === 'loading') {
        return t('panel.character.reading');
    }
    if (!store.character_settings.worldbook_name) {
        return t('panel.character.unbound');
    }
    return store.character_settings.worldbook_name;
});

const update_method_model = computed<string>({
    get: () => {
        const value = store.get_character_settings_override('更新方式');
        return value === '随AI输出' || value === '额外模型解析' ? value : INHERIT;
    },
    set: value => {
        setCharacterSettingsOverride(
            '更新方式',
            value === '随AI输出' || value === '额外模型解析' ? value : undefined
        );
    },
});

function make_boolean_model(path: CharacterSettingsOverridePath): WritableComputedRef<string> {
    return computed<string>({
        get: () => {
            const value = store.get_character_settings_override(path);
            return typeof value === 'boolean' ? String(value) : INHERIT;
        },
        set: value => {
            setCharacterSettingsOverride(path, value === INHERIT ? undefined : value === 'true');
        },
    });
}

function make_regex_model(path: CharacterSettingsOverridePath): WritableComputedRef<string> {
    return computed<string>({
        get: () => {
            const value = store.get_character_settings_override(path);
            return typeof value === 'string' ? value : '';
        },
        set: value => setCharacterSettingsOverride(path, value),
    });
}

const auto_request_model = make_boolean_model('额外模型解析配置.启用自动请求');
const update_chat_variables_model = make_boolean_model('兼容性.更新到聊天变量');
const sendas_not_user_model = make_boolean_model('兼容性.sendas不视为user消息');
const whitelist_model = make_regex_model('额外模型解析配置.世界书条目白名单正则');
const blacklist_model = make_regex_model('额外模型解析配置.世界书条目黑名单正则');

const whitelist_regex_error = computed(
    () => compileEntryCommentRegex(whitelist_model.value).error ?? ''
);
const blacklist_regex_error = computed(
    () => compileEntryCommentRegex(blacklist_model.value).error ?? ''
);
</script>

<style scoped>
.mvu-character-override__metadata {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.25rem 0.7rem;
    margin: 0;
    padding: 0.35rem 0.55rem;
    border-radius: 8px;
    background-color: rgba(0, 0, 0, 0.08);
}

.mvu-character-override__metadata dt {
    font-weight: 600;
    opacity: 0.82;
}

.mvu-character-override__metadata dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.mvu-character-override__fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
}

.mvu-character-override__fieldset:disabled {
    opacity: 0.6;
}

.mvu-character-override__group {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.1rem;
}

.mvu-character-override__group-title {
    padding: 0 0.15rem;
}

.mvu-character-override__select-field.mvu-field {
    flex-flow: row nowrap;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
}

.mvu-character-override__select-field > .text_pole {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    margin: 0;
}

.mvu-character-override__regex-error {
    color: var(--SmartThemeQuoteColor, #ff6b6b);
    font-size: calc(var(--mainFontSize, 1rem) * 0.9);
    line-height: 1.35;
    overflow-wrap: anywhere;
}
</style>

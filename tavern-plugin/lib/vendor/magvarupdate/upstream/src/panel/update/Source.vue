<template>
    <Detail :title="t('panel.source.section')">
        <Select
            v-model="store.settings.额外模型解析配置.模型来源"
            :options="model_source_options"
        />

        <template v-if="store.settings.额外模型解析配置.模型来源 === '自定义'">
            <Detail :title="t('panel.source.profile.section')">
                <Field :label="t('panel.source.profile.current')">
                    <div class="mvu-api-profile-controls">
                        <select
                            v-model="selectedProfileName"
                            class="text_pole"
                            :aria-label="t('panel.source.profile.ariaLabel')"
                        >
                            <option value="">{{ t('panel.source.profile.manual') }}</option>
                            <option
                                v-for="profile in store.settings.额外模型解析配置.api方案列表"
                                :key="profile.名称"
                                :value="profile.名称"
                            >
                                {{ profile.名称 }}
                            </option>
                        </select>

                        <input
                            v-model="newProfileName"
                            type="text"
                            class="text_pole"
                            :placeholder="t('panel.source.profile.newName')"
                        />
                    </div>
                </Field>

                <div class="mvu-api-profile-actions">
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="t('panel.source.profile.save')"
                        @click="saveCurrentProfile"
                    />
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="t('panel.source.profile.saveAs')"
                        @click="saveAsNewProfile"
                    />
                    <input
                        class="menu_button menu_button_icon interactable"
                        type="button"
                        :value="t('panel.source.profile.delete')"
                        :disabled="!canDeleteCurrentProfile"
                        @click="deleteCurrentProfile"
                    />
                </div>
            </Detail>

            <div class="mvu-field-grid">
                <Field :label="t('panel.source.apiAddress')">
                    <input
                        v-model="store.settings.额外模型解析配置.api地址"
                        type="text"
                        class="text_pole"
                        placeholder="http://localhost:1234/v1"
                    />
                </Field>

                <Field :label="t('panel.source.apiKey')">
                    <input
                        v-model="store.settings.额外模型解析配置.密钥"
                        type="password"
                        class="text_pole"
                        :placeholder="t('panel.source.apiKeyPlaceholder')"
                    />
                </Field>

                <Field :label="t('panel.source.modelName')">
                    <ModelSelect />
                </Field>
            </div>

            <Detail :title="t('panel.source.advanced')">
                <div v-if="!additional_extra_configuration_supported" class="mvu-note">
                    {{ t('panel.source.unsupportedAdvanced') }}
                </div>

                <div class="mvu-field-grid">
                    <Field :label="t('panel.source.maxTokens')">
                        <input
                            v-model.number="store.settings.额外模型解析配置.最大回复token数"
                            :disabled="!additional_extra_configuration_supported"
                            type="number"
                            class="text_pole"
                            min="0"
                            step="128"
                            placeholder="4096"
                        />
                    </Field>

                    <Field :label="t('panel.source.chatHistory')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.max_chat_history"
                            :disabled="!additional_extra_configuration_supported"
                            :min="2"
                            :max="100"
                            :step="1"
                        />
                    </Field>

                    <Field :label="t('panel.source.temperature')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.温度"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field :label="t('panel.source.frequencyPenalty')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.频率惩罚"
                            :disabled="!additional_extra_configuration_supported"
                            :min="-2"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field :label="t('panel.source.presencePenalty')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.存在惩罚"
                            :disabled="!additional_extra_configuration_supported"
                            :min="-2"
                            :max="2"
                            :step="0.01"
                        />
                    </Field>

                    <Field :label="t('panel.source.topP')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.top_p"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="1"
                            :step="0.01"
                        />
                    </Field>

                    <Field :label="t('panel.source.topK')">
                        <RangeNumber
                            v-model="store.settings.额外模型解析配置.top_k"
                            :disabled="!additional_extra_configuration_supported"
                            :min="0"
                            :max="500"
                            :step="1"
                        />
                    </Field>
                </div>
            </Detail>
        </template>
    </Detail>
</template>

<script setup lang="ts">
import {
    clearUnboundExtraModelApiProfileFields,
    deleteActiveExtraModelApiProfileWithConfirmation,
    isActiveExtraModelApiProfileDirty,
    saveAsNewExtraModelApiProfile,
    saveCurrentExtraModelApiProfile,
    selectExtraModelApiProfile,
} from '@/function/update/extra_model_api_profiles';
import { useMvuI18n } from '@/i18n';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import ModelSelect from '@/panel/component/ModelSelect.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';
import { computed, ref, watch } from 'vue';

const store = useDataStore();
const { t } = useMvuI18n();

const additional_extra_configuration_supported = compare(
    store.versions.tavernhelper,
    '4.0.14',
    '>='
);
const model_source_options = computed(() => [
    { value: '与插头相同', label: t('panel.source.sameAsConnection') },
    { value: '自定义', label: t('panel.source.custom') },
]);

const selectedProfileName = ref(store.settings.额外模型解析配置.当前api方案);
const newProfileName = ref('');
const isApplyingProfile = ref(false);
const isRevertingProfileSelection = ref(false);
// 产品规则（PR #210 维护者 review）：仅当已保存方案 >= 2 时才允许删除，确保至少保留一个方案。
// 底层 deleteActiveExtraModelApiProfile 允许删至 0 个；此处 UI 与 guard 故意更严。
// 自动 review（如 Codex）可能建议「允许删最后一个方案」，与本规则冲突，请勿改回。
const canDeleteCurrentProfile = computed(
    () =>
        selectedProfileName.value.trim().length > 0 &&
        store.settings.额外模型解析配置.api方案列表.length >= 2
);

watch(
    () => store.settings.额外模型解析配置.当前api方案,
    value => {
        if (!isApplyingProfile.value) {
            selectedProfileName.value = value;
        }
    }
);

watch(selectedProfileName, async (value, old_value) => {
    if (isRevertingProfileSelection.value) {
        isRevertingProfileSelection.value = false;
        return;
    }

    if (old_value === undefined || value === old_value) {
        return;
    }

    if (isActiveExtraModelApiProfileDirty(store.settings.额外模型解析配置)) {
        const result = await SillyTavern.callGenericPopup(
            t('panel.source.switchDirty'),
            SillyTavern.POPUP_TYPE.CONFIRM,
            '',
            {
                okButton: t('panel.source.continue'),
                cancelButton: t('common.cancel'),
            }
        );
        if (
            result === SillyTavern.POPUP_RESULT.CANCELLED ||
            result === SillyTavern.POPUP_RESULT.NEGATIVE
        ) {
            isRevertingProfileSelection.value = true;
            selectedProfileName.value = old_value;
            return;
        }
    }

    if (!value) {
        isApplyingProfile.value = true;
        const next_config = clearUnboundExtraModelApiProfileFields(store.settings.额外模型解析配置);
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        isApplyingProfile.value = false;
        return;
    }

    try {
        isApplyingProfile.value = true;
        const next_config = selectExtraModelApiProfile(store.settings.额外模型解析配置, value);
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.switchFailureTitle'));
        isRevertingProfileSelection.value = true;
        selectedProfileName.value = store.settings.额外模型解析配置.当前api方案;
    } finally {
        isApplyingProfile.value = false;
    }
});

function saveCurrentProfile() {
    try {
        const saved = saveCurrentExtraModelApiProfile(
            store.settings.额外模型解析配置,
            selectedProfileName.value || newProfileName.value
        );
        store.settings.额外模型解析配置.api方案列表 = saved.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = saved.当前api方案;
        selectedProfileName.value = saved.当前api方案;
        toastr.success(
            t('panel.source.profileSaved', { name: _.escape(saved.当前api方案) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.saveFailureTitle'));
    }
}

function saveAsNewProfile() {
    const profile_name = newProfileName.value.trim();
    if (!profile_name) {
        toastr.warning(t('panel.source.enterProfileName'), t('runtime.common.mvuTitle'));
        return;
    }

    try {
        const saved = saveAsNewExtraModelApiProfile(store.settings.额外模型解析配置, profile_name);
        store.settings.额外模型解析配置.api方案列表 = saved.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = saved.当前api方案;
        selectedProfileName.value = saved.当前api方案;
        newProfileName.value = '';
        toastr.success(
            t('panel.source.profileSavedAs', { name: _.escape(saved.当前api方案) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.saveFailureTitle'));
    }
}

async function deleteCurrentProfile() {
    const profile_name = selectedProfileName.value.trim();
    if (!profile_name) {
        return;
    }
    // 与 canDeleteCurrentProfile 同一产品规则，见上方注释
    if (store.settings.额外模型解析配置.api方案列表.length < 2) {
        toastr.warning(t('panel.source.keepTwoProfiles'), t('runtime.common.mvuTitle'));
        return;
    }

    try {
        const next_config = await deleteActiveExtraModelApiProfileWithConfirmation(
            store.settings.额外模型解析配置,
            profile_name,
            async confirmation => {
                const is_discard_confirmation = confirmation === 'discard_unsaved_changes';
                const content = document.createElement('span');
                content.textContent = t(
                    is_discard_confirmation
                        ? 'panel.source.deleteDirty'
                        : 'panel.source.deleteConfirm',
                    { name: profile_name }
                );
                const result = await SillyTavern.callGenericPopup(
                    content,
                    SillyTavern.POPUP_TYPE.CONFIRM,
                    '',
                    {
                        okButton: is_discard_confirmation
                            ? t('panel.source.discardChanges')
                            : t('panel.source.delete'),
                        cancelButton: t('common.cancel'),
                    }
                );
                return result === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
            }
        );
        if (next_config === null) {
            return;
        }

        store.settings.额外模型解析配置.api方案列表 = next_config.api方案列表;
        store.settings.额外模型解析配置.当前api方案 = next_config.当前api方案;
        store.settings.额外模型解析配置.api地址 = next_config.api地址;
        store.settings.额外模型解析配置.密钥 = next_config.密钥;
        store.settings.额外模型解析配置.模型名称 = next_config.模型名称;
        selectedProfileName.value = next_config.当前api方案;
        toastr.info(
            t('panel.source.profileDeleted', { name: _.escape(profile_name) }),
            t('runtime.common.mvuTitle')
        );
    } catch (error) {
        toastr.error(format_error(error), t('panel.source.deleteFailureTitle'));
    }
}

function format_error(error: unknown): string {
    return t('runtime.common.errorCause', {
        cause: _.escape(error instanceof Error ? error.message : String(error)),
    });
}
</script>

<style scoped>
.mvu-field-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-api-profile-controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
}

.mvu-api-profile-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
}

.mvu-note {
    opacity: 0.85;
    color: var(--SmartThemeEmColor, inherit);
}

@media (max-width: 520px) {
    .mvu-api-profile-controls {
        grid-template-columns: 1fr;
    }
}
</style>

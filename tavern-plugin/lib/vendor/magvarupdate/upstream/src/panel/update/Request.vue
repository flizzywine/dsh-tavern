<template>
    <Detail :title="t('panel.request.section')">
        <Field :label="t('panel.request.method')">
            <template #label-suffix>
                <HelpIcon :help="request_method_help" />
            </template>
            <Select
                v-model="store.settings.额外模型解析配置.请求方式"
                :options="request_method_options"
            />
        </Field>

        <Field :label="t('panel.request.count')">
            <RangeNumber
                v-model="store.settings.额外模型解析配置.请求次数"
                :min="
                    store.settings.额外模型解析配置.请求方式 === '先请求一次, 失败后再同时请求多次'
                        ? 2
                        : 1
                "
                :max="10"
                :step="1"
            />
        </Field>

        <Field :label="t('panel.request.auto')">
            <template #label-suffix>
                <HelpIcon :help="t('panel.request.autoHelp')" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('额外模型解析配置.启用自动请求')"
                    :value="auto_request_override_label"
                />
            </template>
            <Checkbox v-model="store.settings.额外模型解析配置.启用自动请求">
                <span>{{ t('common.enabled') }}</span>
            </Checkbox>
        </Field>
    </Detail>
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import RangeNumber from '@/panel/component/RangeNumber.vue';
import Select from '@/panel/component/Select.vue';
import request_method_help_en from '@/panel/update/request_method.en.md';
import request_method_help_zh_cn from '@/panel/update/request_method.zh-CN.md';
import { useDataStore } from '@/store';
import { compare } from 'compare-versions';
import { computed, watch } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
const request_method_help = computed(() =>
    locale.value === 'zh-CN' ? request_method_help_zh_cn : request_method_help_en
);
const auto_request_override_label = computed(() =>
    t(store.effective_settings.额外模型解析配置.启用自动请求 ? 'common.enabled' : 'common.disabled')
);
const request_method_options = computed(() => [
    { value: '依次请求，失败后重试', label: t('panel.request.sequential') },
    { value: '同时请求多次', label: t('panel.request.parallel') },
    {
        value: '先请求一次, 失败后再同时请求多次',
        label: t('panel.request.onceThenParallel'),
    },
]);

watch(
    () => store.settings.额外模型解析配置.请求方式,
    value => {
        if (
            value !== '依次请求，失败后重试' &&
            compare(store.versions.tavernhelper, '4.4.3', '<')
        ) {
            toastr.warning(t('panel.request.batchWarning'), t('panel.request.batchWarningTitle'), {
                timeOut: 5000,
            });
        }
    }
);
</script>

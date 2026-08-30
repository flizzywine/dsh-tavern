<template>
    <Select v-model="store.settings.更新方式" :options="update_method_options" />

    <template
        v-if="
            store.runtimes.unsupported_warnings !== '' &&
            store.effective_settings.更新方式 === '额外模型解析'
        "
    >
        <div class="mvu-warning">
            <span class="mvu-warning__icon">ℹ️</span>
            <span class="mvu-warning__text">
                {{
                    t('panel.update.method.unsupportedWarning', {
                        worldbooks: store.runtimes.unsupported_warnings,
                    })
                }}
                <HelpIcon :help="update_method_help" />
            </span>
        </div>
    </template>
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import Select from '@/panel/component/Select.vue';
import update_method_help_en from '@/panel/update_method.en.md';
import update_method_help_zh_cn from '@/panel/update_method.zh-CN.md';
import { useDataStore } from '@/store';
import { computed } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
const update_method_help = computed(() =>
    locale.value === 'zh-CN' ? update_method_help_zh_cn : update_method_help_en
);
const update_method_options = computed(() => [
    { value: '随AI输出', label: t('panel.update.method.aiOutput') },
    { value: '额外模型解析', label: t('panel.update.method.extraModel') },
]);
</script>

<style scoped>
.mvu-warning {
    margin-top: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--SmartThemeEmColor, #d39e00) 35%, transparent);
    border-radius: 10px;
    background-color: color-mix(in srgb, var(--SmartThemeEmColor, #fff3cd) 15%, transparent);
    color: var(--SmartThemeEmColor, #856404);
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    align-items: center;
}

.mvu-warning__icon {
    line-height: 1;
}

.mvu-warning__text {
    word-break: break-word;
}
</style>

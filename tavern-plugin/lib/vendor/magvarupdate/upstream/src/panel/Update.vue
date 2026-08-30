<template>
    <Section :label="t('panel.update.section')">
        <template #label-suffix>
            <HelpIcon :help="update_method_help" />
            <OverrideBadge
                v-if="store.has_character_settings_override('更新方式')"
                :value="update_method_override_label"
            />
        </template>
        <template #content>
            <Method />

            <template
                v-if="
                    store.settings.更新方式 === '额外模型解析' ||
                    store.effective_settings.更新方式 === '额外模型解析'
                "
            >
                <Prompt />
                <Request />
                <Source />
            </template>
        </template>
    </Section>
</template>

<script setup lang="ts">
import HelpIcon from '@/panel/component/HelpIcon.vue';
import { useMvuI18n } from '@/i18n';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import Section from '@/panel/component/Section.vue';
import Method from '@/panel/update/Method.vue';
import Prompt from '@/panel/update/Prompt.vue';
import Request from '@/panel/update/Request.vue';
import Source from '@/panel/update/Source.vue';
import update_method_help_en from '@/panel/update_method.en.md';
import update_method_help_zh_cn from '@/panel/update_method.zh-CN.md';
import { useDataStore } from '@/store';
import { computed } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
const update_method_help = computed(() =>
    locale.value === 'zh-CN' ? update_method_help_zh_cn : update_method_help_en
);
const update_method_override_label = computed(() =>
    t(
        store.effective_settings.更新方式 === '随AI输出'
            ? 'panel.update.method.aiOutput'
            : 'panel.update.method.extraModel'
    )
);
</script>

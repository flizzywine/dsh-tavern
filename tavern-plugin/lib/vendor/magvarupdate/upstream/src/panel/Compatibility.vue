<template>
    <Section :label="t('panel.compatibility.section')">
        <template #content>
            <Checkbox v-model="store.settings.兼容性.更新到聊天变量">
                <span>{{ t('panel.compatibility.updateChatVariables') }}</span>
                <HelpIcon :help="t('panel.compatibility.updateChatVariablesHelp')" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.更新到聊天变量')"
                    :value="update_chat_variables_override_label"
                />
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.显示老旧功能">
                <span>{{ t('panel.compatibility.showLegacy') }}</span>
            </Checkbox>

            <Checkbox v-model="store.settings.兼容性.sendas不视为user消息">
                <span>{{ t('panel.compatibility.sendasNotUser') }}</span>
                <HelpIcon :help="sandas_message_help" />
                <OverrideBadge
                    v-if="store.has_character_settings_override('兼容性.sendas不视为user消息')"
                    :value="sendas_not_user_override_label"
                />
            </Checkbox>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import { useMvuI18n } from '@/i18n';
import HelpIcon from '@/panel/component/HelpIcon.vue';
import OverrideBadge from '@/panel/component/OverrideBadge.vue';
import Section from '@/panel/component/Section.vue';
import sandas_message_help_en from '@/panel/compatibility_sandas_message.en.md';
import sandas_message_help_zh_cn from '@/panel/compatibility_sandas_message.zh-CN.md';
import { useDataStore } from '@/store';
import { computed } from 'vue';

const store = useDataStore();
const { locale, t } = useMvuI18n();
const sandas_message_help = computed(() =>
    locale.value === 'zh-CN' ? sandas_message_help_zh_cn : sandas_message_help_en
);

function format_boolean(value: boolean): string {
    return t(value ? 'common.enabled' : 'common.disabled');
}

const update_chat_variables_override_label = computed(() =>
    format_boolean(store.effective_settings.兼容性.更新到聊天变量)
);
const sendas_not_user_override_label = computed(() =>
    format_boolean(store.effective_settings.兼容性.sendas不视为user消息)
);
</script>

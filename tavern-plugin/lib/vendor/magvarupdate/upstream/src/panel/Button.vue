<template>
    <Section :label="t('panel.button.section')">
        <template #content>
            <div class="mvu-button-wrap">
                <div
                    v-for="button in visible_buttons"
                    :key="button.name"
                    class="menu_button menu_button_icon interactable"
                    tabindex="0"
                    role="button"
                    @click="button.function"
                >
                    {{ t(button.label_key) }}
                </div>
            </div>
        </template>
    </Section>
</template>

<script setup lang="ts">
import { buttons } from '@/button';
import { useMvuI18n } from '@/i18n';
import Section from '@/panel/component/Section.vue';
import { useDataStore } from '@/store';
import { computed } from 'vue';

const store = useDataStore();
const { t } = useMvuI18n();
const visible_buttons = computed(() =>
    buttons.filter(
        button => !(button.is_legacy ?? false) || store.settings.兼容性.显示老旧功能 === true
    )
);
</script>

<style scoped>
.mvu-button-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 0.6rem;
    align-items: center;
}

.mvu-button-wrap :deep(.menu_button) {
    box-sizing: border-box;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: flex-start;
    padding: 0.35rem 0.6rem;
    min-height: unset;
    height: 2.05rem;
    line-height: 1.1;
}
</style>

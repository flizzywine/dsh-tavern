<template>
    <Section :label="t('panel.version.section')">
        <template #content>
            <span> {{ build_date }} ({{ commit_id }}) </span>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Section from '@/panel/component/Section.vue';
import { useMvuI18n } from '@/i18n';
import { computed } from 'vue';

const { t } = useMvuI18n();
const build_date = computed(() => __BUILD_DATE__ ?? t('panel.version.unknown'));
const commit_id = computed(() => __COMMIT_ID__ ?? t('panel.version.unknown'));
</script>

<template>
    <i
        class="fa-solid fa-circle-question fa-sm note-link-span mvu-help-icon"
        role="button"
        tabindex="0"
        :aria-label="t('panel.help.ariaLabel')"
        @click.stop.prevent="showHelpPopup(help)"
        @keydown.enter.space.stop.prevent="showHelpPopup(help)"
    />
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';
import { showHelpPopup } from '@/util';

defineProps<{ help: string }>();
const { t } = useMvuI18n();
</script>

<style scoped>
.mvu-help-icon {
    cursor: pointer;
}
</style>

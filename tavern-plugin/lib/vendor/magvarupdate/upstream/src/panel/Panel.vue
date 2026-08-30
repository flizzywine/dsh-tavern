<template>
    <div v-if="store.should_enable" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>{{ t('panel.title') }}</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>

        <div class="inline-drawer-content">
            <Version />
            <CharacterOverride />
            <Notification />
            <Update />
            <Button />
            <Cleanup />
            <Compatibility />
        </div>
    </div>
</template>

<script setup lang="ts">
import Button from '@/panel/Button.vue';
import CharacterOverride from '@/panel/CharacterOverride.vue';
import Cleanup from '@/panel/Cleanup.vue';
import Compatibility from '@/panel/Compatibility.vue';
import Notification from '@/panel/Notification.vue';
import Update from '@/panel/Update.vue';
import Version from '@/panel/Version.vue';
import { useMvuI18n } from '@/i18n';
import { useDataStore } from '@/store';

const store = useDataStore();
const { t } = useMvuI18n();
</script>

<style scoped>
.inline-drawer-content {
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.5rem;
}
</style>

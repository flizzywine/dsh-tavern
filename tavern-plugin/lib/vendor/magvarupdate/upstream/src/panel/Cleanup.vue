<template>
    <Section :label="t('panel.cleanup.section')">
        <template #content>
            <Checkbox v-model="store.settings.自动清理变量.启用">
                <span>{{ t('panel.cleanup.enable') }}</span>
            </Checkbox>

            <Detail :title="t('panel.cleanup.strategy')">
                <Field id="mvu_snapshot_keep_interval" :label="t('panel.cleanup.snapshotInterval')">
                    <input
                        id="mvu_snapshot_keep_interval"
                        v-model.number="store.settings.自动清理变量.快照保留间隔"
                        type="number"
                        min="1"
                        step="1"
                        class="text_pole"
                        placeholder="50"
                    />
                </Field>

                <Field id="mvu_keep_recent_floors" :label="t('panel.cleanup.recentFloors')">
                    <input
                        id="mvu_keep_recent_floors"
                        v-model.number="store.settings.自动清理变量.要保留变量的最近楼层数"
                        type="number"
                        min="1"
                        step="1"
                        class="text_pole"
                        placeholder="20"
                    />
                </Field>

                <Field id="mvu_restore_recent_floors" :label="t('panel.cleanup.restoreFloors')">
                    <input
                        id="mvu_restore_recent_floors"
                        v-model.number="store.settings.自动清理变量.触发恢复变量的最近楼层数"
                        type="number"
                        min="1"
                        step="1"
                        class="text_pole"
                        placeholder="10"
                    />
                </Field>
            </Detail>
        </template>
    </Section>
</template>

<script setup lang="ts">
import Checkbox from '@/panel/component/Checkbox.vue';
import Detail from '@/panel/component/Detail.vue';
import Field from '@/panel/component/Field.vue';
import Section from '@/panel/component/Section.vue';
import { useMvuI18n } from '@/i18n';
import { useDataStore } from '@/store';

const store = useDataStore();
const { t } = useMvuI18n();
</script>

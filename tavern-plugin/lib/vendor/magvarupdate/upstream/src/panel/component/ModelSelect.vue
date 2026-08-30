<template>
    <div class="mvu-model-select">
        <div class="mvu-model-select__row">
            <input
                v-model="store.settings.额外模型解析配置.模型名称"
                type="text"
                class="text_pole"
                autocomplete="off"
            />
        </div>

        <div class="mvu-model-select__row mvu-model-select__row--controls">
            <select
                ref="select"
                v-model="selected"
                class="text_pole"
                :disabled="models.length === 0"
                :aria-label="t('panel.modelSelect.ariaLabel')"
            >
                <option value="">{{ t('panel.modelSelect.chooseFromList') }}</option>
                <option v-for="model in models" :key="model" :value="model">{{ model }}</option>
            </select>

            <input
                class="mvu-model-select__btn menu_button menu_button_icon interactable"
                type="button"
                :value="loading ? t('panel.modelSelect.loading') : t('panel.modelSelect.fetch')"
                :disabled="loading"
                @click="refresh"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';
import { useDataStore } from '@/store';
import { normalizeBaseURL } from '@/util';
import { ref, watch } from 'vue';

const store = useDataStore();
const { t } = useMvuI18n();

const loading = ref(false);
const models = ref<string[]>([]);
const selected = ref('');

async function refresh() {
    if (loading.value) {
        return;
    }

    const base_url = normalizeBaseURL(store.settings.额外模型解析配置.api地址);
    if (!base_url) {
        return;
    }

    loading.value = true;
    try {
        const response = await fetch('/api/backends/chat-completions/status', {
            method: 'POST',
            headers: SillyTavern.getRequestHeaders(),
            body: JSON.stringify({
                reverse_proxy: base_url,
                proxy_password: store.settings.额外模型解析配置.密钥,
                chat_completion_source: 'openai',
            }),
            cache: 'no-cache',
        });

        const json = await response.json();

        models.value = _(json?.data ?? [])
            .map((model: any) => String(model?.id ?? model?.name ?? '').trim())
            .filter(Boolean)
            .sort()
            .sortedUniq()
            .value();
        selected.value = models.value.includes(store.settings.额外模型解析配置.模型名称)
            ? store.settings.额外模型解析配置.模型名称
            : '';

        if (models.value.length === 0) {
            toastr.warning(t('panel.modelSelect.empty'), t('panel.modelSelect.fetchTitle'));
        }
    } catch (error) {
        toastr.error(
            t('runtime.common.errorCause', {
                cause: _.escape(error instanceof Error ? error.message : String(error)),
            }),
            t('panel.modelSelect.fetchFailureTitle')
        );
    } finally {
        loading.value = false;
    }
}

watch(
    selected,
    value => {
        if (!value) return;
        store.settings.额外模型解析配置.模型名称 = value;
    },
    { flush: 'sync' }
);

watch(
    () => store.settings.额外模型解析配置.模型名称,
    value => {
        if (!value) {
            selected.value = '';
            return;
        }
        selected.value = models.value.includes(value) ? value : '';
    },
    { flush: 'sync' }
);

watch(
    () => [store.settings.额外模型解析配置.api地址, store.settings.额外模型解析配置.密钥] as const,
    () => {
        models.value = [];
        selected.value = '';
    }
);
</script>

<style scoped>
.mvu-model-select {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.mvu-model-select__row {
    width: 100%;
}

.mvu-model-select__row--controls {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: center;
}

.mvu-model-select__btn {
    white-space: nowrap;
    text-align: left;
    padding: 0.35rem 0.6rem;
    min-height: unset;
    height: 2.05rem;
    line-height: 1.1;
}

@media (max-width: 520px) {
    .mvu-model-select__row--controls {
        grid-template-columns: 1fr;
    }
}
</style>

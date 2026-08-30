<template>
    <span class="mvu-override-badge" :class="`mvu-override-badge--${kind}`">
        {{
            kind === 'override'
                ? value === undefined
                    ? t('panel.badge.override')
                    : t('panel.badge.overrideWithValue', { value })
                : t('panel.badge.additive')
        }}
    </span>
</template>

<script setup lang="ts">
import { useMvuI18n } from '@/i18n';

withDefaults(defineProps<{ kind?: 'override' | 'additive'; value?: string }>(), {
    kind: 'override',
    value: undefined,
});
const { t } = useMvuI18n();
</script>

<style scoped>
.mvu-override-badge {
    display: inline-flex;
    flex: 0 1 auto;
    align-items: center;
    max-width: 100%;
    padding: 0.08rem 0.38rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: calc(var(--mainFontSize, 1rem) * 0.76);
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
}

.mvu-override-badge--override {
    color: var(--SmartThemeEmColor, #d39e00);
    background-color: color-mix(in srgb, var(--SmartThemeEmColor, #d39e00) 12%, transparent);
}

.mvu-override-badge--additive {
    color: var(--SmartThemeQuoteColor, #6ba7ff);
    background-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #6ba7ff) 12%, transparent);
}
</style>

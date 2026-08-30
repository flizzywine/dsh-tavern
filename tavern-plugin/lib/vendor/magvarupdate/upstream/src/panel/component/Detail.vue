<template>
    <details class="mvu-details">
        <summary class="mvu-details__summary">
            <span>{{ title }}</span>
            <span
                v-if="$slots['title-suffix']"
                class="mvu-details__title-suffix"
                @click.stop
                @keydown.stop
            >
                <slot name="title-suffix" />
            </span>
        </summary>
        <div class="mvu-details__content">
            <slot />
        </div>
    </details>
</template>

<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<style scoped>
.mvu-details {
    border: 1px dashed var(--SmartThemeBorderColor, rgba(45, 45, 45, 1));
    border-radius: 10px;
    padding: 0.5rem 0.7rem;
    background-color: rgba(0, 0, 0, 0.06);
    background-color: color-mix(
        in srgb,
        var(--SmartThemeBlurTintColor, rgba(31, 31, 31, 1)) 70%,
        transparent
    );
}

.mvu-details__summary {
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    opacity: 0.95;
}

.mvu-details__title-suffix {
    display: inline-flex;
    align-items: center;
    margin-inline-start: 0.35rem;
    vertical-align: middle;
}

.mvu-details__content {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}
</style>

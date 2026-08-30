<template>
    <div class="mvu-section flex-container flexFlowColumn">
        <div class="mvu-section__title">
            <strong>
                <span>{{ label }}</span>
            </strong>
            <slot name="label-suffix" />
        </div>
        <div class="mvu-section__content flex-container flexFlowColumn">
            <slot name="content" />
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<style scoped>
.mvu-section {
    border: 1px solid var(--SmartThemeBorderColor, rgba(45, 45, 45, 1));
    border-radius: 10px;
    padding: 0.6rem 0.75rem;
    gap: 0.45rem;
    background-color: rgba(0, 0, 0, 0.08);
    background-color: color-mix(
        in srgb,
        var(--SmartThemeBlurTintColor, rgba(31, 31, 31, 1)) 75%,
        transparent
    );
}

.mvu-section__content {
    gap: 0.5rem;
}

.mvu-section__title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
}
</style>

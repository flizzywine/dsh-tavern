<template>
    <div class="mvu-field flex-container flexFlowColumn">
        <label class="mvu-field__label">
            <span>{{ label }}</span>
            <slot name="label-suffix" />
        </label>
        <slot />
    </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<style scoped>
.mvu-field {
    padding: 0.45rem 0.6rem;
    gap: 0.25rem;
    border: 1px solid color-mix(in srgb, var(--SmartThemeBorderColor, rgba(45, 45, 45, 1)) 35%, transparent);
    border-radius: 10px;
    background-color: color-mix(
        in srgb,
        var(--SmartThemeBlurTintColor, rgba(31, 31, 31, 1)) 55%,
        transparent
    );
}

.mvu-field__label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 600;
    opacity: 0.95;
}
</style>

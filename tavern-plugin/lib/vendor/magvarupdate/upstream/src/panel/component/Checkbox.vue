<template>
    <label class="checkbox_label" :for="id">
        <input :id="id" v-model="model" type="checkbox" />
        <slot />
    </label>
</template>

<script setup lang="ts">
defineProps<{
    id?: string;
}>();

const model = defineModel<boolean>({ required: true });
</script>

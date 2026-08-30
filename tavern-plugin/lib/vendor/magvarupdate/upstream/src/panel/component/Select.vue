<template>
    <select v-model="model" class="text_pole">
        <template v-for="option in options" :key="getOptionValue(option)">
            <option :value="getOptionValue(option)">{{ getOptionLabel(option) }}</option>
        </template>
    </select>
</template>

<script setup lang="ts">
const model = defineModel<string>({ required: true });

type SelectOption = string | { value: string; label: string };

defineProps<{ options: readonly SelectOption[] }>();

function getOptionValue(option: SelectOption): string {
    return typeof option === 'string' ? option : option.value;
}

function getOptionLabel(option: SelectOption): string {
    return typeof option === 'string' ? option : option.label;
}
</script>

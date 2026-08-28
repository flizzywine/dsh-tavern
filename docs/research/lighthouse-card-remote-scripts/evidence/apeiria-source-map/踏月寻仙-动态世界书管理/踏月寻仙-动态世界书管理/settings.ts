const EntryListSchema = z
    .array(z.coerce.string())
    .transform(values => Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean))))
    .prefault([]);
export const DynamicWorldbookSettingsSchema = z
    .object({
    enabled: z.boolean().prefault(true),
    auto_apply: z.boolean().prefault(true),
    debug: z.boolean().prefault(true),
    show_toasts: z.boolean().prefault(true),
    context_window: z.coerce.number().transform(value => _.clamp(Number(value) || 2, 1, 8)).prefault(2),
    debounce_delay: z.coerce.number().transform(value => _.clamp(Number(value) || 500, 100, 5000)).prefault(500),
    map_sticky_cycles: z.coerce.number().transform(value => _.clamp(Number(value) || 3, 0, 8)).prefault(3),
    character_sticky_cycles: z.coerce.number().transform(value => _.clamp(Number(value) || 2, 0, 8)).prefault(2),
    forced_enable_entries: EntryListSchema,
    forced_disable_entries: EntryListSchema,
})
    .prefault({});
const variableOption = { type: 'script', script_id: getScriptId() };
const listeners = new Set();
export function readSettings() {
    return DynamicWorldbookSettingsSchema.parse(getVariables(variableOption));
}
export function emitSettingsChanged(settings = readSettings()) {
    const snapshot = klona(settings);
    listeners.forEach(listener => listener(snapshot));
}
export function subscribeSettings(listener) {
    listeners.add(listener);
    listener(readSettings());
    return () => listeners.delete(listener);
}
export const useSettingsStore = defineStore('踏月寻仙-动态世界书管理-settings', () => {
    const settings = ref(readSettings());
    watch(settings, value => {
        const parsed = DynamicWorldbookSettingsSchema.parse(klona(value));
        if (!_.isEqual(parsed, value)) {
            settings.value = parsed;
            return;
        }
        insertOrAssignVariables(klona(parsed), variableOption);
        emitSettingsChanged(parsed);
    }, { deep: true, immediate: true });
    const reloadSettings = () => {
        settings.value = readSettings();
    };
    const resetSettings = () => {
        settings.value = DynamicWorldbookSettingsSchema.parse({});
    };
    return {
        settings,
        reloadSettings,
        resetSettings,
    };
});

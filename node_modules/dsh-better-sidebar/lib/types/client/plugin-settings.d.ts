import type { SidebarStore } from './state.ts';
/**
 * Merge one plugin-owned settings blob of one descriptor and persist it.
 * @param store - the sidebar store (its prefs are replaced by the write result).
 * @param descriptorId - the descriptor whose blob is patched ('editor' here).
 * @param updater - pure patch function; receives a shallow copy of the blob.
 */
export declare function updatePluginSettings(store: SidebarStore, descriptorId: string, updater: (blob: Record<string, unknown>) => Record<string, unknown>): void;

export const PACK_SETTINGS_SECTION: 'asset-library-packs';
export interface PackSettingsSnapshot { values: {globalEnabledPackIds: string[]}; revision: string; writable: boolean }
/** Explicit native DSH SettingsProvider installation; composition remains a P6 concern. */
export function createAssetPackSettings(ctx: {get(name: string): any; inject(names: string[], callback: (ctx: any) => any): any; effect(callback: () => (() => void)): any}): {
  read(): PackSettingsSnapshot;
  save(input: {expectedRevision: string; globalEnabledPackIds: string[]}): Promise<PackSettingsSnapshot>;
  subscribe(listener: (snapshot: PackSettingsSnapshot) => void): () => void;
};

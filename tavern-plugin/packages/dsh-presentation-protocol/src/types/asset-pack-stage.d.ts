import type { AssetPackState, AssetRef, SceneSelection, TimeOfDay } from './asset-packs.js';
export interface RecalledLook { ref: AssetRef<'looks'>; layer: 'time' | 'mood'; timeOfDay?: TimeOfDay }
export interface StageDiagnostic { code: string; timeOfDay?: TimeOfDay; candidates?: AssetRef[] }
export function assetPackLookLayer(look: unknown): 'time' | 'mood' | null;
export function assetPackTimeLighting(scene: AssetPackState['scene'], looks: RecalledLook[]): { time: AssetPackState['lighting']['time']; diagnostics: StageDiagnostic[] };
export function reduceAssetPackScene<T extends AssetPackState>(state: T, selection: SceneSelection | null, looks: RecalledLook[], options?: { snap?: boolean }): { state: T; diagnostics: StageDiagnostic[]; locationChanged: boolean; transitionMs: number };
export function applyAssetPackLight<T extends AssetPackState>(state: T, value: { mode: 'auto' } | { mode: 'mood'; ref: AssetRef<'looks'> | null }, looks: RecalledLook[]): { state: T; diagnostics: StageDiagnostic[] };
export function assetPackBackgroundVariant(background: { media: string | null; baseTime?: TimeOfDay; variants?: Partial<Record<TimeOfDay, string>> }, scene: AssetPackState['scene']): { media: string | null; timeMatched: boolean; diagnostics: StageDiagnostic[] };

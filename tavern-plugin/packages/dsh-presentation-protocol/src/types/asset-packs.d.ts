export type UUID = string;
export type Sha256 = string;
export type AssetKind = 'backgrounds' | 'music' | 'sfx' | 'ambience' | 'looks' | 'widgets' | 'skins' | 'performances' | 'cg' | 'props' | 'directions' | 'audience' | 'timers' | 'entrances' | 'videos';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type AssetRef<K extends AssetKind = AssetKind> = { packId: UUID; kind: K; assetId: string };
export interface TimerContent { look?: 'default' | 'plate'; seconds?: number; mode?: 'story' | 'reply'; label?: string; onTimeout?: string; onTimeup?: AssetRef<'performances'>; pauseOnChoices?: boolean }
export interface FigureRef { packId: UUID; figureId: UUID }
export interface OutfitRef extends FigureRef { outfitKey: string }
export interface SceneSelection { background: AssetRef<'backgrounds'>; timeOfDay: TimeOfDay | null; variant?: string }
export interface AssetPackState {
  format: 'asset-packs-v1';
  scene: { background: AssetRef<'backgrounds'>; timeOfDay: TimeOfDay | null; timeLook: null; variant?: string } | null;
  music: AssetRef<'music'> | null;
  skin?: { ref: AssetRef<'skins'> | null; level?: 1 | 2 | 3 };
  lighting: { time: { mode: 'auto'; ref: null }; mood: AssetRef<'looks'> | null };
  actors: Record<string, { figure: FigureRef | null; outfitKey: string | null }>;
  soundscape: Record<string, AssetRef<'ambience'>>;
  widgets: Record<string, { ref: AssetRef<'widgets'>; state: Record<string, unknown> }>;
}
export interface AssetPackError extends TypeError { code: string; path: string }
export const ASSET_PACK_ERROR_CODES: readonly string[];
export const ASSET_PACK_FORMAT: 'asset-packs-v1';
export const ASSET_KINDS: readonly AssetKind[];
export const TIMES_OF_DAY: readonly TimeOfDay[];
export const UUID_PATTERN: string, SHORT_ID_PATTERN: string, HASH_PATTERN: string;
export const ASSET_REF_SCHEMA: Readonly<Record<string, unknown>>, FIGURE_REF_SCHEMA: Readonly<Record<string, unknown>>, OUTFIT_REF_SCHEMA: Readonly<Record<string, unknown>>, TIME_OF_DAY_SCHEMA: Readonly<Record<string, unknown>>;
export function validateUuid(value: unknown, path?: string): UUID;
export function validateShortId(value: unknown, path?: string): string;
export function validateStateId(value: unknown, path?: string): string;
export function validateHash(value: unknown, path?: string): Sha256;
export function validateTimeOfDay(value: unknown, path?: string): TimeOfDay;
export function validateAssetRef<K extends AssetKind = AssetKind>(value: unknown, path?: string, kind?: K): AssetRef<K>;
export function validateFigureRef(value: unknown, path?: string): FigureRef;
export function validateOutfitRef(value: unknown, path?: string): OutfitRef;
export function validateSceneSelection(value: unknown, path?: string): SceneSelection;
export function validateAssetPackState(value: unknown, path?: string): AssetPackState;
export function assetRefKey(value: AssetRef): string;

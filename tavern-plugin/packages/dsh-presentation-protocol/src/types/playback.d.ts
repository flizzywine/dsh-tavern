import type { JsonObject, TargetRef, UnitRef } from './index.js';
import type { FigureCatalog, FigureScaleV6 } from './figure.js';
export interface ManagedAssetRef { source: string; libraryId?: string; id: string; revision?: string }
export interface SoundscapeSnapshot {
  name: string; source: string; libraryId: string; id: string;
  soundscape: { place: string; exposure: 'open' | 'indoor' | 'sheltered' | 'sealed'; people?: boolean; warnings: string[] };
}
export type Weather = 'none' | 'rain' | 'storm' | 'snow' | 'sakura' | 'leaves' | 'sparkle';
export interface LogicalWidget {
  widgetId: string; type: string; props: JsonObject; slot: 'top-center' | 'corner-left' | 'corner-right' | 'center-card'; slotExplicit?: boolean;
  lifetime: { until: 'explicit' | 'scene-change' | 'turn-end'; durationSeconds?: number };
  bornStoryTime: number; deadline: number | null; originKey: string; instanceId: string; bornAt: number; order: number;
}
export interface PlaybackState {
  scene: string; sceneCleared: boolean; cast: string[]; order: string[];
  outfits: Record<string, string>; positions: Record<string, string>; focus: Record<string, string>;
  look: Record<string, string>; figureLight: Record<string, string>;
  music: string; weather: Weather; light: string; lighting: { time: string; mood: string };
  soundscape: { scene: string; sceneKey?: string; weather: Weather; tags: ('empty' | 'open' | 'sheltered' | 'sealed')[] };
  camera: { value: string; id?: string }; dof: string;
  widgetState: { version: 1; time: number; scene: string; widgets: LogicalWidget[] };
  phone: { messages: { unit: UnitRef; contact: string; side: 'in' | 'out' }[] };
  figureScale?: FigureScaleV6; assetRefs?: Record<string, ManagedAssetRef | null>;
}
export interface PlaybackEvent { op: 'act' | 'emote' | 'beat' | 'sfx' | 'title' | 'trans' | 'focus'; id?: string; value: string }
export type RecordOrigin = 'canonical-effect' | 'offline-import';
export interface PlaybackRecordV3 {
  version: 3; target: TargetRef; publicationDigest: string; unitizerRevision: string;
  canonicalEffectDigest: string | null; provenance: { kind: RecordOrigin; sourceDigest: string };
  units: number; start: PlaybackState; changes: { at: number; state: PlaybackState }[];
  events: { id: string; at: number; event: PlaybackEvent }[];
  figureCatalog: FigureCatalog; soundscapeScenes: SoundscapeSnapshot[]; rulesHash: string;
  metadata: { warnings?: string[]; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; origin?: RecordOrigin };
}
export interface PlaybackPointerV3 { recordKey: string; target: TargetRef; publicationDigest: string; recordDigest: string; origin: RecordOrigin }
export interface PlaybackIndexV3 { version: 3; records: PlaybackPointerV3[] }
export function validateTargetRef(value: unknown): TargetRef;
export function validatePlaybackState(value: unknown): PlaybackState;
export function validatePlaybackRecord(value: unknown): PlaybackRecordV3;
export function compactPlaybackRecord(value: unknown): PlaybackRecordV3;
export function playbackDigest(value: unknown): Promise<string>;
export function encodePlaybackRecord(value: unknown): Promise<{ json: string; recordDigest: string }>;
export function decodePlaybackRecord(source: string, expected: Pick<PlaybackPointerV3, 'target' | 'publicationDigest' | 'recordDigest'>): Promise<PlaybackRecordV3>;
export function seekPlayback(value: PlaybackRecordV3, paragraph: number): PlaybackState;
export function playbackEventsBetween(value: PlaybackRecordV3, from: number, through: number): PlaybackRecordV3['events'];
export function playbackEventId(publicationDigest: string, at: number, ordinal: number): string;
export function validatePlaybackIndex(value: unknown): PlaybackIndexV3;
export function encodePlaybackIndex(value: unknown): string;
export function decodePlaybackIndex(source: string): PlaybackIndexV3;
export function projectIncrementalStageState(state: JsonObject, catalog: JsonObject, metadata?: JsonObject): JsonObject;
export function stageLookLayer(look: string | JsonObject): 'time' | 'mood';
export function stageLighting(value: unknown, looks?: (string | JsonObject)[]): PlaybackState['lighting'];
export function stageApplyLight(state: PlaybackState['lighting'], value: unknown, looks?: (string | JsonObject)[]): PlaybackState['lighting'];
export function stageLightingReplay(start: JsonObject, entries: JsonObject[], looks?: (string | JsonObject)[]): { lighting: PlaybackState['lighting']; timeFadeMs: number };
export function stagePacing(start: JsonObject, entries: JsonObject[], looks?: JsonObject[], units?: number): JsonObject;

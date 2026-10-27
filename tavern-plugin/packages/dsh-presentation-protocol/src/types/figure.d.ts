import type { JsonObject } from './index.js';
export const FIGURE_ALGORITHM: 1;
export const FIGURE_DISPLAY: Readonly<{ version: 6; FILL: 1.24; HEAD_TOP: 0.13; REF_MIN_CM: 150; curve: 'log-gap'; gapCap: 0.035; gapSlope: 0.45; tailSlope: 0.65; transitionMs: 1200; headLimit: 0.97 }>;
export type HeightBasis = 'standing' | 'seated';
export interface FigureCharacter {
  heightCm?: number; heightBasis?: HeightBasis; heightNote?: string; placement?: { elevationCm: number };
}
export interface FigureMetrics {
  figureTop?: number; visibleBottom?: number; supportX?: number; feet?: number; headTop?: number; chin?: number;
  poseHeightRatio?: number; visibleFraction?: number; headsPerBody?: number; confidence?: number;
  posture?: HeightBasis | 'crouching' | 'other'; heightBasis?: HeightBasis; crop?: 'full' | 'thigh' | 'waist' | 'chest' | 'custom';
  cheeks?: { left: [number, number]; right: [number, number]; size: number };
  faceRect?: [number, number, number, number]; inkBounds?: [number, number, number, number]; bodyBounds?: [number, number, number, number];
  method?: string; restPosePolicy?: string; coreVersion?: string; algorithmVersion?: number;
  cropSuspected?: boolean; invalid?: boolean; estimated?: boolean; warnings?: string[];
}
export interface FigureMeasurement {
  sourceSha?: string; modelRevision?: string; canvas: [number, number]; status: 'pending' | 'confirmed' | 'stale';
  auto?: FigureMetrics; override?: FigureMetrics;
}
export type FigureExtensionV1 = ({ version: 1; slots: Record<string, FigureMeasurement>; defaults?: FigureMetrics }) | ({ version: 1 } & FigureMeasurement);
export type FigureCatalog = Record<string, Record<string, { heightCm: number; elevationCm: number; headRatio: number }[]>>;
export interface FigureScaleV6 { version: 6; scene: number; hMax: number; groundRatio?: number; rescales: number }
export interface FigureSnapshot extends FigureScaleV6 { event: { kind: 'cut' | 'rescale'; at: number; from?: number; warning?: string } | null }
export interface FigureEntry { at: number; scene?: string; cast?: string[]; outfits?: Record<string, string>; commands?: { op: string; id?: string }[] }
export interface FigureStart { figureScale?: FigureScaleV6; cast?: string[]; outfits?: Record<string, string> }
export interface FigureTransition { key: string; scene: number; rescales: number; from: number; to: number; groundFrom: number; groundTo: number; start: number; warning: string | null }
export interface FigureSizingInput extends FigureCharacter {
  version?: number; metrics?: FigureMeasurement; source?: string; sourceUrl?: string; canvas?: [number, number];
  W?: number; H?: number; assetScale?: number; focus?: number; flip?: number; elevationCm?: number;
  sceneHMax?: number; groundHMax?: number; sceneGroundRatio?: number; groundRatio?: number; stageX?: number; speaking?: boolean; occluderTop?: number;
  /** Viewport fit times the skin's framing (0.05..6) about the ruler's head line, a downward shift in px and where the head
   *  line stands (px, default HEAD_TOP x H); renderer-only. */
  fit?: number; fitDrop?: number; fitTop?: number;
  /** The skin's figures.spread (0.2..1): the share of the ruler curve's height gap shown; renderer-only. */
  spread?: number;
}
export type FigureSizing = { mode: 'legacy'; reason: string; warnings: string[] } | {
  mode: 'physical'; heightCm: number; hMax: number; hRef: number; displayCm: number; displayPx: number; effectivePxPerCm: number;
  displayVersion: 6; scale: number; baseScale: number; x: number; y: number; support: { x: number; y: number }; supportX: number;
  feet: number; restHead: { x: number; top: number; chin: number; width: number } | null; pxPerCm: number;
  groundY: number; sharedGroundY: number; ownGround: boolean; poseSpan: number; visibleSpan: number; warnings: string[];
};
export function figurePixelsPerCm(height: number, hMax: number): number;
export function figureGroundY(height: number, groundRatio?: number): number;
export function figureInput(character: FigureCharacter, model: JsonObject, mood: string): FigureSizingInput;
export function figureCatalog(characters: (FigureCharacter & { alias: string; offstage?: boolean; portrait?: string; outfits?: { label: string; model: string }[] })[], models: JsonObject[]): FigureCatalog;
export function figureDirection(start?: FigureStart, entries?: FigureEntry[], catalog?: FigureCatalog, para?: number): FigureSnapshot;
export function figureCarry(scale: FigureSnapshot | null | undefined): FigureScaleV6 | undefined;
export function figureSceneCut(entry: FigureEntry): boolean;
export function figureRatio(ratio: number): number;
export function figureDisplayCm(heightCm: number, hMax?: number, spread?: number): number;
export function figureSceneFrame(state: FigureTransition | null, now: number): { state: FigureTransition | null; hMax: number; groundRatio?: number };
export function figureSceneUpdate(state: FigureTransition | null, snapshot: FigureSnapshot, now: number, snap?: boolean): FigureTransition;
export function figureCharacter(raw: unknown): FigureCharacter;
export function figureMetrics(raw: unknown): FigureMetrics;
export function figureGeometry(metrics: FigureMetrics, basis?: HeightBasis): { reason: string } | { feet: number; fraction: number; ratio: number; span: number; bodySpan: number };
export function normalizeFigureExtension(raw: unknown, sources: unknown, model?: boolean, strict?: boolean): JsonObject | undefined;
export function figurePatch(current: JsonObject | undefined, patch: JsonObject | null): JsonObject | undefined;
export function resolveFigureSizing(input?: FigureSizingInput): FigureSizing;
export function figureMixedWarning(results: FigureSizing[]): string[];
export function figureSlot(model: { images?: Record<string, string> }, mood: string): string;
export function figureSource(url: unknown): string;
export function measureFigureAlpha(data: Uint8Array | Uint8ClampedArray, width: number, height: number, original?: [number, number]): FigureMetrics;

export interface PackAnatomy extends FigureMetrics {
  source: 'calibrated' | 'measured' | 'estimated'; headRatio: number; assetScale?: number;
  figureTop: number; headTop: number; chin: number; feet: number; visibleBottom: number; supportX: number;
  poseHeightRatio: number; posture: HeightBasis; crop: NonNullable<FigureMetrics['crop']>;
}
export function packAnatomy(metrics: FigureMetrics, canvas: [number, number], heightBasis?: HeightBasis, source?: PackAnatomy['source'], assetScale?: number): PackAnatomy;
export function packEstimatedAnatomy(metrics: FigureMetrics, canvas: [number, number], heightBasis?: HeightBasis): PackAnatomy | null;
export function packFigureRecord(input: FigureSizingInput & {anatomy?: PackAnatomy}, canvas: [number, number], candidate?: FigureMeasurement): FigureMeasurement | undefined;

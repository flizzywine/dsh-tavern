import type { JsonObject } from './index.js';
export type ConfigOwner = 'dialogue' | 'gal' | 'director' | 'widgets' | 'assets';
export interface StageBudget { maxToolCalls: number; maxBeatsPerCall: number; maxOpsPerCall: number }
export interface CharacterBinding {
  alias: string; name: string; note: string; color: string; voice: string;
  voiceLang: 'ja' | 'zh' | 'en'; avatar: string; moods: Record<string, string>; full: Record<string, string>;
  offstage: boolean; portrait: string; outfitLabel: string; outfits: { label: string; model: string }[];
  heightCm?: number; heightBasis?: string; heightNote?: string; placement?: { elevationCm: number };
}
export interface CurrentStageConfig {
  version: 1; enabled: boolean; characters: CharacterBinding[];
  emotions: { id: string; label: string; note?: string }[]; moods: JsonObject[];
  injection: { template: string; extra: string; placement?: { book?: string; position?: number; depth?: number; role?: number; order?: number } };
  voice: { enabled: boolean } | null;
  stage: {
    theme: 'classic' | 'gothic' | 'magical' | 'crt' | 'aero'; face: 'always' | 'offstage' | 'off';
    background: string; music: boolean; widgets: boolean; widgetTuning: JsonObject;
    director: boolean; directorModel: { provider: string; model: string } | null;
    directorPrompt: string; directorBudget: StageBudget;
    catalogue: { caps: { backgrounds: number; sfx: number; ambience: number }; musicLibraryThreshold: number };
    sources: Record<'backgrounds' | 'music' | 'sfx' | 'ambience' | 'looks' | 'widgets', { card: boolean; libraries: string[] }>;
  };
}
export const CONFIG_OWNER_PATHS: Readonly<Record<ConfigOwner, readonly string[]>>;
export function configFieldOwner(path: string): ConfigOwner | null;
export function validateCurrentStageConfig(value: unknown): CurrentStageConfig;
export function normalizeStageBudget(value?: Partial<StageBudget>): StageBudget;

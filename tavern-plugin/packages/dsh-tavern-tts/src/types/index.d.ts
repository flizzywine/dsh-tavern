import type { Context } from '@deepseek-ai/cordis'
// The 语音服务 contract (Tts, TtsClient, Provider, ...) is authored once in dsh-presentation-protocol; re-exported here.
// A third-party plugin's provider says what it supports there: `Provider.capabilities.voiceSources` (the 配音来源 it serves,
// refreshed in `discover()`) and `voiceList`; the voice services catalog lists it with exactly those (VoiceServiceEntry).
export * from '../../../dsh-presentation-protocol/src/types/tts'


// normalized at the dictionary entry boundary.
export interface Reading { forms: string[]; reading: string; language: string; inferredLanguage: 'ja' | 'zh' | 'en'; warnings: string[]; languageOverride?: string }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export const name: 'dsh-tavern-tts'
export function apply(ctx: Context, config?: {profileId?: string; dataDir?: string; settings?: object}): void

// global reading presets (control RPC readingPresets / readingPreset / editReading / mergeReadings / …).
// mergeReadings {id, expectedRevision, dryRun?} → {id, revision, groups, removed, count}: entries with the same reading and
// language become one entry with all their forms; dryRun only counts.
export interface ReadingPresetSummary { id: string; name: string; count: number; revision: number }
export interface ReadingPresets { active: string; presets: ReadingPresetSummary[] }
export interface ReadingPresetDocument { version: 1; kind: 'dsh-tts-readings'; name: string; entries: { forms: string[]; reading: string; languageOverride?: string }[] }

// Creator tools: authenticated control RPC methods behind the global creator.enabled switch (default false).
export interface CreatorSettings { enabled: boolean }
export interface VoiceDesignPlan {
  language: 'zh'; maxCostUsd: number
  characters: { id: string; instruction: string; reference_text: string; n: number }[]
}
export interface VoicePilotPlan {
  language: 'zh'; maxCostUsd?: number; model?: string
  rows: { id: string; text: string; reference?: { file: string; text: string; audioBase64: string }; references?: { file: string; text: string; audioBase64: string }[] }[]
}
export type CreatorConfirmation = { dryRun: true; confirm?: false } | { confirm: true; dryRun?: false }
export type CreatorRequest =
  | { method: 'creator.voiceDesign'; args: { action: 'design'; serviceId: string; plan: VoiceDesignPlan } & CreatorConfirmation }
  | { method: 'creator.voicePilot'; args: { action: 'pilot'; serviceId: string; plan: VoicePilotPlan } & CreatorConfirmation }
  | { method: 'setCreatorEnabled'; args: CreatorSettings }
export interface CreatorDryRun {
  dryRun: true; model: string; requests: number; estimatedCostUsd: number; cumulativeReservedUsd: number
}
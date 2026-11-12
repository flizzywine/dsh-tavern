import type { FigureRef, UUID } from '../../packages/dsh-presentation-protocol/src/types/asset-packs.js';
// a card owns only story identity and appearance; figures own character data.
export interface CardAssetBindings { boundPackIds: UUID[] }
// defaultSkin: the card's 「使用皮肤」, exported with it and written by CONFIG 本卡皮肤.
export interface CardStageSettings { defaultSkin?: 'classic' | 'crt' | 'aero' | {packId: UUID; kind: 'skins'; assetId: string}; dialogue?: boolean; voice?: boolean; stage?: boolean; music?: boolean; sfx?: boolean; ambience?: boolean; widgets?: boolean; dimensions?: Record<string, boolean> }
export interface CardVariableBindings { version: 1; entries: { target: { kind: 'widgets'; ref: { packId: UUID; kind: 'widgets'; assetId: string }; slot: string }; variable: { source: 'mvu' | 'helper-chat'; path: string } }[] }
export interface CardAssetExtension { variableBindings?: CardVariableBindings; stage?: CardStageSettings; schemaVersion: 1; assetBindings: CardAssetBindings; [key: string]: unknown }
export function validateCardAssetExtension(value: unknown, path?: string): CardAssetExtension;
export function cardAssetExtensionPointer(raw: object): string;
export function readCardAssetExtension(raw: object): CardAssetExtension | undefined;
export function cardAssetRawOperations(raw: object, patch: Partial<Pick<CardAssetExtension, 'assetBindings' | 'stage' | 'openings' | 'variableBindings'>>): { op: 'set'; path: string; value: unknown }[];

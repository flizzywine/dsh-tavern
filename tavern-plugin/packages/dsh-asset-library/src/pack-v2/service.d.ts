import type { PackManifest, VoiceSpec, Voice, Figure, SpriteManifest, BlobDescriptor, WidgetDocument } from '../asset-packs/index.js'
import type { CatalogueService, CatalogueSettingsProvider, Distribution, MergeSummary } from '../pack-catalogue/contract.js'
import type { AssetRef, FigureRef } from '../asset-packs/protocol.js'
export declare const PACK_LEASE_PATH: '/api/dsh-asset-library/v2/lease/'
type ReadonlyPackValue<T> = T extends object ? {readonly [K in keyof T]: ReadonlyPackValue<T[K]>} : T;
/** Shared immutable host view. Copy only the fields needed for authoring. */
export type PackSnapshot = ReadonlyPackValue<{ privateConfig?: true; manifest: PackManifest; figures: Record<string, Figure>; sprites: Record<string, SpriteManifest>; widgets: Record<string,WidgetDocument>; variantDocuments?: Record<string,Record<string,Record<string,unknown>>>; diagnostics?: Array<{ref: AssetRef<'widgets'>; name: string; code: 'WIDGET_UNAVAILABLE'; message: string}>; skins?: Record<string, Record<string, unknown>>; performances?: Record<string, Record<string, unknown>>; revision: string; installedAt: number; updatedAt: number; distribution?: Distribution }>;
export interface PackListError { packId: string; error: {code: string; message: string} }
export interface ScriptRisk { packId: string; packName: string; path: string; widgetId?: string; widgetName?: string; variables?: {reads: Array<{id: string; source: string; path: string; includesChildren: boolean}>; writes: Array<{id: string; source: string; path: string; ops: string[]; scope?: string; includesChildren: boolean}>} }
export interface PackChange { packId: string; revision: string | null; kinds: string[]; figures: string[] }
export interface WidgetDefaultExportWarning { code: 'external-widget-default'; ref: AssetRef; widgetName: string; settingLabel: string; packName: string | null; assetName: string | null }
export interface StageSetupStatus {path: string; cardId: string; cardRevision: string; libraryRevision: string; boundPackIds: string[]; hasBoundPacks: boolean; hasAssets: boolean; wizardPack: {packId: string; name: string; revision: string} | null; shouldAutoOpen: boolean}
export interface PackWrite { packId: string; expectedRevision: string; force?: boolean }
export interface VoiceTemplate {templateId:string; revision:string; name:string; voiceSpec:VoiceSpec; binding:Voice}
export interface PackRemoval { status: 'removed'; packId: string }
export interface PackMutation { status: 'installed' | 'updated' | 'noop'; snapshot: PackSnapshot; forcedOverrides?: Array<{entry:string;trigger:string;rule:string;message:string}> }
export interface FigureDelivery {
  version: 1;
  figures: Array<{id: string; copyFrom?: string | FigureRef; figure?: Figure; patch?: Partial<Pick<Figure, 'name' | 'aliases' | 'description' | 'enabled' | 'recall' | 'voice'>>}>;
  voices?: Record<string, VoiceSpec>;
  audio?: Array<{hash: string; descriptor: BlobDescriptor; bytes: Uint8Array}>;
}
export interface PackMapping { packId: string; figures: Record<string, string> }
export type ImportDecision = 'install' | 'update' | 'keep-both' | 'noop' | 'cancel'
export interface PackDiff { metadataChanged: boolean; assets: ChangeList; files: ChangeList; figures: ChangeList; affectedCards: {status: 'unknown'} }
export interface ChangeList { added: string[]; removed: string[]; changed: string[] }
export interface PackInspection {
  inspectionId: string; uploadHash: string; packId: string; contentHash: string; expectedRevision: string | null;
  choices: ImportDecision[]; expiresAt: number; diff: PackDiff; incoming: Omit<PackSnapshot, 'revision' | 'installedAt' | 'updatedAt'>; current: PackSnapshot | null; conflictFigures: string[]; mapping: PackMapping;
  scriptRisk: ScriptRisk[];
  distribution?: {sourceId?: string; catalogueUrl?: string; official?: boolean; version?: string; packId?: string; archiveSha256: string; integrity: 'sha256' | 'unverified'};
  merge?: MergeSummary;
}
/** a 素材包合集 ZIP — one ordinary inspection per pack (applied one by one); its own id discards them all. */
export interface PackSetInspection { kind: 'pack-set'; inspectionId: string; uploadHash: string; expiresAt: number; packs: Array<PackInspection & {done?: 'applied' | 'cancelled'}> }
export interface Lease { ticket: string; expiresAt: number; revision: string; url: string; resources: string[] }
export interface LeaseScope { packId: string; origin: string; scope: string }
export interface PackLimits { entries: number; entrySize: number; totalSize: number; spoolBytes: number; ratio: number; previews: number; previewTtlMs: number }
export interface CardBundleAdapter {
  snapshot(input: {path: string}): Promise<{path: string; cardId: string; revision: string | null; raw: unknown; cover?: Uint8Array}>;
  inspectRaw(raw: unknown): {raw: unknown; boundPackIds: string[]; modConfigPackId?: string; name?: string};
  unbindPack?(input: {packId: string}): Promise<void>;
  withBoundPack?(input: {path: string; expectedRevision: string; packId: string}, publish: (card: {record: unknown; commit(): Promise<void>; status(): Promise<'before' | 'after' | 'unknown'>}) => Promise<void>): Promise<void>;
  withConfigPack?(input: {path: string; expectedRevision: string; packId: string}, publish: (card: {record: unknown; commit(): Promise<void>; status(): Promise<'before' | 'after' | 'unknown'>}) => Promise<void>): Promise<void>;
  remapRaw(raw: unknown, mappings: Array<PackMapping & {from: string}>): unknown;
  /** the same raw with these packs appended to the card's bound packs (card export of global packs). */
  bindRaw(raw: unknown, packIds: string[]): unknown;
  withPrepared(input: {path: string; expectedRevision: string | null; raw: unknown; cover?: Uint8Array; packSnapshots?: Array<Omit<PackSnapshot, 'revision' | 'installedAt' | 'updatedAt'>>; disableWidgets?: boolean}, publish: (card: {record: unknown; commit(): Promise<void>; status(): Promise<'before' | 'after' | 'unknown'>}) => Promise<void>): Promise<void>;
  recover(record: unknown): Promise<'before' | 'after' | 'unknown'>;
}
export interface CardBundleInspection {
  inspectionId: string; path: string; expectedRevision: string | null; expiresAt: number; raw: unknown; currentRaw: unknown;
  dependencies: Array<{packId: string; contentHash: string | null; embedded: boolean}>;
  packs: Array<Pick<PackInspection, 'packId' | 'expectedRevision' | 'choices' | 'incoming' | 'diff' | 'mapping' | 'scriptRisk'> & {current: {manifest: PackManifest; figures: Record<string, Figure>} | null; affectedCards: {available: false; count: null}}>;
}
export type PackArchive = {file: string; size: number; expiresAt: number; dispose(): Promise<void>} & {filename: string};
export interface PackServiceOptions {
  /** Explicit absolute profile-owned root; never inferred from legacyDataRoot. One process owns this directory. */
  assetRoot: string;
  /** Private historical ops ledger; copy acknowledgements are committed in native local metadata. */
  mouthDebtRoot?: string;
  /** Shared profile media owner; standalone services default to assetRoot/blobs. */
  mediaStore?: import('./media-store.js').MediaStore;
  limits?: Partial<PackLimits>;
  /** Host-only export sink takes ownership of the completed temporary ZIP. */
  exportArchive?: (file: string) => Promise<{file: string; size: number; expiresAt: number; dispose(): Promise<void>}>;
  /** Host-only collection split budget; defaults to 512 MiB. Whole oversized packs remain indivisible. */
  collectionBytes?: number;
  catalogueSettings?: CatalogueSettingsProvider;
  /** Host-only injection for offline network fixtures. Never accepted by control RPC. */
  catalogueNetwork?: (url: string, options: {signal?: AbortSignal; headers?: Record<string,string>}) => Promise<{status: number; headers: Record<string,string | undefined>; body: AsyncIterable<Uint8Array> & {destroy(): void}; url: string}>;
  maxArchiveBytes?: number;
  externalSpoolUsage?: () => number;
  /** Required for card bundles and recovery of an unfinished card transaction. Never reacquire the pack gate from this adapter. */
  cardTransactions?: CardBundleAdapter;
  modValidators?: Iterable<[string, (config: {version: 1; values: Record<string, unknown>}) => void]>;
  /** the globally enabled pack ids (native pack settings); card export may embed them. Default: none. */
  globalEnabledPackIds?: () => string[];
  now?: () => number;
  leaseTtlMs?: number;
  maxLeases?: number;
  /** Required for compressed codecs other than the built-in noninterlaced PNG / PCM WAV validators. The installed plugin uses bounded structural header validation, not full decoding. */
  decodeMedia?: (bytes: Uint8Array, descriptor: BlobDescriptor) => Promise<{width?: number; height?: number; durationMs?: number}>;
  /** Fail-closed: true only for a currently authenticated principal permitted to access the pack. Called on issuance and reads. */
  authorizeLease?: (input: {packId: string; revision: string; kind: 'media' | 'bundle' | 'widget'; scope: string; request?: Request}) => Promise<boolean>;
}
export interface PackSummary {
  packId: string; name: string; description?: string; revision: string; installedAt: number; updatedAt: number;
  distribution?: unknown; diagnostics?: unknown[];
  /** Sum of the pack's file sizes. */ bytes: number;
  /** Entries per asset kind, plus `figures`. */ counts: Record<string, number>;
  voices: number;
  /** Up to 8 picture refs (backgrounds / cg / items, enabled first). */ pictures: Array<{kind: string; id: string; hash: string}>;
}
export interface AssetPackService extends CatalogueService {
  readonly apiVersion: 2;
  readonly capabilities: readonly string[];
  /** Host-only config namespace; not exposed by the asset editor control RPC. */
  registerModPrivate(input: {modId: string; validate: (config: {version: 1; values: Record<string, unknown>}) => void}): () => void;
  readModPrivate(input: {packId: string; modId: string; path?: string}): Promise<{revision: string; config?: {version: 1; values: Record<string, unknown>} | null; bytes?: Uint8Array | null}>;
  writeModPrivate(input: PackWrite & {modId: string; config?: {version: 1; values: Record<string, unknown>} | null; file?: {path: string}; bytes?: Uint8Array}): Promise<PackMutation>;
  writeCardModPrivate(input: {path: string; packId: string | null; modId: string; expectedCardRevision: string; expectedRevision: string | null; copyOnWrite?: boolean; config?: {version: 1; values: Record<string, unknown>} | null; file?: {path: string}; bytes?: Uint8Array}): Promise<{packId: string; revision: string}>;
  listPacks(): Promise<Array<PackSnapshot | PackListError>>;
  /** what list views read; the browser control RPC offers only this list (full documents per pack). */
  listPackSummaries(): Promise<Array<PackSummary | PackListError>>;
  /** Host-only transport guard; does not clone or hydrate author documents. */
  isPrivatePack(input: {packId: string}): Promise<boolean>;
  /** Concurrent readers share frozen metadata; no per-caller deep copy. */
  getPackSnapshot(input: {packId: string}): Promise<PackSnapshot | null>;
  /** Host-only; validated pack media, no arbitrary paths or remote URLs. */
  readMedia(input: PackWrite & {hash: string}): Promise<{bytes: Uint8Array; descriptor: BlobDescriptor}>;
  createPack(input: {name: string; description?: string; expectedRevision: null}): Promise<PackMutation>;
  /** Explicit offline conversion, not exposed by the authenticated browser RPC. */
  migrateCgFigures(input: PackWrite): Promise<PackMutation>;
  migrateFigureVariants(input: PackWrite & {dryRun?:false}): Promise<PackMutation>;
  migrateFigureVariants(input: PackWrite & {dryRun:true}): Promise<{status:"dry-run";changed:boolean;snapshot:PackSnapshot}>;
  migrateFigureNames(input: PackWrite): Promise<PackMutation>;
  /** one-time removal of recall.priority (entries, figures, outfits, publisher baseline); offline only. */
  migrateRecallPriority(input: PackWrite): Promise<PackMutation>;
  patchPack(input: PackWrite & {dryRun:true; patch?: Partial<Omit<PackManifest, 'id' | 'format' | 'schemaVersion' | 'contentHash' | 'files'>>; fileUpdates?: Map<string, Uint8Array | null>; imageResolutions?: Array<{figureId:string; outfitKey:string; imageId:string; expectedMedia:string; removeImageId?:string}>}): Promise<{status:'dry-run'|'noop'; snapshot:PackSnapshot}>;
  patchPack(input: PackWrite & {dryRun?:false; patch?: Partial<Omit<PackManifest, 'id' | 'format' | 'schemaVersion' | 'contentHash' | 'files'>>; fileUpdates?: Map<string, Uint8Array | null>; imageResolutions?: Array<{figureId:string; outfitKey:string; imageId:string; expectedMedia:string; removeImageId?:string}>}): Promise<PackMutation | PackRemoval>;
  savePackVoice(input: PackWrite & {voiceId:string; voiceSpec:VoiceSpec; figureId?:string; confirmShared?:boolean}): Promise<PackMutation>;
  saveFigureVoiceBinding(input: PackWrite & {figureId:string; binding:Voice|null}): Promise<PackMutation>;
  createAndAssignPackVoice(input: PackWrite & {figureId:string; voiceSpec:VoiceSpec}): Promise<PackMutation & {voiceId:string}>;
  savePackVoiceVariant(input: PackWrite & {voiceId:string; variantId:string; variant:NonNullable<VoiceSpec['variants']>[string]; figureId?:string; confirmShared?:boolean}): Promise<PackMutation & {affectedFigures:Array<{id:string;name:string}>}>;
  deletePackVoiceVariant(input: PackWrite & {voiceId:string; variantId:string; figureId?:string; confirmShared?:boolean}): Promise<PackMutation & {affectedFigures:Array<{id:string;name:string}>}>;
  listVoiceTemplates(): Promise<{templates:VoiceTemplate[]}>;
  saveVoiceTemplate(input: {templateId?:string; expectedRevision:string|null; packId:string; packRevision:string; voiceId:string; binding?:Voice}): Promise<VoiceTemplate>;
  deleteVoiceTemplate(input: {templateId:string; expectedRevision:string}): Promise<{deleted:true}>;
  assignVoiceTemplate(input: PackWrite & {templateId:string; templateRevision:string; figureId:string}): Promise<PackMutation & {voiceId:string}>;
  removePack(input: PackWrite): Promise<{status: 'removed'; packId: string}>;
  putBlob(input: PackWrite & {bytes: Uint8Array; descriptor: BlobDescriptor}): Promise<PackMutation & {hash: string; descriptor: BlobDescriptor}>;
  copyFigure(input: {source: FigureRef; target: PackWrite}): Promise<PackMutation & {figureId: string}>;
  reconcileCopiedMouthDebt(input: PackWrite & {figureId: string; source: FigureRef; sourceRevision: string; dryRun?: boolean}): Promise<PackMutation & {carriedGaps: number}>;
  /** Items of any kind (figures: kind 'figures', id = figure UUID) plus their same-pack closure, copied in one publication. Refs into the source pack are rewritten to the copies; ids are fresh only on collision. Internal copies inherit item availability and do not need import consent. */
  getStageSetupStatus(input: {path: string; autoOpened?: boolean}): Promise<StageSetupStatus>;
  mergeStageSetupPack(input: {path: string; expectedCardRevision: string; expectedLibraryRevision: string; selections: Array<{packId: string; itemRefs: Array<{kind: string; id: string}>}>; name?: string; figure?: Omit<Figure, 'id'>}): Promise<StageSetupStatus & {figureId?: string; copied: Array<{sourcePackId: string; kind: string; fromId: string; toId: string}>}>;
  copyItems(input: {sourcePackId: string; itemRefs: Array<{kind: string; id: string}>; target: PackWrite | {newPackName: string}}): Promise<{packId: string; revision: string; copied: Array<{kind: string; fromId: string; toId: string}>}>;
  /** Manual avatar crop for a static outfit, in the pack the figure lives in (outfit scope clears per-state manual crops; null resets). */
  setFigureAvatarCrop(input: PackWrite & {figureId: string; outfitKey: string; scope: 'outfit' | 'state'; stateId?: string; crop: {x: number; y: number; w: number; h: number} | null}): Promise<PackMutation>;
  createSimpleSprite(input: PackWrite & {spriteKey: string; name?: string; images: Record<string, {hash: string; width: number; height: number}>}): Promise<PackMutation & {sprite: {manifestKey: string; assets: Record<string, string>}}>;
  removeBlob(input: PackWrite & {hash: string}): Promise<PackMutation>;
  putBundle(input: PackWrite & {bundleKey: string; descriptor: {kind: 'live2d' | 'spine' | 'widget' | 'skin' | 'performance' | 'entrance' | 'video'; entry: string}; files: Map<string, Uint8Array>}): Promise<PackMutation>;
  removeBundle(input: PackWrite & {bundleKey: string}): Promise<PackMutation>;
  deliverFigures(input: PackWrite & {delivery: FigureDelivery; dryRun?: boolean}): Promise<{status: 'updated' | 'noop' | 'dry-run'; snapshot: PackSnapshot}>;
  createFigure(input: PackWrite & {figure: Omit<Figure, 'id'>}): Promise<PackMutation & {figureId: string}>;
  /** host-only figure + card publication through the existing journal; not a browser pack control method. */
  createFigureWithCard(input: {target: PackWrite | {packId: string; expectedRevision: null; newPackName: string}; figure: Figure; card: {path: string; expectedRevision: string; raw: unknown}}, authorize?: () => Promise<void>): Promise<{status: 'committed'; snapshot: PackSnapshot; figureId: string}>;
  patchFigure(input: PackWrite & {figureId: string; patch: {[K in keyof Omit<Figure, 'id'>]?: Figure[K] | (undefined extends Figure[K] ? null : never)}}): Promise<PackMutation>;
  removeFigure(input: PackWrite & {figureId: string}): Promise<PackMutation | PackRemoval>;
  migrateCharacterEmotions(input: PackWrite): Promise<PackMutation>;
  setFigureEmotionFallback(input: PackWrite & {figureId:string; outfitKey:string; emotionId:string; enabled:boolean; use?:string|null}): Promise<PackMutation>;
  removeFigureEmotion(input: PackWrite & {figureId: string; emotionId: string}): Promise<PackMutation>;
  resolveAssets(input: {refs: AssetRef[]}): Promise<Array<{ref: AssetRef; value: PackManifest['assets'][number] | null; revision: string | null; contentHash: string | null; diagnostics: string[]}>>;
  /** Resolved clone references expand textFile to verified UTF-8 text (64 KiB / 16384 code points maximum), from the returned revision. Authored documents are unchanged. */
  resolveFigures(input: {refs: FigureRef[]}): Promise<Array<{ref: FigureRef; value: Figure | null; voiceSpec: VoiceSpec | null; revision: string | null; contentHash: string | null; diagnostics: string[]}>>;
  /** Host-only disk input; never exposed by browser transport. */
  inspectImportFile(input: {file: string; copy?: boolean}): Promise<PackInspection | PackSetInspection>;
  inspectCardBundleFile(input: {file: string; path: string}): Promise<CardBundleInspection>;
  inspectImport(input: {bytes: Uint8Array; copy?: boolean}): Promise<PackInspection | PackSetInspection>;
  applyImport(input: {inspectionId: string; expectedRevision: string | null; decision: ImportDecision; acceptScriptRisk?: boolean}): Promise<(PackMutation & {mapping?: PackMapping}) | PackRemoval | {status: 'cancelled'}>;
  exportPack(input: PackWrite): Promise<PackArchive & {contentHash: string; revision: string; warnings: WidgetDefaultExportWarning[]}>;
  exportPacks(input: {packs: PackWrite[]}): Promise<(PackArchive | {archives: PackArchive[]}) & {packs: Array<{packId: string; contentHash: string; revision: string}>; warnings: WidgetDefaultExportWarning[]}>;
  exportCardBundle(input: {path: string; expectedRevision: string; packIds: string[]}): Promise<PackArchive & {dependencies: CardBundleInspection['dependencies']}>;
  inspectCardBundleUrl(input: {path: string; url: string}): Promise<CardBundleInspection>;
  inspectCardBundle(input: {path: string; bytes: Uint8Array}): Promise<CardBundleInspection>;
  previewCardBundleDecisions(input: {inspectionId: string; decisions: Record<string, ImportDecision>}): Promise<{mappings: Array<PackMapping & {from: string}>; scriptRisk: ScriptRisk[]; cardWidgetRisks: Array<Pick<ScriptRisk, 'packId' | 'packName' | 'widgetId' | 'widgetName'>>; raw: unknown}>;
  applyCardBundle(input: {inspectionId: string; expectedRevision?: string | null; cancel?: boolean; decisions?: Record<string, ImportDecision>; acceptScriptRisk?: boolean; disableWidgets?: boolean}): Promise<{status: 'cancelled'} | {status: 'committed'; path: string; mappings: Array<PackMapping & {from: string}>; widgetRisks: ScriptRisk[]}>;
  leaseMedia(input: LeaseScope & {hash: string}): Promise<Lease>;
  leaseBundle(input: LeaseScope & {bundleKey: string}): Promise<Lease>;
  /** Host-only authorization; not exposed by the browser control transport. */
  leaseWidget(input: {ref: AssetRef; expectedRevision: string; origin: string; scope: string; authorize(): boolean | Promise<boolean>}): Promise<Lease>;
  respondLease(input: {ticket: string; resource: string; request: Request; bundle?: boolean; deferFonts?: boolean}): Promise<Response>;
  releaseLease(ticket: string): boolean;
  subscribe(listener: (event: PackChange) => void): () => void;
  dispose(): Promise<void>;
}
export function createAssetPackService(options: PackServiceOptions): AssetPackService;

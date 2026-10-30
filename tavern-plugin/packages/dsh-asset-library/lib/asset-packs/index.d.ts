import type { UUID, Sha256, TimeOfDay, AssetRef, FigureRef, TimerContent } from './protocol.js';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Extensions = Record<string, Json>;
export interface Recall { mode: 'constant' | 'keyword'; keywords: string[]; synonyms?: Record<string, string[]> }
export interface FigureRecall { mode: 'constant' | 'keyword' }
export function validateFigureRecall(value: unknown, path?: string): FigureRecall;
export interface Metadata { description?: string; category?: string[]; aliases?: string[]; author?: string; license?: string; credits?: string[]; extensions?: Extensions }
export interface AssetBase extends Metadata { id: string; name: string; recall: Recall; directorNote: string; remark?: string; inventoryId?: string }
export interface ImageContent { media: Sha256 | null; pendingMedia?: boolean }
export interface AssetContentMap {
  backgrounds: ImageContent & {stageTheme?: StageTheme; tags?: string[]};
  cg: ImageContent & {description?: string; focusHints?: Array<{key:string;label:string;x:number;y:number;zoom:number}>};
  props: ImageContent;
  items: ImageContent & {categoryDefault?:boolean};
  directions: {text:string};
  timers: TimerContent;
  music: {media:Sha256;usage?:string;volume?:number;tags?:string[];loopStart?:number;loopEnd?:number;loudness?:{v:1;lufs:number;peak:number}};
  sfx: {media:Sha256;loop?:false;durationMs?:number;volume?:number;tags?:string[];gainDb?:number;loudness?:{v:1;lufs:number;peak:number}};
  ambience: {media:Sha256;loop?:boolean;durationMs?:number;volume?:number;tags?:string[];loudness?:{v:1;lufs:number;peak:number}};
  looks: {params:Extensions;layer:'mood';event?:boolean};
  skins: {bundleKey:string;entry:string};
  performances: {bundleKey:string;entry:string};
  widgets: {bundleKey:string;entry:string;settingsDefaults?:WidgetSettingValues};
}
export interface AssetVariants<C> {default:string;entries:Array<{id:string;name:string;content:C}>}
export type Asset = {[K in keyof AssetContentMap]: Omit<AssetBase,keyof AssetContentMap[K] | 'category'> & {kind:K; category?: K extends 'sfx' ? string : K extends 'ambience' ? string | string[] : string[]} & (K extends 'skins' ? {} : {enabled:boolean}) & ((AssetContentMap[K] & {variants?:never}) | ({variants:AssetVariants<AssetContentMap[K]>} & {[P in keyof AssetContentMap[K]]?:never}))}[keyof AssetContentMap];
export function validateAssetContent<K extends keyof AssetContentMap>(kind:K,content:unknown,path?:string): AssetContentMap[K];
export interface FileEntry { path: string; size: number; sha256: Sha256 }
export interface BlobDescriptor { ext: 'png' | 'webp' | 'jpeg' | 'mp3' | 'ogg' | 'wav' | 'm4a' | 'flac'; mime: string; size: number }
export interface PackManifest extends Metadata {
  format: 'dsh-asset-pack'; schemaVersion: 1; id: UUID; name: string; contentHash: Sha256;
  assets: Asset[]; tagIcons?: {tag:string;media:Sha256}[]; genStyle?: 'clean' | 'anime' | 'polished' | 'none'; backgroundStyle?: {prompt:string;references?:Sha256[]}; stageSkin?: string; figures: UUID[]; voiceLibrary?: VoiceLibrary;
  sprites: Record<string, string>; bundles: Record<string, { kind: 'live2d' | 'spine' | 'widget' | 'skin' | 'performance' | 'entrance' | 'video'; entry: string; contentHash: Sha256 }>;
  blobs: Record<Sha256, BlobDescriptor>; files: FileEntry[];
}
export interface VoiceReference {media: Sha256; text: string; language: string}
export type VoiceSource = {kind:'voice-id'; provider:'fish-audio'; voiceId:string}
  | {kind:'preset'; provider:string; voiceName:string; model?:string}
  | {kind:'reference-list'; provider:'fish-audio'; references:VoiceReference[]};
export interface VoiceSpec {name:string; language:string; defaultSource:string; sources:Record<string,VoiceSource>; emotions?:Record<string,{label:string;referenceEmotion?:string;tuning?:Record<string,Record<string,Json>>}>; fallbackSources?:string[]; variants?:Record<string,{name?:string; tuning?:Record<string,Record<string,string|number|boolean|null>>}>}
export interface VoiceLibrary {version:1; voices:Record<string,VoiceSpec>}
export interface Voice {voice:string; source?:string|null; variant?:string; language?:string; emotionVariants?:Record<string,string>}
export type OutfitRecall = Recall;
/** Pack coordinates: x / canvas width, y / canvas height; cheek diameter / canvas height. */
export interface Anatomy { cheeks?: { left: [number, number]; right: [number, number]; size: number }; faceRect?: [number, number, number, number]; visibleFraction?: number; headsPerBody?: number; figureTop: number; headTop: number; chin: number; feet: number; visibleBottom: number; supportX: number; poseHeightRatio: number; headRatio: number; assetScale?: number; posture: 'standing' | 'seated'; crop: 'full' | 'thigh' | 'waist' | 'chest' | 'custom'; source: 'calibrated' | 'measured' | 'estimated' }
export interface Outfit { key: string; defaultEmotion?: string; fallbackEmotions?: string[]; fallbackTo?: Record<string,string>; genPrompts?: {sprite?: Record<string,string>; avatar?: Record<string,string>}; genRecords?: {kind:'settei'|'sprite'|'avatar'|'avatar-sheet'; emotionId?: string; at: number; prompt?: string}[];
  label: string; remark?: string; enabled: boolean; recall?: OutfitRecall; extensions?: Extensions;
  live2d?: { anatomy?: Anatomy; bundleKey: string; emotionMap?: Record<string, { expression?: string; motion?: string }> };
  /** track 0 loops the emotion's animation, track 1 the talk animation while voiced. */
  spine?: { bundleKey: string; defaultAnimation: string; talkAnimation?: string; emotionMap?: Record<string, { animation?: string; talk?: string }>; hideSlots?: string[]; skin?: string; frame?: [number, number, number, number]; anatomy?: Anatomy; bottomFade?: number };
  sprite?: { anatomy?: Record<string, Anatomy>; manifestKey: string; assets: Record<string, Sha256>; avatarCrop?: Record<string, { x: number; y: number; w: number; h: number }>; avatarCropAuto?: Record<string, { x: number; y: number; w: number; h: number }> };
  avatarCrop?: { x: number; y: number; w: number; h: number };
  /** 使用情景 (≤ 80 code points) — when the director should switch to this outfit. */
  guidance?: string;
  outfitAppearance?: string;
  settei?: Sha256;
  setteiParentVersion?: string;
  avatars?: Record<string, Sha256>;
}
export interface FigureEmotion {id: string; label?: string; guidance?: string; remark?: string; voiceEmotion?: string; words?: string; color?: string; generationGuidance?: string; protectTears?: boolean}
export function validateFigureEmotions(value: unknown, path?: string): FigureEmotion[];
/** A sole {id} entry is an unlabelled image, never a model variant. */
export function figureSingleImage(figure?: Pick<Figure, 'emotions'>): string | null;
export function figureEmotionRows(figure?: Pick<Figure, 'emotions'>): Array<FigureEmotion & {label: string; color?: string}>;
export function figureOutfitEmotionRows(figure: Pick<Figure, 'emotions'>, outfit: Figure['outfits'][number], sprites?: Record<string, SpriteManifest>): ReturnType<typeof figureEmotionRows>;
// board versions belong to the identity, never to outfit accessories.
export interface IdentitySettei { board: Sha256; version: string; palette: Array<{role: string; hex: string; zone: string}> }
export interface Figure { schemaVersion: 1; id: UUID; name: string; aliases?: string[]; description?: string; remark?: string; enabled: boolean; recall: FigureRecall; appearance: 'live2d' | 'spine' | 'sprite' | 'avatar'; identityAppearance?: string; identitySettei?: IdentitySettei; heightCm?: number; heightBasis?: 'standing' | 'seated'; elevationCm?: number; imageColor?: string; autoColor?: string; emotions?: FigureEmotion[]; voice?: Voice; outfits: Outfit[]; extensions?: Extensions }
export interface Rect { x: number; y: number; w: number; h: number }
export type MouthEvent = 'closed' | 'small' | 'mid' | 'open';
/** Optional closed-eyes overlay at a base-canvas rect [x, y, w, h]; patch images are exactly w×h. */
export interface SpriteBlink { blend?: 'replace'; closed: string; half?: string; rect: [number, number, number, number] }
export interface SpriteView { src: string; width: number; height: number; mouth?: Rect; mouthByFrame?: Record<string, Rect>; mouthFrames?: Record<MouthEvent, string>; mouthOcclusionMask?: string; blink?: SpriteBlink }
export interface MouthAtlas { src: string; width: number; height: number; frames: Record<string, Rect & { replace?: boolean }>; defaultFrames?: Partial<Record<Exclude<MouthEvent, 'closed'>, string>> }
export interface LayeredSpriteManifest {
  version: 1 | 2; kind: 'layered-static-sprites'; character: { id: string; name: string }; closedBehavior: 'restore-base' | 'restore-base except explicit surprise closed override';
  mouthAtlas?: MouthAtlas; mouthSets?: Record<string, MouthAtlas>;
  emotions: Record<string, { initialPhoneme?: MouthEvent; mouthSet?: string; mouthFrames?: Record<MouthEvent, string>; closedMouthFrame?: string; stage: SpriteView; portrait?: SpriteView }>;
}
export interface StaticSpriteManifest {
  version: 1; kind: 'static-sprites';
  emotions: Record<string, { src: string }>;
}
export type SpriteManifest = LayeredSpriteManifest | StaticSpriteManifest;
export interface PackDocuments { manifest: PackManifest; figures: Record<UUID, Figure>; sprites: Record<string, SpriteManifest> }
export const BLOB_MIME_TYPES: Readonly<Record<BlobDescriptor['ext'], string>>;
export const LOCAL_ONLY_FIELDS: readonly string[];
export const ASSET_PACK_ERROR_CODES: readonly string[];
export function validateBlob(value: unknown, path?: string): BlobDescriptor;
export function validateRecall(value: unknown, path?: string, minKeywordLength?: number): Recall;
export function validateAsset(value: unknown, path?: string): Asset;
export function validatePackManifest(value: unknown, path?: string): PackManifest;
export function validatePackIdentities(values: PackManifest[]): PackManifest[];
export function validateVoice(value: unknown, path?: string): Voice;
export function validateFigure(value: unknown, path?: string): Figure;
export function validateSpriteManifest(value: unknown, path?: string): SpriteManifest;
export function spriteResourcePaths(value: SpriteManifest): string[];
export function validateFigureClosure(manifest: PackManifest, figures: Record<UUID, Figure>, sprites: Record<string, SpriteManifest>): PackDocuments;
export function validatePackDocuments(value: PackDocuments): PackDocuments;
export function verifyPackDocuments(value: PackDocuments): Promise<PackDocuments>;
export function verifyPackHashes(value: PackManifest): Promise<void>;
// opt-in authoring hygiene; installed-reader compatibility is unchanged.
export function keywordHygieneIssue(word: string, item?: {name?: string; label?: string; description?: string}): string | null;
export function validatePackKeywords(pack: {manifest: Pick<PackManifest, 'assets'>; figures?: Record<string, Figure>}): void;
export function omitRedundantRecallKeywords(item: {name?: string; label?: string; description?: string; recall: Recall}): Recall;
export function contentHashInput(value: PackManifest): Omit<PackManifest, 'contentHash'>;
export function computeContentHash(value: PackManifest): Promise<Sha256>;
export function verifyContentHash(value: PackManifest): Promise<PackManifest>;
export function verifyPackFiles(value: PackManifest, files: Map<string, Uint8Array>): Promise<PackManifest>;
export function validateFiles(value: unknown, path?: string): FileEntry[];
export function computeBundleHash(value: FileEntry[]): Promise<Sha256>;
export function canonicalJson(value: unknown): string;
export function parseJson(value: string): Json;
export function sha256(bytes: Uint8Array): Promise<Sha256>;
export function jsonHash(value: unknown): Promise<Sha256>;

export interface WidgetRectangle {
  width: number; height: number; minWidth: number; minHeight: number;
  anchor: 'top-center' | 'corner-left' | 'corner-right' | 'center-card'; aspectRatio?: number;
}
export type StageColour = 'accent' | 'accentText' | 'surface' | 'surfaceText' | 'muted' | 'border';
export type StageTheme = Partial<Record<StageColour | 'fontFamily' | 'headingFont', string>> & {radius?: number};
export type WidgetSettingValue = string | number | boolean | null | AssetRef<'backgrounds'>;
export type WidgetSettingValues = Record<string, WidgetSettingValue>;
export type WidgetSettingField = {key: string; label: string; help?: string} & (
  | {type: 'text'; default: string; maxLength: number; bindable?: boolean; directorVisible?: boolean}
  | {type: 'toggle'; default: boolean; bindable?: boolean; directorVisible?: boolean}
  | {type: 'choice'; default: string; choices: Array<{value: string; label: string}>; bindable?: boolean; directorVisible?: boolean}
  | {type: 'range'; default: number; min: number; max: number; step: number; unit?: 'ms' | 's' | '%'; bindable?: boolean; directorVisible?: boolean}
  | {type: 'colour'; default: string; stageToken?: StageColour}
  | {type: 'pack-asset'; default: null; kind: 'backgrounds'}
);
export interface WidgetSettingBinding {source: 'mvu' | 'helper-chat'; path: string; fallback?: string | number | boolean}
export interface WidgetCardOverride {ref: AssetRef<'widgets'>; enabled?: boolean; settings?: WidgetSettingValues; bindings?: Record<string, WidgetSettingBinding>}
export interface WidgetDocument {
  format: 'dsh.widget/2'; namespace: string;
  view: {entry: string};
  presentation: {open: WidgetRectangle; compact?: WidgetRectangle; notifications?: 'none' | 'changes'};
  commands: Array<{name: 'set' | 'update' | 'clear' | 'mark'; summary: string; params: Extensions; bindings?: Record<string,'contact'>; effect: 'state.set' | 'state.patch' | 'state.clear' | 'source.mark'; help?: {details?: string; examples?: Extensions[]}}>;
  stateSchema?: Extensions; settingsSchema?: {fields: WidgetSettingField[]};
  i18n?: {defaultLocale: string; messages: Record<string, Record<string, string>>};
  lifetime?: {until: 'explicit' | 'scene-change' | 'turn-end'; durationSeconds?: number};
  assets?: Record<string,{kind: 'image' | 'font' | 'music' | 'sfx'; path: string}>;
  caps: {bytes: number; active: 1}; samples?: Array<{command: string; params: Extensions}>;
}

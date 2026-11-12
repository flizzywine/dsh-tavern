// 语音服务契约（dsh-tavern-tts 提供，Core 与舞台只通过这里读写）。唯一权威：插件与宿主都从这里 re-export。
export interface VoiceRef { source: string; id: string }
export interface VoiceLoudness { version: 1; lufs: number | null; truePeak: number | null; targetLufs: number; peakCeiling: number; gainDb: number; gain: number }

/** Opaque provider requirements, bounded JSON without paths or credentials. */
export interface PortableVoice {
  schemaVersion: 1; id: string; label: string; enabled: boolean
  kind: 'service' | 'reference' | 'azure' | 'volcengine' | 'qwen' | 'fish-audio' | 'openai-compatible' | 'minimax'
  voiceId?: string; engine?: string; revision?: string; modelSetId?: string; modelVersion?: string
  languages: string[]; params: Record<string, unknown> & { moods?: Record<string, string | null>; styles?: boolean }; moodStyles?: Record<string, string>
  /** Ordered clips including repeated entries; byte/count limits are provider capabilities. */
  references?: {sha256: string; transcript: string; language: string; file?: string}[]
}
export interface VoicePreset extends PortableVoice { kind: 'service' | 'azure' | 'qwen' | 'fish-audio' | 'volcengine' | 'openai-compatible' | 'minimax'; providerId?: string }
export interface VoicePresetImportResult { added: string[]; unchanged: string[]; conflicts: string[] }
declare const consumerGrant: unique symbol
export type ConsumerGrant = { readonly [consumerGrant]: true }
export interface VoiceSourceInput {
  owner: string; sourceId: string; revision: string; voices: PortableVoice[]
  bindings: Record<string,string>
  readReference?(hash: string): Uint8Array | Promise<Uint8Array>
}
export interface ResolvedSynthesis {
  text: string; language: string; params: Record<string,unknown>; identity: string
  voiceId?: string; revision?: string
  mood?: string; resolvedMood?: string | null; readingsRevision: string
  reference?: {sha256: string; bytes: Uint8Array; ext?: 'wav' | 'mp3'; mime?: 'audio/wav' | 'audio/mpeg'; transcript: string; promptText: string; promptLanguage: string}
  /** bytes-list-v1 opt-in; the complete ordered reference set; single-reference providers use index 0. */
  references?: NonNullable<ResolvedSynthesis['reference']>[]
}
/** A 配音来源 kind (a pack voice source's `kind`): reference audio to clone, a voice ID from the service's voice library, a preset voice. */
export type VoiceSourceKind = 'reference-list' | 'voice-id' | 'preset'
/**
 * A synthesis backend. Registered by the plugin (`registerProvider`) or by a plugin's speech provider bridge.
 *
 * What it supports is the provider's own answer, per registered service instance (never per kind or name): the voice
 * services catalog (`voiceServices`) lists a provider only with the 配音来源 it reports in `capabilities.voiceSources`,
 * and UIs offer only those. A provider that can ask its server refreshes the answer in `discover()`, which the catalog
 * calls (without `wake`) before each read, so the provider caches it per service config and a failed ask keeps the last
 * answer (it never rejects only for that); a protocol with nothing to ask declares it from its fixed semantics. Never
 * infer it from a URL or a name. A provider that reports no `voiceSources` is not listed.
 *
 * Built-in example: every Fish-protocol service takes reference audio; it has voice IDs (`voice-id`) only when its own
 * server answers so: `GET /v1/info` `capabilities.voiceLibrary: true`, or, for a server without `/v1/info` (the
 * official cloud), its voice library API (`GET /model`) lists public voices.
 */
export interface Provider {
  id: string; kind: PortableVoice['kind']; revision: string
  /** The service's name in lists (the catalog's `label`); defaults to `id`. */
  label?: string
  capabilities: {referenceInput?: string[]; serviceVoiceEngines?: string[]; voiceKinds?: string[]; paid?: boolean; billing?: 'free' | 'paid' | 'unknown'; prepareVoice?: boolean; voiceDirections?: boolean; concurrency?: number; loadTimeoutMs?: number
    /** The 配音来源 this service instance serves, as listed by the catalog. */
    voiceSources?: VoiceSourceKind[]
    /** How its voices are listed (the catalog's `voiceList`); defaults to `provider` (providerVoices). */
    voiceList?: VoiceServiceEntry['voiceList']}
  onRequest?(): void
  /** Refresh server-advertised optional capabilities (including `voiceSources`); never infer them from a model name. */
  discover?(options?: {wake?: boolean; signal?: AbortSignal}): Promise<void>
  /** Fresh service state from the server (Fish `/v1/info`), for diagnostics only. */
  info?(): Promise<{state?: string}>
  /** A residency lease: keeps a provider that can idle-unload resident until the returned release is called. */
  hold?(): () => void
  /** Prepare references only when advertised; false means unsupported, with no warm request. */
  prewarm?(spec: {references: NonNullable<ResolvedSynthesis['reference']>[]}, options: {signal: AbortSignal}): Promise<boolean | void>
  /** Cached lifecycle state; never probes or starts a worker. */
  status?(): {state:string; sleeping?:boolean; error?:string}
  health(options: {signal?: AbortSignal}): Promise<unknown>
  catalog(options: {signal?: AbortSignal}): Promise<unknown[]>
  synthesize(input: ResolvedSynthesis, options: {signal: AbortSignal}): Promise<Uint8Array>
}
export interface FishVoice {
  voiceId:string; name:string; languages:string[]; gender?:string|null; toneTags?:string[]; visibility?:string; licensed?:boolean|null; licenseNote?:string
  likeCount?:number; taskCount?:number; sampleUrl?:string|null; coverImage?:string|null
  approval?:'candidate'|'approved'; verification?:{status:'passed'|'failed'|'unverified';model?:string;checkedAt?:string;samplePath?:string}
}
export interface ServiceVoice {
  id: string; label: string; engine: string; languages: string[]; state: string; revision: string; serviceId?: string
  preset?: boolean; modelSetId?: string; modelVersion?: string; params?: Record<string, unknown>
}
export interface ServiceSynthesis { voiceId: string; text: string; language: string; mood?: string }
/** Error code when no voice service can speak; callers stay silent and show it as a diagnostic, never throw it to chat. */
export declare const TTS_UNAVAILABLE: 'TTS_UNAVAILABLE'
/** A 台词朗读 voice, the same shape the figure voice picker produces: a browser system voice or a voice of a configured service. */
export type ReadingVoiceBinding = {browser: string} | {serviceId: string; voice: string}
/** Native setting tts.reading: 旁白配音's global switch (off by default) and 全文朗读's reader. 通用声音 / 旁白's voices are the asset
 * library's reading voices, not settings. */
/** 通用声音 / 旁白: the asset-library figure whose voice they speak with (null = the browser's default voice). */
export type FigurePointer = {packId: string; figureId: string}
export interface TtsReading { general: {figure: FigurePointer | null}; narrator: {enabled: boolean; figure: FigurePointer | null}; readAloud: {voice: ReadingVoiceBinding | null; auto: boolean} }
/** ttsControl `setReading` input: omitted keys keep their value; null clears a voice. Invalid input rejects with INVALID_READING_VOICE. */
export interface TtsReadingPatch { general?: {figure?: FigurePointer | null}; narrator?: {enabled?: boolean; figure?: FigurePointer | null}; readAloud?: {voice?: ReadingVoiceBinding | null; auto?: boolean} }
/** One configured voice service as UIs and other plugins list it: no keys, URLs or config. 浏览器朗读 (kind 'browser') is always listed;
 * so is every other plugin's registered provider that reports `voiceSources`. */
export interface VoiceServiceEntry {
  id: string; kind: PortableVoice['kind'] | 'browser'; label: string
  /** From the last connection check of this activation; reading the catalog sends no request. */
  state: 'ready' | 'configured' | 'needs-key' | 'offline'
  billing: 'free' | 'paid' | 'unknown'
  /** The 配音来源 kinds this service speaks: its provider's `capabilities.voiceSources` (see Provider). */
  sources: VoiceSourceKind[]
  /** How its voices are listed: listRecommendedFishVoices, listOnlinePresetVoices, providerVoices, or the browser's own voices. */
  voiceList: 'fish-recommended' | 'preset' | 'provider' | 'browser'
}
/** The configured voice services catalog (ttsControl `voiceServices`, Tts.listVoiceServices); `kinds`: every supported kind's name, for a source whose service is not configured. */
export interface VoiceServiceCatalog { services: VoiceServiceEntry[]; kinds: Record<VoiceServiceEntry['kind'], string> }
/** Host control service (ctx.get('ttsControl')); also served at /api/dsh-tts/v1/control. */
export interface TtsControl {
  call(method: 'reading'): Promise<TtsReading>
  call(method: 'setReading', args: TtsReadingPatch): Promise<TtsReading>
  call(method: 'voiceServices'): Promise<VoiceServiceCatalog>
  call(method: string, args?: Record<string, unknown>): Promise<unknown>
}
/** Host consumer service; unregistered while native tts.enabled is false. */
export interface Tts {
  readonly apiVersion: 1
  /** Current tts.reading (a copy); subscribe for {type:'readingChanged'}. */
  reading(): TtsReading
  setReading(patch: TtsReadingPatch): Promise<TtsReading>
  registerProvider(owner: string, provider: Provider): () => void
  registerVoiceSource(input: VoiceSourceInput): {source: string; replace(next: VoiceSourceInput, expectedRevision: string): void; dispose(): void}
  grantConsumer(input: {principal: string; source: string; scope: string; authorize?: (input: unknown, provider: {serviceId:string;serviceRevision:string}) => void}): {grant: ConsumerGrant; dispose(): void}
  listRecommendedFishVoices(input?: {language?:string;serviceId?:string;selectedVoiceId?:string}): {voices:FishVoice[];refreshing:boolean}
  listServiceVoices(): Promise<ServiceVoice[]>
  /** The configured voice services catalog; subscribe for {type:'servicesChanged'}. */
  listVoiceServices(): Promise<VoiceServiceCatalog>
  /** Synchronous choice among already-listed services, with the same rule as resolveVoiceService (no network, no binding):
   *  the source's own installed serviceId, else the sole service of its provider, else undefined. */
  chooseService(source: {kind: string; provider: string; serviceId?: string}, services: ServiceVoice[]): ServiceVoice | undefined
  exportVoicePresets(ids: string[]): Promise<VoicePreset[]>
  /** A saved or builtin online preset as portable synthesis data (no provider configuration). */
  exportPortableVoice(input: {voiceId: string}): Promise<{voice: PortableVoice}>
  importVoicePresets(input: {presets: VoicePreset[]}): Promise<VoicePresetImportResult>
  grantServiceConsumer(input: {principal: string; scope: string}): {grant: ConsumerGrant; dispose(): void}
  synthesize(input: ServiceSynthesis | {voice: VoiceRef; mood: string; text: string; language: string}, options: {grant: ConsumerGrant; scope: string; signal?: AbortSignal; priority?: 'call' | 'story'}): Promise<{key: string; mime: 'audio/wav'; cacheHit: boolean; loudness: VoiceLoudness}>
  /** Host-only cache lookup: no synthesis, provider request, eviction or metadata write. */
  readCached(input: {voice: VoiceRef; mood?: string; text: string; language: string; selectionKey?: string}, options: {grant: ConsumerGrant; scope: string; signal?: AbortSignal}): Promise<{key: string; audio: Uint8Array; mime: 'audio/wav'; durationMs: number; loudness: VoiceLoudness} | null>
  /** Dev diagnostics: the voice's provider and its fresh state ('unsupported' without an info call). */
  serviceState(input: {voice: VoiceRef; language: string}, options: {grant: ConsumerGrant; scope: string}): Promise<{serviceId: string; state: string}>
  /** Holds the voice's provider resident (an open call); resolves to the release, a no-op when it has nothing to hold. */
  hold(input: {voice: VoiceRef; language: string}, options: {grant: ConsumerGrant; scope: string}): Promise<() => void>
  /** Prepares a reference-list voice on an opted-in server; no audio is played or cached. */
  prewarm(input: {voice: VoiceRef; language: string}, options: {grant: ConsumerGrant; scope: string}): Promise<{prewarmed: boolean}>
  readAudio(input: {key: string; grant: ConsumerGrant}): Promise<Uint8Array>
  createAudioTicket(input: {key: string; grant: ConsumerGrant; ttlMs?: number}): Promise<string>
  /** The same-origin browser address that redeems an audio ticket. */
  audioUrl(ticket: string): string
  /** Read-only outstanding synthesis flights and browser jobs, including audio-ticket completion. */
  pendingCount(): number
  deleteCacheEntry(input: {key:string}): Promise<{removed:number; keys:string[]}>
  cacheSnapshot(): {count:number; bytes:number; maxBytes:number; maxAgeDays:number; loading:boolean; error?:string}
  /** Events include 'readingChanged' (tts.reading changed; read it again with reading()) and 'servicesChanged' (read listVoiceServices again). */
  subscribe(listener: (event: {type: string; source?: string; serviceId?: string; epoch?: number; code?:string}) => void): () => void
  dispose(): Promise<void>
}

/** Optional browser service, unprovided while native tts.enabled is false.
 * Look up ctx.get('ttsClient') for each speech operation; no enabled-change API.
 * Host-issued source/scope grants remain mandatory.
 */
export interface TtsClient {
  readonly apiVersion: 1;
  available(): boolean;
  listVoices(): Promise<ServiceVoice[]>;
  subscribe(listener: (event: {type: 'unavailable' | 'voicesChanged' | 'servicesChanged'}) => void): () => void;
  call(method: string, args?: Record<string, unknown>): Promise<unknown>;
  synthesize(input: ServiceSynthesis | {voice: VoiceRef; text: string; language: string; mood?: string}, options: {scope: string; signal?: AbortSignal; priority?: 'call' | 'story'}): Promise<{key: string; ticket: string; mime: string; cacheHit: boolean; durationMs?: number; loudness: VoiceLoudness}>;
  audio(ticket: string, options?: {signal?: AbortSignal}): Promise<Blob>;
  audioUrl(ticket: string): string;
  /** Polls a job started by a host RPC (e.g. previewFigureVoice): resolves to its state; a failed job rejects with its code. */
  jobStatus(requestId: string, options?: {signal?: AbortSignal}): Promise<{state: string; result?: {ticket: string; loudness: VoiceLoudness; [key: string]: unknown}; error?: string; message?: string}>;
  /** Cancels a job started by a host RPC; never throws. */
  cancelJob(requestId: string): void;
}

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
/** A synthesis backend. Registered by the plugin (`registerProvider`) or by a plugin's speech provider bridge. */
export interface Provider {
  id: string; kind: PortableVoice['kind']; revision: string
  capabilities: {referenceInput?: string[]; serviceVoiceEngines?: string[]; voiceKinds?: string[]; paid?: boolean; billing?: 'free' | 'paid' | 'unknown'; prepareVoice?: boolean; voiceDirections?: boolean; concurrency?: number; loadTimeoutMs?: number}
  onRequest?(): void
  /** Refresh server-advertised optional capabilities; never infer them from a model name. */
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
/** Native setting tts.reading. dialogueVoice null = the browser's system default; narration reading is off by default. */
export interface TtsReading { dialogueVoice: ReadingVoiceBinding | null; narrator: {enabled: boolean; voice: ReadingVoiceBinding | null} }
/** ttsControl `setReading` input: omitted keys keep their value; null clears a voice. Invalid input rejects with INVALID_READING_VOICE. */
export interface TtsReadingPatch { dialogueVoice?: ReadingVoiceBinding | null; narrator?: {enabled?: boolean; voice?: ReadingVoiceBinding | null} }
/** Host control service (ctx.get('ttsControl')); also served at /api/dsh-tts/v1/control. */
export interface TtsControl {
  call(method: 'reading'): Promise<TtsReading>
  call(method: 'setReading', args: TtsReadingPatch): Promise<TtsReading>
  call(method: string, args?: Record<string, unknown>): Promise<unknown>
}
/** Host consumer service; unregistered while native tts.enabled is false. */
export interface Tts {
  readonly apiVersion: 1
  serviceDefaultsChanged(): void
  /** Current tts.reading (a copy); subscribe for {type:'readingChanged'}. */
  reading(): TtsReading
  registerProvider(owner: string, provider: Provider): () => void
  registerVoiceSource(input: VoiceSourceInput): {source: string; replace(next: VoiceSourceInput, expectedRevision: string): void; dispose(): void}
  grantConsumer(input: {principal: string; source: string; scope: string; authorize?: (input: unknown, provider: {serviceId:string;serviceRevision:string}) => void}): {grant: ConsumerGrant; dispose(): void}
  listRecommendedFishVoices(input?: {language?:string;serviceId?:string;selectedVoiceId?:string}): {voices:FishVoice[];refreshing:boolean}
  listServiceVoices(): Promise<ServiceVoice[]>
  /** Synchronous choice among already-listed services, with the same rule as resolveVoiceService (no network, no binding). */
  chooseService(source: {kind: string; provider: string}, services: ServiceVoice[], defaults?: Record<string,string>): ServiceVoice | undefined
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
  /** Events include 'readingChanged' (tts.reading changed; read it again with reading()). */
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
  subscribe(listener: (event: {type: 'unavailable' | 'voicesChanged'}) => void): () => void;
  call(method: string, args?: Record<string, unknown>): Promise<unknown>;
  synthesize(input: ServiceSynthesis | {voice: VoiceRef; text: string; language: string; mood?: string}, options: {scope: string; signal?: AbortSignal; priority?: 'call' | 'story'}): Promise<{key: string; ticket: string; mime: string; cacheHit: boolean; durationMs?: number; loudness: VoiceLoudness}>;
  audio(ticket: string, options?: {signal?: AbortSignal}): Promise<Blob>;
  audioUrl(ticket: string): string;
  /** Polls a job started by a host RPC (e.g. previewFigureVoice): resolves to its state; a failed job rejects with its code. */
  jobStatus(requestId: string, options?: {signal?: AbortSignal}): Promise<{state: string; result?: {ticket: string; loudness: VoiceLoudness; [key: string]: unknown}; error?: string; message?: string}>;
  /** Cancels a job started by a host RPC; never throws. */
  cancelJob(requestId: string): void;
}

export interface ImageChannel {
  id: string; provider: string; name?: string; baseUrl?: string; model?: string;
  authMode?: 'none' | 'bearer' | 'basic'; apiKey?: string; username?: string; password?: string;
  options?: Record<string, unknown>;
}
export interface ImageConfiguration {
  imageBackend: string; activeImageChannel?: string; imageChannels: ImageChannel[]; maxImageBytes?: number;
}
/** 	ransparent is omitted when the channel's ability to return an alpha background is unknown. */
export interface ImageStatus { ready: boolean; reason?: string; model?: string; maxReferences: number; transparent?: boolean }
export interface ImageReference { data: Uint8Array; mediaType: string }
export interface GenerateRequest {
  prompt: string; modelId?: string; references?: ImageReference[]; width?: number; height?: number;
  background?: string; quality?: string; signal?: AbortSignal;
}
export interface ImageResult { data: Uint8Array; mediaType: string }
export interface ImageGenerator {
  id: string; label: string;
  models(): Array<ImageStatus & { id: string; label: string }>;
  status(input?: { modelId?: string }): ImageStatus;
  generate(input: GenerateRequest): Promise<ImageResult>;
}
export type ImageAdapter = (channel: ImageChannel, request: {
  positive: string; references: ImageReference[]; width?: number; height?: number; exactSize: true;
  background?: string; quality?: string;
}, options: { signal?: AbortSignal; maxImageBytes?: number }) => Promise<{ bytes: Uint8Array; mediaType: string }>;
/** Server-side, stateless online generator. No UI, jobs, gallery or story hooks are installed. */
export interface ComfyRunner {
  workflow(): { id: string; label?: string; bindings?: { referenceImages?: unknown[] } } | null | undefined;
  generate(input: Omit<GenerateRequest, 'modelId' | 'background' | 'quality'>): Promise<ImageResult>;
}
export function createImageGenerator(getConfig: () => ImageConfiguration, adapter?: ImageAdapter, options?: { comfy?: ComfyRunner }): ImageGenerator;
export { createImageGenerator as stageImageProvider };

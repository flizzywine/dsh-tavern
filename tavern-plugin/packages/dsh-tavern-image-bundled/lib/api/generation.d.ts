import type { MaterializedModules, ModuleParameters, WorkflowValue } from './modules.js';

export interface ImageChannel {
  id: string; provider: string; name?: string; baseUrl?: string; model?: string;
  authMode?: 'none' | 'bearer' | 'basic'; apiKey?: string; username?: string; password?: string;
  options?: Record<string, unknown>;
}
export interface ImageConfiguration {
  promptSystem?: 'workbench' | 'worldbook'; randomPromptTemplates?: boolean; randomTemplateIds?: string[];
  imageBackend: string; activeImageChannel?: string; imageChannels: ImageChannel[]; maxImageBytes?: number;
  activePromptPreset?: string; promptMode?: string; promptPresets?: unknown[]; promptDefault?: unknown;
  activePreset?: string; stylePresets?: unknown[]; styleArtists?: string; styleNegative?: string;
  promptManualPositive?: string; promptManualNegative?: string; promptEntries?: unknown[];
}
export interface ImageStatus { ready: boolean; reason?: string; model?: string; maxReferences: number; transparent?: boolean }
export interface ImageReference { data: Uint8Array; mediaType: string; name?: string }
export interface PromptSubject {
  characterId?: string; outfitId?: string; angle?: 'front' | 'back'; state?: string;
}
export interface PromptDefinitions { characters?: object[]; outfits?: object[] }
export interface PromptLibrary {
  definitions?: () => PromptDefinitions;
  templates?: () => Array<ImageStatus & { id: string; label: string; templateId: string }>;
  generateTemplate?: (input: GenerateRequest & { templateId?: string }) => Promise<ImageResult>;
  workflows?: () => Array<ImageStatus & { id: string; label: string; workflowId: string }>;
  generateComfy?: (input: GenerateRequest & { workflowId: string }) => Promise<ImageResult>;
  readReference?: (reference: { id: string; mediaType: string; name?: string; byteLength?: number }) => Promise<ImageReference>;
}
export interface GenerateRequest {
  inputs?: Record<string, string>; subjects?: PromptSubject[]; definitions?: PromptDefinitions;
  prompt: string; negative?: string; usage?: string; modelId?: string; templateId?: string;
  /** Style preset for this request only (built-in, saved or registered id). Omit to use the selected preset; an unknown id throws. */
  promptPreset?: string; references?: ImageReference[]; width?: number; height?: number;
  background?: string; quality?: string; signal?: AbortSignal; chooseScenario?: ScenarioChooser;
}
export interface ImageResult { data: Uint8Array; mediaType: string; seed?: number; usage?: Record<string, unknown> }
export interface ScenarioDecision { id: string; name: string; reason: string }
export type ScenarioChooser = (context: { modes: Array<{ id: string; name: string; description: string; keywords: string[] }>; fallback: string; scene: string; signal?: AbortSignal }) => Promise<string>;
export interface ComposedImagePrompt {
  scenario?: ScenarioDecision;
  positive: string; negative?: string; promptMode?: string;
  parameters?: ModuleParameters; workflowValues?: WorkflowValue[]; moduleTrace?: MaterializedModules['trace'];
}
export interface ImageGenerator {
  id: string; label: string;
  models(): Array<ImageStatus & { id: string; label: string }>;
  status(input?: { modelId?: string }): ImageStatus;
  generate(input: GenerateRequest): Promise<ImageResult>;
}
export type ImageAdapter = (channel: ImageChannel, request: {
  positive: string; negative?: string; promptMode?: string; references: ImageReference[]; width?: number; height?: number; exactSize: true;
  seed?: number; steps?: number; cfg?: number;
  background?: string; quality?: string;
}, options: { signal?: AbortSignal; maxImageBytes?: number }) => Promise<{ bytes: Uint8Array; mediaType: string; seed?: number; usage?: Record<string, unknown> }>;
/** Server-side, stateless online generator. No UI, jobs, gallery or story hooks are installed. */
export function createImageGenerator(getConfig: () => ImageConfiguration, adapter?: ImageAdapter, defaultUsage?: string, library?: PromptLibrary): ImageGenerator;
export function composePluginImagePrompt(config: ImageConfiguration, input: { channel?: ImageChannel; prompt: string; negative?: string; usage?: string; inputs?: Record<string, string>; subjects?: PromptSubject[]; definitions?: PromptDefinitions }): ComposedImagePrompt;
export function composePluginImagePromptAsync(config: ImageConfiguration, input: { channel?: ImageChannel; prompt: string; negative?: string; usage?: string; inputs?: Record<string, string>; subjects?: PromptSubject[]; definitions?: PromptDefinitions; signal?: AbortSignal; chooseScenario?: ScenarioChooser }): Promise<ComposedImagePrompt>;
export function stageImageProvider(getConfig: () => ImageConfiguration, adapter?: ImageAdapter, library?: PromptLibrary): ImageGenerator;

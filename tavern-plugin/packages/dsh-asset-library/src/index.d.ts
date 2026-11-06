import type { PackServiceOptions } from './pack-v2/service.js'
export * from './pack-v2/service.js'
export const name: 'dsh-asset-library';
export type AssetPackPluginOptions = PackServiceOptions;
export function apply(ctx: any, config: AssetPackPluginOptions): void;
export function stageWidgetSchemaValue(schema: Record<string, unknown>, value: unknown): boolean;

export function validateStageWidgetDocument(value: unknown): import('./asset-packs/index.js').WidgetDocument | null;

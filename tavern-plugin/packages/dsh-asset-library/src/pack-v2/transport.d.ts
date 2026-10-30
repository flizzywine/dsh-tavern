import type { AssetPackService, PackServiceOptions } from './service.js'
import type { createAssetPackSettings } from './native-settings.js'
export const PACK_CONTROL_PATH: '/api/dsh-asset-library/v2/control';
export const PACK_UPLOAD_PATH: '/api/dsh-asset-library/v2/upload';
export const PACK_DOWNLOAD_PATH: '/api/dsh-asset-library/v2/download';
export const PACK_CHANGES_PATH: '/api/dsh-asset-library/v2/changes';
export interface PackConnection {
  fetch: {register(route: {path: string; methods: string[]; requestBody: 'streaming' | 'buffered'; fetch(request: Request): Promise<Response> | Response}): () => void};
}
export interface AssetPackTransport {
  readonly service: AssetPackService;
  /** Mount exactly once in the authenticated Connection owner scope. Detach revokes leases and spools. */
  attach(connection: PackConnection): () => void;
}
export function packRequestOrigin(request: Request, expected?: string): string | null;
export function createAssetPackTransport(options: PackServiceOptions & {settings?: ReturnType<typeof createAssetPackSettings>}): AssetPackTransport;
export function registerAssetPackTransport(ctx: {inject(names: string[], callback: (child: any) => void): unknown}, transport: AssetPackTransport): void;

import type { CardBundleAdapter } from '../packages/dsh-asset-library/lib/pack-v2/service.js';
/** Explicit P6 adapter. authorizeTarget must only return authorized existing or reserved card resources. */
export function createCardBundleAdapter(options: {
  dependencies?: CardBundleAdapter['dependencies'];
  getEngine?(): unknown;
  cardPreparation: {
    create(request: {kind: 'import'; payload: unknown}): {raw: unknown; meta: {id: string}; [key: string]: unknown};
    present(request: {card: unknown; as: 'raw'}): unknown;
    update?(request: {kind: 'card'; card: unknown; patch: object; rawOperations: unknown[]}): {card: {raw: unknown; meta: {id: string}; [key: string]: unknown}};
  };
  authorizeTarget(path: string): Promise<{cardId: string} | null>;
  readCover?(path: string): Promise<Uint8Array | undefined>;
  readWorkspace(path: string): Promise<unknown | undefined>;
  /** The existing durable workspace writer; one complete atomic workspace, not a raw/media writer. */
  writeWorkspace(path: string, workspace: unknown, cover?: Uint8Array): Promise<void>;
  /** Existing card queue. Never acquire the pack publication gate from this callback. */
  withCardLock<T>(cardId: string, task: () => Promise<T>): Promise<T>;
}): CardBundleAdapter;

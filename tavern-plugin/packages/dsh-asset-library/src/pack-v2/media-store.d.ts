export interface MediaRef { sha256: string; size: number }
/** Host-only port. No paths or trusted refs are accepted through browser RPC. */
export interface MediaStore {
  /** ref reuses a validated byte input's identity; streams without ref are hashed once. */
  put(source: Uint8Array | AsyncIterable<Uint8Array>, options?: {maxBytes?: number; ref?: MediaRef}): Promise<MediaRef>;
  resolve(ref: MediaRef): Promise<{absolutePath: string; size: number} | undefined>;
  /** Creates a new path, never overwrites or mutates an existing inode. */
  materialize(ref: MediaRef, target: string): Promise<{mode: 'hardlink' | 'copy'; savedBytes: number}>;
}
export function createMediaStore(options: {root: string; copyOnly?: boolean; linkFile?: (source: string, target: string) => Promise<void>}): MediaStore;

// Shared by the installed plugin and offline publisher. A pack has no fixed size: what it stores, imports and exports
// lies on disk and is bounded by the disk, whose ENOSPC rolls a write back. The per-entry, entry-count and compression
// ratio limits stay the safety boundary against broken archives and ZIP bombs; spoolBytes bounds what is held in memory.
export const PACK_BUDGET = Object.freeze({totalSize:Number.MAX_SAFE_INTEGER, spoolBytes:8 * 1024 ** 3})

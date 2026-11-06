export * as config from './config.js';
export * as playback from './playback.js';
export * as figure from './figure.js';
export * as soundscape from './soundscape.js';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export interface TargetRef {
  sessionId: string; chatId: string; branchId: string; revision: number;
  turn: number; messageId: number; messageIdentity: string | null; swipeId: number;
  sourceDigest: string; prefixDigest: string; sourceKey: string;
}
export interface UnitRef {
  publicationId: string; partId: string; unitIndex: number;
  sourceRange: [number, number]; unitDigest: string;
}
export interface ProtocolError extends TypeError {
  code: 'INVALID_PRESENTATION' | 'MIGRATION_REQUIRED' | 'DIGEST_MISMATCH' | 'STALE_TARGET';
  path: string;
}

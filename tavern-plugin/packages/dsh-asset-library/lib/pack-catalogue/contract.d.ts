// browser-visible alpha catalogue contract.
import type { PackInspection, PackMutation } from '../pack-v2/service.js'
export interface CatalogueSource { sourceId: string; url: string; enabled: boolean; official: boolean }
export interface CatalogueSettingsValues { sources: CatalogueSource[]; preferredDownloadId: string; mirrorPrefix: string }
export interface CatalogueSettingsSnapshot { values: CatalogueSettingsValues; revision: string }
export interface CatalogueSettingsInput { expectedRevision: string; sources: Array<{sourceId?: string; url: string; enabled: boolean}>; preferredDownloadId: string; mirrorPrefix: string }
export interface CatalogueSettingsProvider { read(): CatalogueSettingsSnapshot; save(input: CatalogueSettingsInput): Promise<CatalogueSettingsSnapshot> }
export interface Distribution { sourceId: string | null; catalogueUrl: string | null; version: string | null; archiveSha256: string; upstreamContentHash: string; baseMetadata: Record<string, {enabled?: boolean; recall?: unknown}> }
export interface MergeSummary { preserved: string[]; removedEdited: string[]; withoutBaseline: boolean; wholePackReplacement: boolean }
export interface CataloguePack { id: string; title: string; version: string; size: number; sha256: string; preview?: string; licence: {id: string; url?: string}; credits: Array<{name: string; url?: string}>; requires: string[]; downloads: Array<{id: string; label: string; url: string}>; extensions?: Record<string, unknown>; sourceId: string; official: boolean; compatibility: {supported: boolean; unsupported: string[]} }
export interface CatalogueSnapshot { sourceId: string; official: boolean; catalogueRevision: string; fetchedAt: number; stale: boolean; error?: {code: string; message: string}; catalogue: {id: string; title: string; updatedAt: string}; packs: CataloguePack[] }
export type PackDownloadInput = {selection: {sourceId: string; catalogueRevision: string; packId: string; version: string; downloadId: string}; useMirrorPrefix?: boolean} | {url: string}
export interface PackDownloadJob {
  jobId: string; state: 'queued' | 'downloading' | 'paused' | 'verifying' | 'ready' | 'installing' | 'completed' | 'failed' | 'cancelled';
  receivedBytes: number; totalBytes: number | null; speed: number; downloadUrl: string; integrity: 'sha256' | 'unverified';
  source: {sourceId: string; catalogueUrl: string; official: boolean; version: string; packId: string} | null;
  expiresAt?: number; error?: {code: string; message: string}; inspection?: PackInspection; result?: PackMutation | {status: 'cancelled'};
}
export interface CatalogueService {
  catalogueSettings(): CatalogueSettingsSnapshot;
  saveCatalogueSettings(input: CatalogueSettingsInput): Promise<CatalogueSettingsSnapshot>;
  refreshCatalogue(input: {sourceId: string; curated?: boolean}): Promise<CatalogueSnapshot>;
  checkPackUpdates(input?: {packIds?: string[]}): Promise<{updates: Array<{packId: string; sourceId: string; currentVersion: string; nextVersion: string | null; status: 'update' | 'current' | 'release-changed' | 'ahead' | 'missing'}>; unavailableSources: string[]}>;
  startPackDownload(input: PackDownloadInput): Promise<{jobId: string}>;
  getPackDownload(input: {jobId: string}): Promise<PackDownloadJob>;
  controlPackDownload(input: {jobId: string; action: 'pause' | 'resume' | 'cancel'}): Promise<PackDownloadJob>;
}

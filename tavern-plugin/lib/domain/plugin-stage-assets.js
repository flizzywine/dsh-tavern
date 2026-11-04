import { validateAssetRef, validateFigureRef, resolveAssetSnapshot, resolveFigureSnapshot } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'

// Return only availability: snapshots may contain private paths or voice configuration.
export async function inspectStageAssetRef({ ref, kind, snapshot }) {
  if (kind === 'figure') validateFigureRef(ref)
  else if (kind === 'asset') validateAssetRef(ref)
  else throw new TypeError('kind must be figure or asset')
  let presentation
  try { presentation = await snapshot() }
  catch (error) { return { ref, status: error?.code === 'REVISION_CONFLICT' ? 'changed' : 'stage-unavailable', revision: null } }
  if (!presentation) return { ref, status: 'stage-unavailable', revision: null }
  const pack = presentation.snapshots.find(row => row?.manifest?.id === ref.packId)
  let status = 'pack-unavailable', revision = null
  if (pack) {
    const result = kind === 'figure' ? resolveFigureSnapshot(pack, ref) : resolveAssetSnapshot(pack, ref)
    revision = result.revision
    status = result.diagnostics[0] || (result.value?.pendingMedia === true ? 'media-pending' : 'available')
  }
  if (!presentation.current()) return { ref, status: 'changed', revision: null }
  return { ref, status, revision }
}

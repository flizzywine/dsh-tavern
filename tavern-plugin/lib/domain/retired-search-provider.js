// Remove only the provider selection written by the retired Tavern search service.
// Unsetting restores the host's provider resolution; preserve deliberate alternatives.
export async function clearRetiredSearchProvider(settings) {
  const descriptor = settings.describe().find(item => item.ns === 'web')
  if (descriptor?.user?.searchProvider !== 'tavern-search') return false
  await settings.mutate('web', [{ op: 'unset', path: ['searchProvider'] }], descriptor.revision)
  return true
}

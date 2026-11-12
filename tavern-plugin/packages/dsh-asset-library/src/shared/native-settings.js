// Generated from Tavern host settings by build.mjs; do not edit.
function entryId(ctx) {
  // The owning loader entry is available before it appears in the editor's snapshot.
  const entry = ctx.fiber?.entry
    ?? ctx.get('configEditor')?.entries().find(row => row.fiber === ctx.fiber || row.fiber?.ctx?.fiber === ctx.fiber?.ctx?.fiber)
  if (!entry) throw new Error('Native settings owner is not a profile entry')
  return entry.options.id
}

// Legacy providers own sections; 0.2.1+ forms own volatile fields of a profile entry.
// owner: the context of the profile entry whose config holds the section (default ctx); listeners stay on ctx. The
// stage plugin runs on its own fiber, but its sections (mod switches, engine, director probes) are dsh-tavern's.
export function installSettingsSection(ctx, provider, section, schema, defaults, hooks, owner = ctx) {
  if (typeof provider.installSection === 'function') return provider.installSection(ctx, section, schema, defaults, hooks)
  hooks.setSource(() => (hooks.validate || schema)((owner.fiber.effectiveConfig ?? owner.fiber.config)?.[section]?.get() ?? defaults))
  ctx.on('settings/document-updated', ns => { if (ns === entryId(owner)) hooks.onChange?.() })
}

export function settingsSectionProvider(ctx, section, owner = ctx) {
  const provider = ctx.get('settings')
  if (!provider || typeof provider.installSection === 'function') return provider
  return {
    get writable() { return provider.writable !== false },
    describe() { return provider.describe().filter(row => row.ns === entryId(owner)).map(row => ({ ...row, ns: section, value: row.value[section] })) },
    async replace(name, value, revision) {
      if (name !== section || revision === undefined) throw new Error('Native settings section revision is unavailable')
      await provider.mutate(entryId(owner), [{ op: 'set', path: [section], value }], revision)
    },
  }
}

export const nativeSettingsEntryId = entryId

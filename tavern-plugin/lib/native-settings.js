function entryId(ctx) {
  const entry = ctx.get('configEditor')?.entries().find(row => row.fiber === ctx.fiber)
  if (!entry) throw new Error('Native settings owner is not a profile entry')
  return entry.options.id
}

// Legacy providers own sections; 0.2.1 forms own volatile fields of a profile entry.
export function installSettingsSection(ctx, provider, section, schema, defaults, hooks) {
  if (typeof provider.installSection === 'function') return provider.installSection(ctx, section, schema, defaults, hooks)
  hooks.setSource(() => (hooks.validate || schema)(ctx.fiber.config[section]?.get() ?? defaults))
  ctx.on('settings/document-updated', ns => { if (ns === entryId(ctx)) hooks.onChange?.() })
}

export function settingsSectionProvider(ctx, section) {
  const provider = ctx.get('settings')
  if (!provider || typeof provider.installSection === 'function') return provider
  return {
    get writable() { return provider.writable !== false },
    describe() { return provider.describe().filter(row => row.ns === entryId(ctx)).map(row => ({ ...row, ns: section, value: row.value[section] })) },
    async replace(name, value, revision) {
      if (name !== section || revision === undefined) throw new Error('Native settings section revision is unavailable')
      await provider.mutate(entryId(ctx), [{ op: 'set', path: [section], value }], revision)
    },
  }
}

export const nativeSettingsEntryId = entryId

// Preserve manifest order and keep adjacent bundle names in separate groups.
export const groupBundleFiles = files => Map.groupBy(files, file => file.path.startsWith('bundles/') ? file.path.split('/')[1] : null)

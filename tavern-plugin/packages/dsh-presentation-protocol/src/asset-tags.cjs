// Stored tags are full-path arrays; normalization belongs to the write boundary.
const assetTags = (() => {
  const paths = value => value || [];
  const normalize = value => [...new Set((typeof value === 'string' ? [value] : paths(value)).map(tag => tag.split('/').map(part => part.trim()).filter(Boolean).join('/')).filter(Boolean))];
  const matches = (value, tag) => !tag || paths(value).some(path => path === tag || path.startsWith(tag + '/'));
  const ancestors = value => [...new Set(paths(value).flatMap(path => path.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))))];
  const icon = (pack, value) => (pack.tagIcons || []).filter(row => matches(value, row.tag)).sort((a, b) => b.tag.split('/').length - a.tag.split('/').length || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))[0]?.media ?? null;
  return {paths, normalize, matches, ancestors, icon};
})();
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = assetTags;

import { readFileSync, writeFileSync } from 'node:fs'

const source = new URL('../../README.md', import.meta.url)
const target = new URL('../../tavern-plugin/packages/dsh-tavern/README.md', import.meta.url)

// Rebase repository-relative Markdown and HTML destinations for the nested README.
const readme = readFileSync(source, 'utf8').replace(
  /(\]\(|\b(?:href|src|srcset)=["'])(?!(?:[a-z][a-z0-9+.-]*:|[/#]))(?=[\w.])/gi,
  '$1../../../',
)

writeFileSync(target, '<!-- Generated from the repository root README.md. -->\n\n' + readme)

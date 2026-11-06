// The stylesheets a mounted stage reads in production: the static theme, the runtime surface table
// (surfaces.js injects surfaces.css() at startup) and the stylesheet the stage client injects when it loads.
import { readFile } from 'node:fs/promises'
import surfaces from '../../tavern-plugin/src/client/surfaces.cjs'
export async function stageThemeCss() {
  return await readFile(new URL('../../tavern-plugin/lib/client-assets/theme.css', import.meta.url), 'utf8') + '\n' + surfaces.css() + '\n'
    + await readFile(new URL('../../tavern-plugin/packages/dsh-tavern-stage/src/client/themes.css', import.meta.url), 'utf8')
}

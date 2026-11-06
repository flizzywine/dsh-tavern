import { writeFile } from 'node:fs/promises'
import { WorkspaceTypertGenerator } from '@deepseek-ai/dsh-typert-generator'

const artifact = new WorkspaceTypertGenerator('../..').generate(['dsh-tavern-remote'], ['host'])[0]
if (artifact === undefined || artifact.remote === undefined) throw new Error('Tavern Remote descriptor generation produced no Remote contract')
await Promise.all([
  writeFile('lib/typert.host.js', artifact.js),
  writeFile('lib/typert.host.d.ts', artifact.dts),
  writeFile('lib/typert.remote-client.js', artifact.remote.js),
  writeFile('lib/typert.remote-client.d.ts', artifact.remote.dts),
  writeFile('lib/typert.remote-client.d.ts.map', artifact.remote.dtsMap),
])

import { readFile, appendFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function refreshCdn({ repo, branch, manifest, request = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = console.log }) {
  const dist = `runtime-archive-${branch}`
  let reset = 0
  const get = async url => {
    const response = await request(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response
  }
  for (const file of ['install.ps1', 'install.sh', 'android/setup.sh', 'dsh-tavern-runtime.json']) {
    try {
      const result = await (await get(`https://purge.jsdelivr.net/gh/${repo}@${dist}/${file}`)).json()
      for (const value of Object.values(result.paths || {})) {
        if (!value.throttled) continue
        const seconds = Math.max(0, Number(value.throttlingReset) || 0)
        reset = Math.max(reset, seconds)
        log(`::warning::jsDelivr purge throttled for ${file}; retry after ${seconds} seconds (about ${Math.ceil(seconds / 60)} minutes)`)
      }
    } catch (error) {
      log(`::warning::jsDelivr purge failed for ${file}: ${error.message}`)
    }
  }
  let served = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(15_000)
    try {
      served = (await (await get(`https://cdn.jsdelivr.net/gh/${repo}@${dist}/dsh-tavern-runtime.json`)).json()).revision
    } catch (error) {
      log(`::warning::CDN manifest check failed: ${error.message}`)
    }
    if (served === manifest.revision) break
  }
  log(`CDN manifest revision=${served || '<none>'} expected=${manifest.revision}`)
  if (served !== manifest.revision) {
    throw new Error(`jsDelivr still serves a stale manifest on ${dist}. Runtime published, CDN synchronization unverified.${reset ? ` Purge throttled; retry after ${reset} seconds (about ${Math.ceil(reset / 60)} minutes) from the purge response.` : ''}`)
  }
  if (manifest.archive?.commit) {
    try {
      const response = await get(`https://cdn.jsdelivr.net/gh/${repo}@${manifest.archive.commit}/runtime.zip`)
      await response.arrayBuffer()
    } catch (error) {
      log(`::warning::jsDelivr could not fetch the runtime archive yet: ${error.message}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await refreshCdn({ repo: process.env.GITHUB_REPOSITORY, branch: process.env.GITHUB_REF_NAME, manifest: JSON.parse(await readFile('dsh-tavern-runtime.json', 'utf8')) })
  } catch (error) {
    console.error(`::error::${error.message}`)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### CDN synchronization failed\n\n${error.message}\n`)
    process.exitCode = 1
  }
}

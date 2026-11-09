import { createHash } from 'node:crypto'
import { readFile, lstat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const RECEIPT_FILE = 'tavern-installation.json'
async function installationFingerprint(sourceRoot, dshHome, host) {
  const files = [
    path.join(sourceRoot, 'package.json'),
    path.join(sourceRoot, 'pnpm-lock.yaml'),
    path.join(sourceRoot, '.dsh-tavern-local.json'),
    ...['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'].map(file => path.join(dshHome, 'profiles', 'tavern', file)),
  ]
  const digest = createHash('sha256')
  for (const file of files) {
    let bytes = await readFile(file)
    // Only the installer-owned keys identify the installation; the machine may add its own.
    if (path.basename(file) === '.dsh-tavern-local.json') {
      const { host: installedHost, dshHome: installedHome } = JSON.parse(bytes)
      bytes = JSON.stringify({ host: installedHost, dshHome: installedHome })
    }
    digest.update(file).update('\0').update(bytes).update('\0')
  }
  // Release metadata alone is not install validation, but a changed source
  // revision must invalidate an earlier successful profile validation receipt.
  for (const file of ['.dsh-tavern-release.json', 'dsh-tavern-runtime.json']) {
    digest.update(file).update('\0').update(await readFile(path.join(sourceRoot, file)).catch(error => {
      if (error.code === 'ENOENT') return Buffer.alloc(0)
      throw error
    }))
  }
  return digest.digest('hex')
}
export async function recordInstallationReceipt({ sourceRoot, dshHome, host, attemptId, bridgeUpdateId, verifiedAt = Date.now() }) {
  const receipt = { schemaVersion: 1, sourceRoot: path.resolve(sourceRoot), dshHome: path.resolve(dshHome), host, attemptId, verifiedAt, ...(bridgeUpdateId ? { bridgeUpdateId } : {}),
    fingerprint: await installationFingerprint(path.resolve(sourceRoot), path.resolve(dshHome), host) }
  await createProfileDataStore({ dataRoot: path.join(dshHome, 'logs') }).writeJson(RECEIPT_FILE, receipt)
  return receipt
}
export async function readInstallationReceipt({ sourceRoot, dshHome, host, attemptId, after = 0 }) {
  try {
    const receipt = await createProfileDataStore({ dataRoot: path.join(dshHome, 'logs') }).readJson(RECEIPT_FILE)
    if (receipt?.schemaVersion !== 1 || receipt.sourceRoot !== path.resolve(sourceRoot) || receipt.dshHome !== path.resolve(dshHome)
      || receipt.host !== host || receipt.verifiedAt <= after || (attemptId && receipt.attemptId !== attemptId)) return null
    if (host === 'desktop' || (host === 'next' && receipt.bridgeUpdateId)) {
      const state = path.join(dshHome, 'profile-bridge')
      for (const name of ['install.json', 'bridge-update.json', 'installation-operation.json']) {
        const file = path.join(state, name)
        let journal
        try {
          if ((await lstat(file)).isSymbolicLink() || await realpath(state) !== path.resolve(state)) return null
          journal = JSON.parse(await readFile(file, 'utf8'))
        } catch (error) {
          if (error.code !== 'ENOENT' || (name === 'bridge-update.json' && receipt.bridgeUpdateId)) return null
          continue
        }
        if (!['completed', 'rolled-back'].includes(journal.phase) || (name !== 'install.json' && journal.schemaVersion !== 1)) return null
        // A receipt written just before a failed bridge commit is not success.
        // Bind only refresh receipts so a later first-install can supersede an
        // older rolled-back refresh without deleting its diagnostic journal.
        if (name === 'bridge-update.json' && receipt.bridgeUpdateId && (journal.schemaVersion !== 1 || journal.phase !== 'completed' || path.basename(journal.backup || '') !== receipt.bridgeUpdateId)) return null
      }
    }
    return receipt.fingerprint === await installationFingerprint(path.resolve(sourceRoot), path.resolve(dshHome), host) ? receipt : null
  } catch { return null }
}

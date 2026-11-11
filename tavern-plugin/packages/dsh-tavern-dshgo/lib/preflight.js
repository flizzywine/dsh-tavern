import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TAVERN_BUNDLES, profileDir } from './status.js'

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'preflight-worker.mjs')

/**
 * 问宿主自己的 loader：这 8 个 bundle 里有几个会被跳过。
 * 不能用 `dsh --dump-config` 判断——它遇到被跳过的 bundle 退出码仍是 0，也不报错。
 *
 * @returns {{ state: 'ok'|'fatal'|'unknown', fatal: {packageName: string, reason: string}[], ignored: string[], error: string|null }}
 */
export function checkBundles({ dshHome, appRoot = '/opt/dsh', execPath = process.execPath, spawn = spawnSync, timeout = 8000 }) {
  const dir = profileDir(dshHome)
  const child = spawn(execPath, [WORKER, appRoot, dir], { encoding: 'utf8', timeout, windowsHide: true })
  if (child.error) return { state: 'unknown', fatal: [], ignored: [], error: String(child.error.message ?? child.error) }
  const line = String(child.stdout ?? '').trim().split('\n').filter(Boolean).at(-1) ?? ''
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    return { state: 'unknown', fatal: [], ignored: [], error: (String(child.stderr ?? '').trim() || '加载校验没有输出').slice(0, 300) }
  }
  if (parsed.ok !== true) return { state: 'unknown', fatal: [], ignored: [], error: String(parsed.error ?? '加载校验失败').slice(0, 300) }
  const managed = new Set(TAVERN_BUNDLES)
  const skipped = Array.isArray(parsed.skipped) ? parsed.skipped : []
  const fatal = skipped.filter(item => managed.has(item.packageName))
  const ignored = skipped.filter(item => !managed.has(item.packageName)).map(item => item.packageName)
  return { state: fatal.length > 0 ? 'fatal' : 'ok', fatal, ignored, error: null }
}

/** 面板/toast 用的一句话。unknown 不当成失败，只是没验成。 */
export function preflightHint(result, zh) {
  if (result.state === 'ok') return zh ? '宿主会加载这 8 个 bundle' : 'The host will load all 8 bundles'
  if (result.state === 'fatal') {
    const names = result.fatal.map(item => item.packageName).join('、')
    return zh ? `宿主会跳过 ${names}，装上也是白装` : `The host would skip ${names}`
  }
  return zh ? `没能完成加载校验：${result.error ?? '未知原因'}` : `Load check did not finish: ${result.error ?? 'unknown'}`
}

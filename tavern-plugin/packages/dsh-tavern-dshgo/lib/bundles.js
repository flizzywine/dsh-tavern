import { closeSync, openSync, copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TAVERN_BUNDLES, profileDir } from './status.js'

/** 与 dsh-go 的 SafeMode / LastKnownGood 用同一个锁名，避免和 App 抢着改 package.json。 */
export const LOCK_FILE = 'package.json.lock'
/** 停用/还原用的一次性快照；只在第一次启用前写，之后不覆盖。 */
export const BACKUP_FILE = 'package.json.tavern-backup'

function manifestPath(dir) {
  return join(dir, 'package.json')
}

function readManifest(dir, read = readFileSync) {
  const file = manifestPath(dir)
  const manifest = JSON.parse(read(file, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${file} 不是 JSON 对象`)
  }
  if (manifest.dsh === undefined) manifest.dsh = {}
  if (manifest.dsh === null || typeof manifest.dsh !== 'object' || Array.isArray(manifest.dsh)) {
    throw new Error(`${file} 的 dsh 字段不是对象`)
  }
  if (manifest.dsh.profile === undefined) manifest.dsh.profile = {}
  if (manifest.dsh.profile === null || typeof manifest.dsh.profile !== 'object' || Array.isArray(manifest.dsh.profile)) {
    throw new Error(`${file} 的 dsh.profile 字段不是对象`)
  }
  if (!Array.isArray(manifest.dsh.profile.bundles)) manifest.dsh.profile.bundles = []
  return manifest
}

export function mergeBundles(current, add) {
  const out = [...current]
  for (const name of add) if (!out.includes(name)) out.push(name)
  return out
}

/** 按 TAVERN_BUNDLES 的顺序追加，已存在的不重复。 */
export function planEnable(manifest) {
  const next = structuredClone(manifest)
  next.dsh.profile.bundles = mergeBundles(next.dsh.profile.bundles, TAVERN_BUNDLES)
  return next
}

/** 只摘掉酒馆的 bundle，其余（含 @deepseek-ai/* 与用户自己装的）原样保留。 */
export function planDisable(manifest) {
  const next = structuredClone(manifest)
  const remove = new Set(TAVERN_BUNDLES)
  next.dsh.profile.bundles = next.dsh.profile.bundles.filter(name => !remove.has(name))
  return next
}

export function isEnabled(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  return Array.isArray(bundles) && TAVERN_BUNDLES.every(name => bundles.includes(name))
}

/**
 * 独占 + 原子写。锁协议照抄 dsh-go 的 SafeMode.kt：`package.json.lock` 用 wx 创建并写入 pid，
 * 结束即删；落盘走 tmp + rename，避免 App 读到半个文件。
 */
export function withLock(dir, fn, io = { openSync, closeSync, writeFileSync, unlinkSync }) {
  const lock = join(dir, LOCK_FILE)
  let fd
  try {
    fd = io.openSync(lock, 'wx', 0o600)
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('App 正在改这份配置（package.json.lock 存在），稍后再试；若一直存在，说明上次改动被中断，删掉这个锁再来一次。')
    }
    throw error
  }
  try {
    io.writeFileSync(fd, `${process.pid}\n`)
    return fn()
  } finally {
    io.closeSync(fd)
    try {
      io.unlinkSync(lock)
    } catch {
      // 锁已经不在，说明被外部清理了，不必再报。
    }
  }
}

export function writeProfile(dir, manifest, io = { renameSync, writeFileSync }) {
  const file = manifestPath(dir)
  const temporary = `${file}.tavern-tmp`
  io.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  io.renameSync(temporary, file)
}

/** 启用前留一份安装前快照；已有快照时不覆盖，保证停用能回到最初的样子。 */
export function snapshotProfile(dir, fs = { existsSync, copyFileSync }) {
  const backup = join(dir, BACKUP_FILE)
  if (fs.existsSync(backup)) return false
  fs.copyFileSync(manifestPath(dir), backup)
  return true
}

export function restoreProfile(dir, io = { renameSync, copyFileSync }, fs = { existsSync }) {
  const backup = join(dir, BACKUP_FILE)
  if (!fs.existsSync(backup)) throw new Error('没有启用前的快照，无法还原')
  const temporary = `${manifestPath(dir)}.tavern-restore`
  io.copyFileSync(backup, temporary)
  io.renameSync(temporary, manifestPath(dir))
}

/**
 * 在锁内完成一次改动。
 * @param {{ home: string, apply: (manifest: object) => object, beforeFirstChange?: boolean }} options
 * @returns {{ changed: boolean, bundles: string[] }}
 */
export function updateProfile({ home, apply, beforeFirstChange = false }, io) {
  const dir = profileDir(home)
  return withLock(dir, () => {
    const manifest = readManifest(dir)
    const before = manifest.dsh.profile.bundles.slice()
    if (beforeFirstChange) snapshotProfile(dir)
    const next = apply(manifest)
    const after = next.dsh.profile.bundles
    if (after.length === before.length && after.every((name, index) => name === before[index])) {
      return { changed: false, bundles: after }
    }
    writeProfile(dir, next)
    return { changed: true, bundles: after }
  }, io)
}

export { manifestPath, readManifest }

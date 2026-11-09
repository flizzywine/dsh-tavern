import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

/**
 * 酒馆的全部用户数据都在 <DSH_HOME>/profile-data/tavern（角色卡、世界书、预设、游玩存档）。
 * dsh-go 的「重置引擎」只保留 ResetKeep 里的六个路径，profile-data 不在其中，
 * 而 ~/.dsh/dsh-go 是被保留的。所以把数据目录实体放到 dsh-go 下，profile-data/tavern 只留链接。
 */
export const DATA_DIR_NAME = 'tavern-data'

export function dataHomePaths(dshHome) {
  const target = join(dshHome, 'dsh-go', DATA_DIR_NAME)
  const link = join(dshHome, 'profile-data', 'tavern')
  return { target, link }
}

function linkTarget(link, io) {
  try {
    return resolve(dirname(link), io.readlinkSync(link))
  } catch {
    return null
  }
}

/**
 * 不写文件的检查。
 * @returns {{ state: 'linked'|'absent'|'directory'|'other-link'|'unreadable', target: string, link: string, current: string|null }}
 */
export function inspectDataHome(dshHome, io = { existsSync, lstatSync, readlinkSync, realpathSync }) {
  const { target, link } = dataHomePaths(dshHome)
  let stat
  try {
    stat = io.lstatSync(link)
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'absent', target, link, current: null }
    return { state: 'unreadable', target, link, current: null }
  }
  if (!stat.isSymbolicLink()) return { state: 'directory', target, link, current: null }
  const current = linkTarget(link, io)
  if (current === null) return { state: 'unreadable', target, link, current: null }
  return { state: current === resolve(target) ? 'linked' : 'other-link', target, link, current }
}

/**
 * 需要时装上链接。已有实体目录（老安装、已存过档）一律不动，交给用户迁移。
 * @returns {{ changed: boolean, state: string, target: string, link: string }}
 */
export function ensureDataHome(dshHome, io = { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync }) {
  const found = inspectDataHome(dshHome, io)
  if (found.state === 'directory' || found.state === 'other-link' || found.state === 'unreadable') {
    return { changed: false, state: found.state, target: found.target, link: found.link }
  }
  if (!io.existsSync(found.target)) io.mkdirSync(found.target, { recursive: true })
  if (found.state === 'linked') return { changed: false, state: 'linked', target: found.target, link: found.link }
  io.mkdirSync(dirname(found.link), { recursive: true })
  // 相对链接：整个 .dsh 被搬走或改名后仍然有效。
  io.symlinkSync(relative(dirname(found.link), found.target), found.link)
  return { changed: true, state: 'linked', target: found.target, link: found.link }
}

/** 面板文案：一句状态 + 一句该怎么办。 */
export function dataHomeHint(found, zh) {
  switch (found.state) {
    case 'linked':
      return zh ? '存档在 dsh-go 下，重置引擎不会删' : 'Data lives under dsh-go; engine reset keeps it'
    case 'absent':
      return zh ? '存档目录还没挂到 dsh-go 下，启用时会自动建' : 'Data link missing; enabling will create it'
    case 'directory':
      return zh
        ? '存档还是实体目录，重置引擎会删：先把它移到 dsh-go/tavern-data 再启用'
        : 'Data is still a real directory and engine reset deletes it; move it under dsh-go/tavern-data first'
    case 'other-link':
      return zh
        ? `存档目录指向别处（${found.current ?? '未知'}），未改动`
        : `Data link points elsewhere (${found.current ?? 'unknown'}); left untouched`
    default:
      return zh ? '读不到存档目录，未改动' : 'Cannot read the data directory; left untouched'
  }
}

import path from 'node:path'
import {mkdir, open, readFile, rename, stat, unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {checkedAssetPath} from './card-storage.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check} = contract

// a mod's own pack media. Bytes are written once, synced, under a fresh name, and only
// then may a pack revision (CAS) reference them, so private metadata never points at unwritten media. No hashing; the
// archive boundary owns transfer digests. Built-in release files are read from the static first-party release.
export const MOD_MEDIA_LIMIT = 512 * 1024
const TYPES = {'image/png':'png','image/webp':'webp','image/jpeg':'jpg','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav'}
export const MOD_MEDIA_MIME = Object.freeze(Object.fromEntries(Object.entries(TYPES).map(([mime,ext]) => [ext,mime])))
const MIME = MOD_MEDIA_MIME
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const MOD_MEDIA_PATH = /^media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|webp|jpg|mp3|ogg|wav)$/
const ascii = (bytes, at, text) => bytes.length >= at + text.length && bytes.toString('latin1', at, at + text.length) === text
const sniff = {
  png:b => ascii(b,0,'\x89PNG\r\n\x1a\n'), webp:b => ascii(b,0,'RIFF') && ascii(b,8,'WEBP'), jpg:b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  mp3:b => ascii(b,0,'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), ogg:b => ascii(b,0,'OggS'), wav:b => ascii(b,0,'RIFF') && ascii(b,8,'WAVE'),
}

export function decodeModMedia({mime,data}) {
  const ext = TYPES[mime]
  check(ext && typeof data === 'string' && data.length <= Math.ceil(MOD_MEDIA_LIMIT / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(data), '$.mime', 'Unsupported media type or size')
  const bytes = Buffer.from(data, 'base64')
  check(bytes.length > 0 && bytes.length <= MOD_MEDIA_LIMIT, '$.data', 'Media size limit', 'MOD_RESOURCE_UNAVAILABLE')
  check(sniff[ext](bytes), '$.data', 'Media content does not match its type')
  return {bytes,ext}
}

export function createModMediaStore({root, builtinFile = () => null, ownedFile = async () => null}) {
  root = path.resolve(root)
  const identity = (modId, packId) => {
    check(typeof modId === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(modId) && modId.length <= 128, '$.modId')
    check(typeof packId === 'string' && uuid.test(packId), '$.packId')
  }
  const locate = (modId, packId, file) => checkedAssetPath(root, ['media', modId, packId, file].join('/'))
  async function put({modId, packId, mime, data}) {
    identity(modId, packId)
    const {bytes,ext} = decodeModMedia({mime,data})
    const file = 'media/' + randomUUID() + '.' + ext, target = await locate(modId, packId, file), temporary = target + '.' + randomUUID() + '.tmp'
    await mkdir(path.dirname(target), {recursive:true})
    const handle = await open(temporary, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try { await rename(temporary, target) } catch (error) { await unlink(temporary).catch(() => {}); throw error }
    return {path:file, size:bytes.length}
  }
  // → stored size, or null. Only fresh upload names are eligible; release paths come from the built-in files.
  async function size(modId, packId, file) {
    identity(modId, packId)
    if (!MOD_MEDIA_PATH.test(file)) return (await ownedFile(modId,packId,file) || builtinFile(modId,file,packId))?.length ?? null
    try { return (await stat(await locate(modId, packId, file))).size } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function read(modId, packId, file, expectedSize) {
    identity(modId, packId)
    const ext = /\.([a-z0-9]+)$/.exec(file)?.[1], mime = MIME[ext]
    check(mime, '$.path', 'Unsupported media type')
    let bytes = null
    if (MOD_MEDIA_PATH.test(file)) bytes = await readFile(await locate(modId, packId, file)).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    bytes ||= await ownedFile(modId,packId,file) || builtinFile(modId,file,packId) || null
    check(bytes && (expectedSize===undefined || bytes.length===expectedSize), '$.path', 'Media is unavailable or has the wrong size', 'MOD_RESOURCE_UNAVAILABLE')
    return {mime, data:Buffer.from(bytes).toString('base64')}
  }
  return Object.freeze({put, size, read})
}

// Resolve pack-local paths through their actual release directory, including copied installations.
export function createLibraryModMedia({root,library,builtins}) {
  const declarations=new Map()
  return createModMediaStore({root,
    builtinFile(modId,file,packId) {
      const installed=library.snapshot().mods[modId]
      if(!installed)return null
      const builtinId=installed.origin?.builtinId || modId
      if(!declarations.has(builtinId)) {
        const manifest=builtins.manifest(builtinId),names=new Set(manifest.defaultPacks)
        // Non-default bundled packs can remain installed for references without being installed on fresh profiles.
        for(const file of manifest.files)if(/^packs\/[^/]+\.json$/.test(file.path))names.add(file.path)
        declarations.set(builtinId,[...names].map(name=>({name,pack:JSON.parse(builtins.file(builtinId,name).toString('utf8'))})))
      }
      const source=declarations.get(builtinId).find(row=>(installed.origin?.packIds?.[row.pack.id] || row.pack.id)===packId)
      if(!source || !source.pack.files.some(row=>row.path===file))return null
      return builtins.file(builtinId,path.posix.join(path.posix.dirname(source.name),file))
    },
    async ownedFile(modId,packId,file) {
      const content=library.snapshot().mods[modId]?.content?.packs?.[packId]
      if(!content)return null
      check(uuid.test(content),'$.content','Media owner is unavailable','MOD_RESOURCE_UNAVAILABLE')
      return readFile(await checkedAssetPath(root,'content/'+content+'/'+file))
    },
  })
}

// Management view: pack saves may reference new media only after the store confirms the exact written size.
export function withModMedia(library, media) {
  const pack = (modId, packId) => {
    const row = library.snapshot().mods[modId]
    check(row, '$.modId', 'Mod is not installed', 'MOD_RESOURCE_UNAVAILABLE')
    return row.packs[packId] || null
  }
  return Object.freeze({...library,
    async putModMedia({modId, packId, mime, data}) { pack(modId, packId); return media.put({modId, packId, mime, data}) },
    async readModMedia({modId, packId, path: file}) {
      const found = pack(modId, packId)
      const declared=found?.files.find(row=>row.path===file)
      check(declared, '$.path', 'Media is not part of this pack', 'MOD_RESOURCE_UNAVAILABLE')
      return media.read(modId, packId, file, declared.size)
    },
    async saveModPack(args) {
      const files = args?.pack?.files
      check(Array.isArray(files) && files.length <= 2048 && typeof args.pack.id === 'string', '$.pack.files')
      const before = new Map((pack(args.modId, args.pack.id)?.files || []).map(row => [row.path, row.size]))
      for (const file of files) {
        check(file && typeof file.path === 'string' && Number.isSafeInteger(file.size), '$.pack.files')
        if (before.get(file.path) !== file.size) check(await media.size(args.modId, args.pack.id, file.path) === file.size, '$.pack.files', 'Media is not stored', 'MOD_RESOURCE_UNAVAILABLE')
      }
      return library.saveModPack({...args, mediaVerified:true})
    },
  })
}

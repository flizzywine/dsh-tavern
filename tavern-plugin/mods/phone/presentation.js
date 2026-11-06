import {isDeepStrictEqual} from 'node:util'
import manifest from './mod.json' with {type:'json'}
import audioLoudness from './audio-loudness.json' with {type:'json'}
import {withBuiltinPhoneDevice,phoneDevices} from './logic.js'
import {phonePresentation,phoneViewDocument} from './source-view.js'

const hasRef=ref=>ref && Object.keys(ref).length>0

// The original media owner resolves references; this module never opens a path or a URL.
export async function renderPhone({catalogue={},view},host,{values}) {
  const devices=phoneDevices(withBuiltinPhoneDevice(catalogue))
  view ||= {device:devices[0]}
  if(!devices.some(ref=>isDeepStrictEqual(ref,view.device)))return []
  const files=new Map(await Promise.all(manifest.coreAssets.filter(row=>row.path.startsWith('view/') && !row.path.startsWith('view/assets/'))
    .map(async row=>[row.path,await host.assets.core(row.id)])))
  // 墙纸: a picture of the phone's 照片 the player chose ({file}); else the card/skin default reference; else none
  // (the view's built-in wallpaper).
  const wallpaper=values.wallpaper?.file?await host.assets.upload('wallpaper'):hasRef(values.defaultWallpaperRef)?await host.assets.resolve(values.defaultWallpaperRef):null
  const sound=!values.muted && values.volume>0 && values.sound!=='none'
  const item=phonePresentation({view,document:phoneViewDocument(files),version:manifest.version,wallpaper,
    // callVideo: the FaceTime view this mod declares (mod.json); the page offers FaceTime only with it.
    settings:{...values,sound,...(manifest.callVideo?{callVideo:manifest.callVideo}:{})}})
  item.mediaPolicy.sfx=sound
  for(const [alias,contact] of Object.entries(values.contacts)) {
    if(hasRef(contact.avatarRef))item.definition.inlineSettingAssets['contact:'+alias]=await host.assets.resolve(contact.avatarRef)
  }
  if(sound) {
    const tone=hasRef(values.notificationToneRef)?await host.assets.resolve(values.notificationToneRef):{
      kind:'sfx',identity:manifest.id+':'+manifest.version+':'+values.sound,
      loudness:audioLoudness[manifest.coreAssets.find(row=>row.id==='tone-'+values.sound).path],
      url:'data:audio/wav;base64,'+(await host.assets.core('tone-'+values.sound)).toString('base64'),
    }
    item.definition.assets.message={...tone,volume:values.volume}
  }
  return [item]
}

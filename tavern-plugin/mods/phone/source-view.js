import {phoneDevices} from './logic.js'

export function phoneSourceView(catalogue) {
  const device=phoneDevices(catalogue)[0]
  return device ? {device} : null
}

// The first-party source view shares the stage's source/thread/media owner, not the widget catalogue.
export function phoneViewDocument(files) {
  return files.get('view/index.html').toString('utf8')
    .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">')
    .replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+files.get('view/style.css').toString('utf8')+'</style>')
    // every view script is inlined (battery.js holds the battery levels shared with the settings preview).
    .replace(/<script src="([a-z0-9-]+\.js)"><\/script>/g,(_,name)=>'<script>'+files.get('view/'+name).toString('utf8').replace(/<\/script/gi,'<\\/script')+'</script>')
}
export function phonePresentation({view,settings,document,version,wallpaper=null}) {
  return {ref:view.device,sourceOnly:true,modSource:true,state:{},
    mediaPolicy:{music:false,sfx:true},
    definition:{modId:'dsh.phone',title:'手机',thirdParty:true,contentIdentity:'dsh.phone:'+version,srcDoc:document,settings,
      settingAssets:{},inlineSettingAssets:wallpaper?{wallpaper}:{},assets:{},document:{presentation:{
        open:{width:280,height:607,minWidth:220,minHeight:477,anchor:'center-card',aspectRatio:280/607},
        compact:{width:320,height:104,minWidth:220,minHeight:88,anchor:'top-center'},notifications:'changes'}}}}
}

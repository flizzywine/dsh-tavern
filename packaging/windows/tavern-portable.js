import { app, dialog } from 'electron';
import fs from 'original-fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// All persistent files belong to this distribution, including Electron state.
const parent = process.env.DSH_TAVERN_TEST_DATA || path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'),'AppData','Local'), 'DSH-Tavern');
const data = path.resolve(parent);
const home = path.join(data, 'harness');
const userData = path.join(data, 'desktop');
const profile = path.join(home, 'profiles', 'desktop');
const TAVERN_APP_ID = 'ai.deepseek.dsh.tavern';
function refreshLink(link,target) {
  fs.mkdirSync(path.dirname(link),{recursive:true});
  let stat;
  try { stat=fs.lstatSync(link); } catch(e) { if(e.code!=='ENOENT')throw e; }
  if(stat&&!stat.isSymbolicLink())return; // Installed dependencies remain authoritative.
  if(stat)fs.unlinkSync(link);
  fs.symlinkSync(target,link,'junction');
}
try {
  fs.mkdirSync(userData, {recursive:true});
  fs.accessSync(userData, fs.constants.W_OK);
  process.env.DSH_HOME = home;
  // Relocated preinstalled dependencies must be replaced without a terminal prompt.
  process.env.CI='true';
  const {prepare}=createRequire(import.meta.url)('../../official-desktop-runtime.cjs');
  Object.assign(process.env,prepare({executable:process.execPath,home}));
  app.setPath('userData', userData);
  // Windows groups taskbar buttons, pins and notifications by AppUserModelID. The
  // bundled Desktop claims the stock DSH Desktop id, so a running Tavern absorbed
  // the user's own DSH Desktop pin: clicking it focused Tavern instead of launching
  // Desktop, and pinning Tavern replaced that pin. Keep a distinct identity; the
  // launcher writes the same id into the DSH Tavern shortcuts.
  if (process.platform === 'win32') {
    const setAppUserModelId = app.setAppUserModelId.bind(app);
    app.setAppUserModelId = () => setAppUserModelId(TAVERN_APP_ID);
    setAppUserModelId(TAVERN_APP_ID);
  }
  // Restart the outer launcher so its cleanup cannot remove a relaunched runtime.
  if(process.env.PORTABLE_EXECUTABLE_FILE) {
    const relaunch=app.relaunch.bind(app);
    app.relaunch=(options={})=>relaunch({...options,execPath:process.env.PORTABLE_EXECUTABLE_FILE,
      args:options.args||process.argv.slice(1)});
  }
  // Use the same lock as Desktop, before creating or changing profile files.
  if (!app.requestSingleInstanceLock()) app.exit(0);
  else {
    const source=path.join(home,'apps','dsh-tavern');
    if(!fs.existsSync(path.join(source,'package.json'))||fs.existsSync(path.join(source,'.portable-install-pending.json')))throw new Error('首次安装尚未完成，请重新打开 EXE 联网安装。');
    process.env.DSH_TAVERN_APP_DIR=source;
    process.env.DSH_TAVERN_RUNTIME_HOST='desktop';
    const portableLinks=path.join(source,'portable-links.json');
    if(fs.existsSync(portableLinks))for(const item of JSON.parse(fs.readFileSync(portableLinks,'utf8'))) {
      const link=path.resolve(source,item.link),target=path.resolve(source,item.target);
      if(!link.startsWith(source+path.sep)||!target.startsWith(source+path.sep))throw new Error('Invalid portable package link');
      if(fs.existsSync(target))refreshLink(link,target);
    }
    if (!fs.existsSync(path.join(profile,'package.json'))) throw new Error('官方 Desktop 配置尚未安装，请重新运行安装包。');
    const settings=path.join(home,'settings.yaml');
    if (!fs.existsSync(settings)) fs.writeFileSync(settings,JSON.stringify({
      'dsh-tavern':{sidebarDefaultsVersion:8},
      'dsh-better-sidebar':{openByDefault:true,defaultWidthPercent:30,
        tabsEnabled:{editor:true,git:false,subagent:false,terminal:false,browser:false,diff:false,
          'dsh-tavern:resources':true,'dsh-tavern:presets':true,'dsh-tavern:cards':true,'dsh-tavern:status':true},
        viewersEnabled:{image:false,pdf:false,markdown:true,html:false,code:true,'binary-download':false}}
    },null,2),{flag:'wx'});
    const workspace=path.join(data,'workspace');
    fs.mkdirSync(workspace,{recursive:true});
    process.chdir(workspace);
    // Refresh module links before composition; extraction paths change between runs.
    const modules=path.join(path.dirname(process.env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR),'node_modules');
    // Host packages use the same explicit links as the Tavern Desktop installer.
    for(const name of ['@deepseek-ai/dsh-agent','@deepseek-ai/dsh-skill-filesystem','@deepseek-ai/dsh-typert-protocol','@deepseek-ai/dsh-subagent','@deepseek-ai/dsh-tools']) {
      refreshLink(path.join(source,'tavern-plugin','node_modules',name),path.join(modules,name));
    }
    const sourceManifest=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
    for(const [name,version] of Object.entries(sourceManifest.dependencies||{})) {
      if(version.startsWith('link:'))refreshLink(path.join(source,'node_modules',name),path.resolve(source,version.slice(5)));
    }
    for(const name of sourceManifest.dsh.profile.bundles) {
      if(!name.startsWith('@deepseek-ai/'))refreshLink(path.join(home,'profiles','node_modules',name),path.join(source,'node_modules',name));
    }
    const installedPlugin=path.join(profile,'node_modules','dsh-tavern-plugin');
    try {
      if(fs.lstatSync(installedPlugin).isSymbolicLink())refreshLink(installedPlugin,path.join(source,'tavern-plugin'));
    } catch(e) { if(e.code!=='ENOENT')throw e; }
    if(process.argv.includes('--tavern-smoke-relaunch')) {
      fs.writeFileSync(path.join(data,'relaunch-request.json'),JSON.stringify({executable:process.execPath}));
      app.relaunch({args:['--tavern-smoke']});
      app.exit(0);
    } else if (process.argv.includes('--tavern-smoke')) {
      const checked=spawnSync(process.execPath,['--expose-internals',path.join(source,'bin','validate-desktop-profile.mjs')],
        {env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
      if(checked.error||checked.status!==0)throw new Error(checked.error?.message||checked.stderr||'Desktop profile composition failed');
      fs.writeFileSync(path.join(data,'smoke-result.json'),JSON.stringify({ok:true,desktop:app.getVersion(),executable:process.execPath,profile},null,2));
      app.exit(0);
    } else await import('./main.js');
  }
} catch(error) {
  try { fs.writeFileSync(path.join(data,'startup-error.txt'),String(error.stack||error)); } catch {}
  dialog.showErrorBox('DSH Tavern 启动失败',`数据目录：${data}\n\n${error.message}`);
  app.exit(1);
}

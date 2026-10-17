import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';

// Bundled bootstrap for both first installation and an explicit Setup upgrade.
// The normal installed entry does not call this after a successful upgrade.
const resources=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.argv[2]);
const home=path.join(data,'harness');
const source=path.join(home,'apps','dsh-tavern');
const log=path.join(data,'setup-upgrade.log');
fs.mkdirSync(data,{recursive:true});
// The launcher shows stderr in its error dialog: name the failed stage, a short reason and the log.
let stage='准备安装';
const INSTALLER_STEPS={'dependencies.install':'安装依赖','profile.install':'注册 Tavern','source.files':'下载代码','service.start':'启动服务'};
const download=createRequire(import.meta.url)('./download.cjs');
// The last lines a failed step printed usually carry its actual error (stack frames and
// the diagnostics pointer excluded); without them the dialog only says which step failed.
function failureReason(lines){
  const kept=lines.map(line=>line.trim()).filter(line=>line&&!/^at\s/.test(line)&&!line.startsWith('诊断日志：')&&!line.startsWith('At ')&&!/^[+~]/.test(line)&&!/^(CategoryInfo|FullyQualifiedErrorId)\b/.test(line));
  const tail=kept.slice(-6).join('\n');
  return tail?'\n原因：'+(tail.length>600?'…'+tail.slice(-600):tail):'';
}
try {
  if(process.env.DSH_ONLINE_TEST_OFFLINE==='1')throw Error('测试：网络不可用');
  const env={...process.env,DSH_HOME:home,DSH_TAVERN_HOST:'desktop',DSH_TAVERN_RUNTIME_HOST:'desktop',
    DSH_TAVERN_APP_DIR:source,DSH_DESKTOP_APP_EXECUTABLE:process.execPath,
    CI:'true',pnpm_config_frozen_lockfile:'false',
    npm_config_cache:path.join(data,'cache','npm'),pnpm_config_store_dir:path.join(data,'cache','pnpm')};
  // Translate the Windows system proxy for this process and every child (powershell, curl, git, pnpm).
  const proxy=download.applyProxyEnvironment(env);
  if(proxy.summary){const text=(proxy.source==='system'?'使用系统代理：':'')+proxy.summary;console.log('DSH_STATUS '+text);fs.appendFileSync(log,text+'\n');}
  stage='配置 DSH 运行环境';
  const {prepare}=createRequire(import.meta.url)('./official-desktop-runtime.cjs');
  Object.assign(env,prepare({executable:process.execPath,home,env}));
  for(const key of Object.keys(env))if(key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete env[key];
  stage='下载并安装酒馆';
  // Run install.ps1 through a small -File wrapper. -EncodedCommand made Windows PowerShell 5.1
  // serialise every Write-Host/warning record as CLIXML into the log; -File keeps plain text.
  // The wrapper is UTF-8 with BOM so 5.1 does not decode it as ANSI, and install.ps1 itself is
  // read explicitly as UTF-8. Do not merge streams with *>&1 under ErrorAction Stop: native
  // stderr (for example Node's EnvHttpProxyAgent warning when NODE_USE_ENV_PROXY=1) becomes a
  // terminating ErrorRecord and aborts install.
  env.DSH_SETUP_INSTALLER=path.join(resources,'install.ps1');
  const wrapper=path.join(data,'setup-installer.ps1');
  fs.writeFileSync(wrapper,'\ufeff'+["$ErrorActionPreference='Stop'","$ProgressPreference='SilentlyContinue'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)','$OutputEncoding=[Console]::OutputEncoding',
    'try { Invoke-Expression ([IO.File]::ReadAllText($env:DSH_SETUP_INSTALLER,[Text.Encoding]::UTF8)) }',
    'catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }',''].join('\r\n'));
  console.log('DSH_STATUS 正在检查更新与下载源…');
  const output=fs.openSync(log,'a');
  let code,installerFailure='';const failureDetail=[];
  try {
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',wrapper],
      {env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    // Preserve diagnostics, but only forward structured status and package counts.
    // Arbitrary command output can contain private paths or registry credentials.
    for(const stream of [child.stdout,child.stderr]) {
      stream.on('data',chunk=>fs.writeSync(output,chunk));
      createInterface({input:stream,crlfDelay:Infinity}).on('line',line=>{
        if(line.startsWith('DSH_STATUS '))console.log(line);
        // install.ps1 ends with one curated summary line; later output never replaces it.
        if(!installerFailure&&line.startsWith('安装失败：'))installerFailure=line.slice(5);
        // The summary line only names the step; the failed command's own output follows it.
        else if(installerFailure)failureDetail.push(line);
        const progress=line.match(/Progress: resolved (\d+), reused (\d+), downloaded (\d+), added (\d+)/);
        if(progress)console.log(`DSH_STATUS 安装依赖：已下载 ${progress[3]}，复用 ${progress[2]}，已安装 ${progress[4]}（已解析 ${progress[1]}）`);
        if(/WARN.*(?:retry|ETIMEDOUT|ECONNRESET|ENOTFOUND|ERR_SOCKET)/i.test(line))console.log('DSH_STATUS 依赖下载遇到网络错误，包管理器正在重试；详细原因见日志。');
      });
    }
    code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  } finally {fs.closeSync(output);fs.rmSync(wrapper,{force:true})}
  if(code!==0)throw Error(installerFailure
    ? (installerFailure.replace(/步骤 ([a-z.-]+) 失败/,(match,step)=>INSTALLER_STEPS[step]?`${INSTALLER_STEPS[step]}（${step}）失败`:match)+failureReason(failureDetail)).replace(/\/\/[^\s/@]+@/g,'//')
    : '安装或更新失败');
  // Older online installers may have left a pending first-install marker.
  fs.rmSync(path.join(source,'.portable-install-pending.json'),{force:true});
  console.log('DSH_STATUS Tavern 安装或更新完成');
} catch(error) {
  const chain=[];for(let item=error,depth=0;item&&depth<5;item=item.cause,depth++)chain.push(depth?'Caused by: '+String(item.stack||item):String(item.stack||item));
  fs.appendFileSync(log,`[${stage}] `+chain.join('\n')+'\n');
  const reason=/[\u4e00-\u9fff]/.test(error.message)?error.message:download.describeFailure(error);
  console.error(`${stage}失败：${reason.length>1200?reason.slice(0,1200)+'…':reason}\n详细日志：${log}`);
  process.exitCode=1;
}

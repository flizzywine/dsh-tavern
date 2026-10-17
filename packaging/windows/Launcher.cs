using System;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Text;
using System.Xml.Linq;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Collections.Generic;

class Launcher : Form {
 // build.ps1 rewrites both payload values for the payload it embeds; the defaults here are the last published payload.
 const string PayloadSha256="a272f20b3f1f5b15d2b8b05d22259e7e97597f47dfc01ee79291e34479d5cea4";
 // Bump the suffix for any embedded runtime/bootstrap change; never patch a running installation.
 const string Version="a272f20b3f1f5b15-setup8";
 // Must match TAVERN_APP_ID in tavern-portable.js: shortcut and windows share one taskbar identity.
 const string AppUserModelId="ai.deepseek.dsh.tavern";
 Label label=new Label(), activity=new Label(); ProgressBar bar=new ProgressBar();
 Button logs=new Button(); System.Windows.Forms.Timer progressTimer=new System.Windows.Forms.Timer();
 Stopwatch elapsed=Stopwatch.StartNew(); TimeSpan lastProgress=TimeSpan.Zero; string lastStatus="";
 string root, runtime, data; string[] args;
 string installedLauncher; bool showCompletion, installationSelected;
 const string LauncherName="DSH Tavern.exe";
 const string SettingsName="launcher-settings.xml";
 static string TestRoot { get { return Environment.GetEnvironmentVariable("DSH_LAUNCHER_TEST_ROOT"); } }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr GetEnvironmentStringsW();
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool FreeEnvironmentStringsW(IntPtr block);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetEnvironmentVariableW(string name, string value);
 // ProcessStartInfo copies the environment into a case-insensitive dictionary and throws if both NO_PROXY and no_proxy exist.
 static void RepairDuplicateEnvironmentVariables() {
  for(int pass=0; pass<8; pass++) {
   var names=new List<string>(); var values=new List<string>();
   IntPtr block=GetEnvironmentStringsW(); if(block==IntPtr.Zero)return;
   try {
    IntPtr current=block;
    while(true) {
     string entry=Marshal.PtrToStringUni(current);
     if(string.IsNullOrEmpty(entry))break;
     current=IntPtr.Add(current,(entry.Length+1)*2);
     if(entry[0]=='=')continue;
     int split=entry.IndexOf('='); if(split<=0)continue;
     names.Add(entry.Substring(0,split)); values.Add(entry.Substring(split+1));
    }
   } finally { FreeEnvironmentStringsW(block); }
   var first=new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
   var count=new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
   for(int i=0;i<names.Count;i++) {
    int n; if(!count.TryGetValue(names[i], out n)) { count[names[i]]=1; first[names[i]]=i; }
    else count[names[i]]=n+1;
   }
   bool duplicate=false;
   foreach(var pair in count) {
    if(pair.Value<2)continue;
    duplicate=true; int index=first[pair.Key];
    for(int n=0;n<pair.Value;n++) SetEnvironmentVariableW(names[index], null);
    SetEnvironmentVariableW(names[index], values[index]);
   }
   if(!duplicate)return;
  }
 }
 [STAThread] static void Main(string[] args) {
  RepairDuplicateEnvironmentVariables();
  Application.EnableVisualStyles(); Application.Run(new Launcher(args));
 }
 Launcher(string[] a) {
  args=a; Text="DSH Tavern"; ClientSize=new Size(560,205); StartPosition=FormStartPosition.CenterScreen;
  FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false; ControlBox=false;
  label.SetBounds(20,18,520,48); label.Text="正在检查运行文件…"; Controls.Add(label);
  bar.SetBounds(20,75,520,18); bar.Style=ProgressBarStyle.Marquee; Controls.Add(bar);
  activity.SetBounds(20,105,520,52); Controls.Add(activity);
  logs.SetBounds(20,164,110,28); logs.Text="查看更新日志"; logs.Enabled=false; Controls.Add(logs);
  logs.Click+=delegate {try {string file=Path.Combine(data,"setup-upgrade.log");if(File.Exists(file))Process.Start(new ProcessStartInfo("notepad.exe",Quote(file)){UseShellExecute=false});}catch(Exception e){MessageBox.Show(e.Message,"无法打开日志");}};
  progressTimer.Interval=1000;
  progressTimer.Tick+=delegate {
   var idle=elapsed.Elapsed-lastProgress;
   activity.Text="已用时 "+(int)elapsed.Elapsed.TotalMinutes+" 分 "+elapsed.Elapsed.Seconds+" 秒 · 距上次状态变化 "+(int)idle.TotalSeconds+" 秒\n"+
    (idle.TotalSeconds>=60?"暂未收到新进展；可能在等待网络或本地处理，可查看日志判断。":"按实际步骤显示；下载、安装和本地配置耗时不同。");
   logs.Enabled=data!=null&&File.Exists(Path.Combine(data,"setup-upgrade.log"));
  };
  progressTimer.Start(); FormClosed+=delegate {progressTimer.Dispose();};
  Shown+=async delegate { while(true) {try {
   if(!installationSelected){if(!SelectInstallation()){Close();return;}installationSelected=true;elapsed.Restart();lastProgress=TimeSpan.Zero;}
   await Task.Run((Action)Run);
   try{File.Delete(Path.Combine(root,"launcher-error.txt"));}catch{}
   if(showCompletion&&TestRoot==null)MessageBox.Show("安装完成，酒馆已启动。\n\n以后请从桌面或开始菜单打开「DSH Tavern」。\n\n程序位置："+root+"\n数据位置："+data+"\n\n下载的安装包可以删除。请勿直接运行 runtime 文件夹中的 DeepSeek Harness.exe。", "DSH Tavern",MessageBoxButtons.OK,MessageBoxIcon.Information);
   Close(); return; } catch(Exception e) {
   try {Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,"launcher-error.txt"),e.ToString());}catch{}
   if(TestRoot!=null){Environment.ExitCode=1;Close();return;}
   progressTimer.Stop();
   if(MessageBox.Show("启动失败："+e.Message+"\n\n文件位置："+root,"DSH Tavern",MessageBoxButtons.RetryCancel,MessageBoxIcon.Warning)==DialogResult.Retry){elapsed.Restart();lastProgress=TimeSpan.Zero;lastStatus="";progressTimer.Start();continue;}
   Environment.ExitCode=1; Close(); return;
  }}};
 }
 static bool SamePath(string a,string b) { return string.Equals(Path.GetFullPath(a).TrimEnd('\\','/'),Path.GetFullPath(b).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase); }
 static bool HasInstallation(string path) {
  return Directory.Exists(path)&&(File.Exists(Path.Combine(path,SettingsName))||Directory.Exists(Path.Combine(path,"data","harness"))||Directory.Exists(Path.Combine(path,"harness"))||Directory.GetDirectories(path,"runtime-*").Length>0);
 }
 static string ReadRegisteredRoot() {
  using(var key=Registry.CurrentUser.OpenSubKey(@"Software\DSH-Tavern"))return key==null?null:key.GetValue("InstallRoot") as string;
 }
 bool SelectInstallation() {
  string beside=Path.GetDirectoryName(Application.ExecutablePath);
  string selected=null; bool freshInstallation=false;
  if(File.Exists(Path.Combine(beside,SettingsName)))selected=beside;
  else if(TestRoot!=null)selected=Path.GetFullPath(TestRoot);
  else {
   string registered=ReadRegisteredRoot();
   if(!string.IsNullOrEmpty(registered)) {
    if(HasInstallation(registered))selected=registered;
    else using(var recovery=new MissingInstallationDialog(registered,HasInstallation)) {
     if(recovery.ShowDialog(this)!=DialogResult.OK)return false;
     selected=recovery.ExistingRoot;
     freshInstallation=selected==null;
    }
   }
   else foreach(string old in new[]{@"D:\Workspace\.DSH-Tavern",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern-Portable"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern")}) {
    if(HasInstallation(old)){selected=old;break;}
   }
  }
  bool existing=selected!=null&&HasInstallation(selected);
  bool ownEntry=selected!=null&&SamePath(Application.ExecutablePath,Path.Combine(selected,LauncherName));
  if(TestRoot==null&&!ownEntry) {
   using(var setup=new SetupDialog(selected??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern"),existing)) {
    if(setup.ShowDialog(this)!=DialogResult.OK)return false;
    selected=setup.InstallRoot;
   }
   showCompletion=true;
  }
  root=Path.GetFullPath(selected);runtime=Path.Combine(root,"runtime-"+Version);
  installedLauncher=Path.Combine(root,LauncherName);
  string settings=Path.Combine(root,SettingsName);
  if(File.Exists(settings)) {
   var doc=XDocument.Load(settings);
   data=(string)doc.Root.Element("DataDirectory");
   if(string.IsNullOrWhiteSpace(data)||!Path.IsPathRooted(data))throw new Exception("启动配置中的数据目录无效："+settings);
   if(!Directory.Exists(data))throw new Exception("原数据目录不存在："+data+"。请恢复原目录后重试。");
  } else {
   data=Path.Combine(root,"data");
   var legacy=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"DSH-Tavern");
   if(!freshInstallation&&TestRoot==null&&!Directory.Exists(data)&&Directory.Exists(Path.Combine(legacy,"harness")))data=legacy;
  }
  return true;
 }
 void SaveEntry() {
  // Install the outer launcher before network access, so failed first installs are retryable.
  if(!SamePath(Application.ExecutablePath,installedLauncher)) {
   string next=installedLauncher+".new";
   File.Copy(Application.ExecutablePath,next,true);
   if(File.Exists(installedLauncher))File.Replace(next,installedLauncher,null);
   else File.Move(next,installedLauncher);
  }
  Directory.CreateDirectory(data);
  string settings=Path.Combine(root,SettingsName);
  if(!File.Exists(settings))new XDocument(new XElement("Installation",new XAttribute("version",1),new XElement("DataDirectory",data))).Save(settings);
  if(TestRoot==null)using(var key=Registry.CurrentUser.CreateSubKey(@"Software\DSH-Tavern"))key.SetValue("InstallRoot",root);
  CreateShortcut(TestRoot==null?Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory):Path.Combine(TestRoot,"Desktop"));
  CreateShortcut(TestRoot==null?Environment.GetFolderPath(Environment.SpecialFolder.Programs):Path.Combine(TestRoot,"StartMenu"));
  File.WriteAllText(Path.Combine(root,"如何启动.txt"),"以后请从桌面或开始菜单打开 DSH Tavern，也可双击本目录的 DSH Tavern.exe。\r\n程序位置："+root+"\r\n数据位置："+data+"\r\n请保留数据目录；不要单独运行 runtime 文件夹中的 DeepSeek Harness.exe。\r\n",Encoding.UTF8);
 }
 // WScript.Shell converts paths to the ANSI code page: on a non-Chinese Windows a Chinese
 // install path or user name becomes '?' and Save fails with E_INVALIDARG. IShellLinkW is Unicode.
 void CreateShortcut(string folder) {
  if(string.IsNullOrWhiteSpace(folder))throw new Exception("无法找到系统快捷方式目录；可从 "+installedLauncher+" 启动。");
  Directory.CreateDirectory(folder);
  var link=(IShellLinkW)new ShellLink();
  try {
   link.SetPath(installedLauncher);
   link.SetWorkingDirectory(root);
   link.SetDescription("打开 DSH Tavern 酒馆");
   link.SetIconLocation(Path.Combine(runtime,"DeepSeek Harness.exe"),0);
   // Without its own AppUserModelID the shortcut is grouped with the user's DSH Desktop.
   var store=(IPropertyStore)link;
   var key=new PropertyKey{FormatId=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),PropertyId=5};
   var value=new PropVariant{Type=31,Pointer=Marshal.StringToCoTaskMemUni(AppUserModelId)};
   try {store.SetValue(ref key,ref value);store.Commit();}
   finally {Marshal.FreeCoTaskMem(value.Pointer);}
   ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Save(Path.Combine(folder,"DSH Tavern.lnk"),true);
  } finally {Marshal.FinalReleaseComObject(link);}
 }
 void Status(string text,int percent=-1) { BeginInvoke((Action)(()=>{if(text!=lastStatus){lastProgress=elapsed.Elapsed;lastStatus=text;}label.Text=text;bar.Style=percent<0?ProgressBarStyle.Marquee:ProgressBarStyle.Continuous;if(percent>=0)bar.Value=Math.Min(100,percent);})); }
 void Resource(string name,string path) {using(var s=Assembly.GetExecutingAssembly().GetManifestResourceStream(name))using(var f=File.Create(path))s.CopyTo(f);}
 static string Quote(string s) {return "\""+Regex.Replace(s,@"(\\*)""", "$1$1\\\"").TrimEnd('\\')+new string('\\',(s.Length-s.TrimEnd('\\').Length)*2)+"\"";}
 void Run() {
  Directory.CreateDirectory(root);
  File.SetAttributes(root,File.GetAttributes(root)&~FileAttributes.Hidden);
  using(var mutex=new Mutex(false,"Local\\DSHTavernPrepare-Online")) {
   Status("正在等待运行文件准备完成…"); bool locked=false;
   try {try {locked=mutex.WaitOne();}catch(AbandonedMutexException){locked=true;}
    runtime=ChooseRuntime(root);
    if(Array.IndexOf(args,"--prepare-only")<0 && NeedsUpgrade()) StopInstallationProcesses();
    SaveEntry();
    if(!IsRuntimeReady(runtime)) {
     Status("首次准备运行环境，后续启动无需重复解压…");
     var stage=Path.Combine(root,"preparing-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
     try {
     PrepareRuntime(runtime,delegate(string app) {
     var archive=Path.Combine(stage,"payload.7z");var seven=Path.Combine(stage,"7za.exe");
     Resource("payload",archive);Resource("seven",seven);
     using(var sha=SHA256.Create())using(var f=File.OpenRead(archive)) {
      var h=BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant();
      if(h!=PayloadSha256)throw new Exception("运行包校验失败");
     }
     var pi=new ProcessStartInfo(seven,"x "+Quote(archive)+" -o"+Quote(app)+" -y -bsp1 -bso0");
     pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardOutput=true;
     pi.EnvironmentVariables["TEMP"]=stage;pi.EnvironmentVariables["TMP"]=stage;
     using(var p=Process.Start(pi)) {char[] buf=new char[256];int n;while((n=p.StandardOutput.Read(buf,0,buf.Length))>0){var m=Regex.Match(new string(buf,0,n),@"(\d{1,3})%");if(m.Success)Status("首次准备运行环境："+m.Value,int.Parse(m.Groups[1].Value));}p.WaitForExit();if(p.ExitCode!=0)throw new Exception("解压失败，代码 "+p.ExitCode);}
     if(!File.Exists(Path.Combine(app,"DeepSeek Harness.exe")))throw new Exception("运行环境不完整");
     Status("本地处理：解压完成，正在配置运行环境…");
     // Official pnpm runs under Electron; the build payload already contains the Tavern entry.
     Resource("setupUpgrade",Path.Combine(app,@"resources\setup-upgrade.mjs"));
     Resource("downloadModule",Path.Combine(app,@"resources\download.cjs"));
     Resource("powershellInstaller",Path.Combine(app,@"resources\install.ps1"));
     });
     // Payload files may be read-only; Directory.Delete then throws UnauthorizedAccessException
     // ("Access to the path 'DeepSeek Harness.exe' is denied") and can mask a finished prepare.
     } finally {TryDeleteTree(stage);}
    }
    if(Array.IndexOf(args,"--prepare-only")<0)EnsureTavern();
   }finally{if(locked)mutex.ReleaseMutex();}
  }
  if(Array.IndexOf(args,"--prepare-only")>=0)return;
  Status("正在打开 DSH Tavern…"); var start=new ProcessStartInfo(Path.Combine(runtime,"DeepSeek Harness.exe"));
  start.UseShellExecute=false;start.WorkingDirectory=runtime;
  start.EnvironmentVariables["DSH_TAVERN_TEST_DATA"]=data;
  start.EnvironmentVariables["PORTABLE_EXECUTABLE_FILE"]=installedLauncher;
  start.EnvironmentVariables["PORTABLE_EXECUTABLE_DIR"]=root;
  var temp=Path.Combine(root,"temp");Directory.CreateDirectory(temp);start.EnvironmentVariables["TEMP"]=temp;start.EnvironmentVariables["TMP"]=temp;
  start.Arguments=string.Join(" ",Array.ConvertAll(args,Quote));
  start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
  using(var p=Process.Start(start)){if(Array.IndexOf(args,"--tavern-smoke")>=0){p.WaitForExit();if(p.ExitCode!=0)throw new Exception("启动检查失败");}}
 }
 static bool IsRuntimeReady(string path) {
  try {return File.Exists(Path.Combine(path,"DeepSeek Harness.exe"))&&File.ReadAllText(Path.Combine(path,"ready"))==Version;}
  catch(IOException){return false;}
  catch(UnauthorizedAccessException){return false;}
 }
 static string ChooseRuntime(string root) {
  string legacy=Path.Combine(root,"runtime-"+Version);
  if(IsRuntimeReady(legacy))return legacy;
  if(Directory.Exists(root)) {
   var candidates=Directory.GetDirectories(root,"runtime-"+Version+"-*");
   Array.Sort(candidates,StringComparer.OrdinalIgnoreCase);
   foreach(string candidate in candidates)if(IsRuntimeReady(candidate))return candidate;
  }
  return legacy+"-"+Guid.NewGuid().ToString("N");
 }
 static void PrepareRuntime(string runtime,Action<string> prepare) {
  if(Directory.Exists(runtime)||File.Exists(runtime))throw new IOException("运行环境目录已存在："+runtime);
  // Prepare at the final unique path. Renaming a directory containing an open
  // child file can fail with ERROR_ACCESS_DENIED regardless of elevation.
  // The exact ready marker is the commit point; incomplete directories are
  // never selected, even when a scanner prevents best-effort cleanup.
  bool complete=false;
  Directory.CreateDirectory(runtime);
  try {
   prepare(runtime);
   if(!File.Exists(Path.Combine(runtime,"DeepSeek Harness.exe")))throw new IOException("运行环境不完整："+runtime);
   File.WriteAllText(Path.Combine(runtime,"ready"),Version);
   complete=true;
  } finally {if(!complete)TryDeleteTree(runtime);}
 }
 void EnsureTavern() {
  if(!NeedsUpgrade())return;
  File.Delete(Path.Combine(data,".launcher-upgrade-ready"));
  Status("正在联网安装或更新酒馆，保留现有数据…");
  var pi=new ProcessStartInfo(Path.Combine(runtime,"DeepSeek Harness.exe"),"--expose-internals "+Quote(Path.Combine(runtime,@"resources\setup-upgrade.mjs"))+" "+Quote(data));
  pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardOutput=true;pi.RedirectStandardError=true;
  pi.StandardOutputEncoding=Encoding.UTF8;pi.StandardErrorEncoding=Encoding.UTF8;
  pi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"]="1";pi.EnvironmentVariables["NODE_USE_ENV_PROXY"]="1";
  var temp=Path.Combine(root,"temp");Directory.CreateDirectory(temp);pi.EnvironmentVariables["TEMP"]=temp;pi.EnvironmentVariables["TMP"]=temp;
  var errors=new StringBuilder();
  using(var p=new Process()) {
   p.StartInfo=pi;
   p.OutputDataReceived+=(sender,e)=>{if(e.Data!=null&&e.Data.StartsWith("DSH_STATUS "))Status(e.Data.Substring(11));};
   p.ErrorDataReceived+=(sender,e)=>{if(e.Data!=null&&errors.Length<4000)errors.AppendLine(e.Data);};
   p.Start();p.BeginOutputReadLine();p.BeginErrorReadLine();p.WaitForExit();
    if(p.ExitCode!=0)throw new Exception(errors.Length>0?errors.ToString():"安装或更新未完成，请检查网络后重试。");
  }
  File.WriteAllText(Path.Combine(data,".launcher-upgrade-ready"),Version);
 }
 bool NeedsUpgrade() {
  string source=Path.Combine(data,@"harness\apps\dsh-tavern");
  string marker=Path.Combine(data,".launcher-upgrade-ready");
  return showCompletion || !File.Exists(Path.Combine(source,"package.json")) || File.Exists(Path.Combine(source,".portable-install-pending.json")) || !File.Exists(marker) || File.ReadAllText(marker)!=Version;
 }
 bool OwnsDesktop(string executable) {
  if(string.IsNullOrEmpty(executable)||!(string.Equals(Path.GetFileName(executable),"DeepSeek Harness.exe",StringComparison.OrdinalIgnoreCase)||string.Equals(Path.GetFileName(executable),"DSH Desktop.exe",StringComparison.OrdinalIgnoreCase)))return false;
  var directory=Path.GetDirectoryName(Path.GetFullPath(executable));
  return Path.GetFileName(directory).StartsWith("runtime-",StringComparison.OrdinalIgnoreCase) && SamePath(Path.GetDirectoryName(directory),root);
 }
 void StopInstallationProcesses() {
  Status("正在关闭此安装目录中的酒馆，以便更新…");
  var owned=new System.Collections.Generic.List<Process>();
  try {
   foreach(var name in new[]{"DSH Desktop","DeepSeek Harness"}) foreach(var p in Process.GetProcessesByName(name)) {
    bool keep=false;
    try {if(OwnsDesktop(p.MainModule.FileName)){owned.Add(p);keep=true;p.CloseMainWindow();}}
    catch(System.ComponentModel.Win32Exception){throw new Exception("无法检查或关闭运行中的酒馆，请退出此安装的 DSH Tavern 后重试。");}
    catch(InvalidOperationException){}
    finally {if(!keep)p.Dispose();}
   }
   var deadline=DateTime.UtcNow.AddSeconds(10);
   foreach(var p in owned) {
    int remaining=Math.Max(0,(int)(deadline-DateTime.UtcNow).TotalMilliseconds);
    if(!p.WaitForExit(remaining)) {
     if(!OwnsDesktop(p.MainModule.FileName))throw new Exception("酒馆进程位置已改变，请退出后重试。");
     // Kill is denied for a process that is already exiting or runs with higher rights;
     // the first case finishes on its own, the second needs the user to quit it.
     try {p.Kill();}
     catch(System.ComponentModel.Win32Exception){if(!p.WaitForExit(10000))throw new Exception("无法结束运行中的酒馆（可能以管理员身份运行）。请手动退出此安装的 DSH Tavern 后点重试。");}
     catch(InvalidOperationException){}
     if(!p.WaitForExit(10000))throw new Exception("酒馆仍在退出，请稍后重试。");
    }
   }
  } finally {foreach(var p in owned)p.Dispose();}
 }
 static void TryDeleteTree(string path) {
  if(string.IsNullOrEmpty(path)||!Directory.Exists(path))return;
  try {
   foreach(var file in Directory.GetFiles(path,"*",SearchOption.AllDirectories))
    File.SetAttributes(file,FileAttributes.Normal);
   foreach(var directory in Directory.GetDirectories(path,"*",SearchOption.AllDirectories))
    File.SetAttributes(directory,FileAttributes.Normal);
   File.SetAttributes(path,FileAttributes.Normal);
   Directory.Delete(path,true);
  } catch {}
 }
}

[ComImport, Guid("00021401-0000-0000-C000-000000000046")] class ShellLink {}
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
interface IShellLinkW {
 void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
 void GetIDList(out IntPtr list);
 void SetIDList(IntPtr list);
 void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int size);
 void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
 void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int size);
 void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
 void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int size);
 void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
 void GetHotkey(out short hotkey);
 void SetHotkey(short hotkey);
 void GetShowCmd(out int command);
 void SetShowCmd(int command);
 void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
 void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
 void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
 void Resolve(IntPtr window, int flags);
 void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
}

[StructLayout(LayoutKind.Sequential, Pack=4)] struct PropertyKey { public Guid FormatId; public int PropertyId; }
// PROPVARIANT holding a VT_LPWSTR; the string memory stays owned by the caller.
[StructLayout(LayoutKind.Explicit, Size=24)] struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }
[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
interface IPropertyStore {
 void GetCount(out uint count);
 void GetAt(uint index, out PropertyKey key);
 void GetValue(ref PropertyKey key, out PropVariant value);
 void SetValue(ref PropertyKey key, ref PropVariant value);
 void Commit();
}

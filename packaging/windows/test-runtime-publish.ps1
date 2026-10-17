param([Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
$TestDirectory=[IO.Path]::GetFullPath($TestDirectory)
if(Test-Path -LiteralPath $TestDirectory){throw 'Use a new test directory'}
New-Item -ItemType Directory $TestDirectory | Out-Null
@"
using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
class RuntimeStorageTest {
 static object Call(string method,params object[] args) {
  try{return typeof(Launcher).GetMethod(method,BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,args);}
  catch(TargetInvocationException e){throw e.InnerException;}
 }
 static string Choose(string root){return (string)Call("ChooseRuntime",root);}
 static bool Ready(string path){return (bool)Call("IsRuntimeReady",path);}
 static void Prepare(string runtime,Action<string> action){Call("PrepareRuntime",runtime,action);}
 static void Populate(string path){File.WriteAllText(Path.Combine(path,"DeepSeek Harness.exe"),"runtime sentinel");}
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static void Test(string name,Action test,ref int failed){try{test();Console.WriteLine("PASS: "+name);}catch(Exception e){failed++;Console.WriteLine("FAIL: "+name+" "+e);}}
 static int Main(string[] args) {
  string root=args[0];int failed=0;
  string version=(string)typeof(Launcher).GetField("Version",BindingFlags.Static|BindingFlags.NonPublic).GetRawConstantValue();
  Test("permanent file lock permits publication and next launch without moving files",delegate {
   string install=Path.Combine(root,"中文 持续占用");Directory.CreateDirectory(install);string runtime=Choose(install);FileStream held=null;
   try {
    var clock=Stopwatch.StartNew();
    Prepare(runtime,delegate(string app){
     Populate(app);held=new FileStream(Path.Combine(app,"DeepSeek Harness.exe"),FileMode.Open,FileAccess.Read,FileShare.Read);
     try{Directory.Move(app,app+"-move-probe");throw new Exception("Fixture did not prevent move");}
     catch(IOException e){Check(e.HResult==unchecked((int)0x80070005),"Unexpected fixture HRESULT");}
    });
    Check(clock.ElapsedMilliseconds<1000,"Publication waited for a lock that is still held");
    Check(Ready(runtime)&&Choose(install)==runtime,"Prepared runtime was not reusable");
    Check(File.ReadAllText(Path.Combine(runtime,"DeepSeek Harness.exe"))=="runtime sentinel","Runtime changed");
    try{Prepare(runtime,Populate);throw new Exception("Existing runtime was overwritten");}catch(IOException){}
   } finally {if(held!=null)held.Dispose();}
  },ref failed);
  Test("failed preparation stays unready even when cleanup is blocked; retry uses a new directory",delegate {
   string install=Path.Combine(root,"failed");Directory.CreateDirectory(install);string runtime=Choose(install);FileStream held=null;
   try {
    try{Prepare(runtime,delegate(string app){Populate(app);held=new FileStream(Path.Combine(app,"DeepSeek Harness.exe"),FileMode.Open,FileAccess.Read,FileShare.Read);throw new InvalidOperationException("patch failed");});throw new Exception("Failure swallowed");}
    catch(InvalidOperationException e){Check(e.Message=="patch failed","Original error masked");}
    Check(!Ready(runtime),"Failed preparation was marked ready");
    string next=Choose(install);Check(next!=runtime,"Retry selected partial runtime");Prepare(next,Populate);Check(Choose(install)==next,"Retry not reusable");
   } finally {if(held!=null)held.Dispose();}
  },ref failed);
  Test("partial marker, missing executable and foreign version are ignored",delegate {
   string install=Path.Combine(root,"interrupted");Directory.CreateDirectory(install);
   foreach(string name in new[]{"partial","missing","foreign"}) {
    string path=Path.Combine(install,"runtime-"+version+"-"+name);Directory.CreateDirectory(path);
    if(name!="missing")Populate(path);
    File.WriteAllText(Path.Combine(path,"ready"),name=="partial"?version.Substring(0,5):name=="foreign"?"other-version":version);
    Check(!Ready(path),"Invalid marker/executable accepted");
   }
   string next=Choose(install);Check(!Directory.Exists(next),"Partial directory selected");Prepare(next,Populate);Check(Choose(install)==next,"Fresh runtime not selected");
  },ref failed);
  Test("legacy ready runtime is reused unchanged",delegate {
   string install=Path.Combine(root,"legacy"),legacy=Path.Combine(install,"runtime-"+version);Directory.CreateDirectory(legacy);Populate(legacy);File.WriteAllText(Path.Combine(legacy,"ready"),version);
   using(var held=new FileStream(Path.Combine(legacy,"DeepSeek Harness.exe"),FileMode.Open,FileAccess.Read,FileShare.Read)){Check(Choose(install)==legacy,"Legacy runtime was not reused");}
  },ref failed);
  Test("missing executable and marker-write failure never publish a runtime",delegate {
   string install=Path.Combine(root,"invalid");Directory.CreateDirectory(install);string missing=Choose(install);
   try{Prepare(missing,delegate(string app){});throw new Exception("Missing executable accepted");}catch(IOException){}
   Check(!Ready(missing),"Missing executable published");string blocked=Choose(install);
   try{Prepare(blocked,delegate(string app){Populate(app);Directory.CreateDirectory(Path.Combine(app,"ready"));});throw new Exception("Marker failure swallowed");}catch(UnauthorizedAccessException){}
   Check(!Ready(blocked)&&Choose(install)!=blocked,"Marker failure published");
  },ref failed);
  return failed==0?0:1;
 }
}
"@ | Set-Content -LiteralPath (Join-Path $TestDirectory 'Harness.cs') -Encoding UTF8
$savedTemp=$env:TEMP; $savedTmp=$env:TMP
try {
 $env:TEMP=$TestDirectory; $env:TMP=$TestDirectory
 $exe=Join-Path $TestDirectory 'test.exe'
 & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /main:RuntimeStorageTest /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Xml.Linq.dll "/out:$exe" (Join-Path $PSScriptRoot 'Launcher.cs') (Join-Path $PSScriptRoot 'SetupDialog.cs') (Join-Path $TestDirectory 'Harness.cs')
 if($LASTEXITCODE -ne 0){throw 'Compilation failed'}
 & $exe $TestDirectory
 if($LASTEXITCODE -ne 0){throw 'Runtime storage regression failed'}
} finally {$env:TEMP=$savedTemp; $env:TMP=$savedTmp}

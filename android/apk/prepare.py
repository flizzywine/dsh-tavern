#!/usr/bin/env python3
"""从锁定 DSHA 源码及官方 APK 的已验证资产生成独立酒馆构建目录。"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

# DSHA v0.2.0-rc2：轻量 tag，tag 本身即提交；内置 DSH 0.2.0-rc.2。
COMMIT = '8362bba747fcf84c19e436c3dbb594a0fc388a67'
APK_SHA256 = '1fedf883d431af658d89c28b86d85974cc1d11b74e0c5d46ef3d3cf8650b1961'
# 与上游 v2.1 APK 并存：签名不同，无法覆盖安装，也不该让用户卸载旧包丢数据。
APPLICATION_ID = 'io.github.flizzywine.dshtavern.standalone'
# 同一酒馆版本的重新打包（例如只更新 APK 内置快照）也递增，避免和已发布的包同号。
VERSION_CODE = 30100
VERSION_NAME = '3.1.0'
HERE = Path(__file__).resolve().parent


def replace(file, before, after):
    text = file.read_text()
    if text.count(before) != 1:
        raise ValueError(f'上游补丁锚点不唯一：{file}: {before[:80]}')
    file.write_text(text.replace(before, after))


def prepare(source, apk, destination, offline=None):
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if actual != COMMIT:
        raise ValueError(f'DSHA 源码版本不匹配：{actual}')
    # 上游提交里的 config/xml/json 带 CRLF，`* text=auto` 在 Linux 上会把它们显示成改动；
    # 只接受换行差异，真正的本地修改仍会拒绝构建。
    dirty = subprocess.run(['git', '-C', str(source), 'diff', '--quiet', '--ignore-cr-at-eol'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
    staged = subprocess.run(['git', '-C', str(source), 'diff', '--cached', '--quiet'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
    if dirty != 0 or staged != 0:
        raise ValueError('DSHA 源码有本地修改，请使用干净的锁定提交')
    if hashlib.sha256(apk.read_bytes()).hexdigest() != APK_SHA256:
        raise ValueError('官方 APK 摘要不匹配')
    if destination.exists():
        raise ValueError('输出目录已存在，请选择新的目录，避免覆盖本地修改')
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns('.git', '.gradle', 'build', 'local.properties'))
    app = destination / 'app'
    assets = app / 'src/tavern/assets'
    assets.mkdir(parents=True)
    # 官方发布已经执行过标准资产构建；逐字节复用通过整体摘要验证的产物。
    with zipfile.ZipFile(apk) as archive:
        for name in archive.namelist():
            if name.startswith('lib/arm64-v8a/') and name.endswith('.so'):
                relative = Path(name).relative_to('lib')
                if '..' in relative.parts:
                    raise ValueError('非法原生库路径')
                target = app / 'src/main/jniLibs' / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
            if not name.startswith('assets/') or name.endswith('/') or name.startswith('assets/dexopt/'):
                continue
            relative = Path(name).relative_to('assets')
            if '..' in relative.parts:
                raise ValueError('非法资产路径')
            target = assets / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(name))
    setup = (HERE.parent / 'setup.sh').read_text()
    setup += '\n# 独立 APK 由原生生命周期持有 tavern 主进程，结束安装器的临时服务。\n'
    setup += 'DSH_TAVERN_PORT=3088 DSH_TAVERN_RUNTIME_HOST=android node /root/.dsh/apps/dsh-tavern/bin/dsh-tavern.mjs stop\n'
    (assets / 'tavern-apk-setup.sh').write_text(setup)
    # 首装离线包：源码 + pnpm store + pnpm 运行时。没有它首装要联网下载 287 个依赖，
    # 手机上这一步经常几分钟到几十分钟，且失败只能整轮重来。
    if offline is None or not Path(offline).is_file():
        raise ValueError('缺少首装离线包，请先运行 android/apk/build-offline-bundle.sh')
    shutil.copyfile(offline, assets / 'tavern-offline.bin')
    # 原生层靠这份小清单判断“新 APK 的内置快照是否值得离线替换已装源码”；
    # 不能让它去解 128 MB 的离线包，所以单独写一个 JSON。
    revision = ''
    sidecar = Path(str(offline) + '.revision')
    if sidecar.is_file():
        revision = sidecar.read_text().strip()
    if not revision:
        revision = subprocess.check_output(
            ['git', '-C', str(HERE.parent.parent), 'rev-parse', 'HEAD'], text=True).strip()
    repo_version = json.loads((HERE.parent.parent / 'package.json').read_text())['version']
    built_at = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    (assets / 'tavern-offline-meta.json').write_text(
        json.dumps({'revision': revision, 'version': repo_version, 'builtAt': built_at}, ensure_ascii=False) + '\n',
        encoding='utf-8')
    print(f'内置快照：{revision[:12]}（v{repo_version}，{built_at}）')
    print(f'离线包：{Path(offline).name} ({Path(offline).stat().st_size / 1048576:.1f} MB)')
    java = app / 'src/main/java/com/deepseekharness/app'
    shutil.copyfile(HERE / 'TavernBootstrap.java', java / 'core/TavernBootstrap.java')
    tests = app / 'src/test/java/com/deepseekharness/app/util'
    tests.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(HERE / 'TavernWebProcessTest.java', tests / 'TavernWebProcessTest.java')
    gradle = app / 'build.gradle'
    replace(gradle, 'applicationId "com.dsh.client"', f'applicationId "{APPLICATION_ID}"')
    # 版本号独立于 DSHA：major*10000 + minor*100 + patch，后续发布只增不减。
    replace(gradle, '''        versionCode 170
        // DSHA 修订号 + 固定的北京时间戳 + 内置 DSH 版本；同一交付重建不变。
        versionName "0.2.21-20261009.0750-dsh0.2.0-rc.2"''',
            f'''        versionCode {VERSION_CODE}
        versionName "{VERSION_NAME}"''')
    replace(gradle,
            '''        main.assets.setSrcDirs([layout.buildDirectory.dir("generated/standardAssets").get().asFile,
                layout.buildDirectory.dir("generated/recoveryAssets").get().asFile])''',
            '        // 直接复用官方 APK 里已经生成并验证过的运行环境资产。\n'
            '        main.assets.setSrcDirs(["src/tavern/assets"])')
    replace(gradle, 'tasks.named("preBuild").configure { dependsOn(prepareStandardAssets, prepareRecoveryAssets) }',
            '''tasks.named("preBuild").configure { }
// 运行环境资产来自官方 APK，跳过从源码重建及其校验任务（否则会重算并与补丁后的源码冲突）。
tasks.configureEach {
    if (name in ['prepareStandardAssets', 'prepareRecoveryAssets', 'prepareBackupAssets',
                 'prepareRuntimeDescriptor', 'verifyRuntimeDescriptorInputs'])
        enabled = false
}''')
    for resource in (app / 'src/main/res').glob('values*/strings.xml'):
        resource.write_text(re.sub(r'(<string name="app_name"[^>]*>).*?(</string>)', r'\1DSH Tavern\2', resource.read_text()))
    # 启动页固定运行 tavern profile；普通 web profile 在本 APK 中不存在。
    pipeline = java / 'core/StartupPipeline.java'
    replace(pipeline, '    String safeProfile() throws IOException;',
            '''    String safeProfile() throws IOException;

    /** 独立 APK：确保内置酒馆已安装；普通启动固定运行 tavern profile。 */
    void installTavern() throws Exception;''')
    replace(pipeline,
            '''    if (!actions.current()) return null;
    String startupProfile = "web";
    if (!safeMode) actions.beforeLaunch(diagnostics.recordId());''',
            '''    if (!actions.current()) return null;
    String startupProfile = "web";
    if (!safeMode) {
      actions.beforeLaunch(diagnostics.recordId());
      actions.installTavern();
      startupProfile = "tavern";
    }''')
    replace(java / 'core/StartupEnvironmentActions.java',
            '  public String safeProfile() throws IOException {',
            '''  public void installTavern() throws Exception {
    TavernBootstrap.ensure(
        owner.context(),
        owner.proot(),
        () -> !current(),
        message -> {
          if (message.startsWith("首次安装："))
            stage.accept(com.deepseekharness.app.util.UiText.text("下载并安装最新版酒馆"));
          else if (message.startsWith("升级："))
            stage.accept(com.deepseekharness.app.util.UiText.text("正在用应用内置版本升级酒馆"));
          status.accept(message);
        });
  }

  public String safeProfile() throws IOException {''')
    # 只给容器内的 dsh 加酒馆标识，不改变启动命令前缀（WebProcSel 依赖它识别受管 shell）。
    replace(java / 'util/WebLaunchCommand.java',
            '''        + generation
        + " && cd /root && rm -f "''',
            '''        + generation
        + " && export DSH_TAVERN_RUNTIME_HOST=android DSH_TAVERN_ANDROID_STANDALONE=1"
        + " && export pnpm_config_update_notifier=false"
        + " && cd /root && rm -f "''')
    replace(java / 'util/WebProcSel.java',
            '"(?:dsha-recovery-[0-9a-f]{16}|dsha-emergency-[0-9a-f]{32})"));',
            '"(?:tavern|dsha-recovery-[0-9a-f]{16}|dsha-emergency-[0-9a-f]{32})"));')
    replace(java / 'util/WebProcSel.java',
            '''        && (command.contains("exec dsh web --no-open --host 127.0.0.1 --port ")
            || command.contains("exec dsh --profile 'dsha-recovery-"));''',
            '''        && (command.contains("exec dsh web --no-open --host 127.0.0.1 --port ")
            || command.contains("exec dsh --profile 'tavern' --no-open --host 127.0.0.1 --port ")
            || command.contains("exec dsh --profile 'dsha-recovery-"));''')
    launch = java / 'ui/LaunchFragment.java'
    replace(launch, '  private boolean pendingAutoEnter;',
            '''  private boolean pendingAutoEnter;

  /** 独立 APK 首次就绪时自动进入酒馆；进入后写入偏好，之后由用户手动点「进入」。 */
  private boolean autoEnterOnReady;''')
    replace(launch,
            '''    if (getArguments() != null && getArguments().getBoolean(ARG_OPEN_WEB, false)) {
      getArguments().remove(ARG_OPEN_WEB);
      pendingAutoEnter = true;
    }''',
            '''    if (getArguments() != null && getArguments().getBoolean(ARG_OPEN_WEB, false)) {
      getArguments().remove(ARG_OPEN_WEB);
      pendingAutoEnter = true;
    }
    // 独立 APK：第一次进入就绪后自动打开酒馆，不要求用户先点「进入」。
    autoEnterOnReady =
        !requireContext().getSharedPreferences("tavern-apk", 0).getBoolean("entered", false);''')
    replace(launch,
            '          if (pendingAutoEnter && !webEntryUrl().isEmpty()) {',
            '''          if (autoEnterOnReady && isResumed() && !webEntryUrl().isEmpty()) {
            autoEnterOnReady = false;
            android.content.Context context = getContext();
            if (context != null)
              context
                  .getSharedPreferences("tavern-apk", 0)
                  .edit()
                  .putBoolean("entered", true)
                  .apply();
            pendingAutoEnter = true;
          }
          if (pendingAutoEnter && !webEntryUrl().isEmpty()) {''')
    # 首次只自动发起一次；失败后由启动按钮重试，避免恢复界面时无限重试。
    replace(launch,
            '''    ui.removeCallbacks(refreshState);
    ui.post(refreshState);
  }

  @Override
  public void onPause() {''',
            '''    ui.removeCallbacks(refreshState);
    ui.post(refreshState);
    // 独立 APK：首次打开自动启动一次；失败后由「启动」按钮重试。
    android.content.SharedPreferences prefs =
        requireContext().getSharedPreferences("tavern-apk", 0);
    if (!prefs.getBoolean("started", false)) {
      prefs.edit().putBoolean("started", true).apply();
      ui.post(
          () -> {
            View view = getView();
            Activity activity = getActivity();
            if (view != null
                && activity != null
                && isResumed()
                && !controller.isStarting()
                && !controller.isStopping()
                && webEntryUrl().isEmpty()) {
              doStart(
                  activity,
                  view.findViewById(R.id.launch_status),
                  view.findViewById(R.id.launch_start));
            }
          });
    }
  }

  @Override
  public void onPause() {''')
    replace(java / 'ui/WebPreviewActivity.java',
            '      WebView view = new WebView(new android.content.MutableContextWrapper(this));',
            '''      if (com.deepseekharness.app.BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
      WebView view = new WebView(new android.content.MutableContextWrapper(this));''')
    # 独立包不可接受上游 DSHA 的 APK 更新；Tavern 内的源码更新保持原样。
    replace(java / 'core/UpdateEngine.java', '  private void check(boolean startup) {',
            f'''  private void check(boolean startup) {{
    if (com.deepseekharness.app.BuildConfig.APPLICATION_ID.equals("{APPLICATION_ID}")) {{
      if (!startup)
        finishState("idle", "酒馆代码请在酒馆内更新；安卓安装包请从 DSH Tavern 发布页下载。");
      return;
    }}''')
    # 上游单测按 web profile 断言启动顺序；独立包固定 tavern，并多一步安装检查。
    pipeline_test = app / 'src/test/java/com/deepseekharness/app/core/StartupPipelineTest.java'
    replace(pipeline_test,
            '''    public void beforeLaunch(String id) throws IOException {
      step("activate");
    }''',
            '''    public void beforeLaunch(String id) throws IOException {
      step("activate");
    }

    public void installTavern() throws Exception {
      step("install-tavern");
    }''')
    replace(pipeline_test,
            '    assertEquals("web", new StartupPipeline(f, f).prepare(1, false, f));',
            '    assertEquals("tavern", new StartupPipeline(f, f).prepare(1, false, f));')
    replace(pipeline_test, '''            "activate",
            "unlock",''', '''            "activate",
            "install-tavern",
            "unlock",''')
    shutil.copyfile(source / 'LICENSE', assets / 'DSHA-LICENSE.txt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--offline', type=Path, help='首装离线包（由 build-offline-bundle.sh 生成）')
    args = parser.parse_args()
    prepare(args.source.resolve(), args.apk.resolve(), args.output.resolve(),
            args.offline.resolve() if args.offline else None)

package io.github.flizzywine.dshtavern.bionic;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;

/** 启动页（状态、启停、更新、后台运行、维护）+ 全屏 WebView。服务就绪后默认直接进酒馆，返回键回到启动页。 */
public final class MainActivity extends Activity {
    private static final int PICK_FILES = 1;
    private static final String INSTALL_ACTION = "io.github.flizzywine.dshtavern.bionic.INSTALL_STATUS";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ScrollView launcher;
    private TextView statusText, versionText, updateText, keepAliveText, logText;
    private ProgressBar bar;
    private Button enter, restart, startStop, check, updateAction, logsToggle;
    private Switch autoOpen, wakeLock;
    private String loadedUrl;
    private boolean showLauncher;
    private boolean logsVisible;
    private boolean clearHistoryOnLoad;
    private ValueCallback<Uri[]> fileCallback;

    private SharedPreferences prefs() {
        return getSharedPreferences(TavernService.PREFS, MODE_PRIVATE);
    }

    private void send(String action) {
        startForegroundService(TavernService.intent(this, action));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        // targetSdk 35 强制全面屏：按系统栏和输入法让出边距，输入框不被键盘挡住。
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets s = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(s.left, s.top, s.right, s.bottom);
            return WindowInsets.CONSUMED;
        });
        root.addView(buildLauncher());
        root.addView(buildWebView());
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
        }
        IntentFilter filter = new IntentFilter(INSTALL_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, filter);
        showLauncher = !prefs().getBoolean("autoOpen", true);
        send(TavernService.ACTION_START);
        handler.post(poll);
    }

    // ---------------------------------------------------------------- 界面

    private TextView text(LinearLayout parent, float size, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(size);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, 12, 0, 12);
        parent.addView(t);
        return t;
    }

    private TextView section(LinearLayout parent, String title) {
        TextView t = text(parent, 13, true);
        t.setText(title);
        t.setPadding(0, 48, 0, 8);
        t.setTextColor(0xff8a6d5a);
        return t;
    }

    private LinearLayout row(LinearLayout parent) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        parent.addView(r);
        return r;
    }

    private Button button(LinearLayout parent, String label, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(click);
        parent.addView(b, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        return b;
    }

    private View buildLauncher() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(48, 72, 48, 72);
        TextView title = text(c, 24, true);
        title.setText("DSH Tavern");
        versionText = text(c, 12, false);
        versionText.setTextColor(0xff888888);

        statusText = text(c, 15, false);
        statusText.setPadding(0, 32, 0, 16);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        c.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        LinearLayout r1 = row(c);
        enter = button(r1, "进入酒馆", v -> {
            showLauncher = false;
            render();
        });
        restart = button(r1, "重启", v -> send(TavernService.ACTION_RESTART));
        startStop = button(r1, "停止", v -> send("running".equals(TavernService.phase) || "starting".equals(TavernService.phase)
                ? TavernService.ACTION_STOP : TavernService.ACTION_START));

        section(c, "更新");
        updateText = text(c, 14, false);
        LinearLayout r2 = row(c);
        check = button(r2, "检查更新", v -> send(TavernService.ACTION_CHECK));
        updateAction = button(r2, "立即更新", v -> onUpdateAction());

        section(c, "后台运行");
        autoOpen = new Switch(this);
        autoOpen.setText("打开应用后直接进入酒馆");
        autoOpen.setChecked(prefs().getBoolean("autoOpen", true));
        autoOpen.setOnCheckedChangeListener((b, on) -> prefs().edit().putBoolean("autoOpen", on).apply());
        c.addView(autoOpen);
        wakeLock = new Switch(this);
        wakeLock.setText("熄屏后保持运行（防止生成到一半卡住，略增耗电）");
        wakeLock.setChecked(prefs().getBoolean("wakelock", true));
        wakeLock.setOnCheckedChangeListener((b, on) -> {
            prefs().edit().putBoolean("wakelock", on).apply();
            send(TavernService.ACTION_PREFS);
        });
        c.addView(wakeLock);
        keepAliveText = text(c, 13, false);
        LinearLayout r3 = row(c);
        button(r3, "允许后台运行", v -> requestBatteryExemption());

        section(c, "维护");
        LinearLayout r4 = row(c);
        logsToggle = button(r4, "查看日志", v -> {
            logsVisible = !logsVisible;
            render();
        });
        button(r4, "分享日志", v -> shareLogs());
        LinearLayout r5 = row(c);
        button(r5, "重置程序文件", v -> new AlertDialog.Builder(this)
                .setTitle("重置程序文件")
                .setMessage("重新解出安装包自带的程序文件（会撤销源码热更新）。存档、人物卡、API key 和模型设置都保留。")
                .setPositiveButton("重置", (d, w) -> send(TavernService.ACTION_RESET))
                .setNegativeButton("取消", null).show());
        button(r5, "退出", v -> {
            send(TavernService.ACTION_EXIT);
            finishAndRemoveTask();
        });
        logText = text(c, 11, false);
        logText.setTypeface(Typeface.MONOSPACE);
        logText.setTextIsSelectable(true);

        launcher = new ScrollView(this);
        launcher.addView(c);
        return launcher;
    }

    private View buildWebView() {
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                if ("127.0.0.1".equals(host) || "localhost".equals(host)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String loaded) {
                // 服务重启后地址（含访问令牌）会变：旧地址已失效，不留在返回历史里。
                if (clearHistoryOnLoad) {
                    clearHistoryOnLoad = false;
                    view.clearHistory();
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(intent, PICK_FILES);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.setVisibility(View.GONE);
        return web;
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            render();
            handler.postDelayed(this, 500);
        }
    };

    /** 只在内容变化时更新：每 0.5 秒无条件 setText 会不停发出无障碍事件、触发重绘（耗电，也让 uiautomator 等不到空闲）。 */
    private static void set(TextView view, CharSequence value) {
        if (!value.toString().contentEquals(view.getText())) view.setText(value);
    }

    private long memoryCheckedAt;
    private long memoryCache;

    private long memoryMbCached() {
        if (System.currentTimeMillis() - memoryCheckedAt > 5000) {
            memoryCheckedAt = System.currentTimeMillis();
            memoryCache = memoryMb();
        }
        return memoryCache;
    }

    private void render() {
        String url = TavernService.url;
        String phase = TavernService.phase;
        if (url != null && !url.equals(loadedUrl)) {
            loadedUrl = url;
            clearHistoryOnLoad = true;
            web.loadUrl(url);
        }
        boolean showWeb = url != null && !showLauncher;
        web.setVisibility(showWeb ? View.VISIBLE : View.GONE);
        launcher.setVisibility(showWeb ? View.GONE : View.VISIBLE);
        if (showWeb) return;

        set(versionText, appVersion() + (TavernService.sourceInfo.isEmpty() ? "" : "\n" + TavernService.sourceInfo));
        String err = TavernService.error;
        int p = TavernService.progress;
        StringBuilder s = new StringBuilder(err != null ? "出错：" + err : TavernService.status);
        if ("running".equals(phase)) {
            long minutes = (System.currentTimeMillis() - TavernService.runningSince) / 60000;
            s.append("\n已运行 ").append(minutes).append(" 分钟 · 内存 ").append(memoryMbCached()).append(" MB");
        }
        if (TavernService.autoRestarts > 0) s.append("\n本次已自动重启 ").append(TavernService.autoRestarts).append(" 次（上次：").append(TavernService.lastExit).append("）");
        set(statusText, s);
        boolean busy = p >= 0 || "preparing".equals(phase) || "starting".equals(phase) || "stopping".equals(phase)
                || "downloading".equals(TavernService.updateState) || "checking".equals(TavernService.updateState);
        bar.setVisibility(busy ? View.VISIBLE : View.INVISIBLE);
        bar.setIndeterminate(p < 0);
        if (p >= 0) bar.setProgress(p);
        enter.setEnabled(url != null);
        boolean active = "running".equals(phase) || "starting".equals(phase);
        set(startStop, active ? "停止" : "启动");

        String us = TavernService.updateState;
        set(updateText, TavernService.updateMessage.isEmpty() ? "点「检查更新」查看是否有新版本" : TavernService.updateMessage);
        check.setEnabled(!"checking".equals(us) && !"downloading".equals(us));
        updateAction.setVisibility("source".equals(us) || "apk".equals(us) || "ready".equals(us) ? View.VISIBLE : View.GONE);
        set(updateAction, "source".equals(us) ? "更新源码" : "apk".equals(us) ? "下载安装包" : "安装");

        PowerManager pm = getSystemService(PowerManager.class);
        boolean exempt = pm.isIgnoringBatteryOptimizations(getPackageName());
        set(keepAliveText, (exempt ? "✓ 已允许后台运行（不受电池优化限制）" : "⚠ 受电池优化限制：锁屏后可能被系统停掉，建议点下方按钮允许后台运行")
                + (Build.VERSION.SDK_INT >= 31 ? "\nAndroid 12 起系统可能清理应用的后台子进程，酒馆服务被清理后会自动重启。频繁发生时，可在开发者选项里开启「停用子进程限制」。" : ""));
        set(logsToggle, logsVisible ? "隐藏日志" : "查看日志");
        set(logText, logsVisible || err != null ? TavernService.tail() : "");
    }

    private String appVersion() {
        try {
            return "安装包 " + getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 本应用所有 libnode.so 进程的常驻内存之和（DSH 主进程 + 模板/脚本 worker）。 */
    private long memoryMb() {
        long kb = 0;
        File[] procs = new File("/proc").listFiles();
        if (procs == null) return 0;
        for (File proc : procs) {
            if (!proc.getName().matches("\\d+")) continue;
            try {
                byte[] cmd = java.nio.file.Files.readAllBytes(new File(proc, "cmdline").toPath());
                if (!new String(cmd, StandardCharsets.UTF_8).contains("libnode.so")) continue;
                for (String line : java.nio.file.Files.readAllLines(new File(proc, "status").toPath())) {
                    if (line.startsWith("VmRSS:")) kb += Long.parseLong(line.replaceAll("\\D", ""));
                }
            } catch (Exception ignored) {
            }
        }
        return kb / 1024;
    }

    // ---------------------------------------------------------------- 动作

    private void requestBatteryExemption() {
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm.isIgnoringBatteryOptimizations(getPackageName())) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            return;
        }
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void shareLogs() {
        StringBuilder text = new StringBuilder(appVersion()).append('\n').append(TavernService.sourceInfo).append("\nAndroid ")
                .append(Build.VERSION.RELEASE).append(" · ").append(Build.MODEL).append(" · ").append(Build.SUPPORTED_ABIS[0]).append("\n\n");
        File dir = new File(getFilesDir(), "logs");
        for (String name : new String[]{"node.prev.log", "node.log"}) {
            File f = new File(dir, name);
            if (!f.exists()) continue;
            text.append("==== ").append(name).append(" ====\n").append(lastBytes(f, 48 * 1024)).append('\n');
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text.toString())
                .putExtra(Intent.EXTRA_SUBJECT, "DSH Tavern 日志");
        startActivity(Intent.createChooser(send, "分享日志"));
    }

    private static String lastBytes(File f, int max) {
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long start = Math.max(0, raf.length() - max);
            byte[] buf = new byte[(int) (raf.length() - start)];
            raf.seek(start);
            raf.readFully(buf);
            return new String(buf, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "（读取失败：" + e + "）";
        }
    }

    private void onUpdateAction() {
        String us = TavernService.updateState;
        if ("source".equals(us)) {
            new AlertDialog.Builder(this).setTitle("更新源码")
                    .setMessage(TavernService.updateMessage + "\n\n更新时酒馆会重启一次；新版本起不来会自动回退。")
                    .setPositiveButton("更新", (d, w) -> send(TavernService.ACTION_SOURCE_UPDATE))
                    .setNegativeButton("取消", null).show();
        } else if ("apk".equals(us)) {
            send(TavernService.ACTION_DOWNLOAD_APK);
        } else if ("ready".equals(us) && TavernService.apkFile != null) {
            installApk(new File(TavernService.apkFile));
        }
    }

    private void installApk(File apk) {
        if (!getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this, "请允许本应用安装更新，返回后再点一次「安装」", Toast.LENGTH_LONG).show();
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            params.setSize(apk.length());
            if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = installer.createSession(params);
            try (PackageInstaller.Session session = installer.openSession(id)) {
                try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    session.fsync(out);
                }
                Intent callback = new Intent(INSTALL_ACTION).setPackage(getPackageName());
                int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0);
                session.commit(android.app.PendingIntent.getBroadcast(this, id, callback, flags).getIntentSender());
            }
            TavernService.updateMessage = "正在安装，安装完成后应用会重新打开";
        } catch (Exception e) {
            TavernService.updateMessage = "安装失败：" + e.getMessage();
        }
    }

    private final BroadcastReceiver installReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                TavernService.updateMessage = "安装没有完成：" + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            }
        }
    };

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                result = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < result.length; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        send(TavernService.ACTION_START);
    }

    @Override
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE) {
            if (web.canGoBack()) web.goBack();
            else {
                showLauncher = true; // 酒馆根页按返回：回到启动页
                render();
            }
        } else {
            moveTaskToBack(true); // 服务继续在后台运行
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(poll);
        unregisterReceiver(installReceiver);
        web.destroy();
        super.onDestroy();
    }
}

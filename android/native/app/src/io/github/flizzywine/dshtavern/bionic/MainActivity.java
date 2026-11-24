package io.github.flizzywine.dshtavern.bionic;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageInstaller;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.GradientDrawable;
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
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.view.WindowInsetsController;
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
import android.widget.ImageView;
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
import java.util.List;

/** 启动页（状态、启停、更新、后台运行、维护）+ 全屏 WebView。服务就绪后默认直接进酒馆，返回键回到启动页。 */
public final class MainActivity extends Activity {
    static final String EXTRA_SHOW_UPDATE = "showUpdate";
    private static final int PICK_FILES = 1;
    private static final String INSTALL_ACTION = "io.github.flizzywine.dshtavern.bionic.INSTALL_STATUS";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ScrollView launcher;
    private TextView versionText, updateText, keepAliveText, logText;
    private ProgressBar bar;
    private Button enter, restart, startStop, check, updateAction;
    private TextView logsToggle;
    private Switch autoOpen, wakeLock, lanAccess;
    private TextView lanStatusText, lanUrlText, lanHintText;
    private LinearLayout lanActionsRow;
    private Button lanCopy, lanShare, lanRefresh;
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
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        // targetSdk 35 强制全面屏：按系统栏和输入法让出边距，输入框不被键盘挡住；让出的区域显示 root 的底色。
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets s = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(s.left, s.top, s.right, s.bottom);
            return WindowInsets.CONSUMED;
        });
        root.addView(buildLauncher());
        root.addView(buildWebView());
        setContentView(root);
        applyBarColor(BG);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
        }
        IntentFilter filter = new IntentFilter(INSTALL_ACTION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(installReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(installReceiver, filter);
        showLauncher = !prefs().getBoolean("autoOpen", true) || getIntent().getBooleanExtra(EXTRA_SHOW_UPDATE, false);
        send(TavernService.ACTION_START);
        send(TavernService.ACTION_APK_CHECK);
        handler.post(poll);
    }

    // ---------------------------------------------------------------- 界面（配色、圆角、分段按钮取自酒馆本体）

    private static final int BG = 0xfffaf9f5, CARD = 0xffffffff, TRACK = 0xfff3eae2, HAIRLINE = 0xffe9e1d8,
            INK = 0xff29201a, MUTED = 0xff8a8178, ACCENT = 0xffc27d5d, DANGER = 0xffc64545,
            OK = 0xff3f9a6b, WARN = 0xffd39b3a;
    private FrameLayout root;
    private TextView statusTitle, statusDetail, footerText;
    private View statusDot;
    private Button batteryButton;
    private int barColor;

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable shape(int fill, int stroke, float radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radiusDp));
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    /** 按下时变暗一点的背景（酒馆按钮的按压反馈）。 */
    private android.graphics.drawable.Drawable pressable(int fill, int stroke, float radiusDp) {
        android.graphics.drawable.StateListDrawable s = new android.graphics.drawable.StateListDrawable();
        s.addState(new int[]{android.R.attr.state_pressed}, shape(blend(fill, INK, 0.06f), stroke, radiusDp));
        s.addState(new int[]{-android.R.attr.state_enabled}, shape(blend(fill, BG, 0.5f), stroke, radiusDp));
        s.addState(new int[]{}, shape(fill, stroke, radiusDp));
        return s;
    }

    private static int blend(int a, int b, float t) {
        int r = Math.round(Color.red(a) + (Color.red(b) - Color.red(a)) * t);
        int g = Math.round(Color.green(a) + (Color.green(b) - Color.green(a)) * t);
        int bl = Math.round(Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t);
        return Color.rgb(r, g, bl);
    }

    private TextView label(ViewGroup parent, float size, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setLineSpacing(dp(2), 1f);
        if (bold) t.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        parent.addView(t);
        return t;
    }

    private LinearLayout.LayoutParams lp(int width, int height, int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(width, height);
        p.topMargin = dp(top);
        return p;
    }

    private LinearLayout card(LinearLayout parent, int top) {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(shape(CARD, HAIRLINE, 16));
        c.setPadding(dp(16), dp(14), dp(16), dp(14));
        parent.addView(c, lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, top));
        return c;
    }

    /** 分组标题：与酒馆侧栏「游玩历史」同款的浅灰小字。 */
    private void heading(LinearLayout parent, String title) {
        TextView t = label(parent, 14, MUTED, false);
        t.setText(title);
        t.setPadding(dp(4), dp(22), 0, dp(8));
    }

    /** 主按钮：酒馆「选择人物卡 · 新开游玩」同款——白底、细边、深色粗体、大圆角。 */
    private Button primary(LinearLayout parent, String text, View.OnClickListener click) {
        Button b = baseButton(text, click);
        b.setTextSize(17);
        b.setTextColor(INK);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        b.setBackground(pressable(CARD, HAIRLINE, 14));
        parent.addView(b, lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(54), 14));
        return b;
    }

    /** 次按钮：「检查更新」同款小号描边按钮；accent=true 时用强调色字。 */
    private Button secondary(LinearLayout parent, String text, boolean accent, View.OnClickListener click) {
        Button b = baseButton(text, click);
        b.setTextSize(14);
        b.setTextColor(accent ? ACCENT : INK);
        if (accent) b.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        b.setBackground(pressable(CARD, HAIRLINE, 12));
        b.setPadding(dp(14), 0, dp(14), 0);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(40));
        p.rightMargin = dp(8);
        parent.addView(b, p);
        return b;
    }

    private Button baseButton(String text, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setStateListAnimator(null);
        b.setElevation(0);
        b.setMinHeight(0);
        b.setMinimumHeight(0);
        b.setOnClickListener(click);
        return b;
    }

    private LinearLayout row(LinearLayout parent, int top) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        parent.addView(r, lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, top));
        return r;
    }

    /** 分段控件（酒馆「游玩 / 卡片」切换同款）：米色底槽里的白色胶囊按钮，强调色字。 */
    private Button segment(LinearLayout track, String text, View.OnClickListener click) {
        Button b = baseButton(text, click);
        b.setTextSize(15);
        b.setTextColor(ACCENT);
        b.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        b.setBackground(pressable(CARD, 0, 10));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(42), 1);
        p.setMargins(dp(3), dp(3), dp(3), dp(3));
        track.addView(b, p);
        return b;
    }

    private void divider(LinearLayout parent) {
        View v = new View(this);
        v.setBackgroundColor(HAIRLINE);
        parent.addView(v, lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(1), 0));
    }

    private Switch toggle(LinearLayout parent, String title, String key, boolean def, Runnable after) {
        Switch s = new Switch(this);
        s.setText(title);
        s.setTextSize(15);
        s.setTextColor(INK);
        s.setPadding(0, dp(12), 0, dp(12));
        int[][] states = {{android.R.attr.state_checked}, {}};
        s.setThumbTintList(new ColorStateList(states, new int[]{ACCENT, 0xffffffff}));
        s.setTrackTintList(new ColorStateList(states, new int[]{blend(ACCENT, CARD, 0.45f), 0xffd9cfc4}));
        s.setChecked(prefs().getBoolean(key, def));
        s.setOnCheckedChangeListener((b, on) -> {
            prefs().edit().putBoolean(key, on).apply();
            if (after != null) after.run();
        });
        parent.addView(s, lp(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, 0));
        return s;
    }

    /** 列表行（酒馆历史列表同款）：左文字、右箭头，整行可点。 */
    private TextView listRow(LinearLayout parent, String text, int color, View.OnClickListener click) {
        LinearLayout r = new LinearLayout(this);
        r.setOrientation(LinearLayout.HORIZONTAL);
        r.setGravity(Gravity.CENTER_VERTICAL);
        r.setPadding(dp(4), 0, dp(4), 0);
        r.setBackground(pressable(CARD, 0, 10));
        r.setClickable(true);
        r.setOnClickListener(click);
        TextView t = label(r, 15, color, false);
        t.setText(text);
        t.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView chevron = label(r, 18, MUTED, false);
        chevron.setText("›");
        parent.addView(r, lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(50), 0));
        return t;
    }

    private View buildLauncher() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(20), dp(20), dp(20), dp(32));

        // 品牌：图标 + DSH Tavern + 酒馆 · Beta（与酒馆侧栏顶部的品牌区一致）
        LinearLayout brand = row(c, 4);
        ImageView icon = new ImageView(this);
        int iconId = getResources().getIdentifier("brand_icon", "drawable", getPackageName());
        if (iconId != 0) icon.setImageResource(iconId);
        icon.setClipToOutline(true);
        icon.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), dp(14));
            }
        });
        brand.addView(icon, new LinearLayout.LayoutParams(dp(56), dp(56)));
        LinearLayout names = new LinearLayout(this);
        names.setOrientation(LinearLayout.VERTICAL);
        names.setPadding(dp(14), 0, 0, 0);
        brand.addView(names, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        TextView title = label(names, 26, INK, false);
        title.setText("DSH Tavern");
        title.setTypeface(Typeface.create("sans-serif-black", Typeface.BOLD));
        title.setLetterSpacing(0.01f);
        TextView subtitle = label(names, 14, ACCENT, true);
        subtitle.setText("酒馆 · Beta");

        // 状态卡
        LinearLayout status = card(c, 22);
        LinearLayout head = row(status, 0);
        statusDot = new View(this);
        statusDot.setBackground(shape(MUTED, 0, 6));
        LinearLayout.LayoutParams dot = new LinearLayout.LayoutParams(dp(10), dp(10));
        dot.rightMargin = dp(10);
        head.addView(statusDot, dot);
        statusTitle = label(head, 17, INK, true);
        statusTitle.setLayoutParams(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        statusDetail = label(status, 13, MUTED, false);
        statusDetail.setPadding(dp(20), dp(4), 0, 0);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgressTintList(ColorStateList.valueOf(ACCENT));
        bar.setIndeterminateTintList(ColorStateList.valueOf(ACCENT));
        bar.setProgressBackgroundTintList(ColorStateList.valueOf(TRACK));
        status.addView(bar, lp(LinearLayout.LayoutParams.MATCH_PARENT, dp(6), 10));

        enter = primary(c, "进入酒馆", v -> {
            showLauncher = false;
            render();
        });
        LinearLayout track = row(c, 10);
        track.setBackground(shape(TRACK, 0, 13));
        restart = segment(track, "重启", v -> send(TavernService.ACTION_RESTART));
        startStop = segment(track, "停止", v -> send("running".equals(TavernService.phase) || "starting".equals(TavernService.phase)
                || "preparing".equals(TavernService.phase) ? TavernService.ACTION_STOP : TavernService.ACTION_START));

        heading(c, "更新");
        LinearLayout updates = card(c, 0);
        updateText = label(updates, 14, INK, false);
        LinearLayout ur = row(updates, 12);
        check = secondary(ur, "检查更新", false, v -> send(TavernService.ACTION_CHECK));
        updateAction = secondary(ur, "立即更新", true, v -> onUpdateAction());

        heading(c, "局域网访问");
        LinearLayout lan = card(c, 0);
        lan.setPadding(dp(16), dp(2), dp(16), dp(14));
        lanAccess = toggle(lan, "允许同局域网设备访问", "lanAccess", false, () -> send(TavernService.ACTION_LAN_SYNC));
        lanStatusText = label(lan, 13, MUTED, false);
        lanStatusText.setPadding(0, dp(4), 0, 0);
        lanUrlText = label(lan, 12, INK, false);
        lanUrlText.setTypeface(Typeface.MONOSPACE);
        lanUrlText.setTextIsSelectable(true);
        lanUrlText.setBackground(shape(TRACK, 0, 10));
        lanUrlText.setPadding(dp(12), dp(10), dp(12), dp(10));
        ((LinearLayout.LayoutParams) lanUrlText.getLayoutParams()).topMargin = dp(8);
        lanHintText = label(lan, 12, MUTED, false);
        lanHintText.setText("仅在可信 Wi-Fi / 局域网内使用；链接含登录令牌，请勿发给他人。切换网络后点「刷新地址」。");
        lanHintText.setPadding(0, dp(8), 0, 0);
        lanActionsRow = row(lan, 10);
        lanCopy = secondary(lanActionsRow, "复制链接", true, v -> copyLanUrl());
        lanShare = secondary(lanActionsRow, "分享", false, v -> shareLanUrl());
        lanRefresh = secondary(lanActionsRow, "刷新地址", false, v -> send(TavernService.ACTION_LAN_SYNC));
        for (Button b : new Button[]{lanCopy, lanShare, lanRefresh}) b.setPadding(dp(12), 0, dp(12), 0);

        heading(c, "后台运行");
        LinearLayout bg = card(c, 0);
        bg.setPadding(dp(16), dp(2), dp(16), dp(12));
        autoOpen = toggle(bg, "打开应用后直接进入酒馆", "autoOpen", true, null);
        divider(bg);
        wakeLock = toggle(bg, "熄屏后保持运行（防止生成到一半卡住，略增耗电）", "wakelock", true, () -> send(TavernService.ACTION_PREFS));
        divider(bg);
        keepAliveText = label(bg, 13, MUTED, false);
        keepAliveText.setPadding(0, dp(10), 0, 0);
        LinearLayout br = row(bg, 10);
        batteryButton = secondary(br, "允许后台运行", true, v -> requestBatteryExemption());

        heading(c, "维护");
        LinearLayout tools = card(c, 0);
        tools.setPadding(dp(10), dp(4), dp(10), dp(4));
        logsToggle = listRow(tools, "查看日志", INK, v -> {
            logsVisible = !logsVisible;
            render();
        });
        listRow(tools, "分享日志", INK, v -> shareLogs());
        listRow(tools, "重置程序文件", DANGER, v -> new AlertDialog.Builder(this)
                .setTitle("重置程序文件")
                .setMessage("重新解出安装包自带的程序文件（会撤销应用内更新）。存档、人物卡、API key 和模型设置都保留。")
                .setPositiveButton("重置", (d, w) -> send(TavernService.ACTION_RESET))
                .setNegativeButton("取消", null).show());
        listRow(tools, "退出", INK, v -> {
            send(TavernService.ACTION_EXIT);
            finishAndRemoveTask();
        });
        logText = label(c, 11, INK, false);
        logText.setTypeface(Typeface.MONOSPACE);
        logText.setTextIsSelectable(true);
        logText.setBackground(shape(TRACK, 0, 12));
        logText.setPadding(dp(12), dp(10), dp(12), dp(10));
        ((LinearLayout.LayoutParams) logText.getLayoutParams()).topMargin = dp(12);

        versionText = label(c, 12, MUTED, false);
        versionText.setGravity(Gravity.CENTER);
        versionText.setPadding(0, dp(24), 0, 0);
        footerText = versionText;

        launcher = new ScrollView(this);
        launcher.setBackgroundColor(BG);
        launcher.setClipToPadding(false);
        launcher.addView(c);
        return launcher;
    }

    private View buildWebView() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
        web = new WebView(this);
        web.setBackgroundColor(BG);
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
                sampleWebColor();
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

    // ---------------------------------------------------------------- 状态栏

    /** 状态栏区域的底色与图标深浅：浅底配深色图标，深底配浅色图标（酒馆切到深色主题时也看得清）。 */
    private void applyBarColor(int color) {
        if (color == barColor && root.getTag() != null) return;
        barColor = color;
        root.setTag(Boolean.TRUE);
        root.setBackgroundColor(color);
        boolean light = (0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color)) > 150;
        WindowInsetsController c = getWindow().getInsetsController();
        if (c == null) return;
        int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
        c.setSystemBarsAppearance(light ? mask : 0, mask);
    }

    /** 取酒馆页面顶部那一条的实际背景色（从顶部中点的元素往上找第一个不透明背景）。 */
    private static final String SAMPLE_JS = "(function(){try{var e=document.elementFromPoint(innerWidth/2,2);"
            + "while(e){var c=getComputedStyle(e).backgroundColor;var m=c.match(/rgba?\\(([^)]+)\\)/);"
            + "if(m){var p=m[1].split(',').map(parseFloat);if(p.length<4||p[3]>0.5)return p.slice(0,3).join(',')}e=e.parentElement}"
            + "var b=getComputedStyle(document.body).backgroundColor.match(/\\d+/g);return b?b.slice(0,3).join(','):''}catch(x){return ''}})()";

    private void sampleWebColor() {
        if (web.getVisibility() != View.VISIBLE) return;
        web.evaluateJavascript(SAMPLE_JS, value -> {
            if (value == null) return;
            String v = value.replace("\"", "");
            String[] p = v.split(",");
            if (p.length != 3) return;
            try {
                applyBarColor(Color.rgb(Math.round(Float.parseFloat(p[0].trim())), Math.round(Float.parseFloat(p[1].trim())), Math.round(Float.parseFloat(p[2].trim()))));
            } catch (NumberFormatException ignored) {
            }
        });
    }

    private int pollTicks;
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            render();
            // 页面里切换主题、打开深色弹层时跟着变：每 1.5 秒取一次色，只在显示酒馆时。
            if (++pollTicks % 3 == 0) sampleWebColor();
            handler.postDelayed(this, 500);
        }
    };

    /** 只在内容变化时更新：每 0.5 秒无条件 setText 会不停发出无障碍事件、触发重绘（耗电，也让 uiautomator 等不到空闲）。 */
    private static void set(TextView view, CharSequence value) {
        if (!value.toString().contentEquals(view.getText())) view.setText(value);
    }

    private static void show(View view, boolean visible) {
        int v = visible ? View.VISIBLE : View.GONE;
        if (view.getVisibility() != v) view.setVisibility(v);
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

    private int dotColor = -1;

    private void render() {
        String url = TavernService.url;
        String phase = TavernService.phase;
        if (url != null && !url.equals(loadedUrl)) {
            loadedUrl = url;
            clearHistoryOnLoad = true;
            web.loadUrl(url);
        }
        boolean showWeb = url != null && !showLauncher;
        boolean wasWeb = web.getVisibility() == View.VISIBLE;
        show(web, showWeb);
        show(launcher, !showWeb);
        if (showWeb) {
            if (!wasWeb) sampleWebColor();
            return;
        }
        applyBarColor(BG);
        maybeShowApkNotice();

        String err = TavernService.error;
        int p = TavernService.progress;
        set(statusTitle, err != null ? "出错了" : TavernService.status);
        StringBuilder s = new StringBuilder();
        if (err != null) s.append(err);
        if ("running".equals(phase)) {
            long minutes = (System.currentTimeMillis() - TavernService.runningSince) / 60000;
            s.append("已运行 ").append(minutes).append(" 分钟 · 内存 ").append(memoryMbCached()).append(" MB");
        }
        if (TavernService.autoRestarts > 0) {
            if (s.length() > 0) s.append('\n');
            s.append("本次已自动重启 ").append(TavernService.autoRestarts).append(" 次（上次：").append(TavernService.lastExit).append("）");
        }
        set(statusDetail, s);
        show(statusDetail, s.length() > 0);
        int color = err != null || "failed".equals(phase) ? DANGER : "running".equals(phase) ? OK
                : "stopped".equals(phase) ? MUTED : WARN;
        if (color != dotColor) {
            dotColor = color;
            statusDot.setBackground(shape(color, 0, 6));
        }
        boolean busy = p >= 0 || "preparing".equals(phase) || "starting".equals(phase) || "stopping".equals(phase)
                || "downloading".equals(TavernService.updateState) || "checking".equals(TavernService.updateState);
        show(bar, busy);
        bar.setIndeterminate(p < 0);
        if (p >= 0) bar.setProgress(p);
        enter.setEnabled(url != null);
        set(enter, url != null ? "进入酒馆" : "进入酒馆（启动中…）");
        boolean active = "running".equals(phase) || "starting".equals(phase) || "preparing".equals(phase);
        set(startStop, active ? "停止" : "启动");
        restart.setEnabled("running".equals(phase) || "failed".equals(phase) || "stopped".equals(phase));

        String us = TavernService.updateState;
        set(updateText, TavernService.updateMessage.isEmpty() ? "点「检查更新」查看是否有新版本" : TavernService.updateMessage);
        updateText.setTextColor("error".equals(us) ? DANGER : INK);
        check.setEnabled(!"checking".equals(us) && !"downloading".equals(us));
        show(updateAction, "source".equals(us) || "apk".equals(us) || "ready".equals(us));
        set(updateAction, "source".equals(us) ? "更新源码" : "apk".equals(us) ? "下载安装包" : "安装");

        boolean lanOn = prefs().getBoolean("lanAccess", false);
        List<String> urls = TavernService.lanUrls();
        String lanErr = TavernService.lanError;
        if (!lanOn) {
            set(lanStatusText, "关闭时仅本机可访问。开启后可在同一 Wi-Fi 的电脑或平板浏览器里打开酒馆。");
            lanStatusText.setTextColor(MUTED);
            show(lanStatusText, true);
            show(lanUrlText, false);
            show(lanHintText, false);
            show(lanActionsRow, false);
        } else if ("running".equals(phase) && !urls.isEmpty()) {
            set(lanStatusText, "✓ 已开启，在同局域网设备的浏览器打开以下链接：");
            lanStatusText.setTextColor(OK);
            show(lanStatusText, true);
            set(lanUrlText, String.join("\n", urls));
            show(lanUrlText, true);
            show(lanHintText, true);
            show(lanActionsRow, true);
            show(lanCopy, true);
            show(lanShare, true);
            show(lanRefresh, true);
            lanRefresh.setEnabled(true);
        } else {
            show(lanUrlText, false);
            show(lanHintText, false);
            show(lanActionsRow, true);
            show(lanCopy, false);
            show(lanShare, false);
            show(lanRefresh, true);
            boolean transitioning = "preparing".equals(phase) || "starting".equals(phase) || "stopping".equals(phase);
            lanRefresh.setEnabled(!transitioning);
            if (lanErr != null && "running".equals(phase)) {
                set(lanStatusText, "⚠ " + lanErr);
                lanStatusText.setTextColor(WARN);
            } else if (transitioning) {
                set(lanStatusText, "正在应用局域网设置，服务就绪后显示访问链接…");
                lanStatusText.setTextColor(MUTED);
            } else {
                set(lanStatusText, "已开启，启动酒馆后生效。");
                lanStatusText.setTextColor(MUTED);
            }
            show(lanStatusText, true);
        }

        PowerManager pm = getSystemService(PowerManager.class);
        boolean exempt = pm.isIgnoringBatteryOptimizations(getPackageName());
        set(keepAliveText, (exempt ? "✓ 已允许后台运行（不受电池优化限制）" : "⚠ 受电池优化限制：锁屏后可能被系统停掉，建议允许后台运行")
                + (Build.VERSION.SDK_INT >= 31 ? "\nAndroid 12 起系统可能清理应用的后台子进程，酒馆服务被清理后会自动重启。频繁发生时，可在开发者选项里开启「停用子进程限制」。" : ""));
        set(batteryButton, exempt ? "电池优化设置" : "允许后台运行");
        set(logsToggle, logsVisible ? "隐藏日志" : "查看日志");
        String logs = logsVisible || err != null ? TavernService.tail() : "";
        set(logText, logs);
        show(logText, !logs.isEmpty());
        set(footerText, appVersion() + (TavernService.sourceInfo.isEmpty() ? "" : " · " + TavernService.sourceInfo));
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
        for (String name : new String[]{"update.log", "node.prev.log", "node.log"}) {
            File f = new File(dir, name);
            if (!f.exists()) continue;
            text.append("==== ").append(name).append(" ====\n").append(lastBytes(f, 48 * 1024)).append('\n');
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text.toString())
                .putExtra(Intent.EXTRA_SUBJECT, "DSH Tavern Beta 日志");
        startActivity(Intent.createChooser(send, "分享日志"));
    }

    private void copyLanUrl() {
        List<String> urls = TavernService.lanUrls();
        if (urls.isEmpty()) return;
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        if (cm != null) {
            cm.setPrimaryClip(ClipData.newPlainText("DSH Tavern 局域网链接", urls.get(0)));
            Toast.makeText(this, "已复制局域网访问链接", Toast.LENGTH_SHORT).show();
        }
    }

    private void shareLanUrl() {
        List<String> urls = TavernService.lanUrls();
        if (urls.isEmpty()) return;
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, String.join("\n", urls))
                .putExtra(Intent.EXTRA_SUBJECT, "DSH Tavern 局域网访问链接");
        startActivity(Intent.createChooser(send, "分享局域网访问链接"));
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

    // ---------------------------------------------------------------- 新版安装包提示

    private long noticeShownFor = -1;
    private AlertDialog noticeDialog;

    /** 停在启动页时弹一次：同一版本每次打开应用最多弹一次；「跳过此版本」后不再弹（强制更新除外）。 */
    private void maybeShowApkNotice() {
        org.json.JSONObject notice = TavernService.apkNotice;
        if (notice == null || isFinishing() || (noticeDialog != null && noticeDialog.isShowing())) return;
        long code = notice.optLong("versionCode");
        if (code == noticeShownFor) return;
        noticeShownFor = code;
        boolean forced = TavernService.apkForced;
        String page = notice.optString("page");
        String browserUrl = page.isEmpty() ? notice.optString("url") : page;
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(forced ? "需要更新安装包" : "有新版安装包")
                .setMessage(TavernService.apkMessage(notice) + "\n\n当前：" + appVersion()
                        + (forced ? "\n当前版本已停止支持，请更新后继续使用。" : "")
                        + "\n覆盖安装后存档和设置保留。")
                .setPositiveButton("下载安装", (d, w) -> {
                    TavernService.apkRelease = notice;
                    send(TavernService.ACTION_DOWNLOAD_APK);
                })
                .setNeutralButton("浏览器下载", (d, w) -> {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(browserUrl)));
                    } catch (Exception e) {
                        Toast.makeText(this, "无法打开浏览器：" + browserUrl, Toast.LENGTH_LONG).show();
                    }
                });
        if (forced) b.setCancelable(false);
        else b.setNegativeButton("跳过此版本", (d, w) -> {
            prefs().edit().putLong("skipApkVersion", code).apply();
            send(TavernService.ACTION_PREFS);
        });
        noticeDialog = b.show();
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
        setIntent(intent);
        send(TavernService.ACTION_START);
        // 从「有新版安装包」通知点进来：回到启动页并再弹一次提示。
        if (intent.getBooleanExtra(EXTRA_SHOW_UPDATE, false)) {
            showLauncher = true;
            noticeShownFor = -1;
            render();
        }
    }

    private long backPressedAt;

    @Override
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE) {
            if (web.canGoBack()) web.goBack();
            else {
                // 酒馆根页按返回：2 秒内连按两次才回到启动页，防止误触
                long now = android.os.SystemClock.elapsedRealtime();
                if (now - backPressedAt > 2000) {
                    backPressedAt = now;
                    Toast.makeText(this, "再按一次返回启动页", Toast.LENGTH_SHORT).show();
                    return;
                }
                backPressedAt = 0;
                showLauncher = true;
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

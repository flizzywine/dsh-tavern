package io.github.flizzywine.dshtavern.bionic;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import android.widget.TextView;

/** 状态页 + 全屏 WebView。服务给出带 token 的地址后切到 WebView。 */
public final class MainActivity extends Activity {
    private static final int PICK_FILES = 1;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ScrollView statusView;
    private TextView title;
    private TextView statusText;
    private ProgressBar bar;
    private TextView detail;
    private Button retry;
    private String loadedUrl;
    private ValueCallback<Uri[]> fileCallback;

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

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(56, 120, 56, 56);
        title = new TextView(this);
        title.setText("DSH Tavern");
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        column.addView(title);
        statusText = new TextView(this);
        statusText.setTextSize(15);
        statusText.setPadding(0, 40, 0, 24);
        column.addView(statusText);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        column.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        retry = new Button(this);
        retry.setText("重试");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> {
            TavernService.error = null;
            TavernService.status = "正在重新启动";
            startForegroundService(new Intent(this, TavernService.class));
        });
        column.addView(retry, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        // 日志只在出错时显示：正常启动的提示信息不该看起来像报错。
        detail = new TextView(this);
        detail.setTextSize(11);
        detail.setTypeface(Typeface.MONOSPACE);
        detail.setTextIsSelectable(true);
        detail.setPadding(0, 32, 0, 0);
        column.addView(detail);
        statusView = new ScrollView(this);
        statusView.addView(column);
        root.addView(statusView);

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
        root.addView(web);
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2);
        }
        startForegroundService(new Intent(this, TavernService.class));
        handler.post(poll);
    }

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            String url = TavernService.url;
            if (url != null) {
                if (!url.equals(loadedUrl)) {
                    loadedUrl = url;
                    web.loadUrl(url);
                }
                web.setVisibility(View.VISIBLE);
                statusView.setVisibility(View.GONE);
            } else {
                web.setVisibility(View.GONE);
                statusView.setVisibility(View.VISIBLE);
                int p = TavernService.progress;
                String err = TavernService.error;
                statusText.setText(err != null ? "启动失败：" + err : TavernService.status);
                bar.setVisibility(err != null ? View.GONE : View.VISIBLE);
                bar.setIndeterminate(p < 0);
                if (p >= 0) bar.setProgress(p);
                retry.setVisibility(err != null ? View.VISIBLE : View.GONE);
                detail.setText(err != null ? TavernService.tail() : "");
            }
            handler.postDelayed(this, 400);
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
    public void onBackPressed() {
        if (web.getVisibility() == View.VISIBLE && web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // 服务继续在后台运行
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(poll);
        web.destroy();
        super.onDestroy();
    }
}

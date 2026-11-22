package io.github.flizzywine.dshtavern.bionic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.os.Build;
import android.os.IBinder;
import android.system.Os;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * 前台服务：首次运行把 assets/payload.bin 解到 files/t，然后用 nativeLibraryDir 里的 libnode.so
 * （Termux 编译的 bionic Node）拉起酒馆 DSH。不用 proot、不带 Ubuntu。
 */
public final class TavernService extends Service {
    static final int PORT = 3081;
    private static final String CHANNEL = "tavern";
    // 参数名拆开写：避免被日志脱敏误伤。
    private static final Pattern URL = Pattern.compile("dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?" + "tok" + "en=\\S+)");

    static volatile String status = "准备中";
    static volatile String url;
    static volatile String error;
    static volatile int progress = -1;
    private static final ArrayDeque<String> tail = new ArrayDeque<>();

    private Thread worker;
    private volatile Process process;

    static String tail() {
        synchronized (tail) {
            return String.join("\n", tail);
        }
    }

    private static void log(String line) {
        synchronized (tail) {
            tail.addLast(line);
            while (tail.size() > 40) tail.removeFirst();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "酒馆服务", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("DSH Tavern 正在运行")
                .setContentText("本机酒馆服务")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(this::run, "tavern-main");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Process p = process;
        if (p != null) p.destroy();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void run() {
        try {
            error = null;
            url = null;
            File root = new File(getFilesDir(), "t");
            String expected = "/data/user/0/" + getPackageName() + "/files/t";
            // 原型的路径在打包时写死（profile 配置、pnpm 锁文件里是绝对路径）。
            if (!root.getAbsolutePath().equals(expected)) throw new IOException("数据目录不是 " + expected + "（多用户/工作资料暂不支持）：" + root);
            ensurePayload(root);
            launch(root);
        } catch (Throwable t) {
            status = "失败";
            error = String.valueOf(t);
            log(android.util.Log.getStackTraceString(t));
        }
    }

    private long versionCode() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return info.getLongVersionCode() * 1000003L + info.lastUpdateTime % 1000003L;
    }

    private void ensurePayload(File root) throws Exception {
        File marker = new File(getFilesDir(), "payload-" + versionCode() + ".done");
        if (marker.exists()) return;
        status = "正在解压（首次启动）";
        progress = 0;
        long started = System.currentTimeMillis();
        // 解包覆盖程序文件；用户数据（profile-data）里的已有文件同样会被包里的初始文件覆盖——原型阶段可接受。
        root.mkdirs();
        try (AssetFileDescriptor fd = getAssets().openFd("payload.bin")) {
            final long total = fd.getLength();
            InputStream raw = new FilterInputStream(fd.createInputStream()) {
                long done;

                @Override
                public int read(byte[] b, int off, int len) throws IOException {
                    int n = super.read(b, off, len);
                    if (n > 0) {
                        done += n;
                        progress = (int) (done * 100 / total);
                    }
                    return n;
                }
            };
            try (InputStream in = new GZIPInputStream(new BufferedInputStream(raw, 1 << 20), 1 << 16)) {
                new TarExtractor(root).extract(in);
            }
        }
        File[] old = getFilesDir().listFiles((dir, name) -> name.startsWith("payload-") && name.endsWith(".done"));
        if (old != null) for (File f : old) f.delete();
        marker.createNewFile();
        log("解压完成，用时 " + (System.currentTimeMillis() - started) / 1000 + " 秒");
        progress = -1;
    }

    private void launch(File root) throws Exception {
        File node = new File(getApplicationInfo().nativeLibraryDir, "libnode.so");
        File home = new File(root, "home");
        File dsh = new File(home, ".dsh-tavern");
        File tmp = new File(root, "tmp");
        tmp.mkdirs();
        File credentials = new File(dsh, ".credentials.yaml");
        if (credentials.exists()) Os.chmod(credentials.getPath(), 0600);

        List<String> command = new ArrayList<>();
        command.add(node.getPath());
        command.add("--max-old-space-size=1024");
        // Termux 的 node 默认读 Termux 路径下的 CA 文件，APK 里没有 → 所有 HTTPS 都校验失败。改用 Node 自带证书库。
        command.add("--use-bundled-ca");
        command.add("--expose-internals");
        command.add("--require");
        command.add(root + "/usr/lib/dsh-android/preload.cjs");
        command.add(dsh + "/runtime/lib/node_modules/@deepseek-ai/dsh/lib/bin.js");
        command.add("--profile");
        command.add("tavern");
        command.add("--host");
        command.add("127.0.0.1");
        command.add("--port");
        command.add(String.valueOf(PORT));
        command.add("--no-open");

        ProcessBuilder pb = new ProcessBuilder(command);
        Map<String, String> env = pb.environment();
        env.clear();
        env.put("HOME", home.getPath());
        env.put("TMPDIR", tmp.getPath());
        env.put("PATH", "/system/bin:/system/xbin");
        env.put("ANDROID_ROOT", "/system");
        env.put("ANDROID_DATA", "/data");
        env.put("LANG", "zh_CN.UTF-8");
        env.put("DSH_HOME", dsh.getPath());
        env.put("DSH_TAVERN_CLI_HOME", dsh.getPath());
        env.put("DSH_TAVERN_RUNTIME_HOST", "cli");
        // 继承环境的子进程（如安装/更新脚本里的 node）同样用自带证书库。
        env.put("NODE_OPTIONS", "--use-bundled-ca");
        // 调试钩子（原型）：files/t/extra-env 里的 KEY=VALUE 追加进环境，例如验收用的固定输出模型。
        File extra = new File(root, "extra-env");
        if (extra.exists()) {
            for (String line : Files.readAllLines(extra.toPath(), StandardCharsets.UTF_8)) {
                int eq = line.indexOf('=');
                if (eq > 0 && !line.startsWith("#")) env.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
            }
        }
        pb.directory(new File(root, "src"));
        pb.redirectErrorStream(true);

        File logs = new File(getFilesDir(), "logs");
        logs.mkdirs();
        status = "正在启动酒馆";
        long started = System.currentTimeMillis();
        Process p = pb.start();
        process = p;
        try (OutputStream file = new FileOutputStream(new File(logs, "node.log"));
             BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                file.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                file.flush();
                log(line);
                if (url == null) {
                    Matcher m = URL.matcher(line);
                    if (m.find()) {
                        url = m.group(1);
                        status = "运行中（启动用时 " + (System.currentTimeMillis() - started) + " ms）";
                    }
                }
            }
        }
        int code = p.waitFor();
        url = null;
        status = "已退出";
        error = "酒馆服务已退出，退出码 " + code;
    }
}

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
import android.net.ConnectivityManager;
import android.net.ProxyInfo;
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
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
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

    /** 程序文件：每次换 APK 整体替换。其余（存档、凭据、模型设置 cordis.patch.yml 等）只在缺失时播种。 */
    static final String PROFILE = "home/.dsh-tavern/profiles/tavern/";
    static final String USER_CONFIG = PROFILE + "cordis.patch.yml";
    static final String[] PROGRAM_DIRS = {"src/", "usr/", "home/.dsh-tavern/runtime/"};

    static boolean isProgram(String path) {
        if (path.startsWith(".payload-")) return true;
        for (String dir : PROGRAM_DIRS) if (path.startsWith(dir)) return true;
        return path.startsWith(PROFILE) && !path.equals(USER_CONFIG);
    }

    private void ensurePayload(File root) throws Exception {
        File marker = new File(getFilesDir(), "payload-" + versionCode() + ".done");
        if (marker.exists()) return;
        boolean upgrade = new File(root, "home").isDirectory();
        long started = System.currentTimeMillis();
        root.mkdirs();
        if (upgrade) {
            status = "正在替换程序文件（存档和设置保留）";
            for (String dir : PROGRAM_DIRS) deleteTree(new File(root, dir));
            File profile = new File(root, PROFILE);
            File[] children = profile.listFiles();
            if (children != null) for (File child : children) if (!child.getName().equals("cordis.patch.yml")) deleteTree(child);
        }
        status = upgrade ? "正在更新程序文件" : "首次启动，正在解压（约 1.3 GB，通常二三十秒）";
        progress = 0;
        TarExtractor extractor = new TarExtractor(root, path -> !isProgram(path));
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
                extractor.extract(in);
            }
        }
        rewriteRoot(root);
        File[] old = getFilesDir().listFiles((dir, name) -> name.startsWith("payload-") && name.endsWith(".done"));
        if (old != null) for (File f : old) f.delete();
        marker.createNewFile();
        log((upgrade ? "程序文件已更新" : "解压完成") + "：写入 " + extractor.written + " 个，保留已有用户文件 " + extractor.kept
                + " 个，用时 " + (System.currentTimeMillis() - started) / 1000 + " 秒");
        progress = -1;
    }

    /** 载荷按打包时的设备路径生成；实际数据目录不同（多用户、工作资料）时改写记录在案的文件。 */
    private void rewriteRoot(File root) throws IOException {
        File built = new File(root, ".payload-root");
        File list = new File(root, ".payload-root-files");
        if (!built.exists() || !list.exists()) return;
        String from = new String(Files.readAllBytes(built.toPath()), StandardCharsets.UTF_8).trim();
        String to = root.getAbsolutePath();
        if (from.equals(to)) return;
        int changed = 0;
        for (String line : Files.readAllLines(list.toPath(), StandardCharsets.UTF_8)) {
            if (line.isEmpty()) continue;
            Path file = new File(root, line).toPath();
            if (!Files.isRegularFile(file, java.nio.file.LinkOption.NOFOLLOW_LINKS)) continue;
            String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            if (!text.contains(from)) continue;
            Files.write(file, text.replace(from, to).getBytes(StandardCharsets.UTF_8));
            changed++;
        }
        log("数据目录为 " + to + "，已改写 " + changed + " 个文件中的路径");
    }

    /** 递归删除，不跟随软链接（node_modules 里的链接指向 src）。 */
    private static void deleteTree(File file) throws IOException {
        Path path = file.toPath();
        if (!Files.exists(path, java.nio.file.LinkOption.NOFOLLOW_LINKS)) return;
        Files.walkFileTree(path, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult visitFile(Path p, BasicFileAttributes attrs) throws IOException {
                Files.delete(p);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path p, IOException e) throws IOException {
                if (e != null) throw e;
                Files.delete(p);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private String systemProxy() {
        try {
            ProxyInfo info = getSystemService(ConnectivityManager.class).getDefaultProxy();
            if (info == null || info.getHost() == null || info.getHost().isEmpty() || info.getPort() <= 0) return null;
            return "http://" + info.getHost() + ":" + info.getPort();
        } catch (Exception e) {
            return null;
        }
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
        // 整体分发：更新靠覆盖安装新 APK，应用内更新器只做检查。
        env.put("DSH_TAVERN_UPDATE_CHANNEL", "apk");
        // 系统 / VPN 下发的 HTTP 代理（Clash 等的「系统代理」）。应用进程读不到 settings，由这里传入。
        String proxy = systemProxy();
        if (proxy != null) {
            env.put("HTTP_PROXY", proxy);
            env.put("HTTPS_PROXY", proxy);
            env.put("NO_PROXY", "127.0.0.1,localhost,::1");
            env.put("NODE_USE_ENV_PROXY", "1");
            log("使用系统代理 " + proxy);
        }
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

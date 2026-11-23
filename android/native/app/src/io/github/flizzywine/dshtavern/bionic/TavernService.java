package io.github.flizzywine.dshtavern.bionic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.ServiceInfo;
import android.content.res.AssetFileDescriptor;
import android.net.ConnectivityManager;
import android.net.ProxyInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.system.Os;

import org.json.JSONObject;

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
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * 前台服务：首次运行把 assets/payload.bin 解到 files/t，用 nativeLibraryDir 里的 libnode.so（Termux 编译的
 * bionic Node）拉起酒馆 DSH。负责启停、意外退出后自动重启、唤醒锁，以及两档更新（源码热更新 / 新版 APK）。
 * 所有操作在一个串行线程里执行；界面通过静态字段读取状态。
 */
public final class TavernService extends Service {
    static final int PORT = 3081;
    static final String ACTION_START = "start", ACTION_STOP = "stop", ACTION_RESTART = "restart", ACTION_EXIT = "exit",
            ACTION_RESET = "reset", ACTION_CHECK = "check", ACTION_SOURCE_UPDATE = "source-update",
            ACTION_DOWNLOAD_APK = "download-apk", ACTION_PREFS = "prefs";
    static final String PREFS = "launcher";
    private static final String CHANNEL = "tavern";
    // 参数名拆开写：避免被日志脱敏误伤。
    private static final Pattern URL = Pattern.compile("dsh web: (http://127\\.0\\.0\\.1:\\d+/\\?" + "tok" + "en=\\S+)");
    private static final Pattern TOOL_STATUS = Pattern.compile("^DSH_STATUS (.*)$");

    // ---- 给界面看的状态 ----
    static volatile String phase = "idle"; // idle preparing starting running stopping stopped updating failed
    static volatile String status = "准备中";
    static volatile String url;
    static volatile String error;
    static volatile int progress = -1;
    static volatile long runningSince;
    static volatile String lastExit;
    static volatile int autoRestarts;
    static volatile String sourceInfo = "";
    // 更新
    static volatile String updateState = "idle"; // idle checking up-to-date source apk needs-apk downloading ready error
    static volatile String updateMessage = "";
    static volatile JSONObject apkRelease;
    static volatile String apkFile;
    private static final ArrayDeque<String> tail = new ArrayDeque<>();

    private final ExecutorService ops = Executors.newSingleThreadExecutor();
    private volatile Process process;
    private volatile boolean wantRunning;
    private volatile boolean stopping;
    private final ArrayDeque<Long> crashes = new ArrayDeque<>();
    private PowerManager.WakeLock wakeLock;
    private File root;

    static String tail() {
        synchronized (tail) {
            return String.join("\n", tail);
        }
    }

    static void log(String line) {
        synchronized (tail) {
            tail.addLast(line);
            while (tail.size() > 80) tail.removeFirst();
        }
    }

    static Intent intent(Context context, String action) {
        return new Intent(context, TavernService.class).setAction(action);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        root = new File(getFilesDir(), "t");
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "酒馆服务", NotificationManager.IMPORTANCE_LOW));
        Notification n = notification("正在准备");
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
        PowerManager pm = getSystemService(PowerManager.class);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dshtavern:server");
        wakeLock.setReferenceCounted(false);
    }

    private int statIcon() {
        int id = getResources().getIdentifier("ic_stat_tavern", "drawable", getPackageName());
        return id != 0 ? id : android.R.drawable.ic_dialog_info;
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent exit = PendingIntent.getService(this, 1, intent(this, ACTION_EXIT), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setContentTitle("DSH Tavern Beta")
                .setContentText(text)
                .setSmallIcon(statIcon())
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "退出", exit).build())
                .setOngoing(true)
                .build();
    }

    private void notify(String text) {
        getSystemService(NotificationManager.class).notify(1, notification(text));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null || intent.getAction() == null ? ACTION_START : intent.getAction();
        // 被系统杀掉后重建（START_STICKY 送来 null intent）：用户之前想让它运行，就接着运行。
        ops.execute(() -> handle(action));
        return START_STICKY;
    }

    private void handle(String action) {
        try {
            switch (action) {
                case ACTION_START:
                    wantRunning = true;
                    if (process == null) startServer();
                    break;
                case ACTION_STOP:
                    wantRunning = false;
                    stopServer();
                    setPhase("stopped", "已停止");
                    break;
                case ACTION_RESTART:
                    wantRunning = true;
                    stopServer();
                    startServer();
                    break;
                case ACTION_EXIT:
                    wantRunning = false;
                    stopServer();
                    setPhase("stopped", "已退出");
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                    break;
                case ACTION_RESET:
                    wantRunning = true;
                    stopServer();
                    ensurePayload(true);
                    startServer();
                    break;
                case ACTION_CHECK:
                    checkUpdates();
                    break;
                case ACTION_SOURCE_UPDATE:
                case ACTION_DOWNLOAD_APK:
                    try {
                        if (ACTION_SOURCE_UPDATE.equals(action)) sourceUpdate();
                        else downloadApk();
                    } catch (Throwable t) {
                        // 更新失败不等于服务失败：服务照常运行（sourceUpdate 自己负责回退）。
                        progress = -1;
                        updateState = "error";
                        updateMessage = "更新失败：" + (t.getMessage() != null ? t.getMessage() : t);
                        log(android.util.Log.getStackTraceString(t));
                        if (wantRunning && process == null) startServer();
                    }
                    break;
                case ACTION_PREFS:
                    applyWakeLock();
                    break;
                default:
                    break;
            }
        } catch (Throwable t) {
            error = String.valueOf(t.getMessage() != null ? t.getMessage() : t);
            setPhase("failed", "失败");
            log(android.util.Log.getStackTraceString(t));
        }
    }

    @Override
    public void onDestroy() {
        wantRunning = false;
        Process p = process;
        if (p != null) p.destroy();
        if (wakeLock.isHeld()) wakeLock.release();
        ops.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void setPhase(String newPhase, String text) {
        phase = newPhase;
        status = text;
        notify(text);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void applyWakeLock() {
        // 熄屏后 CPU 休眠会让 Node 的事件循环停住：生成到一半的回复、后台结算都会卡住。
        boolean want = prefs().getBoolean("wakelock", true) && process != null;
        if (want && !wakeLock.isHeld()) wakeLock.acquire();
        if (!want && wakeLock.isHeld()) wakeLock.release();
    }

    // ---------------------------------------------------------------- 载荷

    private long versionCode() throws Exception {
        return getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
    }

    private long installStamp() throws Exception {
        PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
        return info.getLongVersionCode() * 1000003L + info.lastUpdateTime % 1000003L;
    }

    /** 程序文件：每次换 APK 整体替换。其余（存档、凭据、模型设置 cordis.patch.yml 等）只在缺失时播种。 */
    static final String PROFILE = "home/.dsh-tavern/profiles/tavern/";
    static final String USER_CONFIG = PROFILE + "cordis.patch.yml";
    static final String[] PROGRAM_DIRS = {"src/", "usr/", "home/.dsh-tavern/runtime/", "pnpm-cache/"};

    static boolean isProgram(String path) {
        if (path.startsWith(".payload-")) return true;
        for (String dir : PROGRAM_DIRS) if (path.startsWith(dir)) return true;
        return path.startsWith(PROFILE) && !path.equals(USER_CONFIG);
    }

    private JSONObject readJson(File file) {
        try {
            return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private JSONObject payloadSource() {
        try (InputStream in = getAssets().open("payload-source.json")) {
            return new JSONObject(new String(readAll(in), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    /** 热更新过、比 APK 自带的新、且依赖相同的源码：覆盖安装 APK 时保留。 */
    private boolean keepHotUpdatedSource() {
        JSONObject installed = readJson(new File(root, "src/.native-source.json"));
        JSONObject bundled = payloadSource();
        if (installed == null || bundled == null) return false;
        return "hot-update".equals(installed.optString("from"))
                && installed.optLong("sequence") > bundled.optLong("sequence")
                && installed.optString("fingerprint").equals(bundled.optString("fingerprint"));
    }

    private void ensurePayload(boolean force) throws Exception {
        File marker = new File(getFilesDir(), "payload-" + installStamp() + ".done");
        if (marker.exists() && !force) return;
        setPhase("preparing", "正在准备程序文件");
        boolean upgrade = new File(root, "home").isDirectory();
        boolean keepSource = upgrade && !force && keepHotUpdatedSource();
        long started = System.currentTimeMillis();
        root.mkdirs();
        if (upgrade) {
            status = force ? "正在重置程序文件（存档和设置保留）" : "正在替换程序文件（存档和设置保留）";
            for (String dir : PROGRAM_DIRS) {
                if (keepSource && dir.equals("src/")) continue;
                deleteTree(new File(root, dir));
            }
            deleteTree(new File(root, "src.next"));
            deleteTree(new File(root, "pnpm-store"));
            deleteTree(new File(root, "update-backup"));
            if (!keepSource) deleteTree(new File(root, "src.prev"));
            File profile = new File(root, PROFILE);
            File[] children = profile.listFiles();
            if (children != null) for (File child : children) if (!child.getName().equals("cordis.patch.yml")) deleteTree(child);
        }
        status = upgrade ? status : "首次启动，正在解压（约 1.3 GB，通常二三十秒）";
        progress = 0;
        TarExtractor extractor = new TarExtractor(root, path -> !isProgram(path), path -> keepSource && path.startsWith("src/"));
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
        log((upgrade ? "程序文件已更新" : "解压完成") + "：写入 " + extractor.written + " 个，保留已有文件 " + extractor.kept
                + " 个" + (keepSource ? "（保留热更新过的源码）" : "") + "，用时 " + (System.currentTimeMillis() - started) / 1000 + " 秒");
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
            if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) continue;
            String text = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            if (!text.contains(from)) continue;
            Files.write(file, text.replace(from, to).getBytes(StandardCharsets.UTF_8));
            changed++;
        }
        log("数据目录为 " + to + "，已改写 " + changed + " 个文件中的路径");
    }

    /** 递归删除，不跟随软链接（node_modules 里的链接指向 src）。 */
    static void deleteTree(File file) throws IOException {
        Path path = file.toPath();
        if (!Files.exists(path, LinkOption.NOFOLLOW_LINKS)) return;
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

    // ---------------------------------------------------------------- 进程

    private File node() {
        return new File(getApplicationInfo().nativeLibraryDir, "libnode.so");
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

    private void baseEnvironment(Map<String, String> env) throws IOException {
        File home = new File(root, "home");
        File dsh = new File(home, ".dsh-tavern");
        File tmp = new File(root, "tmp");
        tmp.mkdirs();
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
        // 继承环境的子进程（如模板 worker 以外的 node 子进程）同样用自带证书库：Termux 的 CA 路径在 APK 里不存在。
        env.put("NODE_OPTIONS", "--use-bundled-ca");
        // 整体分发：更新由启动页负责，酒馆里的更新器只做检查。
        env.put("DSH_TAVERN_UPDATE_CHANNEL", "apk");
        String proxy = systemProxy();
        if (proxy != null) {
            env.put("HTTP_PROXY", proxy);
            env.put("HTTPS_PROXY", proxy);
            env.put("NO_PROXY", "127.0.0.1,localhost,::1");
            env.put("NODE_USE_ENV_PROXY", "1");
        }
        // 调试钩子：files/t/extra-env 里的 KEY=VALUE 追加进环境（验收用的固定输出模型、测试用的更新源）。
        File extra = new File(root, "extra-env");
        if (extra.exists()) {
            for (String line : Files.readAllLines(extra.toPath(), StandardCharsets.UTF_8)) {
                int eq = line.indexOf('=');
                if (eq > 0 && !line.startsWith("#")) env.put(line.substring(0, eq).trim(), line.substring(eq + 1).trim());
            }
        }
    }

    private void startServer() throws Exception {
        ensurePayload(false);
        File dsh = new File(root, "home/.dsh-tavern");
        File credentials = new File(dsh, ".credentials.yaml");
        if (credentials.exists()) Os.chmod(credentials.getPath(), 0600);
        sourceInfo = describeSource();

        List<String> command = new ArrayList<>();
        command.add(node().getPath());
        command.add("--max-old-space-size=1024");
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
        baseEnvironment(pb.environment());
        if (systemProxy() != null) log("使用系统代理 " + systemProxy());
        pb.directory(new File(root, "src"));
        pb.redirectErrorStream(true);

        File logs = new File(getFilesDir(), "logs");
        logs.mkdirs();
        rotate(new File(logs, "node.log"));
        error = null;
        url = null;
        setPhase("starting", "正在启动酒馆");
        long started = System.currentTimeMillis();
        stopping = false;
        Process p = pb.start();
        process = p;
        applyWakeLock();
        Thread reader = new Thread(() -> pump(p, new File(logs, "node.log"), started), "tavern-log");
        reader.start();
    }

    private static void rotate(File log) {
        if (log.exists() && log.length() > 0) log.renameTo(new File(log.getParentFile(), "node.prev.log"));
    }

    private void pump(Process p, File logFile, long started) {
        try (OutputStream file = new FileOutputStream(logFile);
             BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                file.write((line + "\n").getBytes(StandardCharsets.UTF_8));
                file.flush();
                log(line);
                if (url == null && process == p) {
                    Matcher m = URL.matcher(line);
                    if (m.find()) {
                        url = m.group(1);
                        runningSince = System.currentTimeMillis();
                        setPhase("running", "运行中（启动用时 " + (System.currentTimeMillis() - started) + " ms）");
                    }
                }
            }
        } catch (IOException ignored) {
        }
        int code;
        try {
            code = p.waitFor();
        } catch (InterruptedException e) {
            return;
        }
        if (process != p) return;
        process = null;
        url = null;
        applyWakeLock();
        lastExit = "退出码 " + code + (code > 128 ? "（信号 " + (code - 128) + "）" : "") + "，"
                + new java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(new java.util.Date());
        if (stopping || !wantRunning) return;
        // 意外退出：系统杀后台子进程（Android 12+ phantom process）、内存不足或程序崩溃。5 分钟内最多自动重启 3 次。
        long now = System.currentTimeMillis();
        synchronized (crashes) {
            crashes.addLast(now);
            while (!crashes.isEmpty() && now - crashes.peekFirst() > 5 * 60_000) crashes.removeFirst();
            if (crashes.size() > 3) {
                error = "酒馆服务 5 分钟内意外退出了 " + crashes.size() + " 次，已停止自动重启（" + lastExit + "）";
                setPhase("failed", "反复退出");
                return;
            }
        }
        autoRestarts++;
        setPhase("starting", "酒馆服务意外退出（" + lastExit + "），正在自动重启");
        log("服务意外退出（" + lastExit + "），2 秒后自动重启");
        ops.execute(() -> {
            try {
                Thread.sleep(2000);
                if (wantRunning && process == null) startServer();
            } catch (Throwable t) {
                error = String.valueOf(t);
                setPhase("failed", "自动重启失败");
            }
        });
    }

    private void stopServer() throws InterruptedException {
        Process p = process;
        if (p == null) return;
        stopping = true;
        setPhase("stopping", "正在停止");
        p.destroy();
        if (!p.waitFor(8, TimeUnit.SECONDS)) p.destroyForcibly().waitFor(3, TimeUnit.SECONDS);
        process = null;
        url = null;
        applyWakeLock();
    }

    private boolean waitRunning(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            if (url != null) return true;
            if (process == null) return false;
            Thread.sleep(300);
        }
        return url != null;
    }

    private String describeSource() {
        JSONObject s = readJson(new File(root, "src/.native-source.json"));
        if (s == null) return "";
        String rev = s.optString("revision");
        return "酒馆 v" + s.optString("version") + " · " + (rev.length() > 7 ? rev.substring(0, 7) : rev)
                + ("hot-update".equals(s.optString("from")) ? "（已热更新）" : "");
    }

    // ---------------------------------------------------------------- 更新

    /** 用 libnode.so 跑 source-update.mjs，转发 DSH_STATUS，返回 RESULT。 */
    private JSONObject tool(String... args) throws Exception {
        List<String> command = new ArrayList<>();
        command.add(node().getPath());
        command.add("--use-bundled-ca");
        command.add(root + "/usr/lib/dsh-android/source-update.mjs");
        for (String a : args) command.add(a);
        command.add("--root");
        command.add(root.getPath());
        ProcessBuilder pb = new ProcessBuilder(command);
        baseEnvironment(pb.environment());
        pb.directory(root);
        pb.redirectErrorStream(true);
        Process p = pb.start();
        JSONObject result = null;
        StringBuilder other = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                Matcher m = TOOL_STATUS.matcher(line);
                if (m.find()) updateMessage = m.group(1);
                else if (line.startsWith("RESULT ")) result = new JSONObject(line.substring(7));
                else if (other.length() < 4000) other.append(line).append('\n');
            }
        }
        p.waitFor();
        if (result == null) throw new IOException("更新工具没有返回结果：" + other);
        if ("error".equals(result.optString("kind"))) throw new IOException(result.optString("error"));
        return result;
    }

    private void checkUpdates() {
        updateState = "checking";
        updateMessage = "正在检查更新";
        try {
            JSONObject r = tool("check", "--apk-version-code", String.valueOf(versionCode()));
            JSONObject apk = r.optJSONObject("apk");
            apkRelease = apk != null && apk.optBoolean("available") ? apk : null;
            String source = r.optString("source");
            JSONObject latest = r.optJSONObject("latest");
            String latestText = latest == null ? "" : "v" + latest.optString("version") + " · " + latest.optString("revision").substring(0, 7);
            if ("available".equals(source)) {
                updateState = "source";
                String deps = r.optString("deps");
                updateMessage = "true".equals(deps)
                        ? "有新版酒馆 " + latestText + "：依赖有变化，更新时会在手机上补装变化的包（需联网，几分钟，存档和设置保留）"
                        : "maybe".equals(deps)
                        ? "有新版酒馆 " + latestText + "：依赖可能有变化，更新时会在手机上补装变化的包（存档和设置保留）"
                        : "有新版酒馆 " + latestText + "：依赖没变，可以直接更新源码（约 17 MB，存档和设置保留）";
            } else if (apkRelease != null) {
                updateState = "apk";
                updateMessage = "有新版安装包 " + apkRelease.optString("versionName") + "（" + apkRelease.optLong("size") / 1048576 + " MB）";
            } else if ("needs-apk".equals(source)) {
                updateState = "needs-apk";
                updateMessage = "有新版酒馆 " + latestText + "，但更换了 DSH 运行时，需要新版安装包；对应的安装包还没发布";
            } else if ("error".equals(source)) {
                updateState = "error";
                updateMessage = "检查失败：" + r.optString("sourceError");
            } else {
                updateState = "up-to-date";
                JSONObject cur = r.optJSONObject("current");
                updateMessage = "已是最新" + (cur == null ? "" : "（v" + cur.optString("version") + " · " + cur.optString("revision").substring(0, 7) + "）");
            }
        } catch (Throwable t) {
            updateState = "error";
            updateMessage = "检查失败：" + (t.getMessage() != null ? t.getMessage() : t);
        }
    }

    private void sourceUpdate() throws Exception {
        updateState = "downloading";
        updateMessage = "正在下载新源码";
        JSONObject staged = tool("stage");
        String kind = staged.optString("kind");
        if ("needs-apk".equals(kind)) {
            updateState = "needs-apk";
            updateMessage = staged.optString("reason");
            return;
        }
        if ("up-to-date".equals(kind)) {
            updateState = "up-to-date";
            updateMessage = "已是最新";
            return;
        }
        boolean deps = staged.optBoolean("deps");
        wantRunning = true;
        stopServer();
        // 与命令行版更新相同：换源码后跑一遍安装器（补装变化的依赖、刷新内置插件与配置）。
        // 依赖有变化时 node_modules 先整份备份，任何一步失败都能原样换回。
        boolean ok = false;
        String failure = null;
        try {
            updateMessage = "正在切换到新源码";
            if (deps) tool("swap", "--copy-modules");
            else tool("swap");
            updateMessage = "正在备份当前配置";
            if (deps) tool("backup", "--modules");
            else tool("backup");
            updateMessage = deps ? "正在补装变化的依赖" : "正在刷新配置";
            JSONObject installed = tool("install");
            log("安装器完成，用时 " + installed.optLong("ms") / 1000 + " 秒");
            updateMessage = "正在启动新版本";
            startServer();
            ok = waitRunning(180_000);
            if (!ok) failure = "新版本启动失败（" + lastExit + "）";
        } catch (Throwable t) {
            failure = t.getMessage() != null ? t.getMessage() : String.valueOf(t);
        }
        if (ok) {
            tool("commit");
            updateState = "up-to-date";
            updateMessage = "已更新到 " + describeSource() + (deps ? "（依赖已在手机上补装）" : "");
            log(updateMessage);
            return;
        }
        // 新版本装不上或起不来：换回旧的，别让用户卡在打不开的状态。
        log("更新失败，正在回退：" + failure);
        stopServer();
        tool("rollback");
        startServer();
        updateState = "error";
        updateMessage = "更新失败，已回退到原来的版本：" + failure + "（详情见日志 update.log）";
    }

    /** 流式下载并边下边算 SHA-256：安装包四百多 MB，不能整个读进内存。系统代理由 HttpURLConnection 自动使用。 */
    private void downloadApk() throws Exception {
        JSONObject release = apkRelease;
        if (release == null) throw new IOException("没有可下载的安装包，请先检查更新");
        updateState = "downloading";
        updateMessage = "正在下载安装包";
        File dir = new File(getCacheDir(), "apk");
        deleteTree(dir);
        dir.mkdirs();
        File part = new File(dir, "download.part");
        File target = new File(dir, "dsh-tavern-" + release.optLong("versionCode") + ".apk");
        long size = release.optLong("size");
        java.security.MessageDigest sha = java.security.MessageDigest.getInstance("SHA-256");
        java.net.URL link = new java.net.URL(release.getString("url"));
        for (int hop = 0; hop < 6; hop++) {
            java.net.HttpURLConnection c = (java.net.HttpURLConnection) link.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20_000);
            c.setReadTimeout(60_000);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                link = new java.net.URL(link, c.getHeaderField("Location"));
                c.disconnect();
                continue;
            }
            if (code != 200) throw new IOException("下载安装包失败：HTTP " + code);
            long done = 0, reported = 0;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[1 << 16];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    sha.update(buf, 0, n);
                    done += n;
                    if (done - reported > (1 << 20)) {
                        reported = done;
                        progress = size > 0 ? (int) Math.min(99, done * 100 / size) : -1;
                        updateMessage = "正在下载安装包 " + done / 1048576 + " / " + size / 1048576 + " MB";
                    }
                }
            } finally {
                c.disconnect();
            }
            progress = -1;
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equalsIgnoreCase(release.getString("sha256"))) {
                part.delete();
                throw new IOException("安装包校验失败（SHA-256 不符），已删除，请重试");
            }
            if (!part.renameTo(target)) throw new IOException("无法保存安装包");
            apkFile = target.getPath();
            updateState = "ready";
            updateMessage = "安装包已下载并校验，点「安装」覆盖安装（存档和设置保留）";
            return;
        }
        throw new IOException("下载安装包失败：重定向次数过多");
    }
}

package io.github.flizzywine.dshtavern.bionic;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 原生 APK 内嵌 WebView 的文件下载实现：
 * - HTTP/HTTPS 下载：带 Cookie 流式写入公共「下载」目录（MediaStore.Downloads，API 30+ 无需存储权限）
 * - Blob / Data 下载：通过 JS 桥接（DshNativeDownload）分块写入，兼容小备份包、世界书、预设、人物卡等导出
 */
final class WebDownloads {
    static final String JS_BRIDGE_NAME = "DshNativeDownload";

    private static final Pattern FILENAME_STAR = Pattern.compile(
            "(?i)filename\\*\\s*=\\s*(?:\"([^\"]*)\"|([^;\\s]+))");
    private static final Pattern FILENAME_PLAIN = Pattern.compile(
            "(?i)filename\\s*=\\s*(?:\"([^\"]*)\"|([^;\\s]+))");

    private final Context context;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Map<String, PendingSave> pending = new ConcurrentHashMap<>();

    WebDownloads(Context context, WebView web) {
        this.context = context.getApplicationContext();
        this.web = web;
    }

    void attach() {
        web.addJavascriptInterface(new Bridge(), JS_BRIDGE_NAME);
        web.setDownloadListener(this::onDownloadStart);
    }

    void destroy() {
        io.shutdownNow();
        for (String id : pending.keySet()) {
            PendingSave item = pending.remove(id);
            if (item != null) item.abort(context.getContentResolver());
        }
    }

    private void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
        if (url == null || url.isEmpty()) return;
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            downloadHttp(url, userAgent, contentDisposition, mimeType);
        } else if (lower.startsWith("blob:")) {
            downloadBlobFromWebView(url, contentDisposition, mimeType);
        } else if (lower.startsWith("data:")) {
            downloadDataUrl(url, contentDisposition, mimeType);
        } else {
            toast("暂不支持保存该类型的链接");
        }
    }

    private void downloadHttp(String url, String userAgent, String contentDisposition, String mimeType) {
        String initialName = resolveFileName(url, contentDisposition, mimeType);
        toast("正在保存 " + initialName + "…");
        String cookie = null;
        try {
            cookie = CookieManager.getInstance().getCookie(url);
        } catch (Exception ignored) {
        }
        final String cookieHeader = cookie;
        io.execute(() -> {
            HttpURLConnection conn = null;
            PendingSave save = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(60000);
                if (userAgent != null && !userAgent.isEmpty()) conn.setRequestProperty("User-Agent", userAgent);
                if (cookieHeader != null && !cookieHeader.isEmpty()) conn.setRequestProperty("Cookie", cookieHeader);
                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    throw new IOException("HTTP " + status);
                }
                String serverDisposition = conn.getHeaderField("Content-Disposition");
                String serverMime = conn.getContentType();
                String finalName = resolveFileName(
                        conn.getURL() != null ? conn.getURL().toString() : url,
                        serverDisposition != null && !serverDisposition.isEmpty() ? serverDisposition : contentDisposition,
                        serverMime != null && !serverMime.isEmpty() ? serverMime : mimeType
                );
                save = createPendingDownload(finalName);
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        save.out.write(buf, 0, n);
                    }
                }
                save.commit(context.getContentResolver());
                String savedName = save.fileName;
                save = null;
                toast("已保存到下载目录：" + savedName);
            } catch (Exception e) {
                if (save != null) save.abort(context.getContentResolver());
                toast("保存失败：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void downloadDataUrl(String url, String contentDisposition, String mimeType) {
        int comma = url.indexOf(',');
        if (comma < 0) {
            toast("保存失败：无效的数据链接");
            return;
        }
        String meta = url.substring(5, comma);
        String payload = url.substring(comma + 1);
        boolean isBase64 = meta.toLowerCase(Locale.ROOT).endsWith(";base64");
        String fileName = resolveFileName(url, contentDisposition, mimeType);
        io.execute(() -> {
            PendingSave save = null;
            try {
                byte[] bytes = isBase64
                        ? Base64.decode(payload, Base64.DEFAULT)
                        : URLDecoder.decode(payload, "UTF-8").getBytes(StandardCharsets.UTF_8);
                save = createPendingDownload(fileName);
                save.out.write(bytes);
                save.commit(context.getContentResolver());
                String savedName = save.fileName;
                save = null;
                toast("已保存到下载目录：" + savedName);
            } catch (Exception e) {
                if (save != null) save.abort(context.getContentResolver());
                toast("保存失败：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
            }
        });
    }

    /** 兜底处理未走 downloadTavernBlob 的 blob: 链接：在页面里 fetch 字节并分块交给原生桥接保存。 */
    private void downloadBlobFromWebView(String blobUrl, String contentDisposition, String mimeType) {
        String fileName = resolveFileName(blobUrl, contentDisposition, mimeType);
        String js = "(async function(u,name,mime){"
                + "var b=window." + JS_BRIDGE_NAME + ";if(!b)return;"
                + "var id='';"
                + "try{"
                + "var res=await fetch(u);var buf=await res.arrayBuffer();var bytes=new Uint8Array(buf);"
                + "id=b.begin(name,mime||'');if(!id)return;"
                + "var step=393216;"
                + "for(var i=0;i<bytes.length;i+=step){"
                + "var end=Math.min(i+step,bytes.length),s='';"
                + "for(var j=i;j<end;j+=8192){s+=String.fromCharCode.apply(null,bytes.subarray(j,Math.min(j+8192,end)));}"
                + "if(!b.chunk(id,btoa(s)))throw new Error('写入失败');"
                + "}"
                + "b.finish(id);"
                + "}catch(e){if(id)b.abort(id,String(e&&e.message||e));}"
                + "})(" + quoteJs(blobUrl) + "," + quoteJs(fileName) + "," + quoteJs(mimeType == null ? "" : mimeType) + ");";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private PendingSave createPendingDownload(String rawName) throws IOException {
        String safeName = sanitizeFileName(rawName);
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        // 不强塞与自定义后缀（如 .dshtransfer / .dshcard）不匹配的 MIME_TYPE，
        // 避免 Android MediaProvider 自动改名或追加 .bin / .zip 后缀。
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) throw new IOException("无法创建下载文件");
        OutputStream raw = resolver.openOutputStream(uri, "w");
        if (raw == null) {
            resolver.delete(uri, null, null);
            throw new IOException("无法打开下载输出流");
        }
        return new PendingSave(uri, safeName, new BufferedOutputStream(raw, 1 << 16));
    }

    private void toast(String message) {
        main.post(() -> Toast.makeText(context, message, Toast.LENGTH_LONG).show());
    }

    static String resolveFileName(String url, String contentDisposition, String mimeType) {
        if (contentDisposition != null && !contentDisposition.isEmpty()) {
            Matcher star = FILENAME_STAR.matcher(contentDisposition);
            if (star.find()) {
                String val = star.group(1) != null ? star.group(1) : star.group(2);
                String decoded = decodeRfc5987(val);
                if (!decoded.isEmpty()) return sanitizeFileName(decoded);
            }
            Matcher plain = FILENAME_PLAIN.matcher(contentDisposition);
            if (plain.find()) {
                String val = plain.group(1) != null ? plain.group(1) : plain.group(2);
                String decoded = decodeUrlQuietly(val);
                if (!decoded.isEmpty()) return sanitizeFileName(decoded);
            }
        }
        if (url != null && !url.isEmpty() && !url.startsWith("blob:") && !url.startsWith("data:")) {
            try {
                String path = Uri.parse(url).getLastPathSegment();
                if (path != null && !path.isEmpty() && path.contains(".")) {
                    return sanitizeFileName(decodeUrlQuietly(path));
                }
            } catch (Exception ignored) {
            }
        }
        String guessed = URLUtil.guessFileName(url == null ? "" : url, contentDisposition, mimeType);
        return sanitizeFileName(guessed == null || guessed.isEmpty() ? "dsh-tavern-download.bin" : guessed);
    }

    private static String decodeRfc5987(String raw) {
        if (raw == null) return "";
        String value = raw.trim();
        int idx = value.indexOf("''");
        if (idx >= 0) value = value.substring(idx + 2);
        return decodeUrlQuietly(value);
    }

    private static String decodeUrlQuietly(String value) {
        if (value == null) return "";
        try {
            // 保留文件名里的 '+' 号，不按表单空格解码。
            return URLDecoder.decode(value.replace("+", "%2B"), "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    private static String sanitizeFileName(String name) {
        if (name == null) return "dsh-tavern-download";
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
        while (cleaned.startsWith(".")) cleaned = cleaned.substring(1).trim();
        return cleaned.isEmpty() ? "dsh-tavern-download" : cleaned;
    }

    private static String quoteJs(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default: sb.append(c);
            }
        }
        sb.append('"');
        return sb.toString();
    }

    private static final class PendingSave {
        final Uri uri;
        final String fileName;
        final BufferedOutputStream out;

        PendingSave(Uri uri, String fileName, BufferedOutputStream out) {
            this.uri = uri;
            this.fileName = fileName;
            this.out = out;
        }

        void commit(ContentResolver resolver) throws IOException {
            out.flush();
            out.close();
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
        }

        void abort(ContentResolver resolver) {
            try {
                out.close();
            } catch (Exception ignored) {
            }
            try {
                resolver.delete(uri, null, null);
            } catch (Exception ignored) {
            }
        }
    }

    final class Bridge {
        @JavascriptInterface
        public String begin(String filename, String mimeType) {
            try {
                String safeName = sanitizeFileName(filename);
                PendingSave save = createPendingDownload(safeName);
                String id = UUID.randomUUID().toString();
                pending.put(id, save);
                toast("正在保存 " + save.fileName + "…");
                return id;
            } catch (Exception e) {
                toast("保存失败：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
                return "";
            }
        }

        @JavascriptInterface
        public boolean chunk(String id, String base64) {
            PendingSave save = id == null ? null : pending.get(id);
            if (save == null) return false;
            try {
                if (base64 != null && !base64.isEmpty()) {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    save.out.write(bytes);
                }
                return true;
            } catch (Exception e) {
                abort(id, e.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean finish(String id) {
            PendingSave save = id == null ? null : pending.remove(id);
            if (save == null) return false;
            try {
                save.commit(context.getContentResolver());
                toast("已保存到下载目录：" + save.fileName);
                return true;
            } catch (Exception e) {
                save.abort(context.getContentResolver());
                toast("保存失败：" + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
                return false;
            }
        }

        @JavascriptInterface
        public void abort(String id, String reason) {
            PendingSave save = id == null ? null : pending.remove(id);
            if (save != null) save.abort(context.getContentResolver());
            if (reason != null && !reason.isEmpty()) toast("保存失败：" + reason);
        }
    }
}

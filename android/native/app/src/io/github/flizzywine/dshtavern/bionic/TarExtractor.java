package io.github.flizzywine.dshtavern.bionic;

import android.system.Os;

import java.io.EOFException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** 解 GNU/ustar/pax tar 流：普通文件、目录、软链接。硬链接打包时已展开（Android 禁止 link(2)）。 */
final class TarExtractor {
    /** 路径谓词。 */
    interface PathTest {
        boolean test(String path);
    }

    private final File root;
    /** 返回 true 的条目若已存在则保留不动（用户数据只在缺失时播种）。 */
    private final PathTest keepExisting;
    /** 返回 true 的条目一律跳过（例如保留热更新过的源码时跳过 APK 里的旧源码）。 */
    private final PathTest skip;
    private final byte[] buffer = new byte[1 << 16];
    int written;
    int kept;

    TarExtractor(File root, PathTest keepExisting, PathTest skip) {
        this.root = root;
        this.keepExisting = keepExisting;
        this.skip = skip;
    }

    static String normalize(String name) {
        while (name.startsWith("./")) name = name.substring(2);
        return name;
    }

    private static boolean exists(File f) {
        try {
            Os.lstat(f.getPath());
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    void extract(InputStream in) throws IOException {
        byte[] header = new byte[512];
        String longName = null;
        String longLink = null;
        while (true) {
            readFully(in, header, 512);
            if (isZero(header)) return;
            char type = (char) header[156];
            long size = number(header, 124, 12);
            if (type == 'L' || type == 'K' || type == 'x') {
                byte[] data = readBytes(in, size);
                skipPadding(in, size);
                if (type == 'L') longName = cstring(data, 0, data.length);
                else if (type == 'K') longLink = cstring(data, 0, data.length);
                else {
                    String[] pax = pax(data);
                    if (pax[0] != null) longName = pax[0];
                    if (pax[1] != null) longLink = pax[1];
                }
                continue;
            }
            String name = longName != null ? longName : name(header);
            String link = longLink != null ? longLink : cstring(header, 157, 100);
            longName = null;
            longLink = null;
            File target = resolve(name);
            String rel = normalize(name);
            boolean keep = skip.test(rel) || (type != '5' && keepExisting.test(rel) && exists(target));
            if (keep) {
                kept++;
                skip(in, size);
                skipPadding(in, size);
                continue;
            }
            if (type != '5') written++;
            switch (type) {
                case '5':
                    mkdirs(target);
                    break;
                case '2':
                    mkdirs(target.getParentFile());
                    target.delete();
                    try {
                        Os.symlink(link, target.getPath());
                    } catch (Exception error) {
                        throw new IOException("symlink " + name + " -> " + link, error);
                    }
                    break;
                case '0':
                case '\0':
                case '7': {
                    mkdirs(target.getParentFile());
                    target.delete();
                    try (OutputStream out = new FileOutputStream(target)) {
                        long left = size;
                        while (left > 0) {
                            int n = in.read(buffer, 0, (int) Math.min(buffer.length, left));
                            if (n < 0) throw new EOFException(name);
                            out.write(buffer, 0, n);
                            left -= n;
                        }
                    }
                    int mode = (int) number(header, 100, 8);
                    try {
                        // 只给属主权限：DSH 拒绝组/其他可读的凭据文件。
                        Os.chmod(target.getPath(), (mode & 0100) != 0 ? 0700 : 0600);
                    } catch (Exception ignored) {
                    }
                    break;
                }
                default:
                    skip(in, size);
            }
            // 目录、软链接的 size 为 0，补齐也为 0。
            skipPadding(in, size);
        }
    }

    private File resolve(String name) throws IOException {
        name = normalize(name);
        if (name.startsWith("/") || ("/" + name + "/").contains("/../")) throw new IOException("unsafe entry " + name);
        return name.isEmpty() || name.equals(".") ? root : new File(root, name);
    }

    private static void mkdirs(File dir) throws IOException {
        if (dir != null && !dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("mkdir " + dir);
    }

    private static String name(byte[] h) {
        String name = cstring(h, 0, 100);
        // POSIX ustar（"ustar\0"）才有 prefix 字段；GNU（"ustar  "）把这段用作别的。
        boolean posix = h[257] == 'u' && h[262] == 0;
        String prefix = posix ? cstring(h, 345, 155) : "";
        return prefix.isEmpty() ? name : prefix + "/" + name;
    }

    private static String[] pax(byte[] data) {
        String[] out = new String[2];
        int pos = 0;
        while (pos < data.length) {
            int space = pos;
            while (space < data.length && data[space] != ' ') space++;
            if (space >= data.length) break;
            int length = Integer.parseInt(new String(data, pos, space - pos, StandardCharsets.US_ASCII));
            if (length <= 0) break;
            String record = new String(data, space + 1, pos + length - space - 2, StandardCharsets.UTF_8);
            int eq = record.indexOf('=');
            if (eq > 0) {
                String key = record.substring(0, eq);
                if (key.equals("path")) out[0] = record.substring(eq + 1);
                if (key.equals("linkpath")) out[1] = record.substring(eq + 1);
            }
            pos += length;
        }
        return out;
    }

    private static long number(byte[] h, int off, int len) {
        if ((h[off] & 0x80) != 0) { // GNU base-256
            long value = h[off] & 0x7f;
            for (int i = 1; i < len; i++) value = (value << 8) | (h[off + i] & 0xff);
            return value;
        }
        long value = 0;
        for (int i = off; i < off + len; i++) {
            byte b = h[i];
            if (b == 0 || b == ' ') {
                if (value != 0) break;
                continue;
            }
            value = value * 8 + (b - '0');
        }
        return value;
    }

    private static String cstring(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && b[end] != 0) end++;
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    private static boolean isZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    private void skipPadding(InputStream in, long size) throws IOException {
        long pad = (512 - (size % 512)) % 512;
        skip(in, pad);
    }

    private void skip(InputStream in, long n) throws IOException {
        while (n > 0) {
            int r = in.read(buffer, 0, (int) Math.min(buffer.length, n));
            if (r < 0) throw new EOFException();
            n -= r;
        }
    }

    private static byte[] readBytes(InputStream in, long size) throws IOException {
        byte[] data = new byte[(int) size];
        readFully(in, data, data.length);
        return data;
    }

    private static void readFully(InputStream in, byte[] b, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(b, off, len - off);
            if (n < 0) throw new EOFException("truncated tar");
            off += n;
        }
    }
}

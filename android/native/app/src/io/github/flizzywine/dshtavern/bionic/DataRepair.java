package io.github.flizzywine.dshtavern.bionic;

import org.json.JSONException;
import org.json.JSONTokener;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 「修复酒馆」的数据体检：扫描用户数据（程序文件除外）里的 JSON / YAML / JSONL，找出写到一半被打断的文件
 * （空文件、含空字节、无法解析）。只移动、不删除：原文件都放进隔离目录，按原路径存放。
 * <ul>
 * <li>JSON / YAML 损坏：有同名备份（.bak / .backup / .prev）且完好时用备份恢复，否则移走；
 *     安装包自带的文件随后由重新解压补回，其余由酒馆按缺省值重建。</li>
 * <li>JSONL（对局记录等）只有最后一行坏：原文件复制一份进隔离目录，截掉最后一行；中间有坏行时不动，只报告。</li>
 * <li>原子写入留下的 *.tmp 移走；临时导出目录 tmp-exports 清掉。</li>
 * </ul>
 */
final class DataRepair {
    private static final long MAX_PARSE_BYTES = 64L << 20;
    private static final Set<String> SKIP_DIRS = new HashSet<>(Arrays.asList("node_modules", ".git", "backups"));
    private static final String[] BACKUP_SUFFIXES = {".bak", ".backup", ".prev"};

    private final File root;
    private final File quarantine;
    final List<String> notes = new ArrayList<>();
    int checked, restored, quarantined, trimmed, unresolved, leftovers;
    boolean credentialsReset;

    DataRepair(File root, File quarantine) {
        this.root = root;
        this.quarantine = quarantine;
    }

    boolean changed() {
        return restored + quarantined + trimmed + leftovers > 0;
    }

    String quarantineRelative() {
        return root.toPath().relativize(quarantine.toPath()).toString();
    }

    void run() throws IOException {
        Path base = root.toPath();
        Files.walkFileTree(base, new SimpleFileVisitor<Path>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                String rel = rel(base, dir);
                if (rel.isEmpty()) return FileVisitResult.CONTINUE;
                String name = dir.getFileName().toString();
                if (rel.equals("quarantine") || rel.equals("tmp") || SKIP_DIRS.contains(name)) return FileVisitResult.SKIP_SUBTREE;
                for (String program : TavernService.PROGRAM_DIRS) if ((rel + "/").startsWith(program)) return FileVisitResult.SKIP_SUBTREE;
                if (name.equals("tmp-exports")) {
                    TavernService.deleteTree(dir.toFile());
                    notes.add("清掉临时导出 " + rel);
                    return FileVisitResult.SKIP_SUBTREE;
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                String rel = rel(base, file);
                if (!attrs.isRegularFile() || TavernService.isProgram(rel)) return FileVisitResult.CONTINUE;
                try {
                    check(file.toFile(), rel, attrs.size());
                } catch (IOException e) {
                    unresolved++;
                    notes.add("处理失败 " + rel + "：" + e.getMessage());
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException e) {
                unresolved++;
                notes.add("无法读取 " + rel(base, file) + "：" + e.getMessage());
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static String rel(Path base, Path p) {
        return base.relativize(p).toString().replace(File.separatorChar, '/');
    }

    private void check(File file, String rel, long size) throws IOException {
        String name = file.getName();
        if (name.endsWith(".tmp")) {
            move(file, rel);
            leftovers++;
            notes.add("移走写到一半的临时文件 " + rel);
            return;
        }
        boolean json = name.endsWith(".json"), jsonl = name.endsWith(".jsonl"),
                yaml = name.endsWith(".yaml") || name.endsWith(".yml");
        if (!json && !jsonl && !yaml) return;
        checked++;
        if (jsonl) {
            if (size > 0 && size <= 4 * MAX_PARSE_BYTES) checkJsonl(file, rel);
            return;
        }
        if (size > MAX_PARSE_BYTES) return;
        String problem = size == 0 ? "空文件" : problem(Files.readAllBytes(file.toPath()), json);
        if (problem == null) return;
        File backup = goodBackup(file, json);
        move(file, rel);
        if (backup != null) {
            Files.copy(backup.toPath(), file.toPath());
            restored++;
            notes.add("用备份 " + backup.getName() + " 恢复 " + rel + "（" + problem + "）");
        } else {
            quarantined++;
            notes.add("移走损坏的 " + rel + "（" + problem + "）");
            if (rel.endsWith(TavernService.USER_CONFIG) || name.equals(".credentials.yaml")) credentialsReset = true;
        }
    }

    private File goodBackup(File file, boolean json) {
        for (String suffix : BACKUP_SUFFIXES) {
            File b = new File(file.getPath() + suffix);
            try {
                if (b.isFile() && b.length() > 0 && b.length() <= MAX_PARSE_BYTES
                        && problem(Files.readAllBytes(b.toPath()), json) == null) return b;
            } catch (IOException ignored) {
            }
        }
        return null;
    }

    /** 对局记录等逐行 JSON：断电或被杀时通常只坏最后一行。 */
    private void checkJsonl(File file, String rel) throws IOException {
        byte[] b = Files.readAllBytes(file.toPath());
        int start = 0, line = 0, bad = 0, firstBad = 0;
        long goodEnd = 0;
        boolean lastBad = false;
        for (int i = 0; i <= b.length; i++) {
            if (i < b.length && b[i] != '\n') continue;
            line++;
            byte[] row = Arrays.copyOfRange(b, start, i);
            start = i + 1;
            if (new String(row, StandardCharsets.UTF_8).trim().isEmpty() && indexOf(row, (byte) 0) < 0) continue;
            if (problem(row, true) == null) {
                goodEnd = Math.min(i + 1, b.length);
                lastBad = false;
            } else {
                bad++;
                if (firstBad == 0) firstBad = line;
                lastBad = true;
            }
        }
        if (bad == 0) return;
        if (bad == 1 && lastBad) {
            File copy = new File(quarantine, rel);
            copy.getParentFile().mkdirs();
            Files.copy(file.toPath(), copy.toPath(), StandardCopyOption.REPLACE_EXISTING);
            try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
                raf.setLength(goodEnd);
                raf.getFD().sync();
            }
            trimmed++;
            notes.add("截掉 " + rel + " 写到一半的最后一行（原文件已备份）");
        } else {
            unresolved++;
            notes.add(rel + " 从第 " + firstBad + " 行起有 " + bad + " 行无法解析，未自动处理（原样保留）");
        }
    }

    private void move(File file, String rel) throws IOException {
        File target = new File(quarantine, rel);
        target.getParentFile().mkdirs();
        Files.move(file.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
    }

    /** 返回问题描述，完好时返回 null。YAML 只查空字节和编码（写入中断的典型痕迹），不做语法解析。 */
    static String problem(byte[] bytes, boolean json) {
        if (indexOf(bytes, (byte) 0) >= 0) return "含有空字节，写入被打断";
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            return "不是有效的 UTF-8 文本";
        }
        if (!json) return null;
        if (text.startsWith("﻿")) text = text.substring(1);
        if (text.trim().isEmpty()) return "内容为空";
        try {
            JSONTokener tokener = new JSONTokener(text);
            tokener.nextValue();
            if (tokener.nextClean() != 0) return "JSON 结尾有多余内容";
            return null;
        } catch (JSONException e) {
            return "JSON 无法解析";
        }
    }

    private static int indexOf(byte[] bytes, byte value) {
        for (int i = 0; i < bytes.length; i++) if (bytes[i] == value) return i;
        return -1;
    }
}

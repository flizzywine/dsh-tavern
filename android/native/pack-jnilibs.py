#!/usr/bin/env python3
"""把 Termux 的 node 及其依赖整理成 APK 的 jniLibs/<abi>/ 目录。

PackageManager 只解出 lib/<abi>/lib*.so；Termux 的库是 libssl.so.3 这类带版本的名字，
其中 libssl/libcrypto/libicuuc 还与系统库（BoringSSL、Android ICU）同名。处理：
  - bin/node            → libnode.so（数据目录禁止 execve，只能放 nativeLibraryDir 执行）
  - lib<x>.so.<ver>     → libt<x>.so（加 t 前缀避开系统库；新名不长于旧名，可原地改）
  - 同步改写 DT_NEEDED、DT_SONAME、DT_VERNEED 的 vn_file（OpenSSL 有符号版本，bionic 按名字校验）
  - DT_RUNPATH          → $ORIGIN
只改被引用的字符串偏移，且要求该偏移前一字节是 NUL（不是别的字符串的共享后缀），否则拒绝。
用法：pack-jnilibs.py <termux-usr> <out-abi-dir>
"""
import os, shutil, struct, sys

DT_NULL, DT_NEEDED, DT_STRTAB, DT_SONAME, DT_RPATH, DT_RUNPATH = 0, 1, 5, 14, 15, 29
DT_VERNEED, DT_VERNEEDNUM = 0x6ffffffe, 0x6fffffff


class Elf:
    def __init__(self, path):
        self.path = path
        self.data = bytearray(open(path, 'rb').read())
        d = self.data
        assert d[:4] == b'\x7fELF' and d[4] == 2 and d[5] == 1, f'{path}: not ELF64 LE'
        phoff, = struct.unpack_from('<Q', d, 0x20)
        phentsize, phnum = struct.unpack_from('<HH', d, 0x36)
        self.loads, dyn = [], None
        for i in range(phnum):
            p_type, _, off, vaddr, _, filesz, _, _ = struct.unpack_from('<IIQQQQQQ', d, phoff + i * phentsize)
            if p_type == 1: self.loads.append((vaddr, off, filesz))
            if p_type == 2: dyn = (off, filesz)
        self.entries = []
        for o in range(dyn[0], dyn[0] + dyn[1], 16):
            tag, val = struct.unpack_from('<qQ', d, o)
            if tag == DT_NULL: break
            self.entries.append((tag, val))
        tags = dict(self.entries)
        self.strtab = self.off(tags[DT_STRTAB])
        self.verneed = (self.off(tags[DT_VERNEED]), tags[DT_VERNEEDNUM]) if DT_VERNEED in tags else None

    def off(self, vaddr):
        for v, o, size in self.loads:
            if v <= vaddr < v + size: return o + vaddr - v
        raise ValueError('vaddr not mapped')

    def string(self, index):
        start = self.strtab + index
        return self.data[start:self.data.index(0, start)].decode()

    def refs(self):
        """(kind, string index) for every library-name reference."""
        out = [(('needed' if t == DT_NEEDED else 'soname' if t == DT_SONAME else 'runpath'), v)
               for t, v in self.entries if t in (DT_NEEDED, DT_SONAME, DT_RPATH, DT_RUNPATH)]
        if self.verneed:
            pos, count = self.verneed
            for _ in range(count):
                _, _, vn_file, _, vn_next = struct.unpack_from('<HHIII', self.data, pos)
                out.append(('verneed', vn_file))
                if not vn_next: break
                pos += vn_next
        return out

    def needed(self):
        return [self.string(v) for k, v in self.refs() if k == 'needed']

    def rewrite(self, index, new):
        start = self.strtab + index
        end = self.data.index(0, start)
        if index and self.data[start - 1] != 0:
            raise SystemExit(f'{self.path}: "{self.string(index)}" 与其他字符串共享存储，不能原地改')
        enc = new.encode()
        if len(enc) > end - start:
            raise SystemExit(f'{self.path}: 新名 {new} 长于 {self.string(index)}')
        self.data[start:end] = enc + b'\0' * (end - start - len(enc))

    def save(self, path):
        open(path, 'wb').write(self.data)


def apk_name(name):
    if '.so.' not in name: return name
    base = name.split('.so.')[0]
    assert base.startswith('lib'), name
    return 'libt' + base[3:] + '.so'


def main(usr, out):
    libdir = os.path.join(usr, 'lib')
    os.makedirs(out, exist_ok=True)
    todo, seen, files = ['node'], set(), {}
    while todo:
        name = todo.pop()
        if name in seen: continue
        seen.add(name)
        src = os.path.join(usr, 'bin/node') if name == 'node' else os.path.join(libdir, name)
        if not os.path.exists(src): continue  # libc / libm / libdl：系统提供
        files[name] = Elf(os.path.realpath(src))
        todo.extend(files[name].needed())
    rename = {n: apk_name(n) for n in files if n != 'node'}
    for name, elf in files.items():
        for kind, index in elf.refs():
            old = elf.string(index)
            if kind == 'runpath': elf.rewrite(index, '$ORIGIN')
            elif old in rename and rename[old] != old: elf.rewrite(index, rename[old])
        target = 'libnode.so' if name == 'node' else rename[name]
        elf.save(os.path.join(out, target))
        os.chmod(os.path.join(out, target), 0o755)
        print(f'{name:22} → {target}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

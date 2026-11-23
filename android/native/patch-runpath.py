#!/usr/bin/env python3
"""把 ELF 的 DT_RUNPATH/DT_RPATH 原地改成相对 $ORIGIN 的路径（不需要 patchelf）。

Termux 的二进制 RUNPATH 写死 /data/data/com.termux/files/usr/lib；子进程被清空环境
（例如酒馆模板 worker 只传 NODE_ENV）后 LD_LIBRARY_PATH 丢失，node 就找不到自己的 .so。
bionic linker 支持 $ORIGIN，改成相对路径后与安装位置、环境变量都无关。

只改 .dynamic 指向的那一个字符串；新值不能比旧值长（剩余字节补 NUL）。
用法：patch-runpath.py <新 RUNPATH> <ELF 文件...>
"""
import struct, sys

DT_NULL, DT_STRTAB, DT_RPATH, DT_RUNPATH = 0, 5, 15, 29


def patch(path, new):
    data = bytearray(open(path, 'rb').read())
    if data[:4] != b'\x7fELF' or data[4] != 2 or data[5] != 1:
        return 'skip (not ELF64 LE)'
    phoff, = struct.unpack_from('<Q', data, 0x20)
    phentsize, phnum = struct.unpack_from('<HH', data, 0x36)
    loads, dynamic = [], None
    for i in range(phnum):
        p_type, _, p_offset, p_vaddr, _, p_filesz, _, _ = struct.unpack_from('<IIQQQQQQ', data, phoff + i * phentsize)
        if p_type == 1:
            loads.append((p_vaddr, p_offset, p_filesz))
        elif p_type == 2:
            dynamic = (p_offset, p_filesz)
    if not dynamic:
        return 'skip (static)'

    def file_offset(vaddr):
        for v, o, size in loads:
            if v <= vaddr < v + size:
                return o + vaddr - v
        raise ValueError('vaddr not mapped')

    strtab, entries = None, []
    for off in range(dynamic[0], dynamic[0] + dynamic[1], 16):
        tag, val = struct.unpack_from('<qQ', data, off)
        if tag == DT_NULL:
            break
        if tag == DT_STRTAB:
            strtab = file_offset(val)
        if tag in (DT_RPATH, DT_RUNPATH):
            entries.append(val)
    if not entries:
        return 'skip (no runpath)'
    out = []
    for index in entries:
        start = strtab + index
        end = data.index(0, start)
        old = data[start:end].decode()
        if old == new:
            out.append('unchanged')
            continue
        encoded = new.encode()
        if len(encoded) > end - start:
            raise SystemExit(f'{path}: 新 RUNPATH 比旧值长：{old!r}')
        data[start:end] = encoded + b'\0' * (end - start - len(encoded))
        out.append(f'{old} -> {new}')
    open(path, 'wb').write(data)
    return '; '.join(out)


if __name__ == '__main__':
    new = sys.argv[1]
    for f in sys.argv[2:]:
        print(f'{f}: {patch(f, new)}')

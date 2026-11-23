#!/usr/bin/env python3
"""从 Termux 官方源取 nodejs-lts 及其全部运行依赖，解包成一棵可搬运的 usr 树。

用法：python3 android/native/fetch-termux-node.py --arch aarch64|x86_64 --out <目录>

- 解析 Packages 索引，按 Depends 递归展开（不含 Pre-Depends 以外的推荐/建议包）。
- 每个 .deb 都校验索引给出的 SHA-256，不符直接失败。
- 产物：<out>/usr/{bin,lib,...}，<out>/lock.json 记录包名、版本、SHA-256，供复现和锁定。
"""
import argparse, gzip, hashlib, io, json, lzma, os, pathlib, re, shutil, sys, tarfile, urllib.request

MIRROR = os.environ.get('TERMUX_MIRROR', 'https://packages.termux.dev/apt/termux-main')
PREFIX = 'data/data/com.termux/files/usr'
# 运行 node 用不到、只会把树撑大的包。
SKIP = {'ca-certificates', 'npm', 'resolv-conf'}


def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def packages(arch):
    raw = fetch(f'{MIRROR}/dists/stable/main/binary-{arch}/Packages')
    index = {}
    for block in raw.decode().split('\n\n'):
        fields = {}
        for line in block.splitlines():
            if ':' in line and not line.startswith(' '):
                k, v = line.split(':', 1)
                fields[k] = v.strip()
        if 'Package' in fields:
            index[fields['Package']] = fields
    return index


def deps(field):
    out = []
    for part in (field or '').split(','):
        name = re.split(r'[\s(|]', part.strip(), 1)[0]
        if name:
            out.append(name)
    return out


def resolve(index, root):
    seen, order, todo = set(), [], [root]
    while todo:
        name = todo.pop()
        if name in seen or name in SKIP:
            continue
        if name not in index:
            raise SystemExit(f'索引里找不到依赖：{name}')
        seen.add(name)
        order.append(name)
        todo.extend(deps(index[name].get('Depends')) + deps(index[name].get('Pre-Depends')))
    return order


def extract_deb(blob, dest):
    # ar 格式：找 data.tar.*
    assert blob[:8] == b'!<arch>\n', 'not an ar archive'
    pos = 8
    while pos < len(blob):
        name = blob[pos:pos + 16].decode().strip().rstrip('/')
        size = int(blob[pos + 48:pos + 58].decode().strip())
        body = blob[pos + 60:pos + 60 + size]
        pos += 60 + size + (size & 1)
        if name.startswith('data.tar'):
            if name.endswith('.xz'):
                body = lzma.decompress(body)
            elif name.endswith('.gz'):
                body = gzip.decompress(body)
            with tarfile.open(fileobj=io.BytesIO(body)) as t:
                for m in t.getmembers():
                    rel = m.name.lstrip('./')
                    if not rel.startswith(PREFIX + '/'):
                        continue
                    m.name = rel[len(PREFIX) + 1:]
                    if m.issym() or m.isfile() or m.isdir():
                        t.extract(m, dest, filter='tar' if hasattr(tarfile, 'data_filter') else None)
            return
    raise SystemExit('deb 里没有 data.tar')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--arch', default='aarch64', choices=['aarch64', 'x86_64', 'arm', 'i686'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--package', default='nodejs-lts')
    args = ap.parse_args()
    out = pathlib.Path(args.out)
    usr = out / 'usr'
    if usr.exists():
        shutil.rmtree(usr)
    usr.mkdir(parents=True)
    cache = out / 'debs'
    cache.mkdir(exist_ok=True)
    index = packages(args.arch)
    names = resolve(index, args.package)
    lock = []
    for name in sorted(names):
        meta = index[name]
        file = cache / pathlib.Path(meta['Filename']).name
        if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != meta['SHA256']:
            blob = fetch(f"{MIRROR}/{meta['Filename']}")
            if hashlib.sha256(blob).hexdigest() != meta['SHA256']:
                raise SystemExit(f'SHA-256 不符：{name}')
            file.write_bytes(blob)
        extract_deb(file.read_bytes(), usr)
        lock.append({'package': name, 'version': meta['Version'], 'sha256': meta['SHA256']})
        print(f"{name} {meta['Version']}")
    (out / 'lock.json').write_text(json.dumps({'arch': args.arch, 'mirror': MIRROR, 'packages': lock}, indent=2) + '\n')
    print(f'完成：{len(lock)} 个包 → {usr}')


if __name__ == '__main__':
    main()

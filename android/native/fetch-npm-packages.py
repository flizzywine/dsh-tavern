#!/usr/bin/env python3
"""把 npm 包（及其缺失的依赖）装进一个扁平的 node_modules，不用 npm：取 tarball、校验 integrity、解包。
用法：fetch-npm-packages.py <node_modules 目录> <名字@版本>...
已存在且版本满足要求的依赖不重复装。版本范围只支持精确版本、^x.y.z、~x.y.z、>=x.y.z。
"""
import base64, hashlib, io, json, os, re, shutil, sys, tarfile, urllib.request

REGISTRY = os.environ.get('NPM_REGISTRY', 'https://registry.npmmirror.com').rstrip('/')


def parse(v):
    m = re.match(r'^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$', v)
    return (int(m[1]), int(m[2]), int(m[3]), m[4]) if m else None


def satisfies(version, spec):
    v = parse(version)
    if not v or v[3]:
        return version == spec
    spec = spec.strip()
    if parse(spec):
        return version == spec
    m = re.match(r'^([\^~]|>=)\s*(\d+)\.(\d+)\.(\d+)$', spec)
    if not m:
        raise SystemExit(f'不支持的版本范围：{spec}')
    op, base = m[1], (int(m[2]), int(m[3]), int(m[4]))
    if v[:3] < base:
        return False
    if op == '>=':
        return True
    if op == '~':
        return v[:2] == base[:2]
    if base[0] > 0:
        return v[0] == base[0]
    return v[:2] == base[:2] if base[1] > 0 else v[:3] == base


def meta(name):
    with urllib.request.urlopen(f'{REGISTRY}/{name.replace("/", "%2F")}', timeout=60) as r:
        return json.load(r)


def installed_version(nm, name):
    try:
        return json.load(open(os.path.join(nm, name, 'package.json')))['version']
    except FileNotFoundError:
        return None


def install(nm, name, spec, log):
    have = installed_version(nm, name)
    if have and satisfies(have, spec):
        return
    doc = meta(name)
    candidates = [v for v in doc['versions'] if parse(v) and not parse(v)[3] and satisfies(v, spec)]
    if not candidates:
        raise SystemExit(f'{name}@{spec}：找不到满足的版本')
    version = max(candidates, key=lambda v: parse(v)[:3])
    info = doc['versions'][version]
    with urllib.request.urlopen(info['dist']['tarball'], timeout=120) as r:
        blob = r.read()
    algo, digest = info['dist']['integrity'].split('-', 1)
    if base64.b64encode(hashlib.new(algo, blob).digest()).decode() != digest:
        raise SystemExit(f'{name}@{version}：integrity 不符')
    target = os.path.join(nm, name)
    shutil.rmtree(target, ignore_errors=True)
    os.makedirs(target)
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as t:
        for m in t.getmembers():
            parts = m.name.split('/', 1)
            if len(parts) < 2 or not (m.isfile() or m.isdir()):
                continue
            m.name = parts[1]
            t.extract(m, target, filter='data')
    log.append(f'{name}@{version}')
    for dep, dep_spec in (info.get('dependencies') or {}).items():
        install(nm, dep, dep_spec, log)


def main():
    nm = sys.argv[1]
    log = []
    for item in sys.argv[2:]:
        at = item.rindex('@')
        install(nm, item[:at], item[at + 1:], log)
    print('已安装：' + (', '.join(log) or '（无，均已存在）'))


if __name__ == '__main__':
    main()

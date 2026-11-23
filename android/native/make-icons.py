#!/usr/bin/env python3
"""从项目图标生成 APK 的启动器图标与启动页用的品牌图。
  python3 android/native/make-icons.py <icon-512.png> <res-dir>
自适应图标：背景为图标自身的米色底（#fbf3e4），前景为整张图标缩到 72dp 放在 108dp 画布中央——
圆角方块的边缘与背景同色，在任何遮罩形状下都看不出来；图案落在 66dp 安全区内。
"""
import os
import sys

from PIL import Image

src, res = sys.argv[1], sys.argv[2]
icon = Image.open(src).convert('RGBA')
BG = '#fbf3e4'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def save(img, rel):
    path = os.path.join(res, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


for name, scale in DENSITIES.items():
    legacy = round(48 * scale)
    save(icon.resize((legacy, legacy), Image.LANCZOS), f'mipmap-{name}/ic_launcher.png')
    canvas = round(108 * scale)
    art = round(72 * scale)
    fg = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    fg.alpha_composite(icon.resize((art, art), Image.LANCZOS), ((canvas - art) // 2, (canvas - art) // 2))
    save(fg, f'mipmap-{name}/ic_launcher_foreground.png')
save(icon.resize((192, 192), Image.LANCZOS), 'drawable-nodpi/brand_icon.png')

# 通知栏小图标：系统只用透明度。取图标里的深色描边做成白色线稿，去掉米色底。
line = Image.new('RGBA', icon.size, (0, 0, 0, 0))
px, out = icon.load(), line.load()
for y in range(icon.size[1]):
    for x in range(icon.size[0]):
        r, g, b, a = px[x, y]
        if a > 128 and (r * 299 + g * 587 + b * 114) / 1000 < 90:
            out[x, y] = (255, 255, 255, 255)
box = line.getbbox()
line = line.crop(box)
side = max(line.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.alpha_composite(line, ((side - line.size[0]) // 2, (side - line.size[1]) // 2))
for name, scale in DENSITIES.items():
    size = round(24 * scale)
    pad = round(2 * scale)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(square.resize((size - 2 * pad, size - 2 * pad), Image.LANCZOS), (pad, pad))
    save(canvas, f'drawable-{name}/ic_stat_tavern.png')

os.makedirs(os.path.join(res, 'mipmap-anydpi-v26'), exist_ok=True)
adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '    <background android:drawable="@color/ic_launcher_background" />\n'
            '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
            '</adaptive-icon>\n')
for rel in ('mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml'):
    open(os.path.join(res, rel), 'w').write(adaptive)
os.makedirs(os.path.join(res, 'values'), exist_ok=True)
open(os.path.join(res, 'values/colors.xml'), 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    f'    <color name="ic_launcher_background">{BG}</color>\n'
    '    <color name="tavern_background">#faf9f5</color>\n</resources>\n')
open(os.path.join(res, 'values/styles.xml'), 'w').write(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <!-- 与酒馆本体一致的米白底；状态栏、导航栏透明且用深色图标，打开时也不闪白。 -->\n'
    '    <style name="Tavern" parent="@android:style/Theme.Material.Light.NoActionBar">\n'
    '        <item name="android:windowBackground">@color/tavern_background</item>\n'
    '        <item name="android:colorAccent">#c27d5d</item>\n'
    '        <item name="android:colorPrimary">#faf9f5</item>\n'
    '        <item name="android:statusBarColor">@android:color/transparent</item>\n'
    '        <item name="android:navigationBarColor">@android:color/transparent</item>\n'
    '        <item name="android:windowLightStatusBar">true</item>\n'
    '        <item name="android:windowLightNavigationBar">true</item>\n'
    '    </style>\n</resources>\n')
print('icons ->', res)

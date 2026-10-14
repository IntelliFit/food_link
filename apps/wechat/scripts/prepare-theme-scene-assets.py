"""Encode original scene designs into WeChat's supported code-package formats.

Run from the repository root: python apps/wechat/scripts/prepare-theme-scene-assets.py
Requires Pillow. Original WebP designs remain untouched; no resizing or cropping.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
import hashlib
import json
import math

repo = Path(__file__).resolve().parents[3]
src = repo / 'apps/wechat/src'
designs = src / 'packageThemeScenes/assets'
native = src / 'packageThemeScenes/components/scene-image'
groups = {
    'packageThemeScenes': ('water-', 'motion-', 'eastern-'),
    'packageThemeScenesNature': ('natural-', 'picturebook-'),
    'packageThemeScenesGallery': ('miniature-', 'gallery-'),
}
rows = []
for file in sorted(designs.glob('*.webp')):
    root = next(root for root, prefixes in groups.items() if file.name.startswith(prefixes))
    original = Image.open(file)
    alpha = 'A' in original.getbands()
    target = src / root / 'assets' / file.with_suffix('.png' if alpha else '.jpg').name
    target.parent.mkdir(parents=True, exist_ok=True)
    if alpha:
        original.save(target, 'PNG', optimize=True)
    else:
        original.save(target, 'JPEG', quality=90, subsampling=0, optimize=True)
    decoded = Image.open(target)
    assert decoded.size == original.size
    exact = decoded.tobytes() == original.tobytes() if alpha else False
    if alpha:
        assert exact, 'Transparency and pixels must be preserved losslessly'
    rms = ImageStat.Stat(ImageChops.difference(original.convert('RGB'), decoded.convert('RGB'))).rms
    mse = sum(value ** 2 for value in rms) / len(rms)
    rows.append({
        'original': file.name, 'packageRoot': root, 'file': target.name,
        'width': original.width, 'height': original.height, 'format': decoded.format,
        'hasAlpha': alpha, 'losslessPixels': exact,
        'psnrDb': round(10 * math.log10(255 ** 2 / mse), 3) if mse else None,
        'bytes': target.stat().st_size,
        'originalSha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    })
for root in groups:
    folder = src / root / 'components/scene-image'
    folder.mkdir(parents=True, exist_ok=True)
    if root != 'packageThemeScenes':
        for suffix in ['js', 'json', 'wxss']:
            text = (native / ('index.' + suffix)).read_text(encoding='utf-8-sig')
            if suffix == 'js':
                text = text.replace("const resourceRoot = 'packageThemeScenes';", f"const resourceRoot = '{root}';")
            (folder / ('index.' + suffix)).write_text(text, encoding='utf-8')
        page = src / root / 'pages/index/index.tsx'
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text("import { View } from '@tarojs/components'\nimport React from 'react'\n// Native scene owners download this resource package without navigation.\nexport default function ThemeSceneResources(): React.ReactElement { return <View /> }\n", encoding='utf-8')
    template = '\n'.join(
        '<image wx:if="{{asset === \'' + row['file'] + '\'}}" class="sceneclass" src="/' + root + '/assets/' + row['file'] + '" mode="{{mode}}" aria-hidden="true" bindload="onLoad" binderror="onError" />'
        for row in rows if row['packageRoot'] == root
    ) + '\n'
    (folder / 'index.wxml').write_text(template, encoding='utf-8')
(src / 'theme-scene-assets.json').write_text(json.dumps({'encoding': 'JPEG quality 90 / 4:4:4; lossless PNG for alpha; original dimensions', 'assets': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'assets': len(rows), 'packageImageBytes': {root: sum(row['bytes'] for row in rows if row['packageRoot'] == root) for root in groups}, 'minJpegPsnrDb': min(row['psnrDb'] for row in rows if not row['hasAlpha']), 'transparentImagesLossless': all(row['losslessPixels'] for row in rows if row['hasAlpha'])}))

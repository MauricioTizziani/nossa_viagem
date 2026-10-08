"""Prepare installable icons from the user's original, without altering the artwork."""
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
output = Path(__file__).resolve().parent.parent / 'public'
icons = output / 'icons'
icons.mkdir(parents=True, exist_ok=True)
logo = Image.open(source).convert('RGBA')
logo.save(output / 'logo.png')
for size in (192, 512):
    for maskable in (False, True):
        canvas = Image.new('RGBA', (size, size), '#3B5F86' if maskable else (0, 0, 0, 0))
        limit = round(size * (0.70 if maskable else 0.95))
        fitted = logo.copy()
        fitted.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        canvas.alpha_composite(fitted, ((size-fitted.width)//2, (size-fitted.height)//2))
        canvas.save(icons / f'{"maskable" if maskable else "icon"}-{size}.png')
canvas = Image.new('RGBA', (180, 180), '#3B5F86')
fitted = logo.copy()
fitted.thumbnail((148, 148), Image.Resampling.LANCZOS)
canvas.alpha_composite(fitted, ((180-fitted.width)//2, (180-fitted.height)//2))
canvas.convert('RGB').save(icons / 'apple-touch-icon.png')
print('Logo original e cinco ícones de instalação preparados.')

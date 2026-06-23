#!/usr/bin/env python3
"""
Process the Apical logo PNG:
  1. Crop the triangle pictogram (cols 139-269, rows 535-700) with padding.
  2. Generate favicon PNG sizes (16, 32, 48, 180, 192, 512).
  3. Generate a multi-resolution .ico (16, 32, 48).
  4. Save the cropped pictogram as a high-res PNG (for the SVG trace reference).
  5. Save a white-on-transparent version for dark mode.
"""
from PIL import Image
import os

SRC = '/home/z/my-project/upload/apical logo.png'
OUT = '/home/z/my-project/my-project-temp/public'

# Triangle bbox (with a little padding)
TRI_COL_MIN, TRI_COL_MAX = 130, 275
TRI_ROW_MIN, TRI_ROW_MAX = 528, 708

img = Image.open(SRC).convert('RGBA')

# 1. Crop the triangle pictogram (square crop, centered on the triangle)
tri_w = TRI_COL_MAX - TRI_COL_MIN
tri_h = TRI_ROW_MAX - TRI_ROW_MIN
side = max(tri_w, tri_h)
# Center the square on the triangle's center
tri_cx = (TRI_COL_MIN + TRI_COL_MAX) / 2
tri_cy = (TRI_ROW_MIN + TRI_ROW_MAX) / 2
square_crop = (
    int(tri_cx - side / 2),
    int(tri_cy - side / 2),
    int(tri_cx + side / 2),
    int(tri_cy + side / 2),
)
triangle = img.crop(square_crop)
print(f'triangle cropped: {triangle.size}')

# Make the white background transparent
def make_transparent(im):
    """Convert white pixels to transparent."""
    data = im.getdata()
    new_data = []
    for item in data:
        r, g, b, a = item
        # If close to white, make transparent
        if r > 240 and g > 240 and b > 240:
            new_data.append((255, 255, 255, 0))
        else:
            # Keep the dark pixels but make them fully opaque
            new_data.append((r, g, b, 255))
    im.putdata(new_data)
    return im

triangle透明 = make_transparent(triangle.copy())

# Save the high-res transparent triangle
triangle透明.save(f'{OUT}/apical-mark.png')
print(f'saved apical-mark.png ({triangle透明.size})')

# 2. Generate favicon PNG sizes
sizes = [16, 32, 48, 180, 192, 512]
for s in sizes:
    resized = triangle透明.resize((s, s), Image.LANCZOS)
    name = 'apple-touch-icon.png' if s == 180 else f'icon-{s}.png'
    resized.save(f'{OUT}/{name}')
    print(f'saved {name} ({s}x{s})')

# 3. Generate .ico (multi-resolution: 16, 32, 48)
ico_sizes = [(16, 16), (32, 32), (48, 48)]
triangle透明.save(f'{OUT}/favicon.ico', format='ICO', sizes=ico_sizes)
print(f'saved favicon.ico (sizes: {ico_sizes})')

# 4. Create a white-on-transparent version for dark mode
# (invert: black triangle → white triangle, keep transparency)
def make_white_version(im):
    """Invert dark pixels to white, keep transparency."""
    data = im.getdata()
    new_data = []
    for item in data:
        r, g, b, a = item
        if a == 0:
            new_data.append((255, 255, 255, 0))
        else:
            # Dark pixel → make it white
            new_data.append((255, 255, 255, a))
    im.putdata(new_data)
    return im

white_triangle = make_white_version(triangle透明.copy())
white_triangle.save(f'{OUT}/apical-mark-white.png')
print(f'saved apical-mark-white.png ({white_triangle.size})')

# 5. Also save a cropped version of the full combination mark (triangle + wordmark)
# for use in auth pages / emails
full_crop = img.crop((100, 510, 1150, 740))
full透明 = make_transparent(full_crop.copy())
full透明.save(f'{OUT}/apical-full.png')
print(f'saved apical-full.png ({full透明.size})')

print('\nAll logo assets generated in', OUT)

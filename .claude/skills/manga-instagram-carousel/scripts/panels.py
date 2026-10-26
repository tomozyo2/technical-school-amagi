from PIL import Image, ImageDraw

WHITE = 228

def profile(mask_img, box, axis):
    """box内の『白い割合』を、行ごと(axis=0)または列ごと(axis=1)に返す(0〜1)"""
    x0, y0, x1, y1 = box
    sub = mask_img.crop(box)
    if axis == 0:
        prof = sub.resize((1, y1 - y0), Image.BOX)
        return [prof.getpixel((0, i)) / 255 for i in range(y1 - y0)]
    prof = sub.resize((x1 - x0, 1), Image.BOX)
    return [prof.getpixel((i, 0)) / 255 for i in range(x1 - x0)]

def runs(flags):
    out, s = [], None
    for i, v in enumerate(flags):
        if v and s is None: s = i
        if not v and s is not None: out.append((s, i)); s = None
    if s is not None: out.append((s, len(flags)))
    return out

def split(mask, box, axis, gutter=0.93, min_len=50):
    x0, y0, x1, y1 = box
    frac = profile(mask, box, axis)
    parts = [(a, b) for a, b in runs([f < gutter for f in frac]) if b - a >= min_len]
    if len(parts) <= 1: return None
    return [(x0, y0 + a, x1, y0 + b) if axis == 0 else (x0 + a, y0, x0 + b, y1) for a, b in parts]

def xycut(mask, box):
    for axis in (0, 1):
        parts = split(mask, box, axis)
        if parts:
            out = []
            for p in parts: out += xycut(mask, p)
            return out
    return [box]

def tighten(mask, box):
    x0, y0, x1, y1 = box
    ys = [i for i, f in enumerate(profile(mask, box, 0)) if f < 0.98]
    xs = [i for i, f in enumerate(profile(mask, box, 1)) if f < 0.98]
    if not ys or not xs: return box
    return (x0 + xs[0], y0 + ys[0], x0 + xs[-1] + 1, y0 + ys[-1] + 1)

def detect(path):
    im = Image.open(path).convert("RGB")
    mask = im.convert("L").point(lambda v: 255 if v > WHITE else 0)   # 白=255
    boxes = [tighten(mask, b) for b in xycut(mask, (0, 0, im.width, im.height))]
    boxes = [b for b in boxes if (b[2] - b[0]) > 80 and (b[3] - b[1]) > 60]
    return im, boxes

def overlay(im, boxes, out):
    o = im.copy(); d = ImageDraw.Draw(o)
    for i, (x0, y0, x1, y1) in enumerate(boxes, 1):
        d.rectangle((x0, y0, x1 - 1, y1 - 1), outline=(255, 0, 255), width=6)
        d.rectangle((x0 + 8, y0 + 8, x0 + 78, y0 + 58), fill=(255, 0, 255))
        d.text((x0 + 20, y0 + 20), str(i), fill=(255, 255, 255))
    o.save(out)

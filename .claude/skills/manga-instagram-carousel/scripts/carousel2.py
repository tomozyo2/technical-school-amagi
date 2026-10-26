import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw, ImageFont
from panels import detect

# インスタが選べる3つの形（幅1080基準）
SHAPES = {
    "square":    (1080, 1080),   # 正方形 1:1
    "portrait":  (1080, 1350),   # 縦長 4:5
    "landscape": (1080, 566),    # 横長 1.91:1
}
BG = (10, 28, 19)
GREEN = (61, 220, 106)
GRAY = (170, 190, 178)
FONT_B = "C:/Windows/Fonts/YuGothB.ttc"
def font(sz): return ImageFont.truetype(FONT_B, sz)

def rounded(im, r):
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, im.width - 1, im.height - 1), r, fill=255)
    out = Image.new("RGBA", im.size); out.paste(im.convert("RGBA"), (0, 0), m); return out

def text_center(d, xy_center, s, f, fill):
    w = d.textlength(s, font=f); d.text((xy_center[0] - w / 2, xy_center[1]), s, font=f, fill=fill)

def pick_shape(boxes):
    """中身のコマ(先頭のタイトル帯・末尾の『つづく』帯を除く)の形に、いちばん近いインスタの形を選ぶ"""
    content = boxes[1:-1] if len(boxes) > 2 else boxes
    ratios = sorted((x1 - x0) / (y1 - y0) for x0, y0, x1, y1 in content)
    median = ratios[len(ratios) // 2]
    def fill(cr):
        return (cr / median) if median > cr else (median / cr)
    best = max(SHAPES, key=lambda k: fill(SHAPES[k][0] / SHAPES[k][1]))
    return best, median

def slide(crop, size, ep_label, idx, total, cover=False, last=False):
    cv = Image.new("RGB", size, BG); d = ImageDraw.Draw(cv)
    top_pad, bottom_pad = 90, 96      # 上下の帯（見出し・ページ番号）の分だけ確保
    maxw, maxh = size[0] - 60, size[1] - top_pad - bottom_pad
    sc = min(maxw / crop.width, maxh / crop.height)
    p = rounded(crop.resize((round(crop.width * sc), round(crop.height * sc)), Image.LANCZOS), 16)
    x = (size[0] - p.width) // 2; y = top_pad + (maxh - p.height) // 2
    cv.paste(p, (x, y), p)
    tsz = max(22, size[0] // 32)
    d.text((36, 28), "チロんぽ＆メロんぽ", font=font(tsz), fill=GREEN)
    w = d.textlength(ep_label, font=font(tsz)); d.text((size[0] - 36 - w, 28), ep_label, font=font(tsz), fill=GREEN)
    if not cover:  # 表紙は「スワイプして読もう」と重なるのでページ番号を出さない
        text_center(d, (size[0] / 2, size[1] - bottom_pad + 34), f"{idx} / {total}", font(max(22, tsz - 4)), GRAY)
    if cover: text_center(d, (size[0] / 2, y + p.height + 16), "スワイプして読もう  ▶", font(max(26, tsz + 4)), (255, 255, 255))
    elif not last: d.text((size[0] - 210, size[1] - bottom_pad + 34), "スワイプ ▶", font=font(max(22, tsz - 4)), fill=GRAY)
    return cv

def build(src, ep_label, outdir, shape_name=None):
    im, boxes = detect(src)
    if shape_name is None:
        shape_name, median = pick_shape(boxes)
    else:
        median = None
    size = SHAPES[shape_name]
    os.makedirs(outdir, exist_ok=True)
    total = len(boxes); outs = []
    for i, b in enumerate(boxes, 1):
        crop = im.crop(b)
        s = slide(crop, size, ep_label, i, total, cover=(i == 1), last=(i == total))
        path = os.path.join(outdir, f"{i:02d}.jpg"); s.save(path, quality=93, subsampling=0); outs.append(path)
    return outs, shape_name, median

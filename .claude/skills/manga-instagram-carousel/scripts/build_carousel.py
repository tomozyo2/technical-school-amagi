"""
漫画1話ぶんの画像から、まとめて作る道具。
  1) コマの位置を自動検出（くっついていたら黒い枠線で手直し）
  2) Instagramカルーセル画像（01.jpg, 02.jpg, ...）を作る
  3) manga-panels.js にそのまま貼れる「コマの位置」の数字を出す

使い方（プロジェクトのルートから）:
  python .claude/skills/manga-instagram-carousel/scripts/build_carousel.py ^
      --src "manga/episode3-1790085227000-0.png" ^
      --ep-label "第3話" ^
      --ep-dir "3話" ^
      --out-base "manga"

出力:
  <out-base>/インスタ用カルーセル/<ep-dir>/01.jpg ...
  標準出力に FRACS: [...]  ← これを manga-panels.js の値としてそのまま使う
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from panels import detect, overlay, profile
from carousel2 import SHAPES, pick_shape, slide


def find_black_border_row(im, box, search_frac=0.4):
    """タイトル帯と①のコマがくっついた大きい箱(box)の中から、
    コマの黒い枠線(上端)の行を探す。上からsearch_frac(既定40%)ぶんだけ調べる。
    見つからなければ None。"""
    x0, y0, x1, y1 = box
    search_h = int((y1 - y0) * search_frac)
    mask = im.convert("L")
    # 黒っぽい割合が高い行を探す(枠線はほぼ黒が幅いっぱいに続く)
    from PIL import Image
    sub = mask.crop((x0, y0, x1, y0 + search_h))
    black = sub.point(lambda v: 255 if v < 60 else 0)
    prof = black.resize((1, search_h), Image.BOX)
    for y in range(search_h):
        ratio = prof.getpixel((0, y)) / 255
        if ratio > 0.5:
            return y0 + y
    return None


def detect_with_fix(src, tall_frac=0.30):
    """detect()の結果で、先頭の箱(タイトル帯)が画像の高さのtall_frac以上あったら、
    ①のコマとくっついていると判断して、黒い枠線の位置で手動に分ける。"""
    im, boxes = detect(src)
    w, h = im.size
    fixed_note = None
    if boxes and (boxes[0][3] - boxes[0][1]) > h * tall_frac:
        split_y = find_black_border_row(im, boxes[0])
        if split_y is not None:
            x0, y0, x1, y1 = boxes[0]
            title_box = (x0, y0, x1, split_y)
            panel1_box = (x0, split_y, x1, y1)
            boxes = [title_box, panel1_box] + boxes[1:]
            fixed_note = f"タイトル帯と最初のコマがくっついていたため、y={split_y}の黒い枠線で手動に分けた"
    return im, boxes, fixed_note


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="元画像のパス(1話ぶんの4コマ/8コマがまとまった1枚)")
    ap.add_argument("--ep-label", required=True, help='カルーセルの右上に出す文字。例: "第3話"')
    ap.add_argument("--ep-dir", required=True, help='保存フォルダ名。例: "3話"')
    ap.add_argument("--out-base", default="manga", help="インスタ用カルーセルを作る場所の親フォルダ(既定: manga)")
    ap.add_argument("--no-overlay", action="store_true", help="確認用の枠線つき画像を作らない")
    args = ap.parse_args()

    im, boxes, note = detect_with_fix(args.src)
    if note:
        print("※", note)
    print(f"コマ数(タイトル帯を含む): {len(boxes)}  画像サイズ: {im.size}")
    for i, b in enumerate(boxes):
        print(f"  [{i}] {b}  幅{b[2]-b[0]} 高さ{b[3]-b[1]}")

    if not args.no_overlay:
        os.makedirs(args.out_base, exist_ok=True)
        ov_path = os.path.join(args.out_base, f"_確認用_{args.ep_dir}_枠線.png")
        overlay(im, boxes, ov_path)
        print("確認用画像:", ov_path, "← 開いて、コマがずれていないか目で見て確認する")

    shape_name, median = pick_shape(boxes)
    size = SHAPES[shape_name]
    print(f"選ばれた形: {shape_name} {size}  (コマの横縦比の中央値 {median:.2f})")

    outdir = os.path.join(args.out_base, "インスタ用カルーセル", args.ep_dir)
    os.makedirs(outdir, exist_ok=True)
    total = len(boxes)
    for i, b in enumerate(boxes, 1):
        crop = im.crop(b)
        s = slide(crop, size, args.ep_label, i, total, cover=(i == 1), last=(i == total))
        path = os.path.join(outdir, f"{i:02d}.jpg")
        s.save(path, quality=93, subsampling=0)
        print("作成:", path)

    w, h = im.size
    fracs = [
        [round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4)]
        for x0, y0, x1, y1 in boxes
    ]
    print("\nFRACS(manga-panels.jsにそのまま貼る値):")
    print(json.dumps(fracs))


if __name__ == "__main__":
    main()

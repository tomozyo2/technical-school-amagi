# インスタ用カルーセル画像(緑の暗い背景＋上の文字＋下のページ番号)から、コマの絵だけを切り抜く。
# 使い方: python crop_panels.py <カルーセルの話フォルダ> <出力assetsフォルダ>
#   01.jpg → cover.jpg (表紙はそのまま)、02.jpg〜 → panel1.jpg〜
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
files = sorted(src.glob("[0-9][0-9].jpg"))
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB")
    if i == 0:
        im.save(out / "cover.jpg", quality=95)
        print(f"{f.name} → cover.jpg {im.size}")
        continue
    w, h = im.size
    top, bottom = int(h * 0.063), int(h * 0.935)  # 上の題名と下のページ番号をよける
    a = np.asarray(im)[top:bottom].astype(int)
    bright = a.max(axis=2) > 60  # 背景(とても暗い緑)より明るいところ＝コマ
    rows = np.where(bright.mean(axis=1) > 0.3)[0]  # 横長コマは幅が画面の半分ほどなので0.3(26話で修正)
    # 列は「コマがある行の範囲」だけで調べる(横長のコマは画面の縦の半分も占めないため。18話で修正)
    cols = np.where(bright[rows[0]:rows[-1] + 1].mean(axis=0) > 0.5)[0]
    box = (cols[0] + 6, top + rows[0] + 6, cols[-1] - 5, top + rows[-1] - 5)  # 枠線を少し内側へ
    panel = im.crop(box)
    name = f"panel{i}.jpg"
    panel.save(out / name, quality=95)
    print(f"{f.name} → {name} {panel.size}")

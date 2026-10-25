# 切り抜き方式の部品づくりの道具(ひな形)。話ごとに <プロジェクト>/tools/prep_all.py へコピーし、
# 下に panel1()〜panel4() を書き足して使う(お手本: 漫画アニメ動画/2話_切り抜き版/tools/prep_all.py)。
# 絵を部品(キャラ・ボール・ふきだし・文字など)に分けて assets/ に PNG で保存する。
# 背景(p<N>_bg.png)は、動く部品の跡を周りの色で埋めたもの。
# 使い方: python tools/prep_all.py [確認画像を置くフォルダ]
import sys
from pathlib import Path

import cv2
import numpy as np

A = Path(__file__).resolve().parent.parent / "assets"
CHECK = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def rd(p, flag=cv2.IMREAD_COLOR):
    return cv2.imdecode(np.fromfile(str(p), np.uint8), flag)


def wr(p, im):
    cv2.imencode(Path(p).suffix, im)[1].tofile(str(p))


def fill_outer(m, keep_frac=None):
    # いちばん大きい塊だけ残し、中の穴(口の中など)はうめる
    # keep_frac を指定すると、いちばん大きい塊のその割合以上の塊はぜんぶ残す(はなれた文字など)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return m
    areas = st[1:, cv2.CC_STAT_AREA]
    if keep_frac is None:
        keep = [1 + np.argmax(areas)]
    else:
        keep = [1 + i for i, a in enumerate(areas) if a >= areas.max() * keep_frac]
    m = np.where(np.isin(lab, keep), 255, 0).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros_like(m)
    cv2.drawContours(out, cs, -1, 255, -1)
    return out


def grab(img, rect, keep_frac=None):
    # 四角で囲んだ中から、色の違いで中身を切り分ける
    x0, y0, x1, y1 = rect
    m = np.zeros(img.shape[:2], np.uint8)
    bg, fg = np.zeros((1, 65)), np.zeros((1, 65))
    cv2.grabCut(img, m, (x0, y0, x1 - x0, y1 - y0), bg, fg, 8, cv2.GC_INIT_WITH_RECT)
    m = np.where((m == 1) | (m == 3), 255, 0).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    return fill_outer(m, keep_frac)


def bubble(img, rect):
    # ふきだし: 白い部分(文字の穴はうめる)＋ふちの線まで
    x0, y0, x1, y1 = rect
    white = ((img > 225).all(axis=2)).astype(np.uint8) * 255
    box = np.zeros_like(white)
    box[y0:y1, x0:x1] = 255
    m = fill_outer(cv2.bitwise_and(white, box))
    return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))


def ellipse(img, cx, cy, rx, ry):
    m = np.zeros(img.shape[:2], np.uint8)
    cv2.ellipse(m, (cx, cy), (rx, ry), 0, 0, 360, 255, -1)
    return m


def minus(a, b):
    return cv2.bitwise_and(a, cv2.bitwise_not(b))


def sprite(img, m, name):
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = cv2.GaussianBlur(m, (3, 3), 0)
    wr(A / f"{name}.png", rgba)


def inpaint(img, masks, grow=9):
    # 部品の跡を周りの色で埋める(部品が少し動いても、元の絵が二重に見えないように)
    hole = np.zeros(img.shape[:2], np.uint8)
    for m in masks:
        hole = cv2.bitwise_or(hole, m)
    hole = cv2.dilate(hole, np.ones((grow, grow), np.uint8))
    return cv2.inpaint(img, hole, 7, cv2.INPAINT_TELEA)


def check(n, img, parts):
    # 確認用: 部品をピンクの上に並べた画像
    if not CHECK:
        return
    out = np.zeros_like(img)
    out[:] = (255, 0, 255)
    for m in parts.values():
        a = (cv2.GaussianBlur(m, (3, 3), 0) / 255.0)[:, :, None]
        out = (img * a + out * (1 - a)).astype(np.uint8)
    wr(CHECK / f"p{n}_parts.png", np.hstack([out, rd(A / f"p{n}_bg.png")]))

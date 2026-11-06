"""
すでにある話（本編の絵・コマの位置は確認済み）に、表紙を足して「サイト・コマ送り・インスタ用カルーセル」を作り直す道具。
（26〜30話で使った。SKILL.md の 3.5 の手順を1回で済ませる）

使い方（プロジェクトのルートから）:
  python .claude/skills/manga-instagram-carousel/scripts/add_cover.py --ep 26 --body "manga/episodex-1790300000000-0.png" --cover "manga/26話表紙.png"

やること:
  1) 表紙(上)＋本編(下)を同じ横幅で縦につなぎ、manga/episode<話>-<新しい番号>-0.png に保存
  2) manga-data.js の、その本編の絵のパスを新しい絵に差し替え
  3) manga-panels.js の、その本編のコマの位置(確認済み)を使い、本編のタイトル帯を外して表紙を先頭に足した位置を登録
     (古いキーは削除。古い絵のファイル自体は消さない)
  4) インスタ用カルーセルを 4:5 で作り直し(01=表紙)。古いカルーセルは インスタ用カルーセル/_旧_表紙なし/ に退避
"""
import argparse, json, os, re, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from carousel2 import SHAPES, slide

GAP = 28  # 表紙と本編の間の白いすき間(px)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ep", type=int, required=True)
    ap.add_argument("--body", required=True, help="今の本編の絵(コマの位置が manga-panels.js に登録済みのもの)")
    ap.add_argument("--cover", required=True, help="表紙の絵(ChatGPTの生の出力)")
    ap.add_argument("--base", default="manga")
    args = ap.parse_args()

    n, base = args.ep, args.base
    body = Image.open(args.body).convert("RGB")
    cov = Image.open(args.cover).convert("RGB")
    W = body.width
    cov = cov.resize((W, round(cov.height * W / cov.width)), Image.LANCZOS)
    H = cov.height + GAP + body.height
    out = Image.new("RGB", (W, H), (255, 255, 255))
    out.paste(cov, (0, 0))
    out.paste(body, (0, cov.height + GAP))

    ts = str(int(time.time() * 1000) + n * 1000)
    new_rel = f"{base}/episode{n}-{ts}-0.png"
    out.save(new_rel)
    print("結合画像:", new_rel, out.size)

    # --- コマの位置 ---
    old_rel = args.body.replace("\\", "/")
    panels_js = open("manga-panels.js", encoding="utf-8").read()
    m = re.search(r'^[ \t]*"' + re.escape(old_rel) + r'":\s*(\[\[.*?\]\]),?[ \t]*\n', panels_js, re.M)
    if not m:
        sys.exit(f"manga-panels.js に {old_rel} の位置が見つかりません")
    old = json.loads(m.group(1))
    panels = old[1:]  # 先頭は本編のタイトル帯 → 外す(表紙にタイトルが入っているため)
    y0 = cov.height + GAP
    fr = [[0.0, 0.0, 1.0, round(cov.height / H, 4)]]
    for x, y, w, h in panels:
        fr.append([x, round((y0 + y * body.height) / H, 4), w, round(h * body.height / H, 4)])
    note = f"  // 第{n}話（{len(fr)} か所・表紙＋{len(panels)}コマ。表紙＋本編を縦に結合。本編のタイトル帯は外した）\n"
    newline = f'  "{new_rel}": {json.dumps(fr, separators=(",", ":"))},\n'
    panels_js = panels_js.replace(m.group(0), note + newline, 1)
    open("manga-panels.js", "w", encoding="utf-8").write(panels_js)
    print("manga-panels.js: 登録", len(fr), "か所")

    # --- manga-data.js ---
    data = open("manga-data.js", encoding="utf-8").read()
    pat = re.compile(r'("image":\s*")' + re.escape(old_rel) + r'(",\s*"imageUpdatedAt":\s*")\d+(")')
    if not pat.search(data):
        sys.exit(f"manga-data.js に {old_rel} が見つかりません")
    data = pat.sub(lambda mm: mm.group(1) + new_rel + mm.group(2) + ts + mm.group(3), data, count=1)
    open("manga-data.js", "w", encoding="utf-8").write(data)
    print("manga-data.js: 差し替え")

    # --- インスタ用カルーセル(4:5) ---
    car = os.path.join(base, "インスタ用カルーセル", f"{n}話")
    if os.path.isdir(car):
        bk = os.path.join(base, "インスタ用カルーセル", "_旧_表紙なし")
        os.makedirs(bk, exist_ok=True)
        dest = os.path.join(bk, f"{n}話")
        if os.path.exists(dest):
            dest += "_" + time.strftime("%H%M%S")
        shutil.move(car, dest)
        print("古いカルーセルを退避:", dest)
    os.makedirs(car, exist_ok=True)
    size = SHAPES["portrait"]
    boxes = [(round(x * W), round(y * H), round((x + w) * W), round((y + h) * H)) for x, y, w, h in fr]
    for i, b in enumerate(boxes, 1):
        s = slide(out.crop(b), size, f"第{n}話", i, len(boxes), cover=(i == 1), last=(i == len(boxes)))
        s.save(os.path.join(car, f"{i:02d}.jpg"), quality=93, subsampling=0)
    print("カルーセル:", car, f"{len(boxes)}枚 {size}")


if __name__ == "__main__":
    main()

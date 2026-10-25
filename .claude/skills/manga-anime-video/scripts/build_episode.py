# episode.json(動画の台本) と assets/voice/voices_meta.json(声の長さ) から、HyperFramesの index.html を作る。
# 使い方: python build_episode.py <動画プロジェクトフォルダ>
# 時間は声の長さから自動で計算するので、秒数を手で書く必要はない。
import html
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
W, H = 1080, 1920
ENTER = 0.45      # コマが横から入ってくる時間
GAP = 0.25        # セリフとセリフの間
PANEL_TOP, PANEL_MAX_W, PANEL_MAX_H = 260, 960, 1100
COVER_TOP, COVER_W = 230, 1000
SUB_TOP = 1400

proj = Path(sys.argv[1]).resolve()
ep = json.loads((proj / "episode.json").read_text(encoding="utf-8"))
voices = {v["id"]: v for v in json.loads((proj / "assets/voice/voices_meta.json").read_text(encoding="utf-8"))}
chars = json.loads((HERE.parent / "voices.json").read_text(encoding="utf-8"))["characters"]
sfx_vol = ep.get("sfx_volume", 0.5)

dom, audio, js = [], [], []
t = 0.0
uid = 0


def nid(p):
    global uid
    uid += 1
    return f"{p}{uid}"


def cam_js(img, s, fx, fy, w, h, iw=None, ih=None):
    # 拡大率sで、絵の(fx,fy)の場所が窓(w×h)の真ん中に来るように動かす(はみ出して隙間が出ないよう制限)
    # iw×ih = 窓の中での絵の大きさ(横長のコマは窓より横に大きい)
    iw, ih = iw or w, ih or h
    lim_x, lim_y = max(0, (iw * s - w) / 2), max(0, (ih * s - h) / 2)
    x = max(-lim_x, min(lim_x, (0.5 - fx) * iw * s))
    y = max(-lim_y, min(lim_y, (0.5 - fy) * ih * s))
    return f"{{scale:{s},x:{x:.1f},y:{y:.1f}}}"


def add_sfx(name, at):
    files = {p.stem: p.name for p in (proj / "assets/sfx").iterdir()}
    if name not in files:
        sys.exit(f"効果音「{name}」が assets/sfx にありません")
    aid = nid("sfx")
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                         str(proj / "assets/sfx" / files[name])]).decode())
    # 効果音が重なっても注意が出ないよう、3本の線(トラック)に順番に振り分ける
    track = 5 + uid % 3
    audio.append(f'<audio id="{aid}" src="assets/sfx/{files[name]}" data-start="{at:.2f}" data-duration="{dur:.2f}" data-track-index="{track}" data-volume="{sfx_vol}"></audio>')


def size_class(v):
    # 字幕の長さで文字の大きさを変える。名札＋セリフが長いときは2行に折り返す
    n = len(v["text"]) + len(v["chara"]) * 0.8
    if n > 22:
        return " long wrap"
    return " long" if len(v["text"]) > 11 else ""


def add_line(line_id, at, sub=True, sub_top=SUB_TOP):
    v = voices[line_id]
    aid = nid("vo")
    audio.append(f'<audio id="{aid}" src="assets/voice/{v["file"]}" data-start="{at:.2f}" data-duration="{v["duration_s"]}" data-track-index="2" data-volume="1"></audio>')
    if sub:
        c = chars[v["chara"]]
        sid = nid("sub")
        dom.append(
            f'<div id="{sid}" class="clip sub" style="top:{sub_top}px" data-start="{at:.2f}" data-duration="{v["duration_s"] + 0.35:.2f}" data-track-index="4">'
            f'<div class="sub-in"><span class="who" style="background:{c.get("color", "#3ddc84")}">{html.escape(v["chara"])}</span>'
            f'<span class="say{size_class(v)}">{html.escape(v["text"])}</span></div></div>')
        js.append(f'tl.fromTo("#{sid} .sub-in",{{scale:0.7,opacity:0}},{{scale:1,opacity:1,duration:0.25,ease:"back.out(2)"}},{at:.2f});')
    return v["duration_s"]


scenes = ep["scenes"]
starts = []
for i, sc in enumerate(scenes):
    start = t
    starts.append(start)
    sid, win, img = nid("scene"), nid("win"), nid("img")
    is_cover = sc.get("type") == "cover"
    im = Image.open(proj / "assets" / sc["image"])
    if is_cover:
        w = COVER_W
        h = round(w * im.height / im.width)
        left, top = (W - w) // 2, COVER_TOP
    else:
        k = min(PANEL_MAX_W / im.width, PANEL_MAX_H / im.height)
        w, h = round(im.width * k), round(im.height * k)
        if im.width > im.height:
            # 横長のコマ：窓を縦に広げて絵を大きく映し、しゃべる人へ横にスライドする(字幕はコマのすぐ下)
            w, h = 1000, ep.get("landscape_h", 760)
        left, top = (W - w) // 2, PANEL_TOP + (PANEL_MAX_H - h) // 2
    ih = h
    iw = max(w, round(h * im.width / im.height))
    sub_top = min(SUB_TOP, top + h + 40)
    # 入場
    if i == 0:
        js.append(f'tl.fromTo("#{win}",{{scale:1.15,opacity:0}},{{scale:1,opacity:1,duration:0.6,ease:"back.out(1.6)"}},0);')
        t += 0.4
    else:
        js.append(f'tl.fromTo("#{sid} .slide",{{x:{W}}},{{x:0,duration:{ENTER},ease:"power3.out"}},{start:.2f});')
        add_sfx("whoosh-short", max(0, start - 0.1))
        t += ENTER + 0.15
    s0 = sc.get("cam0", [1, 0.5, 0.5])
    js.append(f'tl.set("#{img}",{cam_js(img, *s0, w, h, iw, ih)},0);')
    for name in sc.get("sfx", []):
        add_sfx(name, t)
    for b in sc.get("beats", []):
        t += b.get("pause", 0)
        if "cam" in b:
            d = b.get("camDur", 0.45)
            js.append(f'tl.to("#{img}",{{...{cam_js(img, *b["cam"], w, h, iw, ih)},duration:{d},ease:"power2.inOut"}},{t:.2f});')
            t += d * 0.6
        for name in b.get("sfx", []):
            add_sfx(name, t)
        if b.get("shake"):
            js.append(f'tl.fromTo("#{win}",{{x:-14}},{{x:14,duration:0.05,repeat:5,yoyo:true,ease:"none"}},{t:.2f}).set("#{win}",{{x:0}},{t + 0.3:.2f});')
        if b.get("pop"):
            js.append(f'tl.fromTo("#{win}",{{scale:1}},{{scale:1.04,duration:0.12,yoyo:true,repeat:1,ease:"power2.out"}},{t:.2f});')
        if "line" in b:
            t += add_line(b["line"], t, sub=not is_cover, sub_top=sub_top) + GAP
        t += b.get("hold", 0)
    if "cam_end" in sc:
        d = sc.get("camEndDur", 0.6)
        js.append(f'tl.to("#{img}",{{...{cam_js(img, *sc["cam_end"], w, h, iw, ih)},duration:{d},ease:"power2.inOut"}},{t:.2f});')
        t += d
    if is_cover:  # 表紙はずっとゆっくり寄っていく
        js.append(f'tl.to("#{win}",{{scale:1.04,duration:{t + sc.get("tail", 0.5):.2f},ease:"none"}},0.6);')
    t += sc.get("tail", 0.5)
    end = t
    dur = end - start + ENTER
    js.append(f'tl.to("#{sid} .slide",{{x:-{W},duration:{ENTER},ease:"power3.in"}},{end:.2f});')
    dom.append(
        f'<div id="{sid}" class="clip scene" data-start="{start:.2f}" data-duration="{dur:.2f}" data-track-index="1">'
        f'<div class="slide"><div id="{win}" class="win" style="left:{left}px;top:{top}px;width:{w}px;height:{h}px">'
        f'<img id="{img}" src="assets/{sc["image"]}" alt="" data-layout-allow-overflow style="left:{(w - iw) / 2:.0f}px;top:0;width:{iw}px;height:{ih}px" /></div></div></div>')

# 最後の「つづく」画面
end_start = t
endd = ep.get("end_duration", 3.0)
dom.append(
    f'<div id="endcard" class="clip scene" data-start="{end_start:.2f}" data-duration="{endd}" data-track-index="1">'
    f'<div class="end"><img id="endicon" src="assets/{ep.get("icon", "icon.jpg")}" alt="" />'
    f'<div id="endtxt" class="end-big">{html.escape(ep.get("end_text", "つづく…"))}</div>'
    f'<div id="endfollow" class="end-small">{html.escape(ep.get("follow_text", "フォローしてね！"))}<br />{html.escape(ep.get("handle", ""))}</div></div></div>')
js.append(f'tl.fromTo("#endicon",{{scale:0,rotation:-20}},{{scale:1,rotation:0,duration:0.6,ease:"back.out(1.8)"}},{end_start + 0.1:.2f});')
js.append(f'tl.fromTo("#endtxt",{{y:60,opacity:0}},{{y:0,opacity:1,duration:0.45,ease:"power3.out"}},{end_start + 0.45:.2f});')
js.append(f'tl.fromTo("#endfollow",{{y:40,opacity:0}},{{y:0,opacity:1,duration:0.45,ease:"power3.out"}},{end_start + 0.8:.2f});')
add_sfx("pop", end_start + 0.1)
total = end_start + endd

page = f"""<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={W}, height={H}" />
    <!-- このファイルは build_episode.py で自動生成。直すときは episode.json を直して作り直す -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {{ font-family: "MaruGo"; src: url("assets/MPLUSRounded1c-ExtraBold.ttf"); font-weight: 800; }}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: {W}px; height: {H}px; overflow: hidden; background: #0b1a14; }}
      #root {{ position: relative; width: 100%; height: 100%; overflow: hidden; font-family: "MaruGo", sans-serif; font-weight: 800;
        background: radial-gradient(circle at 50% 42%, #17402c 0%, #0b1a14 70%); }}
      .paws {{ position: absolute; inset: 0; opacity: 0.08;
        background-image: radial-gradient(circle, #3ddc84 14px, transparent 15px), radial-gradient(circle, #3ddc84 9px, transparent 10px);
        background-size: 180px 180px, 180px 180px; background-position: 0 0, 40px 60px; }}
      .head {{ position: absolute; left: 60px; right: 60px; top: 130px; display: flex; justify-content: space-between; color: #3ddc84; font-size: 46px; }}
      .scene {{ position: absolute; inset: 0; }}
      .slide {{ position: absolute; inset: 0; }}
      .win {{ position: absolute; overflow: hidden; border-radius: 22px; border: 8px solid #ffffff; box-shadow: 0 18px 50px rgba(0,0,0,0.45); background: #fff; }}
      .win img {{ display: block; position: absolute; object-fit: cover; }}
      .sub {{ position: absolute; left: 50px; right: 50px; top: {SUB_TOP}px; display: flex; justify-content: center; }}
      .sub-in {{ display: flex; align-items: center; gap: 22px; background: #ffffff; border-radius: 60px; padding: 18px 40px 18px 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.35); max-width: 980px; }}
      .who {{ color: #fff; font-size: 38px; padding: 10px 26px; border-radius: 40px; white-space: nowrap; }}
      .say {{ color: #2b1a10; font-size: 50px; line-height: 1.25; white-space: nowrap; }}
      .say.long {{ font-size: 40px; }}
      .say.wrap {{ white-space: normal; }}
      .end {{ position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 50px; padding-bottom: 200px; }}
      #endicon {{ display: block; width: 440px; height: 440px; border-radius: 50%; border: 12px solid #fff; object-fit: cover; }}
      .end-big {{ color: #ffd23f; font-size: 130px; }}
      .end-small {{ color: #ffffff; font-size: 58px; text-align: center; line-height: 1.5; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{total:.2f}" data-width="{W}" data-height="{H}">
      <div class="paws"></div>
      <div class="head"><span>{html.escape(ep.get("series", ""))}</span><span>{html.escape(ep.get("title", ""))}</span></div>
      {chr(10).join("      " + d for d in dom).strip()}
      {chr(10).join("      " + a for a in audio).strip()}
    </div>
    <script>
      const tl = gsap.timeline({{ paused: true }});
      {chr(10).join("      " + j for j in js).strip()}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
"""
(proj / "index.html").write_text(page, encoding="utf-8")
print(f"index.html を作りました。長さ {total:.1f}秒 / 場面 {len(scenes)}個 + つづく画面")
for sc, st in zip(scenes, starts):
    print(f"  {st:5.2f}秒〜 {sc['image']}")

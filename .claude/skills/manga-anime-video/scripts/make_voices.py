# セリフ一覧(lines.json)から、voices.json の固定設定(VOICEVOX)でキャラの声を作る。
# 先に VOICEVOX のエンジンを起動しておく:
#   漫画アニメ動画\voicevox\VOICEVOX\vv-engine\run.exe --host 127.0.0.1 --port 50021  (http://127.0.0.1:50021)
# 使い方: python make_voices.py <lines.json> <出力フォルダ>
# lines.json: [{ "id": "p1_chiro", "chara": "チロ", "text": "ぱすだぁぁ！", "yomi": "ぱすだあああ！" }, ...]
#   text = 画面に出す文字 / yomi = 読み方(ひらがな)。yomiが無いときはtextをそのまま読ませる。
#   セリフごとに "speed" / "volume" / "pitch" を書くと、そのセリフだけ上書きできる(小声のつぶやきなど)。
#   セリフに "member": 1 と書くと、groupの中の1人(0から数える)だけの声になる。
#   セリフに "group": true を書くと、voices.json のそのキャラの "group"(声のリスト)を重ねて「みんなの声」にする。
#   全体の速さは `python make_voices.py lines.json out --speed 1.12` のように倍率で変えられる(テンポを速くしたいとき)。
# 出力: <出力フォルダ>/<id>.wav と voices_meta.json (各セリフの長さ秒)
import json, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

URL = "http://127.0.0.1:50021"
HERE = Path(__file__).resolve().parent


def post(path, params, body=None):
    req = urllib.request.Request(f"{URL}{path}?{urllib.parse.urlencode(params)}", data=body, method="POST",
                                 headers={"Content-Type": "application/json"})
    return urllib.request.urlopen(req).read()


def main():
    if len(sys.argv) < 3:
        sys.exit("使い方: python make_voices.py <lines.json> <出力フォルダ>")
    lines = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
    mult = float(sys.argv[sys.argv.index("--speed") + 1]) if "--speed" in sys.argv else 1.0
    chars = json.loads((HERE.parent / "voices.json").read_text(encoding="utf-8"))["characters"]
    meta = []
    for ln in lines:
        c = chars.get(ln["chara"])
        if not c or c.get("speaker") is None:
            sys.exit(f"voices.json に「{ln['chara']}」のVOICEVOXの声がありません。先に試聴して社長と決めて追加してください。")
        text = ln.get("yomi") or ln["text"]
        raw = out / f"{ln['id']}.raw.wav"
        members = c["group"] if ln.get("group") else ([c["group"][ln["member"]]] if "member" in ln else [c])  # "member": 番号 で「みんな」の声の中の1人だけ使う(27話)
        parts = []
        for k, m in enumerate(members):
            q = json.loads(post("/audio_query", {"text": text, "speaker": m["speaker"]}))
            q.update(speedScale=ln.get("speed", m.get("speed", c.get("speed", 1.0))) * mult, pitchScale=ln.get("pitch", m.get("pitch", c.get("pitch", 0.0))),
                     intonationScale=m.get("intonation", c.get("intonation", 1.1)), volumeScale=ln.get("volume", c.get("volume", 1.0)),
                     prePhonemeLength=0.05, postPhonemeLength=0.1)
            f = out / f"{ln['id']}.part{k}.wav"
            f.write_bytes(post("/synthesis", {"speaker": m["speaker"]}, json.dumps(q).encode()))
            parts.append(f)
        if len(parts) == 1:
            parts[0].replace(raw)
        else:  # 声を少しずらして重ねる(みんなで言っている感じ)
            cmd = ["ffmpeg", "-y", "-loglevel", "error"]
            for f in parts:
                cmd += ["-i", str(f)]
            delays = "".join(f"[{k}:a]adelay={k * 35}:all=1[a{k}];" for k in range(len(parts)))
            mix = "".join(f"[a{k}]" for k in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0[o]"
            subprocess.run(cmd + ["-filter_complex", delays + mix, "-map", "[o]", str(raw)], check=True)
            for f in parts:
                f.unlink()
        wav = out / f"{ln['id']}.wav"
        # 小声のセリフは音量をそろえすぎない(loudnormは使わず、基準を下げる)
        loud = "loudnorm=I=-16:TP=-1.5" if ln.get("volume", c.get("volume", 1.0)) >= 1.0 else "loudnorm=I=-24:TP=-1.5"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", f"{loud},aresample=44100", "-ac", "1", str(wav)], check=True)
        raw.unlink()
        dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)]).decode())
        meta.append({"id": ln["id"], "chara": ln["chara"], "text": ln["text"], "yomi": text, "file": wav.name, "duration_s": round(dur, 2)})
        print(f"{ln['chara']}「{ln['text']}」(読み:{text}) {dur:.2f}秒")
    (out / "voices_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

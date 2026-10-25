# セリフ一覧(lines.json)から、voices.json の固定設定でキャラの声を作る。
# 使い方: %USERPROFILE%\.claude\kokoro-venv\Scripts\python.exe make_voices.py <lines.json> <出力フォルダ>
# lines.json: [{ "id": "p1_chiro", "chara": "チロ", "text": "ぱすだぁぁ！", "yomi": "ぱすだあああ！" }, ...]
#   text = 画面に出す文字 / yomi = 読み方(ひらがな・カタカナ)。yomiが無いときはtextから自動で読みを作る。
# 出力: <出力フォルダ>/<id>.wav と voices_meta.json (各セリフの長さ秒)
import json, os, subprocess, sys
from pathlib import Path

import pyopenjtalk
import soundfile as sf
from kokoro_onnx import Kokoro
from misaki import ja

HERE = Path(__file__).resolve().parent
CACHE = Path.home() / ".cache" / "hyperframes" / "tts"
MODEL = CACHE / "models" / "kokoro-v1.0.onnx"
VOICES = CACHE / "voices" / "voices-v1.0.bin"


def main():
    if len(sys.argv) < 3:
        sys.exit("使い方: python make_voices.py <lines.json> <出力フォルダ>")
    lines = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    chars = json.loads((HERE.parent / "voices.json").read_text(encoding="utf-8"))["characters"]
    if not MODEL.exists():
        sys.exit("声のデータがありません。先に一度 `npx hyperframes tts テスト -v jf_alpha` を実行してダウンロードしてください。")

    kokoro = Kokoro(str(MODEL), str(VOICES))
    g2p = ja.JAG2P()
    meta = []
    for line in lines:
        c = chars.get(line["chara"])
        if not c:
            sys.exit(f"voices.json に「{line['chara']}」の声がありません。先に社長と決めて追加してください。")
        # 漢字は読み間違えやすいので、いったんカタカナの読みにしてから音にする
        yomi = line.get("yomi") or pyopenjtalk.g2p(line["text"], kana=True)
        phonemes, _ = g2p(yomi)
        samples, sr = kokoro.create(phonemes, voice=c["voice"], speed=c["speed"], lang="ja", is_phonemes=True)
        raw = out_dir / f"{line['id']}.raw.wav"
        out = out_dir / f"{line['id']}.wav"
        sf.write(raw, samples, sr)
        # 声の高さだけ変える(速さはそのまま)＋音量をそろえる
        p = c.get("pitch", 1.0)
        af = f"asetrate={round(sr * p)},aresample=44100,atempo={1 / p:.4f},loudnorm=I=-16:TP=-1.5,aresample=44100"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(raw), "-af", af, "-ac", "1", str(out)], check=True)
        raw.unlink()
        dur = float(subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(out)]).decode())
        meta.append({"id": line["id"], "chara": line["chara"], "text": line["text"], "yomi": yomi,
                     "file": out.name, "duration_s": round(dur, 2)})
        print(f"{line['chara']}「{line['text']}」(読み:{yomi}) {dur:.2f}秒")
    (out_dir / "voices_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

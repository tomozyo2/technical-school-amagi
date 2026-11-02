#!/bin/bash
# フォルダを開いたときに、GitHubの最新を自動で取り込む（git pull）。
# 安全第一：書きかけの変更や、手元にだけある変更があるときは、何も上書きせずに止めて、理由を日本語で知らせる。
#  - 取り込みは「早送りだけ(--ff-only)」。stash・reset・強制上書きは絶対にしない。

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# JSONに入れるために、文字をエスケープする
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }

# $1=社長に見せる文  $2=Claudeに渡す補足
emit() {
  printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$(esc "$1")" "$(esc "$2")"
  exit 0
}

G="git -c core.quotepath=false"

BRANCH=$($G symbolic-ref --short HEAD 2>/dev/null)
if [ -z "$BRANCH" ]; then
  emit "【自動pull】今は特別な状態（ブランチ外）なので、最新の取り込みはしませんでした。" "自動pullはスキップした（ブランチ外）。"
fi

# 1) GitHubの最新情報を見に行く（20秒で諦める）
if ! timeout 20 $G fetch -q origin 2>/dev/null; then
  emit "【自動pull】ネットにつながらないか、GitHubが見られなかったので、最新の取り込みはしませんでした。ファイルは何も変えていません。" "自動pullは失敗（fetch不可）。ファイルは変更していない。"
fi

UP="origin/$BRANCH"
if ! $G rev-parse --verify -q "$UP" >/dev/null; then
  emit "【自動pull】GitHub側に「$BRANCH」が見つからなかったので、取り込みはしませんでした。" "自動pullはスキップ（$UP なし）。"
fi

BEHIND=$($G rev-list --count "HEAD..$UP")
AHEAD=$($G rev-list --count "$UP..HEAD")

if [ "$BEHIND" = "0" ]; then
  emit "【自動pull】もう最新です。取り込むものはありませんでした。" "自動pull：すでに最新。"
fi

# 2) 手元にだけあるコミットがある（GitHubと枝分かれ）→ 勝手に混ぜない
if [ "$AHEAD" != "0" ]; then
  # 中身が同じコミットが両方にあるだけなら、ここでは判断せず止める（混ぜ方は人が決める）
  emit "【自動pull】取り込みをやめました（ファイルは何も変えていません）。GitHubに新しい更新が${BEHIND}件ありますが、手元のパソコンにも、まだGitHubへ送っていない保存（コミット）が${AHEAD}件あって、そのまま混ぜると上書きの危険があるためです。Claudeに「pullの続きをお願い」と伝えれば、安全なやり方で整えます。" "自動pullは中止：GitHubが${BEHIND}件先、手元が${AHEAD}件先で枝分かれしている。勝手にrebase/merge/resetしないこと。社長に確認してから、安全な方法（別の作業場所で整理など）で対応する。"
fi

# 3) 早送りだけで取り込む。書きかけの変更とぶつかるなら、gitが自分で止めてくれる
OUT=$($G pull --ff-only origin "$BRANCH" 2>&1)
RC=$?

if [ $RC -eq 0 ]; then
  emit "【自動pull】GitHubの更新を${BEHIND}件、取り込みました。" "自動pull成功：${BEHIND}件取り込んだ。"
fi

# 4) 失敗した理由を、やさしい日本語で
FILES=$(printf '%s\n' "$OUT" | grep -E '^[[:space:]]+[^[:space:]]' | grep -vE '(^[[:space:]]*(Please|Aborting|error|hint|From|fatal|\*)|->)' | sed 's/^[[:space:]]*//' | head -8)

if printf '%s' "$OUT" | grep -q "local changes to the following files would be overwritten"; then
  emit "【自動pull】取り込みをやめました（ファイルは何も変えていません）。理由：あなたが今書きかけの変更のあるファイルに、GitHub側でも更新が入っていて、取り込むと書きかけの内容が消えてしまうためです。ぶつかっているファイル：
${FILES}
→ 書きかけを一度「保存（コミット）」してから、もう一度pullするのが安全です。Claudeに「pullの続きをお願い」と伝えてください。" "自動pullは中止：書きかけの変更とGitHubの更新が同じファイルでぶつかった。上書き・stash・resetはせず、社長に確認してから対応する。ぶつかったファイル: ${FILES}"
elif printf '%s' "$OUT" | grep -q "untracked working tree files would be overwritten"; then
  emit "【自動pull】取り込みをやめました（ファイルは何も変えていません）。理由：まだGitに登録していない新しいファイルが、GitHub側の同じ名前のファイルとぶつかるためです。ぶつかっているファイル：
${FILES}
→ Claudeに「pullの続きをお願い」と伝えてください。" "自動pullは中止：未登録ファイルがGitHub側の同名ファイルとぶつかる。上書きせず社長に確認する。ぶつかったファイル: ${FILES}"
else
  SHORT=$(printf '%s' "$OUT" | head -3)
  emit "【自動pull】取り込みに失敗したので、やめました（ファイルは何も変えていません）。Claudeに「pullの続きをお願い」と伝えてください。" "自動pullは失敗（原因不明）。上書きせず社長に確認する。gitの出力: ${SHORT}"
fi

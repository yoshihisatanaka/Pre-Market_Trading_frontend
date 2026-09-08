#!/usr/bin/env bash
# Claude Code の SessionStart フック。セッション開始時に「自分がどのチェックアウトに
# いるか」と「同じチェックアウトで他のセッションが動いていないか」を Claude に伝える。
#
# 2026-09-08 の事故では、4 つのセッションが本体リポジトリを共有していることに
# 誰も気づかないまま同じファイルを書き換えた。現在地が見えないと避けようがないので、
# セッションの冒頭に事実として注入する。
#
# 同居の検知はロックファイル方式。<project>/.claude/.sessions/<session_id> を touch し、
# Stop フック（lint-on-stop.sh）が毎ターン更新する。mtime が新しいものを稼働中とみなす。
# worktree ごとに別ディレクトリになるので、判定の粒度がちょうど「1 チェックアウト」になる。
#
# 手動実行:
#   echo '{"hook_event_name":"SessionStart","session_id":"test-1"}' \
#     | bash .claude/hooks/session-worktree-notice.sh

set -u
input=$(cat)

# CLAUDE_PROJECT_DIR が渡らないときは、このフック自身の位置から導出する
# （guard-secret-paths.sh / guard-main-checkout.sh と同じ作法）。
self_root=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd || true)
root="${CLAUDE_PROJECT_DIR:-${self_root:-.}}"

# session_id はファイル名にするので、想定外の文字は落としてから使う。
sid=$(printf '%s' "$input" |
  sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
  tr -cd 'A-Za-z0-9._-' | cut -c1-64)

branch=$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '?')

lines=''
add() { lines="$lines$1
"; }

# --- 現在地 -----------------------------------------------------------------
# worktree の .git は "gitdir: ..." を書いたファイル、本体の .git はディレクトリ。
if [ -d "$root/.git" ]; then
  add "現在地: 本体リポジトリ / HEAD: $branch"
  if [ "$branch" != 'main' ]; then
    add "! 本体が main 以外（$branch）を掴んでいる。本体は main 常駐が規約。"
  fi
  add "本体でのブランチ切り替え（git switch / checkout）は PreToolUse フックが拒否する。"
  add "新しい作業を始めるときは bash scripts/worktree.sh add <type>/<説明> で worktree を作り、"
  add "表示されたディレクトリを新しい VSCode ウィンドウで開いて Claude を起動すること。"
else
  add "現在地: worktree $(basename "$root")（ブランチ $branch）"
  add "この worktree の CLAUDE.local.md に書かれた「目的」の範囲で作業すること。"
  add "main へのマージとブランチ削除、/api-spec-sync は本体セッションの担当。"
fi

# --- 同居セッションの検知 ---------------------------------------------------
lockdir="$root/.claude/.sessions"
if [ -n "$sid" ] && mkdir -p "$lockdir" 2>/dev/null; then
  # 異常終了で残ったロックを掃除する（7 日以上更新が無いもの）。
  find "$lockdir" -maxdepth 1 -type f -mmin +10080 -delete 2>/dev/null || true
  others=$(find "$lockdir" -maxdepth 1 -type f -mmin -120 ! -name "$sid" 2>/dev/null |
    grep -c '' || printf '0')
  : >"$lockdir/$sid" 2>/dev/null || true
  if [ "${others:-0}" -gt 0 ] 2>/dev/null; then
    add ""
    add "! このチェックアウトで他に $others セッションが稼働中（直近 2 時間）。"
    add "  同じファイルを同時に書き換える恐れがある。担当範囲が重なりそうなら、"
    add "  作業を別の worktree に分けるか、ユーザに確認してから進めること。"
  fi
fi

[ -n "$lines" ] || exit 0

# JSON 文字列として埋め込む（バックスラッシュ → 引用符 → 改行の順で潰す）。
ctx=$(printf '%s' "$lines" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
  sed ':a;N;$!ba;s/\n/\\n/g')

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ctx"

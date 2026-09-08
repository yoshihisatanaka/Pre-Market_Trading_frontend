#!/usr/bin/env bash
# Claude Code の PreToolUse フック。本体リポジトリでのブランチ切り替えを実行前に拒否する。
#
# git は 1 リポジトリ 1 チェックアウトなので、複数セッションが本体を共有したまま
# `git switch` すると、後から切り替えた側が先行セッションの HEAD を奪う。
# 2026-09-08 の事故（4 セッションが本体を共有し、同じファイルを同時に書き換えた）は
# すべて本体での `git switch -c` が起点だった。規律では守れないのでここで止める。
#
# - worktree 側では何もしない。そのブランチで作業するのが正しい
# - 本体でも `git switch main` は通す（main 常駐が規約で、マージ作業に必要）
# - `git checkout -- <path>` などのファイル復元も通す（HEAD を動かさないため）
#
# 手動実行:
#   echo '{"tool_name":"Bash","tool_input":{"command":"git switch -c feat/x"}}' \
#     | bash .claude/hooks/guard-main-checkout.sh

set -u
input=$(cat)

# 拒否して Claude に理由を返す。迂回されないよう明示する。
deny() {
  reason="本体リポジトリでのブランチ切り替え（$1）は禁止されている。\
同じチェックアウトで作業している他セッションの HEAD を奪い、互いのファイルを\
書き換え合う事故になる。作業ブランチは worktree で持つこと: \
bash scripts/worktree.sh add <type>/<説明> を実行し、\
表示された worktree を新しい VSCode ウィンドウで開いて Claude を起動する。\
別のコマンドやツールで迂回せず、ユーザに理由を伝えて止まること。"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
}

# --- 現在地の判定 -----------------------------------------------------------
# CLAUDE_PROJECT_DIR が渡らないときは、このフック自身の位置（.claude/hooks/ の 2 つ上）から
# 導出する。PreToolUse は全ツール呼び出しで走るため、cwd 依存の git rev-parse は使わない。
self_root=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd || true)
root="${CLAUDE_PROJECT_DIR:-${self_root:-.}}"

# worktree の .git は "gitdir: ..." を書いたファイル、本体の .git はディレクトリ。
# worktree セッションなら何もしない。
[ -d "$root/.git" ] || exit 0

# --- コマンド文字列の取り出し -----------------------------------------------
# tool_input.command だけを見る。ペイロード全体を検査すると、description や
# 書き込む本文で "git switch" に言及しただけで誤爆する。
match=$(printf '%s' "$input" |
  grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n1) || true
[ -n "$match" ] || exit 0

raw=$(printf '%s' "$match" | sed -e 's/^"command"[[:space:]]*:[[:space:]]*"//' -e 's/"$//')

# JSON のエスケープを戻す。判定に必要なのは語の区切りだけなので、
# \n と \t は空白に潰し、\" と \\ を実体に戻せば足りる。
cmd=$(printf '%s' "$raw" |
  sed -e 's/\\n/ /g' -e 's/\\t/ /g' -e 's/\\"/"/g' -e 's/\\\\/\\/g')

# ヒアドキュメントの本文は検査しない（コミットメッセージ等で git switch に触れると誤爆する）。
cmd=${cmd%%<<*}

# --- 判定 -------------------------------------------------------------------
# switch / checkout の引数を見て「HEAD を動かすか」を決める。
# 動かすなら $denied に表示用の文字列を入れて 1 を返す。
denied=''
check_args() {
  sub="$1"
  shift
  target=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
    --) return 0 ;; # 以降はパス。ファイル復元なので HEAD は動かない
    -c | -C | -b | -B)
      # 新しいブランチを作る = 新しい作業の開始。worktree を切るべき場面。
      denied="git $sub $1 ${2:-<branch>}"
      return 1
      ;;
    --orphan | --detach)
      denied="git $sub $1"
      return 1
      ;;
    -*)
      shift
      continue
      ;;
    *)
      target="$1"
      break
      ;;
    esac
  done
  [ -n "$target" ] || return 0 # 引数なし。git 自身がエラーにするので任せる
  [ "$target" = 'main' ] && return 0
  # checkout はファイル復元にも使う。実在するパスならブランチ名ではない。
  if [ "$sub" = 'checkout' ] && [ -e "$root/$target" ]; then
    return 0
  fi
  denied="git $sub $target"
  return 1
}

check_segment() {
  # shellcheck disable=SC2086 # 判定に使うのは前方の数語だけなので単語分割でよい
  set -- $1
  [ "${1:-}" = 'git' ] || return 0
  shift
  # グローバルオプションを読み飛ばす。値を取るものは 2 語消費する。
  while [ "$#" -gt 0 ]; do
    case "$1" in
    -C | -c | --git-dir | --work-tree | --namespace | --exec-path)
      shift 2 2>/dev/null || return 0
      ;;
    -*) shift ;;
    *) break ;;
    esac
  done
  case "${1:-}" in
  switch | checkout)
    sub="$1"
    shift
    check_args "$sub" "$@"
    ;;
  *) return 0 ;;
  esac
}

# && || | ; 改行で区切られた 1 コマンドずつ調べる。
# パイプで回すとループがサブシェルになり deny の exit が親に効かないので、
# いったん変数に受けてヒアドキュメントから読む。
segments=$(printf '%s\n' "$cmd" |
  sed -e 's/&&/\n/g' -e 's/||/\n/g' -e 's/|/\n/g' -e 's/;/\n/g')
while IFS= read -r seg; do
  check_segment "$seg" || deny "$(printf '%s' "$denied" | tr -d '"\\')"
done <<EOF
$segments
EOF

exit 0

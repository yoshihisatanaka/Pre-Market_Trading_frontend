#!/usr/bin/env bash
# /real-api-e2e を本体リポジトリから 1 コマンドで回す。
#
#   bash scripts/real-api-e2e.sh [--branch test/<kebab>] [--no-up] <画面名…> [-- <claude の追加フラグ…>]
#
# やること:
#   1. worktree を用意する（bash scripts/worktree.sh add。冪等なので同日 2 回目は再利用）
#   2. その worktree の frontend を起動し、Vite が応答するまで待つ（作成モードの lint が exec する先）
#   3. その worktree の中で claude -p "/real-api-e2e <画面名…>" --permission-mode acceptEdits を起動する
#   4. 終了後に worktree の git status と次の手順を表示する
#
# 設計上の約束:
#   - git worktree / 設定配備 / ポート割当は scripts/worktree.sh に任せ、ここでは再実装しない
#   - 本体の cwd は変えない。cd は内側の claude を起動するサブシェルの中だけ
#   - 機密ファイル名（環境変数ファイル等）を引数にも本文にも出さない（guard フックが拒否する）
#   - コミットしない。MSW の ON/OFF も触らない（ユーザの担当）
#   - 既に worktree の中で呼ばれたら 1〜2 を飛ばし、その場で 3 を行う（二重に worktree を切らない）
#
# 終了コード: 0 正常 / 2 使い方の誤り / 4 git・環境の状態不整合 / それ以外は内側の claude の終了コードを引き継ぐ

set -euo pipefail

info() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
head2() { printf '\n%s\n' "$*"; }
die() {
  printf 'error: %s\n' "$1" >&2
  exit "${2:-1}"
}

win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# --- 引数 -------------------------------------------------------------------
branch=''
do_up=1
screens=()
claude_args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
  --branch)
    [ -n "${2:-}" ] || die '--branch にはブランチ名が必要' 2
    branch="$2"
    shift 2
    ;;
  --no-up)
    do_up=0
    shift
    ;;
  --)
    shift
    claude_args=("$@")
    break
    ;;
  -h | --help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  -*)
    die "不明なオプション: $1（--branch / --no-up。claude へ渡すフラグは -- の後ろに置く）" 2
    ;;
  *)
    screens+=("$1")
    shift
    ;;
  esac
done
[ -n "$branch" ] || branch="test/real-api-e2e-$(date +%m%d)"

command -v claude >/dev/null 2>&1 || die 'claude コマンドが PATH に無い' 4
command -v docker >/dev/null 2>&1 || die 'docker コマンドが PATH に無い' 4

# --- 現在地 -----------------------------------------------------------------
# worktree.sh と同じ求め方。worktree の中からでも本体を指す。
git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) ||
  die 'git リポジトリの中で実行すること' 4
main_repo=$(cd "$(dirname "$git_common")" && pwd)
toplevel=$(git rev-parse --show-toplevel)

if [ -f "$toplevel/.git" ]; then
  # .git がファイルなら worktree。ここで書いてよいのでそのまま使う。
  wt="$toplevel"
  head2 "worktree の中で呼ばれたので、このまま使う: $(win_path "$wt")"
else
  # --- 1. worktree の用意 ---------------------------------------------------
  head2 "worktree を用意する: $branch"
  bash "$main_repo/scripts/worktree.sh" add "$branch"

  # パスの規則を二重実装せず、登録結果から引く。
  wt=$(git -C "$main_repo" worktree list --porcelain | awk -v b="refs/heads/$branch" '
    /^worktree / { dir = substr($0, 10); next }
    /^branch /   { if (substr($0, 8) == b) { print dir; exit } }
  ')
  [ -n "$wt" ] && [ -d "$wt" ] || die "worktree の場所を特定できなかった: $branch" 4
fi

compose=(docker compose -f "$wt/docker-compose.yml")

# --- 2. frontend の起動 -----------------------------------------------------
if [ "$do_up" -eq 1 ]; then
  head2 'frontend を起動する（作成モードの lint が exec する先）'
  "${compose[@]}" up -d frontend
  # Vite の初回最適化が終わるまで待つ（最大 60 秒）。exec はコンテナが居れば通るが、
  # 先頭の数本が element not found で落ちる既知事象を避けるため応答を確認する。
  waited=0
  until "${compose[@]}" exec -T frontend node -e \
    "fetch('http://localhost:5173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    >/dev/null 2>&1; do
    [ "$waited" -lt 60 ] || {
      warn 'Vite が 60 秒以内に応答しなかった。そのまま続行する（lint の exec は通る）'
      break
    }
    sleep 3
    waited=$((waited + 3))
  done
  [ "$waited" -lt 60 ] && info "Vite 応答を確認（${waited} 秒）"
fi

# --- 3. 内側の claude -------------------------------------------------------
prompt='/real-api-e2e'
if [ "${#screens[@]}" -gt 0 ]; then
  prompt="$prompt ${screens[*]}"
fi

# Claude のセッション内から呼ばれたときに、親セッションの環境変数（CLAUDECODE / CLAUDE_CODE_* /
# CLAUDE_PROJECT_DIR 等）が内側へ漏れると、入れ子検知やフックの向き先が狂う。CLAUDE で始まるものは全部外す。
unset_args=()
while IFS= read -r v; do
  [ -n "$v" ] && unset_args+=(-u "$v")
done < <(env | grep -oE '^CLAUDE[A-Za-z0-9_]*' || true)

head2 "起動: claude -p \"$prompt\" --permission-mode acceptEdits ${claude_args[*]:-}"
info "cwd: $(win_path "$wt")"
set +e
(
  cd "$wt" &&
    env "${unset_args[@]}" claude -p "$prompt" --permission-mode acceptEdits "${claude_args[@]}"
)
rc=$?
set -e

# --- 4. 後処理 --------------------------------------------------------------
head2 "worktree の変更（claude の終了コード: $rc）:"
git -C "$wt" status --short || true

head2 '次にやること:'
cat <<EOF
  1. 差分をレビューする（シナリオ表と spec を一緒に見る）
       git -C "$(win_path "$wt")" diff
  2. その worktree でコミットする（本体ではない）
  3. 本体で main にマージし、worktree を撤収する
       git merge --no-ff $branch
       bash scripts/worktree.sh remove $branch --docker-clean --delete-branch
EOF

exit "$rc"

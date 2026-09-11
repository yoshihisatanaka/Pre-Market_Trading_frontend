#!/usr/bin/env bash
# .mcp.json から呼ばれる MCP サーバ（Docker 版）の起動ラッパー。
#
#   bash scripts/mcp-docker.sh playwright
#   bash scripts/mcp-docker.sh chrome-devtools
#   bash scripts/mcp-docker.sh print-network   # 診断用（解決したネットワーク名を出す）
#
# 存在理由: compose プロジェクト名を worktree ごとに分けた（docker-compose.yml に name: を
# 書かない）ため、Docker ネットワーク名も worktree ごとに変わる。.mcp.json は git 管理下で
# 全 worktree 共通なので、ネットワーク名をそこに書けない。このスクリプトが
# 「いま自分が居る worktree の稼働中 frontend が参加しているネットワーク」を実物から導出する。
#
# 設計上の約束:
# 1. ネットワーク名をディレクトリ名から自前計算しない。compose は小文字化と許可外文字の
#    除去を行うため一致の保証がない。正は稼働中コンテナのラベルと docker compose config。
# 2. 失敗したら「何をすれば直るか」を stderr に出して非ゼロで終わる。
#    MCP の CONNECTION_CLOSED だけを見て原因を推測させないため。
#
# 終了コード: 0 正常（exec するので通常は docker の終了コード）/ 2 使い方の誤り
#             / 4 Docker・compose の状態不整合

set -euo pipefail

# Git Bash(MSYS) は引数中の /output のような絶対パスを Windows パスへ勝手に変換する。
# docker run の -v ... :/output や --chromeArg=--no-sandbox が壊れるので必ず無効化する。
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

die() {
  printf 'mcp-docker: %s\n' "$1" >&2
  exit "${2:-1}"
}

server="${1:-}"
[ -n "$server" ] || die 'サーバ名が必要（playwright | chrome-devtools）。' 2

# リポジトリ（この worktree）のルート。-v の相対パスがここ基準になるよう cd する。
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

command -v docker >/dev/null 2>&1 || die 'docker コマンドが見つからない。' 4
docker info >/dev/null 2>&1 || die 'Docker Desktop が起動していない。起動してから /mcp で繋ぎ直すこと。' 4

# --- compose プロジェクト名（正は docker compose 自身の解決結果） ----------------
# 引数にパスを渡さない（cd 済みなので -f は不要）。MSYS_NO_PATHCONV=1 を入れてあるため、
# /c/... のような Git Bash 形式のパスを渡すと変換されずに docker へ届いて存在しない扱いになる。
project=$(docker compose config 2>/dev/null |
  sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' | head -n1) || project=''
if [ -z "$project" ]; then
  # config が失敗する状況（compose ファイルの文法エラー等）でも案内は出したいので推測に落とす
  project=$(basename "$root" | tr 'A-Z' 'a-z')
fi

# --- 参加するネットワーク ----------------------------------------------------
# 1) この worktree の稼働中 frontend が実際に参加しているネットワーク
network=''
cid=$(docker ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=frontend" 2>/dev/null | head -n1)
if [ -n "$cid" ]; then
  network=$(docker inspect --format \
    '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$cid" 2>/dev/null |
    head -n1)
fi

# 2) 停止中でもネットワークだけ残っていることがある（compose の既定名）
if [ -z "$network" ] && docker network inspect "${project}_default" >/dev/null 2>&1; then
  network="${project}_default"
fi

[ -n "$network" ] || die "この worktree の frontend が起動していない（compose プロジェクト: $project）。
  先に次を実行し、そのあと Claude Code の /mcp で繋ぎ直すこと:
    docker compose up -d frontend
  MCP コンテナは frontend と同じ Docker ネットワークに参加して http://frontend:5173 を見るため、
  frontend が落ちていると接続先が存在しない。" 4

# --- 起動 --------------------------------------------------------------------
case "$server" in
print-network)
  # 診断用。MCP が繋がらないときに何を見ているか確かめる。
  printf '%s\n' "$network"
  ;;
playwright)
  # 出力先は .playwright-mcp/（.gitignore 済み）。--save-session で操作ログが残る。
  exec docker run -i --rm --init \
    --network "$network" \
    -v ./.playwright-mcp:/output \
    mcr.microsoft.com/playwright/mcp \
    --output-dir /output \
    --save-session
  ;;
chrome-devtools)
  # ローカルビルドのイメージが必要:
  #   docker build -t us-stock-order-chrome-devtools-mcp docker/chrome-devtools-mcp
  exec docker run -i --rm --init \
    --network "$network" \
    us-stock-order-chrome-devtools-mcp \
    --headless \
    --isolated \
    --chromeArg=--no-sandbox \
    --viewport 1280x720 \
    --no-page-id-routing \
    --no-usage-statistics
  ;;
*)
  die "不明なサーバ名: $server（playwright | chrome-devtools）" 2
  ;;
esac

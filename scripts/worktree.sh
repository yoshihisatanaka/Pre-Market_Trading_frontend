#!/usr/bin/env bash
# 並行セッション用の git worktree を作成 / 撤収 / 点検する。
#
# 使い方は `bash scripts/worktree.sh help`。入口はスラッシュコマンド /worktree。
#
# 設計上の約束（崩さないこと）:
#
# 1. git worktree / docker の呼び出しはすべてこのスクリプトに閉じ込める。
#    Claude が生コマンドを叩かずに済み、settings.json の allow は
#    `Bash(bash scripts/worktree.sh *)` の 1 系統で足りる。
# 2. 機密扱いのファイル名（環境変数ファイル等）を引数に取らない。
#    .claude/hooks/guard-secret-paths.sh は「ツール入力の文字列」を検査するため、
#    引数に出すとコマンドごと拒否される。名前はこのスクリプト内の定数に閉じ込める。
# 3. 破壊的な操作の前に必ず一度止まる。--force は人が明示したときだけ。
#
# 終了コード: 0 正常 / 2 使い方の誤り / 3 ブランチ名が規約違反 / 4 git・環境の状態不整合
#             / 5 未コミット・未マージがあるため中断

set -euo pipefail

# --- 定数 -------------------------------------------------------------------
# gitignore されていて worktree に引き継がれないもの。名前をここに閉じ込める（上記 2）。
ENV_FILE='.env'
ENV_EXAMPLE='.env.example'
LOCAL_SETTINGS='.claude/settings.local.json'
LOCAL_MEMO='CLAUDE.local.md'

# CLAUDE.md のブランチ命名規約と同じ語彙・同じ形。
BRANCH_RE='^(feat|fix|refactor|docs|test|chore|style)/[a-z0-9]+(-[a-z0-9]+)*$'

# --- 出力 -------------------------------------------------------------------
info() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
head2() { printf '\n%s\n' "$*"; }

die() {
  printf 'error: %s\n' "$1" >&2
  exit "${2:-1}"
}

# --- パス -------------------------------------------------------------------
# 比較用に正規化する。ドライブレターの大小・区切り文字・末尾スラッシュに加えて、
# Windows 形式（c:/users/...）を Git Bash 形式（/c/users/...）へ寄せる。
# git worktree list --porcelain は前者を返し、$HOME 由来のパスは後者になるため、
# ここを揃えないと「登録済みの worktree を未登録と誤判定」する。
norm_path() {
  printf '%s' "$1" | tr 'A-Z' 'a-z' | tr '\\' '/' |
    sed -e 's|//*|/|g' -e 's|^\([a-z]\):|/\1|' -e 's|\(.\)/$|\1|'
}

# 表示用の Windows 形式（cygpath が無い環境でも落ちない）。
win_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1" 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1"
  fi
}

# 本体リポジトリの場所。worktree の中から実行しても本体を指す。
# `git rev-parse --show-toplevel` は worktree 自身を返してしまうので使わない。
git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) ||
  die 'git リポジトリの中で実行すること。' 4
main_repo=$(cd "$(dirname "$git_common")" && pwd)
repo_name=$(basename "$main_repo")
wt_root="${WORKTREE_ROOT:-$HOME/worktrees}"

# --- ブランチ名 -------------------------------------------------------------
# 検証を先、変換を後に行う。規約で弾いてしまえば変換は実質「/ を - に」だけになり、
# `..` や Windows の予約名を気にする必要がなくなる。
validate_branch() {
  case "$1" in
  main | master | HEAD)
    die "'$1' は worktree にしない（main は本体リポジトリに常駐させる）。" 3
    ;;
  esac
  printf '%s' "$1" | grep -Eq "$BRANCH_RE" ||
    die "ブランチ名が CLAUDE.md の規約に合わない: $1
  形式は <type>/<kebab-case>。<type> は feat / fix / refactor / docs / test / chore / style。
  例: feat/market-holiday-type" 3
}

sanitize() {
  printf '%s' "$1" | tr 'A-Z' 'a-z' |
    sed -e 's|[^a-z0-9._-]|-|g' -e 's|-\{2,\}|-|g' -e 's|^-*||' |
    cut -c1-60 | sed 's|-*$||'
}

dir_for() {
  printf '%s/%s-%s' "$wt_root" "$repo_name" "$(sanitize "$1")"
}

# --- worktree の登録状態 ----------------------------------------------------
# "<dir><TAB><branch>" を 1 行ずつ返す。
wt_pairs() {
  git -C "$main_repo" worktree list --porcelain | awk '
    /^worktree /  { dir = substr($0, 10); br = "(detached)"; next }
    /^branch /    { br = substr($0, 8); sub(/^refs\/heads\//, "", br); next }
    /^detached$/  { br = "(detached)"; next }
    /^$/          { if (dir != "") { print dir "\t" br; dir = "" } }
    END           { if (dir != "") print dir "\t" br }
  '
}

# 指定ディレクトリに登録されているブランチ名（未登録なら空）。
branch_at_dir() {
  target=$(norm_path "$1")
  wt_pairs | while IFS="$(printf '\t')" read -r d b; do
    if [ "$(norm_path "$d")" = "$target" ]; then
      printf '%s' "$b"
      return 0
    fi
  done
}

# 指定ブランチが登録されているディレクトリ（未登録なら空）。
dir_of_branch() {
  wt_pairs | while IFS="$(printf '\t')" read -r d b; do
    if [ "$b" = "$1" ]; then
      printf '%s' "$d"
      return 0
    fi
  done
}

# --- Docker -----------------------------------------------------------------
# docker-compose.yml に name: を書かないので、compose プロジェクトはディレクトリ名由来＝
# worktree ごとに別になる（project / コンテナ名 / ネットワークが分離される）。
# よってここの関数は「共有資源の所有者を見張る」のではなく
# 「worktree ごとの Docker の状態を並べる」ためにある。
#
# 唯一の共有は node_modules（external な named volume）。install は 1 回で済むが排他。
NODE_MODULES_VOLUME='us-stock-order-frontend_node_modules'
# ホスト公開ポートの割当帯。5173 は本体リポジトリの予約。
PORT_MIN=5174
PORT_MAX=5199

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# 表示用の高速な推定（compose の正規化に合わせて小文字化と許可外文字の除去だけ行う）。
# 停止中の worktree にまで docker compose config を走らせると list が遅くなるため。
guess_project_for_dir() {
  basename "$1" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-'
}

# 正の compose プロジェクト名。compose 自身に解決させる（推定に依存しない）。
# down のように壊しうる操作と doctor の点検ではこちらを使う。
compose_project_for_dir() {
  d="$1"
  p=''
  if [ -f "$d/docker-compose.yml" ] && docker_ready; then
    p=$(docker compose -f "$d/docker-compose.yml" config 2>/dev/null |
      sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' | head -n1)
  fi
  [ -n "$p" ] || p=$(guess_project_for_dir "$d")
  printf '%s' "$p"
}

# そのディレクトリの compose を叩く。-f を渡すので project dir も .env の読み場所も
# そのディレクトリになる（--project-directory だけでは compose ファイル探索が cwd 基準）。
compose_in_dir() {
  d="$1"
  shift
  docker compose -f "$d/docker-compose.yml" "$@"
}

# 稼働中の frontend コンテナを 1 回の docker ps でまとめて取る。
# "<project>\t<working_dir>\t<ports>" を 1 行ずつ返す。
frontend_snapshot() {
  docker_ready || return 0
  docker ps --filter 'label=com.docker.compose.service=frontend' \
    --format '{{.Label "com.docker.compose.project"}}	{{.Label "com.docker.compose.project.working_dir"}}	{{.Ports}}' 2>/dev/null
}

# スナップショットから指定ディレクトリの行を引く（working_dir で突き合わせる）。
snapshot_row_for_dir() {
  snap="$1"
  nd=$(norm_path "$2")
  printf '%s\n' "$snap" | while IFS="$(printf '\t')" read -r p w ports; do
    [ -n "${w:-}" ] || continue
    if [ "$(norm_path "$w")" = "$nd" ]; then
      printf '%s\t%s\t%s' "$p" "$w" "${ports:-}"
      break
    fi
  done
}

# .env は機密扱いで Claude から読めない。ファイル名は ENV_FILE 定数に閉じ込め、
# 読み出しはこの関数だけで行う（コマンド引数に名前を出すと guard フックが拒否する）。
env_port_of_dir() {
  p=$(sed -n 's/^[[:space:]]*FRONTEND_PORT[[:space:]]*=[[:space:]]*\([0-9]\{1,5\}\).*/\1/p' \
    "$1/$ENV_FILE" 2>/dev/null | tail -n1)
  [ -n "$p" ] || p=5173
  printf '%s' "$p"
}

# 使用中とみなすポート（割当の除外条件）。
used_ports() {
  # wt_pairs は本体リポジトリも 1 行目に含む（git worktree list の仕様）。
  wt_pairs | cut -f1 | while read -r d; do
    [ -d "$d" ] && printf '%s\n' "$(env_port_of_dir "$d")"
  done
  if docker_ready; then
    docker ps --format '{{.Ports}}' 2>/dev/null |
      grep -o '0\.0\.0\.0:[0-9]\{1,5\}' | cut -d: -f2
  fi
  # OS のリスナー（Windows の netstat）。Hyper-V の動的予約帯までは分からないので、
  # ここで空いて見えても bind に失敗することはある（その場合は add をやり直す）。
  netstat -an 2>/dev/null | grep -i 'listen' |
    grep -o ':[0-9]\{1,5\}[[:space:]]' | tr -d ': \t' || true
}

alloc_frontend_port() {
  used=$(used_ports | sort -u)
  p="$PORT_MIN"
  while [ "$p" -le "$PORT_MAX" ]; do
    if ! printf '%s\n' "$used" | grep -qx "$p"; then
      printf '%s' "$p"
      return 0
    fi
    p=$((p + 1))
  done
  return 1
}

# 共有の node_modules ボリューム（compose 側で external: true）。
ensure_node_modules_volume() {
  docker_ready || return 0
  docker volume inspect "$NODE_MODULES_VOLUME" >/dev/null 2>&1 && return 0
  if docker volume create "$NODE_MODULES_VOLUME" >/dev/null 2>&1; then
    info "共有ボリュームを作成した: $NODE_MODULES_VOLUME"
    warn "中身は空なので、どこか 1 つの worktree で一度だけ実行すること:
    docker compose run --rm frontend npm ci"
  else
    warn "共有ボリュームを作成できなかった。手で実行すること:
    docker volume create $NODE_MODULES_VOLUME"
  fi
}

# その worktree の Docker 環境（project / ネットワーク / ポート）を表示する。
print_docker_env() {
  d="$1"
  if ! docker_ready; then
    printf 'Docker: 判定不能（Docker Desktop が起動していない）\n'
    return 0
  fi
  row=$(snapshot_row_for_dir "$(frontend_snapshot)" "$d")
  proj=$(compose_project_for_dir "$d")
  printf 'Docker（この worktree 専用。他 worktree と並行して使える）:\n'
  printf '  compose プロジェクト: %s\n' "$proj"
  printf '  ネットワーク:         %s_default\n' "$proj"
  if [ -n "$row" ]; then
    printf '  frontend:             稼働中 — http://localhost:%s\n' "$(frontend_port_of_dir "$d")"
  else
    printf '  frontend:             停止中 — docker compose up -d frontend で http://localhost:%s\n' \
      "$(env_port_of_dir "$d")"
  fi
  printf '  node_modules:         %s（全 worktree 共有。npm install だけは排他）\n' "$NODE_MODULES_VOLUME"
}

# 稼働中なら実際の公開ポート、停止中なら .env の設定値。
frontend_port_of_dir() {
  d="$1"
  row=$(snapshot_row_for_dir "$(frontend_snapshot)" "$d")
  if [ -n "$row" ]; then
    p=$(printf '%s' "$row" | cut -f3 |
      grep -o '0\.0\.0\.0:[0-9]\{1,5\}->5173' | head -n1 | cut -d: -f2 | cut -d- -f1)
    [ -n "$p" ] && {
      printf '%s' "$p"
      return 0
    }
  fi
  env_port_of_dir "$d"
}

# 本体リポジトリが main 以外を掴んでいたら警告する。
# worktree が 0 件でも「全セッションが本体でブランチを奪い合っている」異常が見えるように、
# list / doctor の両方から呼ぶ（2026-09-08 の事故は worktree が 1 つも無い状態で起きた）。
print_main_head() {
  head=$(git -C "$main_repo" rev-parse --abbrev-ref HEAD 2>/dev/null || printf '?')
  [ "$head" = 'main' ] && return 0
  printf '! 本体リポジトリが main 以外を掴んでいる: %s\n' "$head"
  printf '  本体は main 常駐が規約。ブランチ作業は worktree で行うこと:\n'
  printf '    bash scripts/worktree.sh add <type>/<説明>\n'
}

# --- 設定ファイルの配備 -----------------------------------------------------
# シンボリックリンクにはしない。docker-compose.yml が `.:/app` をバインドマウントするため、
# リンク先のホスト絶対パスはコンテナ内に存在せず壊れたリンクになる。しかも vite.config.js の
# loadEnv は失敗しても throw せず既定値に落ちて警告するだけなので、壊れても気づけない。
deploy_configs() {
  dir="$1"
  overwrite="$2"

  # 1. 環境変数ファイル
  if [ -e "$dir/$ENV_FILE" ] && [ "$overwrite" -eq 0 ]; then
    info "既存を維持: $ENV_FILE"
  elif [ -f "$main_repo/$ENV_FILE" ]; then
    cp "$main_repo/$ENV_FILE" "$dir/$ENV_FILE"
    info "配備: $ENV_FILE（本体からコピー）"
  elif [ -f "$main_repo/$ENV_EXAMPLE" ]; then
    cp "$main_repo/$ENV_EXAMPLE" "$dir/$ENV_FILE"
    warn "$ENV_FILE を $ENV_EXAMPLE から作成した。VITE_PROXY_TARGET 等を確認すること"
  else
    warn "$ENV_FILE を配備できなかった（本体にも例ファイルにも無い）"
  fi

  # 2. Claude Code の個人設定（承認モード等を引き継ぐ）
  mkdir -p "$dir/.claude"
  if [ -e "$dir/$LOCAL_SETTINGS" ] && [ "$overwrite" -eq 0 ]; then
    info "既存を維持: $LOCAL_SETTINGS"
  elif [ -f "$main_repo/$LOCAL_SETTINGS" ]; then
    cp "$main_repo/$LOCAL_SETTINGS" "$dir/$LOCAL_SETTINGS"
    info "配備: $LOCAL_SETTINGS（本体からコピー）"
  else
    warn "$LOCAL_SETTINGS が本体に無いので配備しなかった（承認モードは既定に戻る）"
  fi

  # 3. worktree 固有の指示メモ（既存があれば絶対に上書きしない）
  if [ -e "$dir/$LOCAL_MEMO" ]; then
    info "既存を維持: $LOCAL_MEMO"
  else
    write_local_memo "$dir" "$3"
    info "生成: $LOCAL_MEMO（「この worktree の目的」を書くこと）"
  fi

  # 4. dev サーバのホスト公開ポート（docker-compose.yml の ${FRONTEND_PORT} 用）。
  #    worktree ごとに別のポートを割り当てないと 2 つ目の up -d が
  #    port is already allocated で落ちる。既存値は --overwrite-config でも温存する。
  ensure_frontend_port "$dir"
}

ensure_frontend_port() {
  dir="$1"
  if [ ! -f "$dir/$ENV_FILE" ]; then
    warn "ホスト公開ポートを割り当てられなかった（$ENV_FILE が無い）。
    既定の 5173 は本体リポジトリと衝突するので、$ENV_FILE を作ってから add をやり直すこと"
    return 0
  fi
  if grep -q '^[[:space:]]*FRONTEND_PORT[[:space:]]*=' "$dir/$ENV_FILE" 2>/dev/null; then
    info "既存を維持: ホスト公開ポート $(env_port_of_dir "$dir")"
    return 0
  fi
  if port=$(alloc_frontend_port); then
    {
      printf '\n# dev サーバのホスト公開ポート（worktree.sh add が割り当てた。compose 専用）。\n'
      printf '# コンテナ内は常に 5173 なので E2E の http://frontend:5173 は変わらない。\n'
      printf 'FRONTEND_PORT=%s\n' "$port"
    } >>"$dir/$ENV_FILE"
    info "ホスト公開ポートを割り当てた: $port（http://localhost:$port）"
  else
    warn "$PORT_MIN〜$PORT_MAX に空きが無い。手で $ENV_FILE の FRONTEND_PORT を設定すること"
  fi
}

write_local_memo() {
  dir="$1"
  branch="$2"
  cat >"$dir/$LOCAL_MEMO" <<EOF
# CLAUDE.local.md（この worktree 限定・コミットしない）

- ブランチ: $branch
- 作成日: $(date '+%Y-%m-%d')
- 本体リポジトリ: $(win_path "$main_repo")

## この worktree の目的

（1〜3 行で書く。ここに書いた範囲を超える変更はしない）

## 並行運用の制約（詳細は CLAUDE.md の「Git worktree（並行セッション）」節）

- **Docker はこの worktree 専用。** compose プロジェクト・コンテナ・ネットワーク・
  ホスト公開ポートが worktree ごとに分かれているので、\`docker compose up -d frontend\` /
  E2E / Playwright MCP は他 worktree と**並行して使える**。
  自分の project 名・ポート・URL は \`bash scripts/worktree.sh list\` で確認する
  （dev サーバの URL は \`localhost:5173\` ではなく割り当てられたポート）
- \`npm install\` / \`npm ci\` / \`package.json\` / \`package-lock.json\` / \`Dockerfile\` の変更は
  **排他**（node_modules は全 worktree 共有の named volume）。
  \`lint\` / \`test:unit\` / \`check:scenarios\` / \`build\` / E2E は並行してよい
- **実 API に当てる E2E は排他。** バックエンドの api と DB は 1 つしかなく、
  データを読み書きするので worktree 間で衝突する
- **\`git stash\` を使わない**（stash はリポジトリ共通で、別 worktree から pop できてしまう）。
  中断するときは WIP コミットで退避する
- \`main\` へのマージとブランチ削除は**本体セッション**で行う
- \`/api-spec-sync\` は**本体セッション専用**（\`../Pre-Market_Trading\` が worktree からは見えない）
- 本体リポジトリのファイルを絶対パスで書き換えない（guard フックが拒否する。それが正しい挙動）
EOF
}

# --- add --------------------------------------------------------------------
cmd_add() {
  branch="${1:-}"
  [ -n "$branch" ] || die "ブランチ名が必要。例: worktree.sh add feat/market-holiday-type" 2
  shift

  overwrite=0
  do_fetch=0
  for a in "$@"; do
    case "$a" in
    --overwrite-config) overwrite=1 ;;
    --fetch) do_fetch=1 ;;
    *) die "不明なオプション: $a（--overwrite-config / --fetch）" 2 ;;
    esac
  done

  validate_branch "$branch"
  dir=$(dir_for "$branch")

  if [ "$do_fetch" -eq 1 ]; then
    info 'origin を fetch する'
    git -C "$main_repo" fetch origin --prune || warn 'fetch に失敗した（オフライン？）。ローカルの状態で続行する'
  fi

  registered_branch=$(branch_at_dir "$dir")
  registered_dir=$(dir_of_branch "$branch")

  if [ -n "$registered_branch" ]; then
    if [ "$registered_branch" = "$branch" ]; then
      info "既に存在する worktree を再利用する: $(win_path "$dir")"
    else
      die "ディレクトリ名が衝突している。
  $(win_path "$dir")
  には既にブランチ '$registered_branch' が入っている（要求は '$branch'）。
  ブランチ名を変えるか、既存側を worktree.sh remove $registered_branch で撤収すること。" 4
    fi
  elif [ -n "$registered_dir" ]; then
    die "ブランチ '$branch' は既に別の worktree が掴んでいる。
  $(win_path "$registered_dir")
  同じブランチを 2 箇所でチェックアウトすることはできない（git の意図的な制約）。" 4
  elif [ -e "$dir" ]; then
    die "ディレクトリが残っているが worktree として登録されていない。
  $(win_path "$dir")
  中身を確認して手で消し、git worktree prune を実行してからやり直すこと。" 4
  else
    mkdir -p "$wt_root"
    if git -C "$main_repo" show-ref --verify --quiet "refs/heads/$branch"; then
      info "既存のローカルブランチ '$branch' を使う"
      git -C "$main_repo" worktree add "$dir" "$branch"
    elif git -C "$main_repo" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      info "origin/$branch を追跡する新しいブランチを作る"
      git -C "$main_repo" worktree add --track -b "$branch" "$dir" "origin/$branch"
    else
      git -C "$main_repo" show-ref --verify --quiet refs/heads/main ||
        die 'main ブランチが見つからない。' 4
      if git -C "$main_repo" show-ref --verify --quiet refs/remotes/origin/main; then
        behind=$(git -C "$main_repo" rev-list --count main..origin/main 2>/dev/null || printf '0')
        [ "$behind" -gt 0 ] 2>/dev/null &&
          warn "main が origin/main より $behind コミット遅れている。先に取り込むか、--fetch 後にやり直すことを検討する"
      fi
      info "main から新しいブランチ '$branch' を作る"
      git -C "$main_repo" worktree add -b "$branch" "$dir" main
    fi
  fi

  head2 '設定ファイルの配備:'
  deploy_configs "$dir" "$overwrite" "$branch"
  ensure_node_modules_volume

  head2 '次にやること:'
  cat <<EOF
  1. この worktree を「新しい VSCode ウィンドウ」で開き、そこで Claude を起動する
       code "$(win_path "$dir")"
     （VSCode の File > New Window でこのフォルダを開いてもよい。
       ターミナルから使うなら cd "$(win_path "$dir")" してから claude を起動する）
     いまの VSCode ウィンドウで新しいセッションを開いても cwd は本体のままで、
     CLAUDE_PROJECT_DIR も変わらず、フックと設定が本体側を向く。
  2. その worktree の $LOCAL_MEMO に「この worktree の目的」を書く
  3. その worktree で dev サーバを起動する（他 worktree と並行して動く）
       docker compose up -d frontend

EOF
  print_docker_env "$dir"
}

# --- remove -----------------------------------------------------------------
cmd_remove() {
  branch="${1:-}"
  [ -n "$branch" ] || die "ブランチ名が必要。例: worktree.sh remove feat/market-holiday-type" 2
  shift

  force=0
  del_branch=0
  docker_clean=0
  for a in "$@"; do
    case "$a" in
    --force) force=1 ;;
    --delete-branch) del_branch=1 ;;
    --docker-clean) docker_clean=1 ;;
    *) die "不明なオプション: $a（--force / --delete-branch / --docker-clean）" 2 ;;
    esac
  done

  validate_branch "$branch"
  dir=$(dir_for "$branch")

  registered_branch=$(branch_at_dir "$dir")
  [ -n "$registered_branch" ] || die "worktree として登録されていない: $(win_path "$dir")
  一覧は worktree.sh list で確認する。" 4
  [ "$registered_branch" = "$branch" ] ||
    die "そのディレクトリに入っているのは '$registered_branch' で '$branch' ではない。" 4

  # 1. カレントディレクトリが対象の内側だと Windows では削除できない。
  cwd=$(norm_path "$(pwd)")
  ndir=$(norm_path "$dir")
  case "$cwd" in
  "$ndir" | "$ndir"/*)
    die "撤収対象の中で実行している。本体リポジトリのセッションから実行すること:
  $(win_path "$main_repo")" 4
    ;;
  esac

  # 2. 取り返しがつかない喪失を防ぐ。--force は未追跡ファイルまで消す
  #    （配備した設定ファイルも一緒に消える）。
  if [ "$force" -eq 0 ]; then
    dirty=$(git -C "$dir" status --porcelain)
    if [ -n "$dirty" ]; then
      head2 '未コミットの変更がある:'
      git -C "$dir" status --short
      die "コミットするか破棄してからやり直すこと。
  意図して捨てるなら --force を付ける（未追跡ファイルも消える）。" 5
    fi
    notargs='main'
    if git -C "$main_repo" show-ref --verify --quiet refs/remotes/origin/main; then
      notargs='main origin/main'
    fi
    # shellcheck disable=SC2086
    unmerged=$(git -C "$main_repo" log --oneline "$branch" --not $notargs)
    if [ -n "$unmerged" ]; then
      head2 'main に取り込まれていないコミットがある:'
      printf '%s\n' "$unmerged"
      die "先に main へマージすること（マージは本体セッションで行う）。
  意図して捨てるなら --force を付ける。" 5
    fi
  fi

  # 3. この worktree の Docker 環境を片付ける。他 worktree の project には触らない。
  #    コンテナが生きているとバインドマウントがディレクトリを掴み、
  #    Windows では git worktree remove がディレクトリを消せない。必ず remove の前に行う。
  proj=$(compose_project_for_dir "$dir")
  running=$(snapshot_row_for_dir "$(frontend_snapshot)" "$dir")
  if [ "$docker_clean" -eq 1 ]; then
    if docker_ready; then
      head2 "Docker 環境を片付ける（compose プロジェクト: $proj）:"
      # -v は「この project の」匿名・named ボリューム。共有の node_modules は
      # external 宣言なので消えない（他 worktree を壊さない）。
      compose_in_dir "$dir" down --remove-orphans -v ||
        warn 'down に失敗した。docker ps で残っているコンテナを確認すること'
    else
      warn 'Docker Desktop が起動していないので片付けを飛ばす'
    fi
  elif [ -n "$running" ]; then
    die "この worktree の frontend コンテナが稼働中（compose プロジェクト: $proj）。
  掴んだままだとディレクトリを削除できない。次のどちらかを行うこと:
    - この撤収コマンドに --docker-clean を付け直す（コンテナとネットワークを片付けてから撤収する）
    - その worktree で docker compose down を実行してからやり直す
  他 worktree の Docker は無関係なので止めなくてよい。" 4
  fi

  if [ "$force" -eq 1 ]; then
    git -C "$main_repo" worktree remove --force "$dir"
  else
    git -C "$main_repo" worktree remove "$dir"
  fi
  git -C "$main_repo" worktree prune
  info "撤収した: $(win_path "$dir")"

  if [ "$del_branch" -eq 1 ]; then
    if git -C "$main_repo" branch -d "$branch"; then
      info "ブランチを削除した: $branch"
    else
      warn "ブランチ '$branch' の削除に失敗した（未マージ？）。強制削除する場合は手で git branch -D する"
    fi
  fi

  if [ "$docker_clean" -eq 0 ] && docker_ready; then
    head2 'Docker の残留物:'
    info "compose プロジェクト '$proj' のネットワーク等は残っている。掃除するなら:"
    info "  docker network rm ${proj}_default"
    info "共有の node_modules（$NODE_MODULES_VOLUME）は消さないこと（全 worktree が使う）。"
    info "次からは remove に --docker-clean を付けるとまとめて片付く。"
  fi

  if [ -e "$dir" ]; then
    warn "ディレクトリが残っている（Docker のバインドマウントやエディタが掴んでいる可能性）:
    $(win_path "$dir")
    掴んでいるプロセスを閉じてから手で削除し、git worktree prune を実行すること"
  fi
}

# --- list -------------------------------------------------------------------
cmd_list() {
  snap=$(frontend_snapshot)
  head2 'worktree 一覧:'
  # DIR 列は共通の接頭辞（リポジトリ名）を落として並びを崩さないようにする。
  printf '  %-30s %-30s %-10s %-9s %-8s %s\n' \
    "DIR($repo_name-)" 'BRANCH' 'STATE' 'A/B(main)' 'DOCKER' 'URL'
  wt_pairs | while IFS="$(printf '\t')" read -r d b; do
    state='clean'
    if [ -d "$d" ]; then
      n=$(git -C "$d" status --porcelain 2>/dev/null | grep -c '' || true)
      [ "${n:-0}" -gt 0 ] 2>/dev/null && state="dirty($n)"
    else
      state='MISSING'
    fi
    ab='-'
    if [ -d "$d" ]; then
      counts=$(git -C "$d" rev-list --left-right --count main...HEAD 2>/dev/null || true)
      if [ -n "$counts" ]; then
        behind=$(printf '%s' "$counts" | awk '{print $1}')
        ahead=$(printf '%s' "$counts" | awk '{print $2}')
        ab="+$ahead/-$behind"
      fi
    fi
    dstate='-'
    url='-'
    if [ -d "$d" ]; then
      if [ -n "$(snapshot_row_for_dir "$snap" "$d")" ]; then
        dstate='running'
        url="http://localhost:$(frontend_port_of_dir "$d")"
      else
        dstate='stopped'
        url="(http://localhost:$(env_port_of_dir "$d"))"
      fi
    fi
    name=$(basename "$d")
    short=${name#"$repo_name"-}
    [ "$short" = "$repo_name" ] && short='(本体)'
    printf '  %-30s %-30s %-10s %-9s %-8s %s\n' \
      "$short" "$b" "$state" "$ab" "$dstate" "$url"
  done
  printf '\n'
  printf 'Docker は worktree ごとに分離されている（compose プロジェクト＝ディレクトリ名）。\n'
  printf 'up -d / E2E / Playwright MCP は他 worktree と並行して実行してよい。\n'
  printf '停止中の URL は括弧付き（%s の FRONTEND_PORT の設定値）。\n' "$ENV_FILE"
  printf '共有は node_modules（%s）だけ。npm install / npm ci は排他。\n' "$NODE_MODULES_VOLUME"
  docker_ready || printf '! Docker Desktop が起動していないため DOCKER 列は判定していない。\n'
  printf '\n'
  print_main_head
}

# --- doctor -----------------------------------------------------------------
cmd_doctor() {
  head2 '配備状況:'
  wt_pairs | while IFS="$(printf '\t')" read -r d b; do
    printf '  %s (%s)\n' "$(basename "$d")" "$b"
    if [ ! -d "$d" ]; then
      printf '    MISSING: ディレクトリが無い。git worktree prune が必要\n'
      continue
    fi
    # 本体リポジトリには worktree 固有メモを置かないので点検対象から外す。
    files="$ENV_FILE $LOCAL_SETTINGS $LOCAL_MEMO"
    if [ "$(norm_path "$d")" = "$(norm_path "$main_repo")" ]; then
      files="$ENV_FILE $LOCAL_SETTINGS"
    fi
    for f in $files; do
      if [ -e "$d/$f" ]; then
        note=''
        if [ -f "$main_repo/$f" ] && ! cmp -s "$d/$f" "$main_repo/$f"; then
          note=' (本体と内容が異なる)'
        fi
        printf '    ok   %s%s\n' "$f" "$note"
      else
        printf '    MISS %s\n' "$f"
      fi
    done
    # gitignore が効いているか（ファイル名を引数に出さないためここに閉じ込める）。
    # check-ignore -q は 1 パスしか受け付けないので 1 件ずつ確かめる。
    not_ignored=''
    for f in $files; do
      case "$f" in
      "$LOCAL_SETTINGS") continue ;; # .claude/ 配下は行単位で指定済み。個別に確認しない
      esac
      git -C "$d" check-ignore -q "$f" 2>/dev/null || not_ignored="$not_ignored $f"
    done
    if [ -z "$not_ignored" ]; then
      printf '    ok   配備物は gitignore 済み\n'
    else
      printf '    WARN gitignore されていない配備物がある:%s（コミットに混入する危険）\n' "$not_ignored"
    fi
  done

  head2 'Docker 環境（worktree ごとに分離。project 名は compose に解決させた正の値）:'
  if ! docker_ready; then
    printf '  判定不能（Docker Desktop が起動していない）\n'
  else
    snap=$(frontend_snapshot)
    projects=''
    # 孤児判定に project 名を集めるので、パイプ（サブシェル）ではなく for で回す。
    # 置き場所は $HOME/worktrees 固定なのでパスに空白は入らない。
    for d in $(wt_pairs | cut -f1); do
      [ -d "$d" ] || continue
      p=$(compose_project_for_dir "$d")
      projects="$projects $p"
      if [ -n "$(snapshot_row_for_dir "$snap" "$d")" ]; then
        printf '  %-34s running  %s\n' "$p" "http://localhost:$(frontend_port_of_dir "$d")"
      else
        printf '  %-34s stopped  （割当ポート %s）\n' "$p" "$(env_port_of_dir "$d")"
      fi
    done

    printf '\n  共有リソース:\n'
    if docker volume inspect "$NODE_MODULES_VOLUME" >/dev/null 2>&1; then
      printf '    ok   node_modules: %s（npm install / npm ci は排他）\n' "$NODE_MODULES_VOLUME"
    else
      printf '    MISS node_modules: %s が無い。作ってから npm ci すること:\n' "$NODE_MODULES_VOLUME"
      printf '           docker volume create %s\n' "$NODE_MODULES_VOLUME"
      printf '           docker compose run --rm frontend npm ci\n'
    fi

    # 孤児の検出。撤収済み worktree のネットワークや、旧構成の固定名が残っていないか。
    nets=$(docker network ls --format '{{.Name}}' 2>/dev/null |
      grep -i 'pre-market_trading_frontend\|us-stock-order-frontend' || true)
    orphans=''
    for n in $nets; do
      base=${n%_default}
      case " $projects " in
      *" $base "*) ;;
      *) orphans="$orphans $n" ;;
      esac
    done
    if [ -n "$orphans" ]; then
      printf '\n  ! どの worktree にも対応しない Docker ネットワークが残っている:%s\n' "$orphans"
      printf '    掴んでいるコンテナ（異常終了した MCP など）を止めてから消すこと:\n'
      printf '      docker network rm <名前>\n'
      printf '    旧構成の us-stock-order-frontend_default が残っている場合も同じ手順で消す。\n'
    fi
  fi
  printf '\n'
  print_main_head
}

# --- help -------------------------------------------------------------------
usage() {
  cat <<EOF
並行セッション用の git worktree を管理する。

  bash scripts/worktree.sh add <type>/<kebab> [--overwrite-config] [--fetch]
  bash scripts/worktree.sh remove <type>/<kebab> [--force] [--delete-branch]
  bash scripts/worktree.sh list
  bash scripts/worktree.sh doctor
  bash scripts/worktree.sh help

置き場所: $(win_path "$wt_root")\\$repo_name-<ブランチ名>

  add     worktree を作り、gitignore された設定（$ENV_FILE / $LOCAL_SETTINGS /
          $LOCAL_MEMO）を配備し、dev サーバのホスト公開ポートを割り当てる。
          2 回目以降は既存を壊さない（冪等）。
          --overwrite-config で本体の設定を上書きコピーする（ポートは温存）
  remove  撤収する。未コミット・未マージがあれば止まる（捨てるなら --force）。
          --delete-branch でブランチも削除する（-d 相当。強制はしない）
          --docker-clean でその worktree の compose プロジェクトを片付ける
          （共有の node_modules は external なので消えない）
  list    一覧＋worktree ごとの Docker の状態と dev サーバ URL を表示する
  doctor  配備漏れ・gitignore・worktree ごとの Docker 環境・孤児リソースを点検する

Docker は worktree ごとに分離される（compose プロジェクト＝ディレクトリ名）。
up -d / E2E / Playwright MCP は並行可。共有は node_modules だけで、npm install は排他。
詳細は CLAUDE.md の「Git worktree（並行セッション）」節。
EOF
}

# --- ディスパッチ -----------------------------------------------------------
sub="${1:-list}"
[ "$#" -gt 0 ] && shift || true

case "$sub" in
add) cmd_add "$@" ;;
remove | rm) cmd_remove "$@" ;;
list | ls) cmd_list "$@" ;;
doctor) cmd_doctor "$@" ;;
help | -h | --help) usage ;;
*)
  printf 'error: 不明なサブコマンド: %s\n\n' "$sub" >&2
  usage >&2
  exit 2
  ;;
esac

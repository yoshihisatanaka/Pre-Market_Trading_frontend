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
# compose プロジェクト名は docker-compose.yml の name: が正。ハードコードしない。
compose_project() {
  sed -n 's/^name:[[:space:]]*\([^[:space:]#]*\).*/\1/p' "$main_repo/docker-compose.yml" 2>/dev/null | head -n1
}

# 稼働中の frontend コンテナがどの worktree をマウントしているか。
# compose プロジェクト名もポートも全 worktree で共有なので、これが「排他利用の見張り」になる。
# 出力: "" 停止中 / "-" Docker 未起動・判定不能 / それ以外は working_dir
docker_owner() {
  command -v docker >/dev/null 2>&1 || {
    printf '%s' '-'
    return
  }
  docker info >/dev/null 2>&1 || {
    printf '%s' '-'
    return
  }
  proj=$(compose_project)
  [ -n "$proj" ] || {
    printf '%s' '-'
    return
  }
  cid=$(docker ps -q \
    --filter "label=com.docker.compose.project=$proj" \
    --filter "label=com.docker.compose.service=frontend" 2>/dev/null | head -n1)
  [ -n "$cid" ] || return 0
  docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid" 2>/dev/null || printf '%s' '-'
}

print_docker_owner() {
  owner=$(docker_owner)
  case "$owner" in
  '') printf 'Docker(frontend): 停止中。使いたい worktree で docker compose up -d frontend\n' ;;
  '-') printf 'Docker(frontend): 判定不能（Docker Desktop が起動していない）\n' ;;
  *)
    printf 'Docker(frontend): 稼働中 — 所有者は %s\n' "$(win_path "$owner")"
    printf '  他 worktree では up -d / restart / down / E2E / Playwright MCP を実行しないこと。\n'
    ;;
  esac
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

- **Docker は排他利用。** \`docker compose up -d frontend\` / E2E / Playwright MCP /
  \`localhost:5173\` を使う前に \`bash scripts/worktree.sh list\` で現所有者を確認する。
  自分以外が持っていたら手を出さない。明け渡しは \`docker compose down\`（\`-v\` は付けない）
- \`npm install\` は排他（node_modules は全 worktree 共有のボリューム）。
  \`lint\` / \`test:unit\` / \`check:scenarios\` / \`build\` は並行してよい
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

  head2 '次にやること:'
  cat <<EOF
  1. この worktree を「新しい VSCode ウィンドウ」で開き、そこで Claude を起動する
       code "$(win_path "$dir")"
     （VSCode の File > New Window でこのフォルダを開いてもよい。
       ターミナルから使うなら cd "$(win_path "$dir")" してから claude を起動する）
     いまの VSCode ウィンドウで新しいセッションを開いても cwd は本体のままで、
     CLAUDE_PROJECT_DIR も変わらず、フックと設定が本体側を向く。
  2. その worktree の $LOCAL_MEMO に「この worktree の目的」を書く
  3. Docker を使う前に現所有者を確認する
       bash scripts/worktree.sh list

EOF
  print_docker_owner
}

# --- remove -----------------------------------------------------------------
cmd_remove() {
  branch="${1:-}"
  [ -n "$branch" ] || die "ブランチ名が必要。例: worktree.sh remove feat/market-holiday-type" 2
  shift

  force=0
  del_branch=0
  for a in "$@"; do
    case "$a" in
    --force) force=1 ;;
    --delete-branch) del_branch=1 ;;
    *) die "不明なオプション: $a（--force / --delete-branch）" 2 ;;
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

  # 3. Docker を掴んだままの撤収を防ぐ。
  owner=$(docker_owner)
  if [ -n "$owner" ] && [ "$owner" != '-' ] && [ "$(norm_path "$owner")" = "$ndir" ]; then
    die "この worktree が frontend コンテナを掴んでいる。
  先にその worktree で docker compose down を実行すること（-v は付けない）。" 4
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

  if [ -e "$dir" ]; then
    warn "ディレクトリが残っている（Docker のバインドマウントやエディタが掴んでいる可能性）:
    $(win_path "$dir")
    掴んでいるプロセスを閉じてから手で削除し、git worktree prune を実行すること"
  fi
}

# --- list -------------------------------------------------------------------
cmd_list() {
  head2 'worktree 一覧:'
  printf '  %-52s %-34s %-12s %s\n' 'DIR' 'BRANCH' 'STATE' 'AHEAD/BEHIND(main)'
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
    printf '  %-52s %-34s %-12s %s\n' "$(basename "$d")" "$b" "$state" "$ab"
  done
  printf '\n'
  print_main_head
  print_docker_owner
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

  head2 '共有リソース（全 worktree で共有。並行実行の注意点）:'
  printf '  compose プロジェクト: %s\n' "$(compose_project)"
  printf '  node_modules: named volume（%s_node_modules）\n' "$(compose_project)"
  if [ -d "$main_repo/.vite" ]; then
    printf '  ! 本体に .vite/ がある。Vite の依存キャッシュ既定は node_modules/.vite（共有側）なので\n'
    printf '    重い npm タスク（build / test:unit）の同時実行は避ける\n'
  fi
  printf '\n'
  print_main_head
  print_docker_owner
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
          $LOCAL_MEMO）を配備する。2 回目以降は既存を壊さない（冪等）。
          --overwrite-config で本体の設定を上書きコピーする
  remove  撤収する。未コミット・未マージがあれば止まる（捨てるなら --force）。
          --delete-branch でブランチも削除する（-d 相当。強制はしない）
  list    一覧と「いま Docker を掴んでいる worktree」を表示する
  doctor  配備漏れ・gitignore・共有リソースを点検する

Docker は排他利用（compose のプロジェクト名・ポート・node_modules は全 worktree 共有）。
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

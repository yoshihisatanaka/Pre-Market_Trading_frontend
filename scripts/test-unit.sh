#!/usr/bin/env bash
# 単体テスト（Vitest）を「変更に関係する spec だけ」回す。worktree での日常用。
#
#   bash scripts/test-unit.sh                       # 変更ファイルに依存する spec だけ
#   bash scripts/test-unit.sh --all                 # 全件（main へマージする前 / /morning-check）
#   bash scripts/test-unit.sh --lint                # 変更ファイルの eslint も同じコンテナで先に流す
#   bash scripts/test-unit.sh src/utils/csv.js      # 起点を直接指定（spec ならそれ自身、製品コードならそれに依存する spec）
#   bash scripts/test-unit.sh -- --reporter=dot     # `--` 以降は vitest へそのまま渡す
#   bash scripts/test-unit.sh --dry-run             # 対象とコマンドを表示するだけで実行しない
#
# なぜ必要か（2026-09-30 の実測）:
#   spec 121 本 / 1648 件の全件実行は 353 秒。時間の 3 割は spec ごとに走る vitest.setup.js
#   （MSW ハンドラと fixture 8300 行の読み込み）、2 割は jsdom の生成で、「spec 1 本あたりの固定費 × 本数」
#   が支配的。つまり本数を絞るのが最も効く。`--no-isolate` は速くならず 466 件壊れたので採らない。
#   `vitest related` も使わない。全 spec の import グラフをコンテナ内（Windows の bind mount）で
#   辿るため、spec 6 本を選ぶだけで 134〜206 秒かかった（spec を直接指定すれば 1 本 13 秒）。
#   依存の逆引きはホスト側で git grep して済ませる。
#
# 設計上の約束:
#   1. 変更ファイルと依存の逆引きは **ホスト側の git** で行う。コンテナ内では git が使えない
#      （worktree の .git はホストの絶対パスを書いたファイル）ので `vitest --changed` は使えない。
#   2. dev サーバの frontend コンテナが起動していれば `docker compose exec` で乗り入れ、
#      `run --rm` の起動 30 秒を省く。起動していなければ `run --rm` に切り替える。
#   3. 絶対パスを引数に取らない（.claude/hooks/guard-secret-paths.sh がツール入力を検査するため）。
#   4. 全件用の `npm run verify` / `npm run test:unit` は変えない。ここはその軽量版。
#
# 終了コード: vitest / eslint の終了コードをそのまま返す。
#             2 使い方の誤り / 4 Docker が使えない

set -euo pipefail

info() { printf '  %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$1" >&2
  exit "${2:-1}"
}

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

cd "$(git rev-parse --show-toplevel)" || die 'git リポジトリの中で実行すること' 2

# --- 引数 -------------------------------------------------------------------
run_all=0
run_lint=0
dry_run=0
seeds=()
passthrough=()
while [ $# -gt 0 ]; do
  case "$1" in
    --all) run_all=1 ;;
    --lint) run_lint=1 ;;
    --dry-run) dry_run=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      passthrough=("$@")
      break
      ;;
    -*) die "不明なオプション: $1（vitest へ渡すなら -- の後ろに置く）" 2 ;;
    *)
      case "$1" in
        /* | [A-Za-z]:*) die "絶対パスは受け付けない（リポジトリからの相対パスで指定する）: $1" 2 ;;
      esac
      [ -f "$1" ] || die "ファイルが無い: $1" 2
      seeds+=("$1")
      ;;
  esac
  shift
done

# --- 変更ファイルの収集 -------------------------------------------------------
# コミット済（main から分岐した後）+ ステージ + 未ステージ を 1 回で。削除は除き、リネームは新パスを採る。
# 未追跡は git status の ?? 行から拾う。quote / "a -> b" の処理は .claude/hooks/lint-on-stop.sh と同じ。
changed_files() {
  local base
  base=$(git merge-base main HEAD 2>/dev/null || git rev-parse HEAD)
  {
    git diff --name-only --diff-filter=d -M "$base" 2>/dev/null
    git status --porcelain --untracked-files=all 2>/dev/null | sed -n 's/^?? //p'
  } |
    sed 's/^.* -> //' | sed 's/^"\(.*\)"$/\1/' |
    sort -u
}

# 変更が広すぎて依存では絞れないもの。含まれていたら全件に格上げする。
# src/mocks/ は vitest.setup.js（MSW）経由で全 spec に効くので丸ごと対象。
FULL_RUN_TRIGGER_RE='^(vitest\.config\.js|vitest\.setup\.js|vite\.config\.js|package\.json|package-lock\.json|src/mocks/)'
# 依存の起点にできるもの（openapi.json は src/api/contract.spec.js が import している）。
SEED_RE='(^src/.*\.(js|vue)$|^docs/api/openapi\.json$)'

if [ "$run_all" -eq 0 ] && [ "${#seeds[@]}" -eq 0 ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    if printf '%s' "$f" | grep -Eq "$FULL_RUN_TRIGGER_RE"; then
      info "$f が変更されているので全件に切り替える"
      run_all=1
    fi
    printf '%s' "$f" | grep -Eq "$SEED_RE" && seeds+=("$f")
  done < <(changed_files)
fi

# --- 依存の逆引き（ホスト側） -----------------------------------------------------
# src/ 配下の import 文から「importer importee」の辺を作り、起点から逆向きに辿って spec を集める。
# 解決するのは `@/` と相対パスだけ（パッケージは辿らない）。拡張子省略は .js / .vue / /index.js を補う。
# 動的 import（router の `() => import('@/views/...')`）は辿らない。辿ると画面を 1 つ触るたびに
# router の spec が付いてくるが、router の spec は画面を描画しないので無駄になる。
dependent_specs() {
  # grep は「一致しないファイルがあった」だけで xargs の終了コードを 123 にするので、|| true で受ける
  # （set -e / pipefail のまま黙って関数を抜けてしまうのを防ぐ）。
  local edges
  edges=$(
    {
      git ls-files -- 'src/*.js' 'src/*.vue'
      git ls-files --others --exclude-standard -- 'src/*.js' 'src/*.vue'
    } | sort -u | xargs grep -HoE "(from|^import)[[:space:]]+['\"](@/|\.{1,2}/)[^'\"]+['\"]" 2>/dev/null |
      awk -F: '
        {
          importer = $1
          spec = $0
          sub(/^[^:]*:/, "", spec)
          match(spec, /['"'"'"][^'"'"'"]+['"'"'"]/)
          target = substr(spec, RSTART + 1, RLENGTH - 2)
          if (target ~ /^@\//) {
            target = "src/" substr(target, 3)
          } else {
            dir = importer
            sub(/\/[^\/]*$/, "", dir)
            target = dir "/" target
          }
          # ./ と ../ を畳む
          n = split(target, parts, "/")
          depth = 0
          for (i = 1; i <= n; i++) {
            if (parts[i] == "." || parts[i] == "") continue
            if (parts[i] == "..") { if (depth > 0) depth--; continue }
            out[++depth] = parts[i]
          }
          target = ""
          for (i = 1; i <= depth; i++) target = target (i > 1 ? "/" : "") out[i]
          print importer, target
        }' || true
  )

  # 拡張子の補完は実在確認が要るので bash 側で行う
  local importer target resolved
  while read -r importer target; do
    [ -n "$importer" ] || continue
    resolved=''
    for cand in "$target" "$target.js" "$target.vue" "$target/index.js"; do
      if [ -f "$cand" ]; then
        resolved=$cand
        break
      fi
    done
    if [ -n "$resolved" ]; then printf '%s %s\n' "$importer" "$resolved"; fi
  done <<<"$edges" | sort -u >"$EDGE_FILE"

  # 逆向き BFS。起点自身が spec ならそのまま対象。
  awk -v seeds="$(printf '%s\n' "$@")" '
    BEGIN {
      n = split(seeds, s, "\n")
      for (i = 1; i <= n; i++) if (s[i] != "") { seen[s[i]] = 1; queue[++tail] = s[i] }
    }
    { rev[$2] = rev[$2] " " $1 }
    END {
      while (head < tail) {
        cur = queue[++head]
        m = split(rev[cur], importers, " ")
        for (i = 1; i <= m; i++) {
          f = importers[i]
          if (f == "" || (f in seen)) continue
          seen[f] = 1
          queue[++tail] = f
        }
      }
      for (f in seen) if (f ~ /\.spec\.js$/) print f
    }' "$EDGE_FILE" | sort
}

targets=()
lint_files=()
if [ "$run_all" -eq 0 ]; then
  if [ "${#seeds[@]}" -eq 0 ]; then
    info '変更に関係する spec が無い（変更ファイル無し）。全件を回すなら --all'
    exit 0
  fi
  EDGE_FILE=$(mktemp)
  trap 'rm -f "$EDGE_FILE"' EXIT
  while IFS= read -r f; do
    [ -n "$f" ] && targets+=("$f")
  done < <(dependent_specs "${seeds[@]}")
  for f in "${seeds[@]}"; do
    case "$f" in *.js | *.vue) lint_files+=("$f") ;; esac
  done
  if [ "${#targets[@]}" -eq 0 ]; then
    info "起点 ${#seeds[@]} 件に依存する spec が無い:"
    for f in "${seeds[@]}"; do info "  $f"; done
    info '（テストが無い変更。全件を回すなら --all）'
    exit 0
  fi
fi

# --- Docker -----------------------------------------------------------------
if [ "$dry_run" -eq 0 ]; then
  docker info >/dev/null 2>&1 || die 'Docker が使えない（Docker Desktop を起動する）' 4
fi

# frontend が起動していれば exec（起動 30 秒を省く）。無ければ一時コンテナ。
if docker compose ps --services --status running 2>/dev/null | grep -qx frontend; then
  runner=(docker compose exec -T frontend)
  info 'frontend コンテナに exec で乗り入れる'
else
  runner=(docker compose run --rm -T frontend)
  info 'frontend が起動していないので一時コンテナで回す（起動に 30 秒ほど）'
fi

# --- コマンド組み立て ---------------------------------------------------------
if [ "$run_all" -eq 1 ]; then
  vitest_cmd=(npx vitest run)
  info '全件を回す'
else
  vitest_cmd=(npx vitest run "${targets[@]}")
  info "起点 ${#seeds[@]} 件 → spec ${#targets[@]} 本:"
  for f in "${targets[@]}"; do info "  $f"; done
fi
vitest_cmd+=("${passthrough[@]+"${passthrough[@]}"}")

if [ "$run_lint" -eq 1 ] && [ "${#lint_files[@]}" -gt 0 ]; then
  # eslint と vitest を 1 コンテナで続けて流す。sh -c に渡すので各引数を quote する。
  q() { printf '%q ' "$@"; }
  info "eslint を先に流す（${#lint_files[@]} 件）"
  shell_cmd="$(q npx eslint "${lint_files[@]}") && $(q "${vitest_cmd[@]}")"
  if [ "$dry_run" -eq 1 ]; then
    info "[dry-run] ${runner[*]} sh -c '$shell_cmd'"
    exit 0
  fi
  exec "${runner[@]}" sh -c "$shell_cmd"
fi

if [ "$dry_run" -eq 1 ]; then
  info "[dry-run] ${runner[*]} ${vitest_cmd[*]}"
  exit 0
fi
exec "${runner[@]}" "${vitest_cmd[@]}"

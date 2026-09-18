#!/usr/bin/env bash
# Claude Code の Stop フック。ターン終了時に Docker 経由で ESLint を実行し、
# 失敗していれば結果を Claude に差し戻して修正させる。
#
# - **未コミットの .js / .mjs / .vue だけ**を lint する。変更が無いターン（調査・docs だけ）では
#   Docker を起こさずに終わる（起動だけで 30 秒かかるため。2026-09-18 に差分方式へ変更）
# - コミット済みの変更は、そのコミットを作ったターンの Stop で既に lint されている
# - Docker Desktop が起動していないときは lint をスキップして通知だけ出す
# - stop_hook_active（フックによる差し戻し中）のときは再実行せず無限ループを防ぐ
# - 手動実行: echo '{}' | bash .claude/hooks/lint-on-stop.sh
#   全体を lint したいときは docker compose run --rm frontend npm run verify

set -u
input=$(cat)

case "$input" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# セッション同居検知（SessionStart の session-worktree-notice.sh）用のロックを更新する。
# Stop は毎ターン走るので、これで「まだ生きているセッション」だけが新しい mtime を持つ。
sid=$(printf '%s' "$input" |
  sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
  tr -cd 'A-Za-z0-9._-' | cut -c1-64)
if [ -n "$sid" ]; then
  mkdir -p .claude/.sessions 2>/dev/null && : >".claude/.sessions/$sid" 2>/dev/null || true
fi

# 未コミットの lint 対象ファイル。リネームは新しい側のパスを採る。
# eslint.config.js の ignores（docs/ ・ .claude/worktrees/ など）と同じものはここでも外す。
changed=$(
  git status --porcelain --untracked-files=all 2>/dev/null |
    sed -n 's/^.. //p' | sed 's/^.* -> //' | sed 's/^"\(.*\)"$/\1/' |
    grep -E '\.(js|mjs|vue)$' |
    grep -Ev '^(docs/|\.claude/worktrees/|dist/|\.vite/|coverage/|playwright-report/|test-results/|public/mockServiceWorker\.js)' |
    sort -u
)
files=()
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] && files+=("$f")
done <<<"$changed"

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo '{"systemMessage":"[lint hook] Docker が起動していないため lint をスキップしました"}'
  exit 0
fi

output=$(docker compose run --rm -T frontend npx eslint "${files[@]}" 2>&1)
status=$?

if [ "$status" -eq 0 ]; then
  exit 0
fi

# npm notice の行を除き、末尾 40 行だけを JSON 文字列として埋め込む
snippet=$(printf '%s\n' "$output" | grep -v '^npm notice' | tail -n 40 \
  | sed -e 's/\/\\/g' -e 's/"/\\"/g' -e 's/\t/\t/g' | sed ':a;N;$!ba;s/\n/\n/g')

printf '{"decision":"block","reason":"ESLint が失敗しました（変更ファイル %s 件）。以下を修正してください。\n\n%s"}\n' "${#files[@]}" "$snippet"
exit 0

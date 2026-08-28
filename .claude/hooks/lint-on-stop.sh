#!/usr/bin/env bash
# Claude Code の Stop フック。ターン終了時に Docker 経由で ESLint を実行し、
# 失敗していれば結果を Claude に差し戻して修正させる。
#
# - Docker Desktop が起動していないときは lint をスキップして通知だけ出す
# - stop_hook_active（フックによる差し戻し中）のときは再実行せず無限ループを防ぐ
# - 手動実行: echo '{}' | bash .claude/hooks/lint-on-stop.sh

set -u
input=$(cat)

case "$input" in
  *'"stop_hook_active":true'*) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if ! docker info >/dev/null 2>&1; then
  echo '{"systemMessage":"[lint hook] Docker が起動していないため lint をスキップしました"}'
  exit 0
fi

output=$(docker compose run --rm -T frontend npm run lint 2>&1)
status=$?

if [ "$status" -eq 0 ]; then
  exit 0
fi

# npm notice の行を除き、末尾 40 行だけを JSON 文字列として埋め込む
snippet=$(printf '%s\n' "$output" | grep -v '^npm notice' | tail -n 40 \
  | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' | sed ':a;N;$!ba;s/\n/\\n/g')

printf '{"decision":"block","reason":"ESLint が失敗しました。以下を修正してください。\\n\\n%s"}\n' "$snippet"
exit 0

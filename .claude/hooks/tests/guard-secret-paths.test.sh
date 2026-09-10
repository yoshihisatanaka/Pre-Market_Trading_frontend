#!/usr/bin/env bash
# guard-secret-paths.sh の回帰テスト。
#
# ケース（`.env` などの文字列を含む JSON）は、このファイルの中に置いてある。
# フック自身が「コマンド文字列に機密ファイル名が現れたら拒否」するため、
#   echo '{"tool_name":"Bash","tool_input":{"command":"cat ...<機密>"}}' | bash <フック>
# という手で流す形の動作確認は、そのフックに拒否されて実行できない。
# 起動コマンドに機密ファイル名が現れないこの形にすれば、ツール経由でも通る:
#
#   bash .claude/hooks/tests/guard-secret-paths.test.sh
#
# 判定対象はフックの標準出力に deny が出るかどうかだけ。副作用は無い。

set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)
hook="$here/../guard-secret-paths.sh"

# フックは CLAUDE_PROJECT_DIR を許可リストの基点にする。どこから起動しても
# 同じ判定になるよう、このスクリプトの位置（.claude/hooks/tests の 3 つ上）で固定する。
project=$(cd "$here/../../.." && pwd)

sq="'"
pass=0
fail=0

# --- 実行と判定 -------------------------------------------------------------
run_case() {
  expected="$1"
  name="$2"
  payload="$3"

  out=$(printf '%s' "$payload" | CLAUDE_PROJECT_DIR="$project" bash "$hook" 2>&1)
  if printf '%s' "$out" | grep -q '"permissionDecision":"deny"'; then
    actual='deny'
  else
    actual='allow'
  fi

  if [ "$actual" = "$expected" ]; then
    pass=$((pass + 1))
    printf 'ok    %-5s  %s\n' "$expected" "$name"
  else
    fail=$((fail + 1))
    printf 'FAIL  %-5s  %s  (期待 %s / 実際 %s)\n' "$expected" "$name" "$expected" "$actual"
  fi
}

# --- ペイロードの組み立て ---------------------------------------------------
# 引数は JSON 文字列の中身。二重引用符とバックスラッシュは呼び出し側でエスケープする。
bash_cmd() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"; }
pwsh_cmd() { printf '{"tool_name":"PowerShell","tool_input":{"command":"%s"}}' "$1"; }
read_path() { printf '{"tool_name":"Read","tool_input":{"file_path":"%s"}}' "$1"; }

echo '--- 拒否されるべきもの（読み出し・書き出し） ---'

run_case deny 'cat .env' \
  "$(bash_cmd 'cat frontend/.env')"

run_case deny '.env.local を読む' \
  "$(bash_cmd 'Get-Content .env.local')"

run_case deny 'docker cp でコンテナから抜き出す' \
  "$(bash_cmd 'docker cp app:/app/.env .')"

run_case deny 'git commit -F は本文ではなくファイル読み出し' \
  "$(bash_cmd 'git commit -F .env')"

run_case deny 'メッセージの後ろに繋げた読み出し（1 文字引用なら後半も検査される）' \
  "$(bash_cmd 'git commit -m \"chore: 整理する\" && cat .env')"

run_case deny 'Read の file_path' \
  "$(read_path "$project/.env")"

run_case deny '秘密鍵' \
  "$(bash_cmd 'openssl x509 -in server.pem -text')"

run_case deny 'SSH 鍵' \
  "$(bash_cmd 'cat ~/.ssh/id_rsa')"

run_case deny '認証情報ディレクトリ' \
  "$(bash_cmd 'cat ~/.aws/credentials')"

run_case deny 'プロジェクト外の絶対パス（Read）' \
  "$(read_path '/c/users/someone-else/note.txt')"

# コマンド文字列は JSON のエスケープを戻してから見るので、Windows 形式の
# バックスラッシュ 1 個でも検出できること（sed ではなく tr で潰している）。
run_case deny 'プロジェクト外の絶対パス（Windows 形式のコマンド）' \
  "$(bash_cmd 'cat \"C:\\Users\\someone-else\\note.txt\"')"

echo
echo '--- 通すべきもの（実行されないテキスト） ---'

run_case allow 'コミットメッセージ（二重引用符）' \
  "$(bash_cmd 'git commit -m \"docs: .env の扱いを書く\"')"

run_case allow 'コミットメッセージ（単引用符）' \
  "$(bash_cmd "git commit -m ${sq}chore: .env のコピーを worktree.sh に足す${sq}")"

run_case allow 'コミットメッセージ（--message=）' \
  "$(bash_cmd 'git commit --message=\"fix: .env.local を読まないようにする\"')"

run_case allow 'コミットメッセージ（ヒアドキュメント）' \
  "$(bash_cmd 'git commit -m \"$(cat <<EOF\nchore: .env をコピーする\n\n複数行の本文でも誤爆しない。\nEOF\n)\"')"

run_case allow 'コミットメッセージ（PowerShell のヒア文字列）' \
  "$(pwsh_cmd "git commit -m @${sq}\\nchore: .env のコピーを worktree.sh に足す\\n${sq}@")"

run_case allow 'タグのメッセージ' \
  "$(bash_cmd 'git tag -a v1.0.0 -m \".env の取り込みまで含むリリース\"')"

run_case allow 'description だけが言及している' \
  '{"tool_name":"Bash","tool_input":{"command":"git status","description":"Check .env staging"}}'

echo
echo '--- 既存の誤検知回避が壊れていないこと ---'

run_case allow 'import.meta.env（プロパティアクセス）' \
  "$(bash_cmd 'grep -r import.meta.env src/')"

run_case allow '.env.example は読んでよい' \
  "$(read_path "$project/.env.example")"

run_case allow 'プロジェクト内のファイル' \
  "$(read_path "$project/src/api/client.js")"

run_case allow 'プロジェクト内の絶対パスを含むコマンド' \
  "$(bash_cmd "ls $project/src")"

run_case allow 'worktree 置き場は許可されている' \
  "$(read_path '/c/users/0036/worktrees/sample-repo/CLAUDE.local.md')"

echo
echo '--- 既知の穴（塞いでいないことを固定しておく） ---'
# ヒア文字列 / ヒアドキュメントは終端が 2 文字で、非貪欲に閉じ位置を求められない。
# 開始以降をまとめて捨てるので、その後ろに繋げた読み出しは検査されない。
# guard-main-checkout.sh も同じ割り切り。設定は事故防止であって隔離ではない。
run_case allow 'ヒア文字列の後ろに繋げた読み出しは検査されない' \
  "$(pwsh_cmd "git commit -m @${sq}\\nchore: 整理する\\n${sq}@; Get-Content .env")"

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

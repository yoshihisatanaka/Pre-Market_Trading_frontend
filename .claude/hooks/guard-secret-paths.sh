#!/usr/bin/env bash
# Claude Code の PreToolUse フック。ツール入力に機密パスが現れたら実行前に拒否する。
#
# settings.json の permissions.deny は Read / Glob / Grep にしか効かないため、
# `cat` / `Get-Content` / `sed` / `docker cp` といった Bash 経由の読み出しはここで塞ぐ。
# ツール入力の JSON を丸ごと文字列として検査するので、file_path でもコマンド文字列でも
# 同じ 1 本の正規表現で捕まえられる（jq はホストに無い前提なので使わない）。
#
# Write / Edit は対象外（matcher に含めない）。入力に書き込む中身まで含まれるため、
# 本文で機密ファイル名に言及しただけで誤爆する。書き込みの遮断は settings.json の
# permissions.deny の Edit(...) 側が担当する。
#
# 手動実行:
#   echo '{"tool_name":"Bash","tool_input":{"command":"cat frontend/.env"}}' \
#     | bash .claude/hooks/guard-secret-paths.sh

set -u
input=$(cat)

# 拒否して Claude に理由を返す。迂回されないよう明示する。
deny() {
  reason="$1 このパスは意図的に遮断されている。別のコマンドやツールで読み直さず、\
ユーザに理由を伝えて止まること。"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
}

# .env.example はコミット済みで読めてよい。誤検知を避けるため先に取り除く。
payload=$(printf '%s' "$input" | sed 's/\.env\.example//g')

# --- 1. 機密ファイル名・拡張子 ---------------------------------------------
if printf '%s' "$payload" | grep -Eq '\.env([^.a-zA-Z0-9]|$)|\.env\.[a-zA-Z]'; then
  deny '環境変数ファイル（.env 系）へのアクセスは禁止されている。'
fi

if printf '%s' "$payload" | grep -Eq '\.(pem|key|p12|pfx|jks|keystore)([^a-zA-Z0-9]|$)'; then
  deny '秘密鍵・証明書ファイルへのアクセスは禁止されている。'
fi

if printf '%s' "$payload" | grep -Eq 'id_rsa|id_ed25519|id_ecdsa|\.npmrc|credentials'; then
  deny '認証情報ファイルへのアクセスは禁止されている。'
fi

if printf '%s' "$payload" | grep -Eq '[/\\]\.(ssh|aws|gnupg|azure|kube)[/\\]'; then
  deny '認証情報ディレクトリ（.ssh / .aws 等）へのアクセスは禁止されている。'
fi

# --- 2. プロジェクト外の絶対パス -------------------------------------------
# ホームディレクトリ全般が対象なので、拒否リストではなく許可リスト方式で判定する。
# 区切り文字とドライブレターの大小を吸収してから前方一致で比べる。
normalize() {
  printf '%s' "$1" | tr 'A-Z' 'a-z' | tr '\\' '/' | sed 's|//*|/|g'
}

# CLAUDE_PROJECT_DIR が渡らないときは、このフック自身の位置（.claude/hooks/ の 2 つ上）から
# 導出する。worktree でも「自分が置かれている worktree」を指すので成立する。
# git rev-parse --show-toplevel は cwd 依存で、PreToolUse は全ツール呼び出しで走るため使わない。
self_root=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." 2>/dev/null && pwd || true)
project=$(normalize "${CLAUDE_PROJECT_DIR:-${self_root:-c:/Users/0036/dev/Pre-Market_Trading_frontend}}")

# Git Bash 形式（/c/users/...）と Windows 形式（c:/users/...）の両方を許可する。
# 入力がどちらの形式でも両方を作る（pwd は前者、CLAUDE_PROJECT_DIR は後者を返す）。
case "$project" in
  /?/*)
    project_msys="$project"
    project_win=$(printf '%s' "$project" | sed 's|^/\([a-z]\)/|\1:/|')
    ;;
  *)
    project_win="$project"
    project_msys=$(printf '%s' "$project" | sed 's|^\([a-z]\):|/\1|')
    ;;
esac

home=$(printf '%s' "$project_win" | sed 's|\(/users/[^/]*\)/.*|\1|')
home_msys=$(printf '%s' "$project_msys" | sed 's|\(/users/[^/]*\)/.*|\1|')

allowed="$project_win $project_msys"
for h in "$home" "$home_msys"; do
  # worktrees は並行セッション用の worktree 置き場（scripts/worktree.sh が作る）。
  # 本体 → worktrees は許可する（worktree の作成・撤収は本体セッションの仕事）。
  # 逆向き（worktree → 本体の dev/）は許可しない。worktree セッションが絶対パスで本体を
  # 書き換えると main に未コミット変更が生えるため、そこは塞いだままにする。
  allowed="$allowed $h/appdata/local/temp/claude $h/.claude $h/worktrees"
done

# JSON 中に現れる絶対パスらしき文字列を列挙する（\\ でエスケープされた形も戻す）。
paths=$(printf '%s' "$payload" | sed 's|\\\\|/|g' | tr '"' '\n' \
  | grep -Eio '(/[a-z]/users/|[a-z]:/users/)[^ *?<>|]*' || true)

for p in $paths; do
  np=$(normalize "$p")
  ok=0
  for a in $allowed; do
    case "$np" in
      "$a" | "$a"/*) ok=1; break ;;
    esac
  done
  if [ "$ok" -eq 0 ]; then
    deny "プロジェクト外の絶対パス（$p）へのアクセスは禁止されている。"
  fi
done

exit 0

#!/usr/bin/env bash
# Claude Code の PreToolUse フック。ツール入力に機密パスが現れたら実行前に拒否する。
#
# settings.json の permissions.deny は Read / Glob / Grep にしか効かないため、
# `cat` / `Get-Content` / `sed` / `docker cp` といった Bash 経由の読み出しはここで塞ぐ。
# 判定は 1 本の正規表現だが、かける対象はツールで変える（jq はホストに無い前提なので使わない）:
#
#   - Read / Glob / Grep … 入力が小さくパスしか入らないので、ペイロード全体
#   - Bash / PowerShell  … tool_input.command だけ。さらに git のメッセージ本文を除く
#
# 後者を絞るのは誤検知を止めるため。ペイロード全体を見ると、実行されないテキスト
# （コミットメッセージ本文や description）で機密ファイル名に触れただけで拒否される。
# 「chore: .env のコピーを worktree.sh に足す」のようなコミットが軒並み止まった。
#
# Write / Edit は対象外（matcher に含めない）。入力に書き込む中身まで含まれるため、
# 本文で機密ファイル名に言及しただけで誤爆する。書き込みの遮断は settings.json の
# permissions.deny の Edit(...) 側が担当する。
#
# 回帰テスト。ケースはスクリプトの中に置いてある（`.env` を含むコマンドはこのフック自身に
# 拒否されるので、1 行を手で流す形の動作確認は成立しない）:
#   bash .claude/hooks/tests/guard-secret-paths.test.sh

set -u
input=$(cat)

# 拒否して Claude に理由を返す。迂回されないよう明示する。
deny() {
  reason="$1 このパスは意図的に遮断されている。別のコマンドやツールで読み直さず、\
ユーザに理由を伝えて止まること。"
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
}

# git のメッセージ本文を検査対象から外す。実行されないテキストであり、
# 「.env の扱いを直す」のようなコミットメッセージで誤爆するため。
# 働くのは git commit / tag / merge / notes を含むコマンドのときだけ。無条件に適用すると
# `docker compose run --rm frontend sh <<'EOF'` のようなヒアドキュメント経由の読み出しが素通りする。
strip_git_message() {
  cmd="$1"
  case "$cmd" in
  *git*commit* | *git*tag* | *git*merge* | *git*notes*) ;;
  *)
    printf '%s' "$cmd"
    return
    ;;
  esac

  # 1 文字で閉じる引用は本文だけ削り、以降のコマンドは検査を続ける
  # （`git commit -m "..." && cat <機密>` の後半は従来どおり捕まる）。
  cmd=$(printf '%s' "$cmd" | sed -E \
    -e "s/(-m|--message)([=[:space:]]+)'[^']*'/\1\2''/g" \
    -e 's/(-m|--message)([=[:space:]]+)"[^"]*"/\1\2""/g')

  # 終端が 2 文字のもの（ヒアドキュメント / PowerShell のヒア文字列）は非貪欲に閉じ位置を
  # 求められないので、開始以降をまとめて捨てる。guard-main-checkout.sh の
  # cmd=${cmd%%<<*} と同じ割り切りで、この後ろに繋げた読み出しは検査されない。
  q="'"
  cmd=${cmd%%<<*}
  cmd=${cmd%%@$q*}
  cmd=${cmd%%@\"*}
  printf '%s' "$cmd"
}

# --- 検査対象の切り出し -----------------------------------------------------
tool=$(printf '%s' "$input" |
  grep -oE '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 |
  sed -e 's/^"tool_name"[[:space:]]*:[[:space:]]*"//' -e 's/"$//')

case "$tool" in
Bash | PowerShell)
  # コマンド文字列だけを取り出す（guard-main-checkout.sh と同じ切り出し。
  # フックは 1 本ずつ自己完結させる方針なので、共通ライブラリにはしない）。
  match=$(printf '%s' "$input" |
    grep -oE '"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n1) || true
  [ -n "$match" ] || exit 0
  # JSON のエスケープを戻す。判定に要るのは語の区切りだけなので、
  # \n と \t は空白に潰し、\" と \\ を実体に戻せば足りる。
  payload=$(printf '%s' "$match" |
    sed -e 's/^"command"[[:space:]]*:[[:space:]]*"//' -e 's/"$//' \
      -e 's/\\n/ /g' -e 's/\\t/ /g' -e 's/\\"/"/g' -e 's/\\\\/\\/g')
  payload=$(strip_git_message "$payload")
  ;;
*)
  payload="$input"
  ;;
esac

# .env.example はコミット済みで読めてよい。誤検知を避けるため先に取り除く。
payload=$(printf '%s' "$payload" | sed 's/\.env\.example//g')

# --- 1. 機密ファイル名・拡張子 ---------------------------------------------
# 直前が識別子の文字（英数字・アンダースコア）なら、ファイル名ではなくプロパティ
# アクセスとみなして見逃す（`import.meta.env` / `process.env`）。ファイル名として
# 現れるときは、必ず先頭・空白・引用符・`/`・`\`・`=` のいずれかが直前に来る。
if printf '%s' "$payload" | grep -Eq '(^|[^A-Za-z0-9_])\.env([^.A-Za-z0-9]|$)|(^|[^A-Za-z0-9_])\.env\.[A-Za-z]'; then
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

# 絶対パスらしき文字列を列挙する。バックスラッシュはここで区切り文字に寄せる
# （JSON のままなら \\、コマンド文字列としてアンエスケープ済みなら \。tr で両方潰す）。
paths=$(printf '%s' "$payload" | tr '\\' '/' | tr '"' '\n' \
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

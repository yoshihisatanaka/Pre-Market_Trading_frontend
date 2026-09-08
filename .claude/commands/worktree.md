---
description: 並行セッション用の git worktree を作成 / 撤収 / 点検する
argument-hint: add <type>/<kebab> | remove <type>/<kebab> [--force] [--delete-branch] | list | doctor
allowed-tools: Bash(bash scripts/worktree.sh), Bash(bash scripts/worktree.sh *), Bash(git worktree list), Bash(git worktree list *), Bash(git status), Bash(git status *), Bash(git log *)
---

現在の状態:

!`bash scripts/worktree.sh list`

## 指示

引数: `$ARGUMENTS`

1. 引数が空、または `list` のときは、**上の出力を要約して報告するだけで終わる**。
   スクリプトを再実行しない。
2. それ以外は `bash scripts/worktree.sh $ARGUMENTS` を **そのまま 1 回だけ** 実行する。
   引数を勝手に補ったり、`git worktree` の生コマンドに書き換えたりしない
   （安全確認はすべてスクリプト側に入っている）。
3. スクリプトが非ゼロで終了したら **迂回しない**。終了コードとメッセージをそのまま
   ユーザに伝えて手を止める。とくに未コミット変更・未マージコミットで止まった場合
   （終了コード 5）に、**自分の判断で `--force` を足さない**。
   - `2` 使い方の誤り / `3` ブランチ名が規約違反 / `4` git・環境の状態不整合 /
     `5` 未コミット・未マージがある
4. `add` が成功したら、次を案内して**そこで終わる**。
   - 表示された Windows パスを **新しい VSCode ウィンドウで開き**、そこで Claude を
     起動すること（`code "<パス>"`、または File > New Window でそのフォルダを開く。
     ターミナルから使うなら `cd` してから `claude`）
   - **いまのウィンドウで新しいセッションを開いたり、`cd` して作業を続けたりしてはいけない。**
     `CLAUDE_PROJECT_DIR` は変わらないため、フックと設定が本体リポジトリを向いたままになる
   - その worktree の `CLAUDE.local.md` に「この worktree の目的」を書くこと
   - **Docker は排他利用。** `docker compose up -d frontend` / E2E / Playwright MCP /
     `localhost:5173` を使えるのは同時に 1 worktree だけで、現所有者は `list` の
     最終行に出る（詳細は CLAUDE.md の「Git worktree（並行セッション）」節）
5. `add` / `remove` の直後に `docker compose` 系のコマンドを実行しない。
6. worktree のファイルを、このセッションから絶対パスで直接編集しない。
   編集はその worktree で起動した Claude セッションの担当。

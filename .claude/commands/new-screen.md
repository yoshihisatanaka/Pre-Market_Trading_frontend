---
description: 型に乗る画面（検索一覧 / CRUD マスタ）の雛形を一括生成する。引数: <search-list|crud-master> <kebab-name> <画面名> [openapi のパス]
argument-hint: <search-list|crud-master> <kebab-name> <画面名> [/masters/xxx]
allowed-tools: Skill
---

引数: `$ARGUMENTS`

`new-screen` スキルを **Skill ツールで 1 回だけ** 呼び出し、引数をそのまま渡す。
生成するファイルと手順はすべてスキル側（`.claude/skills/new-screen/SKILL.md`）に書いてあるので、
ここで参照実装を読み直したり、ファイルの構成を独自に決めたりしない。

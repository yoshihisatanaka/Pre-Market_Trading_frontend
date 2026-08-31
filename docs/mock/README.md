# 画面モック（Manus）

## 置き方

Manus が出力した HTML / CSS / 画像を、**無加工のまま**このディレクトリに置く。
画面ごとにサブディレクトリを切ると参照しやすい。

```
docs/mock/
├─ order-list/
│  ├─ index.html
│  └─ style.css
└─ order-entry/
   └─ ...
```

## Vue コンポーネント化の手順

1. 原本をここに置く（**編集しない**。差分の参照元として残す）
2. CSS の中から色・余白・フォントサイズを [frontend/src/assets/styles/tokens.css](../../frontend/src/assets/styles/tokens.css) の CSS 変数へ吸い上げる
3. HTML を `views/` の画面 + `components/` の部品に分解する
4. 各コンポーネントの `<style scoped>` に、対応する CSS を移す（直値ではなくトークンを参照する形に書き換える）

## 現状

- 公開 URL（`https://uspreorder-vmbhej3k.manus.space/`）で受領。**素の CSS**（Tailwind ではない）
- 共通レイアウト部分を `layout/masters-users.html` に保存済み。CSS はこの 1 ファイルにインラインで入っている
  （どの画面を保存しても共通部分の CSS は同一。`.sidebar-*` / `.topbar-*` / `.btn` / `.card` / `.badge` などの原本）
- 配色・文字サイズは `tokens.css` へ吸い上げ済。サイドバーとヘッダは
  `frontend/src/components/layout/` にコンポーネント化済み
- 個別画面（顧客検索・注文入力・各マスタ等）はまだ取り込んでいない。着手時にこのディレクトリへ
  `docs/mock/<画面>/` として保存してから分解する
